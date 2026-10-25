import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

async function seedUser(input: {
  username: string;
  displayName: string;
  password: string;
  role: 'ADMIN' | 'PROMOTER';
  parentId?: string;
}) {
  const passwordHash = await argon2.hash(input.password);
  const user = await prisma.user.upsert({
    where: { username: input.username },
    update: {
      passwordHash,
      displayName: input.displayName,
      role: input.role,
      status: 'ACTIVE',
      ...(input.parentId ? { parentId: input.parentId } : {}),
    },
    create: {
      username: input.username,
      passwordHash,
      displayName: input.displayName,
      role: input.role,
      status: 'ACTIVE',
      ...(input.parentId ? { parentId: input.parentId } : {}),
      wallet: { create: {} },
    },
  });
  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id },
  });
  return user;
}

async function main(): Promise<void> {
  if (process.env.SEED_DEMO_DATA !== 'true') {
    console.log('未设置 SEED_DEMO_DATA=true，跳过演示数据。');
    return;
  }

  const admin = await seedUser({
    username: required('DEMO_ADMIN_USERNAME'),
    displayName: '演示管理员',
    password: required('DEMO_ADMIN_PASSWORD'),
    role: 'ADMIN',
  });
  const promoter = await seedUser({
    username: required('DEMO_PROMOTER_USERNAME'),
    displayName: '演示推广客户',
    password: required('DEMO_PROMOTER_PASSWORD'),
    role: 'PROMOTER',
  });

  const merchantUser = await prisma.user.upsert({
    where: { username: 'merchant-demo' },
    update: { displayName: '演示商户（仅后台资料）', status: 'ACTIVE' },
    create: {
      username: 'merchant-demo',
      passwordHash: await argon2.hash(randomBytes(32).toString('base64url')),
      displayName: '演示商户（仅后台资料）',
      role: 'MERCHANT',
      status: 'ACTIVE',
      wallet: { create: { availableCents: 10_000_000n } },
    },
  });
  await prisma.wallet.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: { userId: merchantUser.id, availableCents: 10_000_000n },
  });
  await prisma.merchantProfile.upsert({
    where: { userId: merchantUser.id },
    update: {},
    create: {
      userId: merchantUser.id,
      companyName: '青禾茶饮（演示）',
      contactName: '陈经理',
      contactPhone: '13800000000',
      note: '演示商户没有登录入口，由管理员在后台维护。',
    },
  });

  const existingAudit = await prisma.auditLog.findFirst({
    where: { action: 'DEMO_SEED', entityType: 'SYSTEM', entityId: 'demo-seed' },
  });
  if (!existingAudit) {
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: 'DEMO_SEED',
        entityType: 'SYSTEM',
        entityId: 'demo-seed',
        detail: '初始化演示管理员、推广客户和仅后台可见的商户资料',
      },
    });
  }
  console.log('演示数据已就绪；登录密码只来自环境变量，不写入日志。');
  console.log(`推广客户：${promoter.username}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
