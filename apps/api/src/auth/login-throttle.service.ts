import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export type LoginAttemptScope = 'ACCOUNT' | 'IP';

export interface LoginAttemptSubject {
  scope: LoginAttemptScope;
  subjectHash: string;
}

export interface LoginLockout extends LoginAttemptSubject {
  failureCount: number;
  lockedUntil: Date;
}

interface LoginAttemptState {
  scope: LoginAttemptScope;
  subjectHash: string;
  failureCount: number;
  lockedUntil: Date | null;
}

/**
 * 账号和 IP 使用不同的哈希命名空间，既避免明文落表，也不会互相碰撞。
 */
export function buildLoginAttemptSubjects(
  username: string,
  ipAddress: string,
): LoginAttemptSubject[] {
  const account = username.trim();
  const ip = ipAddress.trim().replace(/^::ffff:/i, '') || 'unknown';
  const digest = (scope: LoginAttemptScope, value: string): string =>
    createHash('sha256').update(`${scope}\0${value}`).digest('hex');

  return [
    { scope: 'ACCOUNT', subjectHash: digest('ACCOUNT', account) },
    { scope: 'IP', subjectHash: digest('IP', ip) },
  ];
}

@Injectable()
export class LoginThrottleService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly env = loadEnv();
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.cleanupTimer = setInterval(() => void this.cleanupExpiredAttempts(), 60 * 60 * 1_000);
    // 清理定时器不能阻止服务正常退出。
    this.cleanupTimer.unref();
  }

  onApplicationShutdown(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
  }

  /**
   * 登录校验前先查锁定状态，数据库异常时直接失败，不能降级为无限重试。
   */
  async assertAllowed(username: string, ipAddress: string): Promise<void> {
    const subjects = buildLoginAttemptSubjects(username, ipAddress);
    const records = await this.prisma.loginAttempt.findMany({
      where: {
        OR: subjects.map(({ scope, subjectHash }) => ({ scope, subjectHash })),
        lockedUntil: { gt: new Date() },
      },
      select: { lockedUntil: true },
    });
    const latestLock = records.reduce<Date | null>(
      (latest, record) =>
        record.lockedUntil && (!latest || record.lockedUntil > latest)
          ? record.lockedUntil
          : latest,
      null,
    );
    if (!latestLock) return;

    const retryAfterSeconds = Math.max(1, Math.ceil((latestLock.getTime() - Date.now()) / 1_000));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: '登录尝试过于频繁，请稍后再试',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * 单条 PostgreSQL UPSERT 原子累加失败次数，避免并发请求漏计或覆盖计数。
   */
  async recordFailure(
    username: string,
    ipAddress: string,
    now: Date = new Date(),
  ): Promise<LoginLockout[]> {
    const subjects = buildLoginAttemptSubjects(username, ipAddress);
    const windowCutoff = new Date(now.getTime() - this.env.loginWindowMinutes * 60_000);
    const lockUntil = new Date(now.getTime() + this.env.loginLockMinutes * 60_000);

    const results = await this.prisma.$transaction(
      subjects.map(
        (subject) => this.prisma.$queryRaw<LoginAttemptState[]>`
          INSERT INTO "LoginAttempt" (
            "id",
            "scope",
            "subjectHash",
            "failureCount",
            "windowStartedAt",
            "lastFailedAt",
            "lockedUntil",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${subject.scope}::"LoginAttemptScope",
            ${subject.subjectHash},
            1,
            ${now},
            ${now},
            NULL,
            ${now},
            ${now}
          )
          ON CONFLICT ("scope", "subjectHash") DO UPDATE
          SET
            "failureCount" = CASE
              WHEN
                "LoginAttempt"."windowStartedAt" <= ${windowCutoff}
                OR (
                  "LoginAttempt"."lockedUntil" IS NOT NULL
                  AND "LoginAttempt"."lockedUntil" <= ${now}
                )
              THEN 1
              ELSE "LoginAttempt"."failureCount" + 1
            END,
            "windowStartedAt" = CASE
              WHEN
                "LoginAttempt"."windowStartedAt" <= ${windowCutoff}
                OR (
                  "LoginAttempt"."lockedUntil" IS NOT NULL
                  AND "LoginAttempt"."lockedUntil" <= ${now}
                )
              THEN ${now}
              ELSE "LoginAttempt"."windowStartedAt"
            END,
            "lastFailedAt" = ${now},
            "lockedUntil" = CASE
              WHEN (
                CASE
                  WHEN
                    "LoginAttempt"."windowStartedAt" <= ${windowCutoff}
                    OR (
                      "LoginAttempt"."lockedUntil" IS NOT NULL
                      AND "LoginAttempt"."lockedUntil" <= ${now}
                    )
                  THEN 1
                  ELSE "LoginAttempt"."failureCount" + 1
                END
              ) >= ${this.env.loginMaxFailures}
              THEN ${lockUntil}::timestamp(3)
              ELSE NULL
            END,
            "updatedAt" = ${now}
          RETURNING
            "scope"::text AS "scope",
            "subjectHash",
            "failureCount",
            "lockedUntil"
        `,
      ),
    );

    // 并发请求可能在阈值之后继续落库，只让首次达到阈值的维度产生锁定事件。
    return results
      .flat()
      .filter(
        (record): record is LoginAttemptState & { lockedUntil: Date } =>
          record.failureCount === this.env.loginMaxFailures && record.lockedUntil !== null,
      )
      .map((record) => ({
        scope: record.scope,
        subjectHash: record.subjectHash,
        failureCount: record.failureCount,
        lockedUntil: record.lockedUntil,
      }));
  }

  /**
   * 登录成功后只清除该账号的失败窗口。
   * IP 计数不能被任意一个成功账号重置，否则攻击者可切换合法账号绕过来源限制。
   */
  async clearAccount(username: string): Promise<void> {
    const account = buildLoginAttemptSubjects(username, 'not-used')[0];
    if (!account) throw new Error('账号登录失败计数标识生成异常');
    await this.prisma.loginAttempt.deleteMany({
      where: account,
    });
  }

  /**
   * 定期删除已超过保留期的计数，防止随机账号攻击持续扩大安全表。
   */
  async cleanupExpiredAttempts(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.env.loginAttemptRetentionHours * 3_600_000);
    try {
      const result = await this.prisma.loginAttempt.deleteMany({
        where: {
          updatedAt: { lt: cutoff },
          // 保留期短于最长锁定时，也不能提前删除仍在生效的锁定。
          OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
        },
      });
      if (result.count > 0) {
        this.logger.log(`登录失败计数清理完成：删除 ${result.count} 条`);
      }
      return result.count;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          type: 'login_attempt_cleanup_failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return 0;
    }
  }
}
