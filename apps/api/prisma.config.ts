import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 不再自动读取 .env，按本地与工作区根目录顺序加载已有配置。
for (const envFile of ['.env', '../../.env']) {
  const envPath = resolve(envFile);
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
