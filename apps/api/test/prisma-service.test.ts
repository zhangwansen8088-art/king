import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { describe, expect, it, vi } from 'vitest';

describe('PrismaService.serializable', () => {
  it('P2034 重试耗尽后返回业务异常而非泄漏 Prisma 错误', async () => {
    const service = Object.create(PrismaService.prototype) as PrismaService;
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const transaction = vi.fn().mockRejectedValue(conflict);
    Object.defineProperty(service, '$transaction', { value: transaction });

    const result = service.serializable(async () => 'unreachable');
    await expect(result).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(result).rejects.toThrow('系统繁忙，请稍后重试');
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('claimRandom 可将 P2034 耗尽映射为当前无可用任务 400', async () => {
    const service = Object.create(PrismaService.prototype) as PrismaService;
    const conflict = new Prisma.PrismaClientKnownRequestError('serialization conflict', {
      code: 'P2034',
      clientVersion: 'test',
    });
    const transaction = vi.fn().mockRejectedValue(conflict);
    const fallback = vi.fn(() => new BadRequestException('当前没有可随机分配的推广任务'));
    Object.defineProperty(service, '$transaction', { value: transaction });

    const result = service.serializable(async () => 'unreachable', fallback);
    await expect(result).rejects.toBeInstanceOf(BadRequestException);
    await expect(result).rejects.toThrow('当前没有可随机分配的推广任务');
    expect(fallback).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledTimes(5);
  });
});
