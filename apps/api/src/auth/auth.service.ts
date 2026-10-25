import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import argon2 from 'argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadEnv } from '../config/env';
import { AlertService } from '../operations/alert.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthSessionRecord, SessionUser } from '@max-promotion/contracts';
import { buildLoginAttemptSubjects, LoginThrottleService } from './login-throttle.service';

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  refreshExpiresAt: Date;
  user: SessionUser;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

// 不存在的账号也执行一次 Argon2 校验，避免通过响应耗时枚举账号。
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$IVhB4rV370kK+fpF6yEaZg$u/E2DyYX5PmiQvFkBOO41piD6WECjQy76AGOUrphGPA';

@Injectable()
export class AuthService {
  private readonly env = loadEnv();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly throttle: LoginThrottleService,
    private readonly alerts: AlertService,
  ) {}

  async login(
    username: string,
    password: string,
    userAgent: string,
    ipAddress: string,
  ): Promise<IssuedSession> {
    await this.throttle.assertAllowed(username, ipAddress);
    const user = await this.prisma.user.findUnique({ where: { username: username.trim() } });
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      password,
    );
    const validUser = user && user.status === 'ACTIVE' && user.role !== 'MERCHANT';
    if (!validUser || !passwordMatches) {
      const lockouts = await this.throttle.recordFailure(username, ipAddress);
      const accountHash = buildLoginAttemptSubjects(username, ipAddress)[0]?.subjectHash ?? '';
      await this.prisma.auditLog.create({
        data: {
          ...(user ? { actorId: user.id } : {}),
          action: 'LOGIN_FAILURE',
          entityType: 'AUTH_ACCOUNT',
          entityId: accountHash,
          detail: '账号登录失败',
          // 失败审计只保留来源信息，禁止写入密码、令牌或请求体。
          metadata: { ipAddress: ipAddress.slice(0, 100), userAgent: userAgent.slice(0, 500) },
        },
      });
      for (const lockout of lockouts) {
        await this.prisma.auditLog.create({
          data: {
            action: 'LOGIN_LOCKED',
            entityType: `AUTH_${lockout.scope}`,
            entityId: lockout.subjectHash,
            detail: '登录失败次数达到阈值，临时锁定',
            metadata: {
              failureCount: lockout.failureCount,
              lockedUntil: lockout.lockedUntil.toISOString(),
            },
          },
        });
        void this.alerts.notifyLoginLockout({
          type: 'login_lockout',
          service: 'max-promotion-api',
          environment: this.env.nodeEnv,
          scope: lockout.scope,
          subjectHash: lockout.subjectHash,
          failureCount: lockout.failureCount,
          lockedUntil: lockout.lockedUntil.toISOString(),
          occurredAt: new Date().toISOString(),
        });
      }
      throw new UnauthorizedException('账号或密码不正确');
    }

    const session = this.toSessionUser(user);
    // 成功登录只清除该账号的失败计数；IP 计数按窗口自然过期，防止切换账号重置攻击来源。
    await this.throttle.clearAccount(username);
    await this.prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'LOGIN_SUCCESS',
        entityType: 'USER',
        entityId: user.id,
        detail: '账号登录成功',
        metadata: { ipAddress, userAgent },
      },
    });
    return this.issue(session, userAgent, ipAddress);
  }

  async refresh(
    rawRefreshToken: string | undefined,
    csrfToken: string | undefined,
    userAgent: string,
    ipAddress: string,
  ): Promise<IssuedSession> {
    if (!rawRefreshToken || !csrfToken) {
      throw new UnauthorizedException('刷新会话无效');
    }
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hash(rawRefreshToken) },
      include: { user: true },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== 'ACTIVE' ||
      session.user.role === 'MERCHANT' ||
      !sameHash(session.csrfHash, hash(csrfToken))
    ) {
      throw new UnauthorizedException('刷新会话已失效，请重新登录');
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshSession.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) throw new UnauthorizedException('刷新会话已使用');

      const issued = await this.issue(this.toSessionUser(session.user), userAgent, ipAddress, tx);
      await tx.refreshSession.update({
        where: { id: session.id },
        data: { replacedById: issued.sessionId },
      });
      return issued;
    });
  }

  async logout(rawRefreshToken: string | undefined, csrfToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    if (!csrfToken) throw new UnauthorizedException('注销请求校验失败');
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash: hash(rawRefreshToken) },
    });
    if (!session || session.revokedAt || !sameHash(session.csrfHash, hash(csrfToken))) {
      throw new UnauthorizedException('注销请求校验失败');
    }
    await this.prisma.refreshSession.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * 只返回当前账号仍有效、尚未过期的会话。
   * 查询结果不读取令牌哈希和 CSRF 哈希，避免敏感校验值离开服务端。
   */
  async listSessions(userId: string, currentSessionId: string): Promise<AuthSessionRecord[]> {
    const sessions = await this.prisma.refreshSession.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    return sessions.map((session) => ({
      id: session.id,
      current: session.id === currentSessionId,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    }));
  }

  /**
   * 使用带 userId 条件的原子更新撤销会话。
   * 重复撤销按幂等成功处理，其他账号的会话统一返回不存在，防止跨账号探测。
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const revoked = await transaction.refreshSession.updateMany({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count === 0) {
        const existing = await transaction.refreshSession.findFirst({
          where: { id: sessionId, userId },
          select: { id: true },
        });
        if (!existing) throw new NotFoundException('会话不存在或无权操作');
        return;
      }

      await transaction.auditLog.create({
        data: {
          actorId: userId,
          action: 'SESSION_REVOKED',
          entityType: 'REFRESH_SESSION',
          entityId: sessionId,
          detail: '用户撤销了自己的登录会话',
        },
      });
    });
  }

  private async issue(
    user: SessionUser,
    userAgent: string,
    ipAddress: string,
    client: Pick<PrismaService, 'refreshSession'> = this.prisma,
  ): Promise<IssuedSession & { sessionId: string }> {
    const refreshToken = randomBytes(48).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.env.refreshTokenDays * 24 * 60 * 60 * 1_000,
    );

    const created = await client.refreshSession.create({
      data: {
        userId: user.id,
        tokenHash: hash(refreshToken),
        csrfHash: hash(csrfToken),
        expiresAt: refreshExpiresAt,
        userAgent: userAgent.slice(0, 500),
        ipAddress: ipAddress.slice(0, 100),
      },
    });
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      sessionId: created.id,
    });

    return {
      accessToken,
      refreshToken,
      csrfToken,
      refreshExpiresAt,
      user,
      sessionId: created.id,
    };
  }

  private toSessionUser(user: {
    id: string;
    username: string;
    displayName: string;
    role: 'ADMIN' | 'PROMOTER' | 'MERCHANT';
  }): SessionUser {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };
  }
}
