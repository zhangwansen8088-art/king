import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { loadEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { cleanupExpiredAuditLogs, type AuditCleanupResult } from './audit-retention';

@Injectable()
export class AuditRetentionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AuditRetentionService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private retentionDays = 0;
  private batchSize = 1_000;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    const env = loadEnv();
    this.retentionDays = env.auditRetentionDays;
    this.batchSize = env.auditCleanupBatchSize;
    if (this.retentionDays === 0) {
      this.logger.log('审计日志自动清理已关闭');
      return;
    }

    const intervalMs = env.auditCleanupIntervalHours * 3_600_000;
    this.timer = setInterval(() => void this.cleanupNow(), intervalMs);
    // 定时器不能阻止进程正常退出。
    this.timer.unref();
    this.logger.log(
      `审计日志自动清理已启用：保留 ${this.retentionDays} 天，每 ${env.auditCleanupIntervalHours} 小时检查一次`,
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * 同一进程内禁止重入；清理异常只记录类型，下一周期继续尝试。
   */
  async cleanupNow(): Promise<AuditCleanupResult | null> {
    if (this.running || this.retentionDays === 0) return null;
    this.running = true;
    try {
      const result = await cleanupExpiredAuditLogs(this.prisma, {
        retentionDays: this.retentionDays,
        batchSize: this.batchSize,
      });
      this.logger.log(`审计日志清理完成：删除 ${result.deletedCount} 条，共 ${result.batches} 批`);
      return result;
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          type: 'audit_retention_failed',
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
      return null;
    } finally {
      this.running = false;
    }
  }
}
