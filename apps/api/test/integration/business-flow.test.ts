import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../../src/admin/admin.service';
import { FundsService } from '../../src/business/funds.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PromoterService } from '../../src/promoter/promoter.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error('缺少 TEST_DATABASE_URL，拒绝运行数据库集成测试');
}

const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
if (!databaseName.endsWith('_test')) {
  throw new Error('TEST_DATABASE_URL 的数据库名必须以 _test 结尾，防止误清理业务库');
}
process.env.DATABASE_URL = testDatabaseUrl;

const fixedNow = new Date('2026-10-25T04:00:00.000Z');
const startsAt = '2026-10-25T03:00:00.000Z';
const endsAt = '2026-10-26T03:00:00.000Z';

let prisma: PrismaService;
let admin: AdminService;
let promoter: PromoterService;
let funds: FundsService;

async function truncateTestDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "LedgerEntry", "Withdrawal", "Submission", "Task", ' +
      '"MerchantProfile", "RefreshSession", "Wallet", "User" RESTART IDENTITY CASCADE',
  );
}

async function createUser(input: {
  username: string;
  displayName: string;
  role: 'ADMIN' | 'PROMOTER';
  availableCents?: bigint;
  parentId?: string;
}) {
  return prisma.user.create({
    data: {
      username: input.username,
      passwordHash: 'integration-test-only',
      displayName: input.displayName,
      role: input.role,
      parentId: input.parentId,
      wallet: { create: { availableCents: input.availableCents ?? 0n } },
    },
  });
}

async function seedBusinessActors() {
  const adminUser = await createUser({
    username: 'admin-integration',
    displayName: '集成测试管理员',
    role: 'ADMIN',
  });
  const parent = await createUser({
    username: 'promoter-parent',
    displayName: '一级推广客户',
    role: 'PROMOTER',
    availableCents: 100_000n,
  });
  const child = await createUser({
    username: 'promoter-child',
    displayName: '测试推广客户',
    role: 'PROMOTER',
    availableCents: 200_000n,
    parentId: parent.id,
  });
  const merchant = await admin.createMerchant(adminUser.id, {
    companyName: '集成测试商户',
    displayName: '集成测试商户账号',
    contactName: '测试联系人',
    contactPhone: '13800000000',
    note: '仅用于隔离数据库测试',
  });
  if (!merchant.merchantProfile) throw new Error('测试商户资料创建失败');

  await admin.adjustWallet(adminUser.id, merchant.id, {
    requestId: randomUUID(),
    amountCents: '100000',
    reason: '隔离数据库集成测试充值',
  });

  return {
    adminUser,
    parent,
    child,
    merchantId: merchant.merchantProfile.id,
    merchantUserId: merchant.id,
  };
}

function taskDraft(merchantId: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    merchantId,
    title: '集成测试推广任务',
    description: '验证领取、提交、审核、结算和退款闭环',
    adContent: '测试广告内容',
    publicPoints: '按任务说明完成展示',
    region: '上海',
    adFeeCents: '100000',
    rewardType: 'NORMAL' as const,
    maxClaims: 2,
    startsAt,
    endsAt,
    ...overrides,
  };
}

async function grantApprovedClaims(
  userId: string,
  merchantId: string,
  count: number,
): Promise<void> {
  const taskIds = Array.from({ length: count }, () => randomUUID());
  await prisma.task.createMany({
    data: taskIds.map((id) => ({
      id,
      clientRequestId: randomUUID(),
      merchantId,
      title: `提现额度测试任务 ${id}`,
      adContent: '额度测试',
      publicPoints: '额度测试',
      region: '上海',
      adFeeCents: 100_000n,
      rewardType: 'NORMAL',
      commissionCents: 320n,
      referralCents: 64n,
      maxClaims: 1,
      budgetReservedCents: 384n,
      budgetSpentCents: 384n,
      status: 'ENDED',
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
    })),
  });
  await prisma.submission.createMany({
    data: taskIds.map((taskId) => ({
      taskId,
      promoterId: userId,
      depositCents: 0n,
      status: 'APPROVED',
      proofText: '额度测试历史凭证',
      submittedAt: fixedNow,
      reviewedAt: fixedNow,
    })),
  });
}

describe('PostgreSQL 资金与任务业务闭环', () => {
  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    funds = new FundsService(prisma);
    admin = new AdminService(prisma, funds);
    promoter = new PromoterService(prisma, funds);
  });

  beforeEach(async () => {
    vi.useFakeTimers({ now: fixedNow, toFake: ['Date'] });
    await truncateTestDatabase();
  });

  afterAll(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await prisma.$disconnect();
  });

  it('发布、领取、审核通过、返佣和剩余预算退回只结算一次', async () => {
    const actors = await seedBusinessActors();
    const draft = taskDraft(actors.merchantId);
    const task = await admin.createTask(actors.adminUser.id, draft);
    const duplicateTask = await admin.createTask(actors.adminUser.id, {
      ...draft,
      title: '重复请求不应生成新任务',
    });

    expect(duplicateTask.id).toBe(task.id);
    expect(await prisma.ledgerEntry.count({ where: { type: 'TASK_BUDGET_FREEZE' } })).toBe(1);

    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const submission = await promoter.claimRandom(actors.child.id);
    random.mockRestore();

    expect(submission.depositCents).toBe(140_000n);
    await expect(promoter.claimRandom(actors.child.id)).rejects.toBeInstanceOf(BadRequestException);
    await promoter.submitProof(actors.child.id, submission.id, {
      proofText: '已完成展示并上传现场凭证',
      proofUrl: 'https://example.com/integration-proof',
    });
    await admin.reviewSubmission(actors.adminUser.id, submission.id, {
      decision: 'APPROVED',
      note: '集成测试审核通过',
    });

    const childWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: actors.child.id },
    });
    const parentWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: actors.parent.id },
    });
    expect(childWallet.availableCents).toBe(200_320n);
    expect(childWallet.frozenCents).toBe(0n);
    expect(parentWallet.availableCents).toBe(100_064n);

    const ledgerCount = await prisma.ledgerEntry.count();
    await expect(
      admin.reviewSubmission(actors.adminUser.id, submission.id, {
        decision: 'APPROVED',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCount);

    await admin.updateTaskStatus(actors.adminUser.id, task.id, 'ENDED');
    const merchantWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: actors.merchantUserId },
    });
    const closedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(merchantWallet.availableCents).toBe(99_616n);
    expect(merchantWallet.frozenCents).toBe(0n);
    expect(closedTask.budgetSpentCents).toBe(384n);
    expect(closedTask.budgetRefundedCents).toBe(384n);
  });

  it('任务列表按状态筛选，并返回稳定分页', async () => {
    const actors = await seedBusinessActors();
    const statuses = ['OPEN', 'OPEN', 'PAUSED', 'ENDED', 'OPEN'] as const;
    await prisma.task.createMany({
      data: statuses.map((status, index) => ({
        clientRequestId: randomUUID(),
        merchantId: actors.merchantId,
        title: `任务分页测试 ${index + 1}`,
        adContent: '任务分页测试广告内容',
        publicPoints: '任务分页测试展示要求',
        region: '上海',
        adFeeCents: 100_000n,
        rewardType: 'NORMAL',
        commissionCents: 320n,
        referralCents: 64n,
        maxClaims: 1,
        budgetReservedCents: 384n,
        status,
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      })),
    });

    const allPage = await admin.tasks({ page: 1, pageSize: 2 });
    expect(allPage).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(allPage.items).toHaveLength(2);

    const openPage = await admin.tasks({ page: 2, pageSize: 1, status: 'OPEN' });
    expect(openPage).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(openPage.items).toHaveLength(1);
    expect(openPage.items[0].status).toBe('OPEN');

    const clampedPage = await admin.tasks({ page: 99, pageSize: 2, status: 'ENDED' });
    expect(clampedPage).toMatchObject({ total: 1, page: 1, pageSize: 2 });
    expect(clampedPage.items[0].status).toBe('ENDED');
  });

  it('凭证驳回只退保证金，不扣任务预算和佣金', async () => {
    const actors = await seedBusinessActors();
    const task = await admin.createTask(actors.adminUser.id, taskDraft(actors.merchantId));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const submission = await promoter.claimRandom(actors.child.id);
    random.mockRestore();
    await promoter.submitProof(actors.child.id, submission.id, {
      proofText: '提交待驳回的测试凭证',
    });
    await admin.reviewSubmission(actors.adminUser.id, submission.id, {
      decision: 'REJECTED',
      note: '凭证不符合任务要求',
    });

    const childWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: actors.child.id },
    });
    const parentWallet = await prisma.wallet.findUniqueOrThrow({
      where: { userId: actors.parent.id },
    });
    const unchangedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(childWallet.availableCents).toBe(200_000n);
    expect(childWallet.frozenCents).toBe(0n);
    expect(parentWallet.availableCents).toBe(100_000n);
    expect(unchangedTask.budgetSpentCents).toBe(0n);
    expect(unchangedTask.approvedCount).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: 'COMMISSION' } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: 'REFERRAL' } })).toBe(0);
  });

  it('提现驳回不扣款，打款只扣一次，重复审核被拒绝', async () => {
    const actors = await seedBusinessActors();
    await grantApprovedClaims(actors.child.id, actors.merchantId, 120);

    const status = await promoter.withdrawalStatus(actors.child.id);
    expect(status.totalQuota).toBe(2);
    expect(status.remainingQuota).toBe(2);

    const rejected = await promoter.requestWithdrawal(actors.child.id, {
      amountCents: '50000',
      payoutAccount: '支付宝：集成测试收款人',
    });
    await admin.reviewWithdrawal(actors.adminUser.id, rejected.id, {
      decision: 'REJECTED',
      note: '收款信息不完整',
    });
    let wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: actors.child.id } });
    expect(wallet.availableCents).toBe(200_000n);

    const paid = await promoter.requestWithdrawal(actors.child.id, {
      amountCents: '50000',
      payoutAccount: '支付宝：集成测试收款人',
    });
    await admin.reviewWithdrawal(actors.adminUser.id, paid.id, {
      decision: 'PAID',
      note: '集成测试确认打款',
    });
    wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: actors.child.id } });
    expect(wallet.availableCents).toBe(150_000n);

    await expect(
      admin.reviewWithdrawal(actors.adminUser.id, paid.id, { decision: 'PAID' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: actors.child.id } });
    expect(wallet.availableCents).toBe(150_000n);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'WITHDRAWAL_PAID', referenceId: paid.id },
      }),
    ).toBe(1);
  });

  it('审计日志按动作和实体筛选，并返回稳定分页', async () => {
    const adminUser = await createUser({
      username: 'audit-admin',
      displayName: '审计测试管理员',
      role: 'ADMIN',
    });
    await prisma.auditLog.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        actorId: adminUser.id,
        action: index < 4 ? `MERCHANT_ACTION_${index + 1}` : `TASK_ACTION_${index + 1}`,
        entityType: index < 4 ? 'MERCHANT' : 'TASK',
        entityId: randomUUID(),
        detail: `审计分页测试记录 ${index + 1}`,
      })),
    });

    const merchantPage = await admin.auditLogs({
      page: 2,
      pageSize: 2,
      action: 'merchant',
    });
    expect(merchantPage).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(merchantPage.items).toHaveLength(2);
    expect(merchantPage.items.every((log) => log.entityType === 'MERCHANT')).toBe(true);

    const taskPage = await admin.auditLogs({
      page: 1,
      pageSize: 20,
      entityType: 'task',
    });
    expect(taskPage).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(taskPage.items.every((log) => log.action.startsWith('TASK_ACTION_'))).toBe(true);

    const clampedPage = await admin.auditLogs({
      page: 99,
      pageSize: 2,
      entityType: 'TASK',
    });
    expect(clampedPage).toMatchObject({ total: 2, page: 1, pageSize: 2 });
  });
});
