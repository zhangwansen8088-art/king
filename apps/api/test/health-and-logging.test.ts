import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  createAccessLogEntry,
  getAccessLogPath,
  resolveRequestId,
} from '../src/common/request-logging.middleware';
import { HealthController } from '../src/health.controller';
import type { PrismaService } from '../src/prisma/prisma.service';

function createController(queryRaw: () => Promise<unknown>): HealthController {
  const prisma = { $queryRaw: vi.fn(queryRaw) } as unknown as PrismaService;
  return new HealthController(prisma);
}

describe('健康检查', () => {
  it('存活探针不查询数据库', () => {
    const queryRaw = vi.fn<() => Promise<unknown>>();
    const controller = createController(queryRaw);

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('数据库正常时返回就绪状态', async () => {
    const controller = createController(async () => [{ '?column?': 1 }]);

    await expect(controller.ready()).resolves.toEqual({ status: 'ok', database: 'ok' });
  });

  it('数据库异常时返回 503，且保留旧健康检查地址', async () => {
    const controller = createController(async () => {
      throw new Error('连接失败');
    });

    try {
      await controller.health();
      throw new Error('预期健康检查失败');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(503);
    }
  });
});

describe('请求访问日志', () => {
  it('接受合法请求 ID，并替换非法请求 ID', () => {
    expect(resolveRequestId('edge-request-123')).toBe('edge-request-123');
    expect(resolveRequestId('bad id\r\nforged')).not.toBe('bad id\r\nforged');
    expect(resolveRequestId(undefined)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('日志路径不包含查询参数，并限制字段长度', () => {
    expect(getAccessLogPath('/api/tasks?token=secret&phone=13800138000')).toBe('/api/tasks');
    expect(getAccessLogPath(`/api/${'a'.repeat(600)}`)).toHaveLength(512);
  });

  it('生成结构化访问日志字段', () => {
    expect(
      createAccessLogEntry(
        { method: 'GET', originalUrl: '/api/health/ready?debug=1' },
        { statusCode: 503 },
        'edge-request-123',
        12_600_000n,
      ),
    ).toEqual({
      type: 'http_request',
      requestId: 'edge-request-123',
      method: 'GET',
      path: '/api/health/ready',
      statusCode: 503,
      durationMs: 13,
      aborted: false,
    });
  });
});
