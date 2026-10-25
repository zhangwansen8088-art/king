import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/auth/auth.service';
import {
  buildLoginAttemptSubjects,
  LoginThrottleService,
  type LoginLockout,
} from '../src/auth/login-throttle.service';
import { parseTrustProxy } from '../src/config/trust-proxy';
import type { AlertService } from '../src/operations/alert.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  JWT_SECRET: process.env.JWT_SECRET,
  WEB_ORIGIN: process.env.WEB_ORIGIN,
  LOGIN_MAX_FAILURES: process.env.LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MINUTES: process.env.LOGIN_WINDOW_MINUTES,
  LOGIN_LOCK_MINUTES: process.env.LOGIN_LOCK_MINUTES,
  LOGIN_ATTEMPT_RETENTION_HOURS: process.env.LOGIN_ATTEMPT_RETENTION_HOURS,
};

function restoreEnv(name: keyof typeof originalEnv): void {
  const value = originalEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
  process.env.WEB_ORIGIN = 'http://127.0.0.1:5173';
  process.env.LOGIN_MAX_FAILURES = '3';
  process.env.LOGIN_WINDOW_MINUTES = '15';
  process.env.LOGIN_LOCK_MINUTES = '15';
  process.env.LOGIN_ATTEMPT_RETENTION_HOURS = '24';
});

afterAll(() => {
  for (const name of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
    restoreEnv(name);
  }
});

describe('可信代理配置', () => {
  it('只接受明确的 IP、CIDR 和 Express 预定义网段', () => {
    expect(parseTrustProxy(' loopback, 172.20.0.0/16, 192.0.2.10 ')).toEqual([
      'loopback',
      '172.20.0.0/16',
      '192.0.2.10',
    ]);
  });

  it.each(['*', 'proxy.example.com', '10.0.0.0/0', '10.0.0.0/33', '10.0.0.0/abc'])(
    '拒绝危险或无法验证的配置：%s',
    (value) => {
      expect(() => parseTrustProxy(value)).toThrow('TRUST_PROXY_CIDRS');
    },
  );
});

async function fetchObservedIp(trustProxy: string[], forwardedFor: string): Promise<string> {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.get('/client-ip', (request, response) => {
    response.json({ ip: request.ip });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // 测试服务无论断言是否失败都必须在 finally 中关闭，避免残留端口和后台句柄。
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/client-ip`, {
      headers: { 'X-Forwarded-For': forwardedFor },
    });
    if (!response.ok) throw new Error(`测试服务返回 HTTP ${response.status}`);
    const body = (await response.json()) as { ip?: string };
    if (!body.ip) throw new Error('测试服务未返回客户端 IP');
    return body.ip;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('可信代理 HTTP 边界', () => {
  it('代理来源命中可信网段时采用转发头中的客户端 IP', async () => {
    const clientIp = '198.51.100.25';

    await expect(fetchObservedIp(parseTrustProxy('loopback'), clientIp)).resolves.toBe(clientIp);
  });

  it('来源未命中可信网段时忽略伪造转发头并保留 TCP 地址', async () => {
    const spoofedIp = '198.51.100.26';
    const observedIp = await fetchObservedIp(parseTrustProxy('192.0.2.10'), spoofedIp);

    expect(observedIp).not.toBe(spoofedIp);
    expect(['127.0.0.1', '::1', '::ffff:127.0.0.1']).toContain(observedIp);
  });
});

describe('登录失败计数标识', () => {
  it('账号和 IP 使用隔离哈希，且不包含原始值', () => {
    const username = 'security-test-account';
    const ipAddress = '203.0.113.25';
    const subjects = buildLoginAttemptSubjects(username, ipAddress);

    expect(subjects.map(({ scope }) => scope)).toEqual(['ACCOUNT', 'IP']);
    expect(new Set(subjects.map(({ subjectHash }) => subjectHash)).size).toBe(2);
    for (const subject of subjects) {
      expect(subject.subjectHash).toMatch(/^[0-9a-f]{64}$/);
      expect(subject.subjectHash).not.toContain(username);
      expect(subject.subjectHash).not.toContain(ipAddress);
    }
  });

  it('IPv4 映射地址按同一 IP 计数', () => {
    const direct = buildLoginAttemptSubjects('account', '203.0.113.25')[1]?.subjectHash;
    const mapped = buildLoginAttemptSubjects('account', '::ffff:203.0.113.25')[1]?.subjectHash;

    expect(mapped).toBe(direct);
  });
});

describe('登录限速行为', () => {
  it('锁定期间返回 429 和准确的剩余秒数', async () => {
    const lockedUntil = new Date(Date.now() + 10_100);
    const prisma = {
      loginAttempt: {
        findMany: vi.fn(async () => [{ lockedUntil }]),
      },
    } as unknown as PrismaService;
    const throttle = new LoginThrottleService(prisma);

    try {
      await throttle.assertAllowed('account', '203.0.113.25');
      throw new Error('预期登录被临时锁定');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(exception.getResponse()).toMatchObject({
        message: '登录尝试过于频繁，请稍后再试',
        retryAfterSeconds: 11,
      });
    }
  });

  it('成功登录只清除账号计数，不清除 IP 计数', async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const prisma = {
      loginAttempt: { deleteMany },
    } as unknown as PrismaService;
    const throttle = new LoginThrottleService(prisma);
    const [account] = buildLoginAttemptSubjects('security-test-account', '203.0.113.25');

    await throttle.clearAccount('security-test-account');

    expect(deleteMany).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith({ where: account });
    expect(deleteMany.mock.calls[0]?.[0].where).not.toMatchObject({ OR: expect.anything() });
  });
});

describe('登录锁定告警', () => {
  it('只发送哈希和锁定信息，不发送账号、密码或原始 IP', async () => {
    const username = 'private-account';
    const password = 'private-password';
    const ipAddress = '203.0.113.88';
    const lockedUntil = new Date('2026-10-25T06:15:00.000Z');
    const lockout: LoginLockout = {
      scope: 'ACCOUNT',
      subjectHash: buildLoginAttemptSubjects(username, ipAddress)[0]!.subjectHash,
      failureCount: 3,
      lockedUntil,
    };
    const throttle = {
      assertAllowed: vi.fn(async () => undefined),
      recordFailure: vi.fn(async () => [lockout]),
      clearAccount: vi.fn(async () => undefined),
    };
    const prisma = {
      user: { findUnique: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async () => ({ id: 'audit-log-id' })) },
    } as unknown as PrismaService;
    const alerts = { notifyLoginLockout: vi.fn(async () => undefined) } as unknown as AlertService;
    const auth = new AuthService(
      prisma,
      {} as JwtService,
      throttle as unknown as LoginThrottleService,
      alerts,
    );

    await expect(auth.login(username, password, 'test-agent', ipAddress)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(alerts.notifyLoginLockout).toHaveBeenCalledOnce();
    const alertText = JSON.stringify(vi.mocked(alerts.notifyLoginLockout).mock.calls[0]?.[0]);
    expect(alertText).not.toContain(username);
    expect(alertText).not.toContain(password);
    expect(alertText).not.toContain(ipAddress);
    expect(alertText).toContain(lockout.subjectHash);
  });
});
