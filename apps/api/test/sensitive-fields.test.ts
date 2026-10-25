import { describe, expect, it, vi } from 'vitest';
import { AdminService } from '../src/admin/admin.service';
import { PromoterService } from '../src/promoter/promoter.service';
import type { FundsService } from '../src/business/funds.service';
import type { PrismaService } from '../src/prisma/prisma.service';

// BigInt 不能被 JSON.stringify 直接序列化，断言前统一转字符串。
const toJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

const userId = '33333333-3333-4333-8333-333333333333';

// 商户列表查询：不能把 user 整条带出（会含 passwordHash 等凭据字段）。
describe('管理员商户列表不下发凭据字段', () => {
  it('使用 select 查询且不含 passwordHash', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      merchantProfile: { findMany },
    } as unknown as PrismaService;

    const service = new AdminService(prisma, {} as unknown as FundsService);
    await service.merchants();

    const args = findMany.mock.calls[0]?.[0] as Record<string, unknown> & {
      select?: { user?: { select?: Record<string, unknown> } };
    };
    expect(args).toBeDefined();
    expect(args.select).toBeDefined();
    // 页面仍需要商户联系信息与钱包余额。
    expect(args.select?.user?.select).toMatchObject({
      id: true,
      username: true,
      displayName: true,
    });
    expect(args.select?.user?.select).not.toHaveProperty('passwordHash');
    expect(toJson(args)).not.toContain('passwordHash');
  });
});

// 推广端仪表盘：任务不得带出商户联系人/电话/备注与广告费、预算等内部字段。
describe('推广端任务只下发展示字段', () => {
  const taskSelectExpectation = {
    title: true,
    adContent: true,
    publicPoints: true,
    region: true,
    rewardType: true,
    welfareClaimRule: true,
    commissionCents: true,
    endsAt: true,
  };

  function createService(): {
    service: PromoterService;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  } {
    // 模拟按 select 取回的数据形状：不含商户内部字段。
    const submission = {
      id: 'submission-1',
      status: 'CLAIMED',
      depositCents: 320n,
      claimedAt: new Date('2026-10-26T02:00:00.000Z'),
      submittedAt: null,
      task: {
        id: 'task-1',
        title: '示例任务',
        adContent: '示例广告',
        publicPoints: '公开要点',
        region: '全国',
        rewardType: 'NORMAL',
        welfareClaimRule: '',
        commissionCents: 320n,
        endsAt: new Date('2026-11-01T00:00:00.000Z'),
        merchant: { id: 'merchant-1', companyName: '示例商户', displayName: '示例商户' },
      },
    };

    const findFirst = vi.fn().mockResolvedValue(submission);
    const findMany = vi.fn().mockResolvedValue([submission]);
    const prisma = {
      submission: {
        count: vi.fn().mockResolvedValue(0),
        findFirst,
        findMany,
      },
      withdrawal: { count: vi.fn().mockResolvedValue(0) },
    } as unknown as PrismaService;
    const funds = {
      walletView: vi.fn().mockResolvedValue({ availableCents: 0n, frozenCents: 0n }),
      ledgerView: vi.fn().mockResolvedValue([]),
    } as unknown as FundsService;

    return { service: new PromoterService(prisma, funds), findFirst, findMany };
  }

  it('按 select 查询任务，且不含商户联系信息与预算字段', async () => {
    const { service, findFirst, findMany } = createService();
    await service.dashboard(userId);

    for (const callArgs of [findFirst.mock.calls[0]?.[0], findMany.mock.calls[0]?.[0]]) {
      const taskSelect = (callArgs as { include?: { task?: { select?: Record<string, unknown> } } })
        .include?.task?.select;
      expect(taskSelect).toBeDefined();
      expect(taskSelect).toMatchObject(taskSelectExpectation);
      expect(taskSelect).not.toHaveProperty('adFeeCents');
      expect(taskSelect).not.toHaveProperty('budgetReservedCents');
      expect(taskSelect).not.toHaveProperty('budgetSpentCents');
      expect(taskSelect).not.toHaveProperty('budgetRefundedCents');

      const merchantSelect = (taskSelect as { merchant?: { select?: Record<string, unknown> } })
        .merchant?.select;
      expect(merchantSelect).toEqual({ id: true, companyName: true, displayName: true });

      // 整串查询参数里不能出现商户内部字段名。
      const serialized = toJson(callArgs);
      expect(serialized).not.toContain('contactPhone');
      expect(serialized).not.toContain('adFeeCents');
      expect(serialized).not.toContain('budgetReservedCents');
    }
  });

  it('返回体保留前端所需字段，且不含敏感字段', async () => {
    const { service } = createService();
    const dashboard = await service.dashboard(userId);
    const serialized = toJson(dashboard);

    expect(serialized).toContain('示例商户');
    expect(serialized).toContain('示例任务');
    expect(serialized).toContain('commissionCents');
    expect(serialized).not.toContain('contactPhone');
    expect(serialized).not.toContain('contactName');
    expect(serialized).not.toContain('adFeeCents');
    expect(serialized).not.toContain('budgetReservedCents');
  });
});
