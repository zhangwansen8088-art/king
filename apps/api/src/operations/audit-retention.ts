import type { PrismaService } from '../prisma/prisma.service';

export interface AuditCleanupResult {
  retentionDays: number;
  cutoff: Date;
  deletedCount: number;
  batches: number;
}

/**
 * 分批清理超过保留期的审计日志，并在完成后写入一条系统审计记录。
 * 生产环境是否启用以及保留天数由环境变量控制，默认关闭。
 */
export async function cleanupExpiredAuditLogs(
  prisma: PrismaService,
  input: {
    retentionDays: number;
    batchSize: number;
    now?: Date;
  },
): Promise<AuditCleanupResult> {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1) {
    throw new Error('审计日志保留天数必须是大于 0 的整数');
  }
  if (!Number.isInteger(input.batchSize) || input.batchSize < 1) {
    throw new Error('审计日志清理批次必须是大于 0 的整数');
  }

  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - input.retentionDays * 86_400_000);
  let deletedCount = 0;
  let batches = 0;

  while (true) {
    const expiredLogs = await prisma.auditLog.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.batchSize,
    });
    if (expiredLogs.length === 0) break;

    const result = await prisma.auditLog.deleteMany({
      where: {
        id: { in: expiredLogs.map((log) => log.id) },
        createdAt: { lt: cutoff },
      },
    });
    deletedCount += result.count;
    batches += 1;

    // 已无匹配记录时立即结束，避免多实例并发清理形成空循环。
    if (result.count === 0 || expiredLogs.length < input.batchSize) break;
  }

  await prisma.auditLog.create({
    data: {
      action: 'AUDIT_LOG_RETENTION_CLEANUP',
      entityType: 'AUDIT_LOG',
      entityId: 'automatic-retention',
      detail: `自动清理 ${input.retentionDays} 天前的审计日志，共删除 ${deletedCount} 条`,
      metadata: {
        retentionDays: input.retentionDays,
        cutoff: cutoff.toISOString(),
        deletedCount,
        batches,
      },
      createdAt: now,
    },
  });

  return {
    retentionDays: input.retentionDays,
    cutoff,
    deletedCount,
    batches,
  };
}
