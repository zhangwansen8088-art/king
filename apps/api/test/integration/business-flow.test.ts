import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '../../src/admin/admin.service';
import { FundsService } from '../../src/business/funds.service';
import { cleanupExpiredAuditLogs } from '../../src/operations/audit-retention';
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
    merchantConfirmed: true,
    merchantConfirmation: '2026-10-25 09:30 与测试联系人电话确认，回执号 TEST-1025',
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
      authenticityConfirmed: true,
    });
    await admin.reviewSubmission(actors.adminUser.id, submission.id, {
      decision: 'APPROVED',
      note: '集成测试审核通过',
      verificationBasis: '2026-10-25 14:05 测试联系人电话确认，回执号 TEST-REVIEW-01',
      counterpartyConfirmed: true,
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
        verificationBasis: '重复审核测试，回执号 TEST-REVIEW-02',
        counterpartyConfirmed: true,
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

  it('同一推广客户并发领任务时只生成一条提交和一笔保证金流水', async () => {
    const actors = await seedBusinessActors();
    await admin.createTask(actors.adminUser.id, taskDraft(actors.merchantId));

    // 固定随机数，确保并发请求竞争同一任务，并得到可重复验证的保证金金额。
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => promoter.claimRandom(actors.child.id)),
    );
    random.mockRestore();

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(BadRequestException);
      }
    }

    const [submissionCount, guaranteeCount, task, wallet] = await Promise.all([
      prisma.submission.count({ where: { promoterId: actors.child.id } }),
      prisma.ledgerEntry.count({
        where: { type: 'GUARANTEE_FREEZE', referenceType: 'SUBMISSION' },
      }),
      prisma.task.findFirstOrThrow({ where: { merchantId: actors.merchantId } }),
      prisma.wallet.findUniqueOrThrow({ where: { userId: actors.child.id } }),
    ]);
    expect(submissionCount).toBe(1);
    expect(guaranteeCount).toBe(1);
    expect(task.claimedCount).toBe(1);
    expect(wallet).toMatchObject({ availableCents: 60_000n, frozenCents: 140_000n });
  });

  it('多个推广客户并发领取单名额任务时不能超卖', async () => {
    const actors = await seedBusinessActors();
    const otherPromoters = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createUser({
          username: `concurrent-promoter-${index + 1}`,
          displayName: `并发推广客户 ${index + 1}`,
          role: 'PROMOTER',
          availableCents: 100_000n,
        }),
      ),
    );
    const task = await admin.createTask(
      actors.adminUser.id,
      taskDraft(actors.merchantId, { maxClaims: 1 }),
    );
    const promoterIds = [actors.child.id, ...otherPromoters.map((user) => user.id)];

    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const results = await Promise.allSettled(
      promoterIds.map((promoterId) => promoter.claimRandom(promoterId)),
    );
    random.mockRestore();

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(BadRequestException);
      }
    }

    const claimedTask = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(claimedTask.claimedCount).toBe(1);
    expect(await prisma.submission.count({ where: { taskId: task.id } })).toBe(1);
    expect(
      await prisma.ledgerEntry.count({
        where: { type: 'GUARANTEE_FREEZE' },
      }),
    ).toBe(1);
  });

  it('商户广告余额不足时拒绝发布，且任务和资金流水都不落库', async () => {
    const actors = await seedBusinessActors();
    await prisma.wallet.update({
      where: { userId: actors.merchantUserId },
      data: { availableCents: 1n, frozenCents: 0n },
    });
    const draft = taskDraft(actors.merchantId);

    await expect(admin.createTask(actors.adminUser.id, draft)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    const [taskCount, freezeCount, auditCount, wallet] = await Promise.all([
      prisma.task.count(),
      prisma.ledgerEntry.count({ where: { type: 'TASK_BUDGET_FREEZE' } }),
      prisma.auditLog.count({ where: { action: 'TASK_CREATE' } }),
      prisma.wallet.findUniqueOrThrow({ where: { userId: actors.merchantUserId } }),
    ]);
    expect(taskCount).toBe(0);
    expect(freezeCount).toBe(0);
    expect(auditCount).toBe(0);
    expect(wallet).toMatchObject({ availableCents: 1n, frozenCents: 0n });
  });

  it('同一提现并发审核打款时只能扣款一次', async () => {
    const actors = await seedBusinessActors();
    await grantApprovedClaims(actors.child.id, actors.merchantId, 120);
    const withdrawal = await promoter.requestWithdrawal(actors.child.id, {
      amountCents: '50000',
      payoutAccount: '支付宝：并发提现测试收款人',
    });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        admin.reviewWithdrawal(actors.adminUser.id, withdrawal.id, {
          decision: 'PAID',
          note: '并发打款测试',
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(BadRequestException);
      }
    }

    const [wallet, paidCount, reviewAuditCount] = await Promise.all([
      prisma.wallet.findUniqueOrThrow({ where: { userId: actors.child.id } }),
      prisma.ledgerEntry.count({
        where: { type: 'WITHDRAWAL_PAID', referenceId: withdrawal.id },
      }),
      prisma.auditLog.count({
        where: { action: 'WITHDRAWAL_PAID', entityId: withdrawal.id },
      }),
    ]);
    expect(wallet.availableCents).toBe(150_000n);
    expect(paidCount).toBe(1);
    expect(reviewAuditCount).toBe(1);
  });

  it('同一 requestId 并发发布任务时稳定返回同一任务', async () => {
    const actors = await seedBusinessActors();
    const draft = taskDraft(actors.merchantId);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => admin.createTask(actors.adminUser.id, draft)),
    );

    expect(new Set(results.map((task) => task.id)).size).toBe(1);
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { type: 'TASK_BUDGET_FREEZE' } })).toBe(1);
  });

  it('未取得商户确认和提交人声明时，禁止创建任务或提交凭证', async () => {
    const actors = await seedBusinessActors();
    const draft = taskDraft(actors.merchantId);

    await expect(
      admin.createTask(actors.adminUser.id, {
        ...draft,
        merchantConfirmed: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      admin.createTask(actors.adminUser.id, {
        ...draft,
        merchantConfirmation: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { type: 'TASK_BUDGET_FREEZE' } })).toBe(0);

    const task = await admin.createTask(actors.adminUser.id, draft);
    const taskAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TASK_CREATE', entityId: task.id },
    });
    expect(taskAudit.detail).toContain(draft.merchantConfirmation);

    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const submission = await promoter.claimRandom(actors.child.id);
    random.mockRestore();

    await expect(
      promoter.submitProof(actors.child.id, submission.id, {
        proofText: '提交人未确认的测试凭证',
        authenticityConfirmed: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const unchanged = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(unchanged.status).toBe('CLAIMED');
    expect(unchanged.submittedAt).toBeNull();
  });

  it('凭证地址拒绝内网，审核通过必须有对方确认和可追溯依据', async () => {
    const actors = await seedBusinessActors();
    await admin.createTask(actors.adminUser.id, taskDraft(actors.merchantId));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const submission = await promoter.claimRandom(actors.child.id);
    random.mockRestore();

    for (const proofUrl of [
      'http://127.0.0.1/proof',
      'http://192.168.1.10/proof',
      'https://user:password@example.com/proof',
    ]) {
      await expect(
        promoter.submitProof(actors.child.id, submission.id, {
          proofText: '提交公网凭证地址测试',
          proofUrl,
          authenticityConfirmed: true,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    await promoter.submitProof(actors.child.id, submission.id, {
      proofText: '提交可供商户核验的公网凭证',
      proofUrl: 'https://example.com/proof',
      authenticityConfirmed: true,
    });
    const ledgerCount = await prisma.ledgerEntry.count();

    await expect(
      admin.reviewSubmission(actors.adminUser.id, submission.id, {
        decision: 'APPROVED',
        verificationBasis: '2026-10-25 15:00 未取得商户确认，仅做负向测试',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      admin.reviewSubmission(actors.adminUser.id, submission.id, {
        decision: 'APPROVED',
        verificationBasis: '短依据',
        counterpartyConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await prisma.ledgerEntry.count()).toBe(ledgerCount);
    expect(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
    ).toBe('SUBMITTED');

    const verificationBasis = '2026-10-25 15:05 商户陈经理在企业微信确认，回执号 TEST-REVIEW-03';
    await admin.reviewSubmission(actors.adminUser.id, submission.id, {
      decision: 'APPROVED',
      verificationBasis,
      counterpartyConfirmed: true,
    });
    const reviewed = await prisma.submission.findUniqueOrThrow({
      where: { id: submission.id },
    });
    expect(reviewed.reviewNote).toContain(`核验依据：${verificationBasis}`);
    expect(reviewed.reviewNote).toContain('数据提供方已确认');
    const reviewAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'SUBMISSION_APPROVE', entityId: submission.id },
    });
    expect(reviewAudit.detail).toContain(verificationBasis);
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

  it('凭证列表按审核状态筛选，并返回稳定分页', async () => {
    const actors = await seedBusinessActors();
    const statuses = ['SUBMITTED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CLAIMED'] as const;
    const taskIds = Array.from({ length: statuses.length }, () => randomUUID());
    await prisma.task.createMany({
      data: taskIds.map((id, index) => ({
        id,
        clientRequestId: randomUUID(),
        merchantId: actors.merchantId,
        title: `凭证分页测试任务 ${index + 1}`,
        adContent: '凭证分页测试广告内容',
        publicPoints: '凭证分页测试展示要求',
        region: '上海',
        adFeeCents: 100_000n,
        rewardType: 'NORMAL',
        commissionCents: 320n,
        referralCents: 64n,
        maxClaims: 1,
        budgetReservedCents: 384n,
        status: 'ENDED',
        startsAt: new Date(startsAt),
        endsAt: new Date(endsAt),
      })),
    });
    await prisma.submission.createMany({
      data: taskIds.map((taskId, index) => ({
        taskId,
        promoterId: actors.child.id,
        depositCents: 0n,
        status: statuses[index],
        proofText: `凭证分页测试 ${index + 1}`,
        submittedAt: statuses[index] === 'CLAIMED' ? null : fixedNow,
        reviewedAt:
          statuses[index] === 'APPROVED' || statuses[index] === 'REJECTED' ? fixedNow : null,
      })),
    });

    const allPage = await admin.submissions({ page: 1, pageSize: 2 });
    expect(allPage).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(allPage.items).toHaveLength(2);

    const submittedPage = await admin.submissions({
      page: 2,
      pageSize: 1,
      status: 'SUBMITTED',
    });
    expect(submittedPage).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(submittedPage.items[0].status).toBe('SUBMITTED');

    const clampedPage = await admin.submissions({
      page: 99,
      pageSize: 2,
      status: 'REJECTED',
    });
    expect(clampedPage).toMatchObject({ total: 1, page: 1, pageSize: 2 });
    expect(clampedPage.items[0].status).toBe('REJECTED');
  });

  it('凭证驳回只退保证金，不扣任务预算和佣金', async () => {
    const actors = await seedBusinessActors();
    const task = await admin.createTask(actors.adminUser.id, taskDraft(actors.merchantId));
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const submission = await promoter.claimRandom(actors.child.id);
    random.mockRestore();
    await promoter.submitProof(actors.child.id, submission.id, {
      proofText: '提交待驳回的测试凭证',
      authenticityConfirmed: true,
    });
    await admin.reviewSubmission(actors.adminUser.id, submission.id, {
      decision: 'REJECTED',
      note: '凭证不符合任务要求',
      verificationBasis: '2026-10-25 14:10 核验发现凭证未体现公开要点',
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

  it('提现列表按处理状态筛选，并返回稳定分页', async () => {
    const actors = await seedBusinessActors();
    const statuses = ['PENDING', 'PAID', 'REJECTED', 'PAID', 'PENDING'] as const;
    await prisma.withdrawal.createMany({
      data: statuses.map((status, index) => ({
        userId: actors.child.id,
        amountCents: BigInt(50_000 + index),
        payoutAccount: `支付宝：提现分页测试 ${index + 1}`,
        status,
        reviewerId: status === 'PENDING' ? null : actors.adminUser.id,
        requestedAt: new Date(fixedNow.getTime() + index * 1_000),
        reviewedAt: status === 'PENDING' ? null : fixedNow,
      })),
    });

    const allPage = await admin.withdrawals({ page: 1, pageSize: 2 });
    expect(allPage).toMatchObject({ total: 5, page: 1, pageSize: 2 });
    expect(allPage.items).toHaveLength(2);
    expect(allPage.items.map((item) => item.status)).toEqual(['PENDING', 'PAID']);

    const paidPage = await admin.withdrawals({
      page: 2,
      pageSize: 1,
      status: 'PAID',
    });
    expect(paidPage).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(paidPage.items[0].status).toBe('PAID');

    const clampedPage = await admin.withdrawals({
      page: 99,
      pageSize: 2,
      status: 'REJECTED',
    });
    expect(clampedPage).toMatchObject({ total: 1, page: 1, pageSize: 2 });
    expect(clampedPage.items[0].status).toBe('REJECTED');
  });

  it('资金账户列表按角色和状态筛选，并返回稳定分页', async () => {
    const actors = await seedBusinessActors();
    await admin.createMerchant(actors.adminUser.id, {
      companyName: '分页测试第二商户',
      displayName: '分页测试第二商户账号',
      contactName: '第二联系人',
    });
    await prisma.user.update({
      where: { id: actors.child.id },
      data: { status: 'DISABLED' },
    });

    const allPage = await admin.wallets({ page: 1, pageSize: 20 });
    expect(allPage).toMatchObject({ total: 4, page: 1, pageSize: 20 });
    expect(
      allPage.items.every((item) => item.role === 'PROMOTER' || item.role === 'MERCHANT'),
    ).toBe(true);

    const firstMerchantPage = await admin.wallets({
      page: 1,
      pageSize: 1,
      role: 'MERCHANT',
    });
    const secondMerchantPage = await admin.wallets({
      page: 2,
      pageSize: 1,
      role: 'MERCHANT',
    });
    expect(firstMerchantPage).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(secondMerchantPage).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(firstMerchantPage.items[0].id).not.toBe(secondMerchantPage.items[0].id);

    const clampedPage = await admin.wallets({ page: 99, pageSize: 1, role: 'MERCHANT' });
    expect(clampedPage).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(clampedPage.items[0].id).toBe(secondMerchantPage.items[0].id);

    const disabledPromoterPage = await admin.wallets({
      page: 1,
      pageSize: 20,
      role: 'PROMOTER',
      status: 'DISABLED',
    });
    expect(disabledPromoterPage).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(disabledPromoterPage.items[0]).toMatchObject({
      id: actors.child.id,
      status: 'DISABLED',
    });
  });

  it('商户资料按关键词和状态筛选，并返回稳定分页', async () => {
    const actors = await seedBusinessActors();
    await prisma.user.createMany({
      data: [
        {
          username: 'merchant-pagination-active-1',
          passwordHash: 'integration-test-only',
          displayName: '晨光便利店账号',
          role: 'MERCHANT',
          status: 'ACTIVE',
        },
        {
          username: 'merchant-pagination-disabled',
          passwordHash: 'integration-test-only',
          displayName: '海岸咖啡账号',
          role: 'MERCHANT',
          status: 'DISABLED',
        },
        {
          username: 'merchant-pagination-active-2',
          passwordHash: 'integration-test-only',
          displayName: '青禾茶饮账号',
          role: 'MERCHANT',
          status: 'ACTIVE',
        },
      ],
    });
    const merchantUsers = await prisma.user.findMany({
      where: {
        username: {
          in: [
            'merchant-pagination-active-1',
            'merchant-pagination-disabled',
            'merchant-pagination-active-2',
          ],
        },
      },
    });
    await prisma.merchantProfile.createMany({
      data: [
        {
          userId: merchantUsers.find((user) => user.username === 'merchant-pagination-active-1')!
            .id,
          companyName: '晨光便利店',
          contactName: '王晨',
          contactPhone: '13900000001',
        },
        {
          userId: merchantUsers.find((user) => user.username === 'merchant-pagination-disabled')!
            .id,
          companyName: '海岸咖啡',
          contactName: '李海',
          contactPhone: '13900000002',
        },
        {
          userId: merchantUsers.find((user) => user.username === 'merchant-pagination-active-2')!
            .id,
          companyName: '青禾茶饮',
          contactName: '陈青',
          contactPhone: '13900000003',
        },
      ],
    });

    const firstPage = await admin.merchantProfiles({ page: 1, pageSize: 2 });
    const secondPage = await admin.merchantProfiles({ page: 2, pageSize: 2 });
    expect(firstPage).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0]._count.tasks).toBe(0);
    expect(secondPage).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(firstPage.items[0].id).not.toBe(secondPage.items[0].id);

    const searchPage = await admin.merchantProfiles({ search: '陈青' });
    expect(searchPage).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(searchPage.items[0].companyName).toBe('青禾茶饮');

    const usernamePage = await admin.merchantProfiles({
      search: 'merchant-pagination-active-2',
    });
    expect(usernamePage).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(usernamePage.items[0].companyName).toBe('青禾茶饮');

    const phonePage = await admin.merchantProfiles({ search: '13800000000' });
    expect(phonePage).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(phonePage.items[0].id).toBe(actors.merchantId);

    const disabledPage = await admin.merchantProfiles({ status: 'DISABLED' });
    expect(disabledPage).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(disabledPage.items[0]).toMatchObject({
      companyName: '海岸咖啡',
      user: { status: 'DISABLED' },
    });

    const clampedPage = await admin.merchantProfiles({
      page: 99,
      pageSize: 2,
      status: 'ACTIVE',
    });
    expect(clampedPage).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(clampedPage.items).toHaveLength(1);
  });

  it('商户资料 CSV 按筛选条件导出并防止公式注入', async () => {
    const actors = await seedBusinessActors();
    const activeMerchant = await admin.createMerchant(actors.adminUser.id, {
      companyName: '=HYPERLINK("https://example.com","危险链接")',
      displayName: 'CSV 导出启用商户账号',
      contactName: '=导出筛选联系人',
      contactPhone: '+8613800000000',
      note: '@SUM(1,1)',
    });
    const disabledMerchant = await admin.createMerchant(actors.adminUser.id, {
      companyName: '停用导出商户',
      displayName: 'CSV 导出停用商户账号',
      contactName: '+导出筛选联系人',
    });
    if (!activeMerchant.merchantProfile || !disabledMerchant.merchantProfile) {
      throw new Error('CSV 测试商户资料创建失败');
    }
    await admin.updateMerchant(actors.adminUser.id, disabledMerchant.merchantProfile.id, {
      status: 'DISABLED',
    });

    const csv = await admin.merchantProfilesCsv({
      status: 'ACTIVE',
      search: '导出筛选联系人',
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"商户名称","账号名称","账号显示名","联系人","联系电话"');
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"",""危险链接"")"');
    expect(csv).toContain('"\'=导出筛选联系人"');
    expect(csv).toContain('"\'+8613800000000"');
    expect(csv).toContain('"\'@SUM(1,1)"');
    expect(csv).not.toContain('停用导出商户');
    expect(csv.split('\r\n')).toHaveLength(3);
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

  it('审计日志保留清理只删除阈值前记录并写入系统审计', async () => {
    const now = new Date('2026-10-25T04:00:00.000Z');
    await prisma.auditLog.createMany({
      data: [
        {
          action: 'OLD_AUDIT',
          entityType: 'TEST',
          entityId: 'old-record',
          detail: '保留期外测试记录',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
        },
        {
          action: 'RECENT_AUDIT',
          entityType: 'TEST',
          entityId: 'recent-record',
          detail: '保留期内测试记录',
          createdAt: new Date('2026-10-01T00:00:00.000Z'),
        },
      ],
    });

    const result = await cleanupExpiredAuditLogs(prisma, {
      retentionDays: 30,
      batchSize: 1,
      now,
    });

    expect(result.deletedCount).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { entityId: { in: ['old-record', 'recent-record'] } },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { action: 'AUDIT_LOG_RETENTION_CLEANUP' },
      }),
    ).toMatchObject({
      entityType: 'AUDIT_LOG',
      entityId: 'automatic-retention',
    });
  });
});
