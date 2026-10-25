import { PrismaPg } from '@prisma/adapter-pg';

/**
 * 创建 Prisma 7 使用的 PostgreSQL 驱动适配器。
 * 缺少连接地址时立即失败，避免应用以未连接数据库的状态继续启动。
 */
export function createDatabaseAdapter(): PrismaPg {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('缺少 DATABASE_URL，已拒绝连接数据库');
  }
  return new PrismaPg({ connectionString: databaseUrl });
}
