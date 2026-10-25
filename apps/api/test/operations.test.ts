import {
  BadRequestException,
  HttpStatus,
  type ArgumentsHost,
  type HttpServer,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AlertExceptionFilter } from '../src/common/alert-exception.filter';
import {
  AlertNotifier,
  buildServerErrorAlert,
  type ServerErrorAlert,
} from '../src/common/alert-notifier';
import type { AlertService } from '../src/operations/alert.service';
import { cleanupExpiredAuditLogs } from '../src/operations/audit-retention';
import type { PrismaService } from '../src/prisma/prisma.service';

const sampleAlert: ServerErrorAlert = {
  type: 'http_server_error',
  service: 'max-promotion-api',
  environment: 'test',
  requestId: 'request-1',
  method: 'GET',
  path: '/api/tasks',
  statusCode: 500,
  errorType: 'Error',
  occurredAt: '2026-10-25T04:00:00.000Z',
};

describe('服务端错误告警', () => {
  it('只生成 5xx 告警，且不包含原始错误消息', () => {
    const alert = buildServerErrorAlert({
      environment: 'production',
      requestId: 'request-1',
      method: 'GET',
      path: '/api/tasks',
      statusCode: 500,
      errorType: 'Error',
      occurredAt: new Date('2026-10-25T04:00:00.000Z'),
    });

    expect(alert).toEqual({
      ...sampleAlert,
      environment: 'production',
    });
    expect(
      buildServerErrorAlert({
        environment: 'production',
        requestId: 'request-2',
        method: 'POST',
        path: '/api/auth/login',
        statusCode: 401,
        errorType: 'UnauthorizedException',
        occurredAt: new Date('2026-10-25T04:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('相同错误在冷却期内只发送一次', async () => {
    let currentTime = 1_000;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
    const notifier = new AlertNotifier(
      {
        webhookUrl: 'https://alerts.example.com/hook',
        timeoutMs: 2_000,
        cooldownMs: 60_000,
      },
      fetchImpl,
      () => currentTime,
    );

    await expect(notifier.notify(sampleAlert)).resolves.toBe(true);
    await expect(notifier.notify(sampleAlert)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    currentTime += 60_000;
    await expect(notifier.notify(sampleAlert)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('未配置 Webhook 时不发起网络请求', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const notifier = new AlertNotifier(
      { webhookUrl: null, timeoutMs: 2_000, cooldownMs: 60_000 },
      fetchImpl,
    );

    await expect(notifier.notify(sampleAlert)).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('全局异常过滤器', () => {
  const createContext = (request: Request, response: Response) => {
    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
      getArgByIndex: (index: number) => (index === 1 ? response : request),
    } as unknown as ArgumentsHost;
    const adapter = {
      isHeadersSent: vi.fn(() => false),
      reply: vi.fn(),
      end: vi.fn(),
    } as unknown as HttpServer;
    const alerts = {
      notifyServerError: vi.fn().mockResolvedValue(undefined),
    } as unknown as AlertService;
    return {
      host,
      adapter,
      alerts,
      filter: new AlertExceptionFilter(adapter, alerts),
    };
  };

  it('4xx 保留原响应且不发送告警', () => {
    const request = { method: 'POST', originalUrl: '/api/auth/login?token=secret' } as Request;
    const response = { getHeader: vi.fn(() => 'request-400') } as unknown as Response;
    const { host, adapter, alerts, filter } = createContext(request, response);

    filter.catch(new BadRequestException('参数错误'), host);

    expect(alerts.notifyServerError).not.toHaveBeenCalled();
    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      {
        message: '参数错误',
        error: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      },
      HttpStatus.BAD_REQUEST,
    );
  });

  it('5xx 发送脱敏告警且保留 NestJS 原响应', () => {
    const request = { method: 'POST', originalUrl: '/api/tasks?token=secret' } as Request;
    const response = { getHeader: vi.fn(() => 'request-500') } as unknown as Response;
    const { host, adapter, alerts, filter } = createContext(request, response);

    filter.catch(new Error('内部服务异常'), host);

    expect(alerts.notifyServerError).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-500',
        method: 'POST',
        path: '/api/tasks',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorType: 'Error',
      }),
    );
    expect(alerts.notifyServerError).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.anything() }),
    );
    expect(adapter.reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });
});

describe('审计日志保留清理', () => {
  it('按保留期分批删除并记录系统审计', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const create = vi.fn().mockResolvedValue({ id: 'system-audit' });
    const prisma = {
      auditLog: { findMany, deleteMany, create },
    } as unknown as PrismaService;
    const now = new Date('2026-10-25T04:00:00.000Z');

    const result = await cleanupExpiredAuditLogs(prisma, {
      retentionDays: 30,
      batchSize: 10,
      now,
    });

    expect(result).toMatchObject({
      retentionDays: 30,
      deletedCount: 2,
      batches: 1,
    });
    expect(result.cutoff.toISOString()).toBe('2026-09-25T04:00:00.000Z');
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['old-1', 'old-2'] },
        createdAt: { lt: result.cutoff },
      },
    });
    expect(create).toHaveBeenCalledOnce();
  });

  it('拒绝无效保留期和批次大小', async () => {
    const prisma = {
      auditLog: { findMany: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    } as unknown as PrismaService;

    await expect(
      cleanupExpiredAuditLogs(prisma, { retentionDays: 0, batchSize: 100 }),
    ).rejects.toThrow('保留天数');
    await expect(
      cleanupExpiredAuditLogs(prisma, { retentionDays: 30, batchSize: 0 }),
    ).rejects.toThrow('清理批次');
  });
});
