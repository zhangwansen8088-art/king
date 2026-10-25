import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import type { AuthUser } from '../src/common/auth.types';
import { JwtAuthGuard } from '../src/common/guards';
import type { AlertService } from '../src/operations/alert.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
};

const currentSessionId = '11111111-1111-4111-8111-111111111111';
const otherSessionId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'session-test-jwt-secret-with-at-least-32-characters';
  process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
});

afterAll(() => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function createAuthService(prisma: PrismaService, jwt: JwtService): AuthService {
  return new AuthService(
    prisma,
    jwt,
    {} as never,
    { notifyLoginLockout: vi.fn() } as unknown as AlertService,
  );
}

function httpContext(request: {
  headers: { authorization?: string };
  user?: AuthUser;
}): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function createGuard(
  payload: { sub?: string; sessionId?: string },
  session: { user: Record<string, unknown> } | null,
) {
  const verifyAsync = vi.fn(async () => payload);
  const findFirst = vi.fn(async () => session);
  const jwt = { verifyAsync } as unknown as JwtService;
  const reflector = { getAllAndOverride: vi.fn(() => false) } as unknown as Reflector;
  const prisma = { refreshSession: { findFirst } } as unknown as PrismaService;
  return { guard: new JwtAuthGuard(jwt, reflector, prisma), verifyAsync, findFirst };
}

describe('访问令牌与会话绑定', () => {
  it('刷新后签发的新访问令牌携带持久化会话 ID', async () => {
    const refreshToken = 'valid-refresh-token';
    const csrfToken = 'valid-csrf-token';
    const newSessionId = '44444444-4444-4444-8444-444444444444';
    const transaction = {
      refreshSession: {
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async () => ({ id: newSessionId })),
        update: vi.fn(async () => ({ id: newSessionId })),
      },
    };
    const prisma = {
      refreshSession: {
        findUnique: vi.fn(async () => ({
          id: currentSessionId,
          tokenHash: sha256(refreshToken),
          csrfHash: sha256(csrfToken),
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          user: {
            id: userId,
            username: 'session-user',
            displayName: '会话测试客户',
            role: 'PROMOTER',
            status: 'ACTIVE',
          },
        })),
      },
      $transaction: vi.fn(async (work: (client: typeof transaction) => Promise<unknown>) =>
        work(transaction),
      ),
    } as unknown as PrismaService;
    const signAsync = vi.fn(async () => 'signed-access-token');
    const jwt = { signAsync } as unknown as JwtService;
    const auth = createAuthService(prisma, jwt);

    const issued = await auth.refresh(refreshToken, csrfToken, '测试浏览器', '127.0.0.1');

    expect(issued.accessToken).toBe('signed-access-token');
    expect(signAsync).toHaveBeenCalledWith({
      sub: userId,
      role: 'PROMOTER',
      sessionId: newSessionId,
    });
  });
});

describe('会话列表', () => {
  it('只查询当前账号有效会话并返回字段白名单', async () => {
    const createdAt = new Date('2026-10-25T02:00:00.000Z');
    const expiresAt = new Date('2026-11-01T02:00:00.000Z');
    const findMany = vi.fn(async () => [
      {
        id: currentSessionId,
        userAgent: '当前设备浏览器',
        ipAddress: '203.0.113.10',
        createdAt,
        expiresAt,
      },
      {
        id: otherSessionId,
        userAgent: '其他设备浏览器',
        ipAddress: '203.0.113.11',
        createdAt,
        expiresAt,
      },
    ]);
    const prisma = { refreshSession: { findMany } } as unknown as PrismaService;
    const auth = createAuthService(prisma, {} as JwtService);

    const sessions = await auth.listSessions(userId, currentSessionId);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
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
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toEqual({
      id: currentSessionId,
      current: true,
      userAgent: '当前设备浏览器',
      ipAddress: '203.0.113.10',
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual(
      ['createdAt', 'current', 'expiresAt', 'id', 'ipAddress', 'userAgent'].sort(),
    );
    expect(JSON.stringify(sessions)).not.toMatch(/tokenHash|csrfHash/);
  });
});

describe('单会话撤销', () => {
  function createRevokeMocks(options: {
    updateCounts: number[];
    existingSession: { id: string } | null;
  }) {
    const updateMany = vi.fn();
    for (const count of options.updateCounts) {
      updateMany.mockResolvedValueOnce({ count });
    }
    const update = updateMany;
    const transaction = {
      refreshSession: {
        updateMany: update,
        findFirst: vi.fn(async () => options.existingSession),
      },
      auditLog: { create: vi.fn(async () => ({ id: 'audit-log-id' })) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: (client: typeof transaction) => Promise<unknown>) =>
        work(transaction),
      ),
    } as unknown as PrismaService;
    return { prisma, transaction };
  }

  it('撤销条件包含当前账号且只写一次审计', async () => {
    const { prisma, transaction } = createRevokeMocks({
      updateCounts: [1],
      existingSession: null,
    });
    const auth = createAuthService(prisma, {} as JwtService);

    await auth.revokeSession(userId, otherSessionId);

    expect(transaction.refreshSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: otherSessionId,
        userId,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(transaction.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: userId,
        action: 'SESSION_REVOKED',
        entityType: 'REFRESH_SESSION',
        entityId: otherSessionId,
        detail: '用户撤销了自己的登录会话',
      },
    });
  });

  it('不存在和跨账号会话统一返回 404，且不写审计', async () => {
    const { prisma, transaction } = createRevokeMocks({
      updateCounts: [0],
      existingSession: null,
    });
    const auth = createAuthService(prisma, {} as JwtService);

    await expect(auth.revokeSession(userId, otherSessionId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('重复撤销保持幂等且不会重复写审计', async () => {
    const { prisma, transaction } = createRevokeMocks({
      updateCounts: [0],
      existingSession: { id: otherSessionId },
    });
    const auth = createAuthService(prisma, {} as JwtService);

    await expect(auth.revokeSession(userId, otherSessionId)).resolves.toBeUndefined();
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('并发撤销同一会话时只有实际更新成功的一次写审计', async () => {
    const { prisma, transaction } = createRevokeMocks({
      updateCounts: [1, 0],
      existingSession: { id: otherSessionId },
    });
    const auth = createAuthService(prisma, {} as JwtService);

    await expect(
      Promise.all([
        auth.revokeSession(userId, otherSessionId),
        auth.revokeSession(userId, otherSessionId),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });
});

describe('JWT 守卫核验会话状态', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('缺少会话 ID 的旧访问令牌被拒绝', async () => {
    const { guard, findFirst } = createGuard({ sub: userId }, null);
    const request = { headers: { authorization: 'Bearer legacy-token' } };

    await expect(guard.canActivate(httpContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('会话 ID、用户、撤销状态和过期时间全部参与查询', async () => {
    const { guard, findFirst } = createGuard({ sub: userId, sessionId: currentSessionId }, null);
    const request = { headers: { authorization: 'Bearer revoked-token' } };

    await expect(guard.canActivate(httpContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: currentSessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            status: true,
          },
        },
      },
    });
  });

  it('有效会话绑定到请求用户，且不保存令牌或密码字段', async () => {
    const { guard } = createGuard(
      { sub: userId, sessionId: currentSessionId },
      {
        user: {
          id: userId,
          username: 'session-user',
          displayName: '会话测试客户',
          role: 'PROMOTER',
          status: 'ACTIVE',
        },
      },
    );
    const request: {
      headers: { authorization?: string };
      user?: AuthUser;
    } = { headers: { authorization: 'Bearer valid-token' } };

    await expect(guard.canActivate(httpContext(request))).resolves.toBe(true);
    expect(request.user).toEqual({
      id: userId,
      username: 'session-user',
      displayName: '会话测试客户',
      role: 'PROMOTER',
      sessionId: currentSessionId,
    });
    expect(JSON.stringify(request.user)).not.toMatch(/token|password|hash/i);
  });
});
