import { describe, expect, it, vi } from 'vitest';
import {
  isWithdrawalWindow,
  priceTask,
  randomGuaranteeCents,
  withdrawalQuota,
} from '../src/business/business-rules';

describe('任务计价', () => {
  it('普通任务按佣金加直属上级 20% 预留预算', () => {
    expect(priceTask(100_000n, 'NORMAL', 10)).toEqual({
      commissionCents: 320n,
      referralCents: 64n,
      maximumBudgetCents: 3_840n,
    });
  });

  it('福利任务按广告费 5% 计算', () => {
    expect(priceTask(100_000n, 'WELFARE', 2)).toEqual({
      commissionCents: 5_000n,
      referralCents: 1_000n,
      maximumBudgetCents: 12_000n,
    });
  });
});

describe('保证金和时间规则', () => {
  it('保证金在可用余额的 70% 到 74% 之间', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(randomGuaranteeCents(10_000n)).toBe(7_000n);
    vi.restoreAllMocks();
  });

  it('提现时间为北京时间 10:00 至 22:59:59', () => {
    expect(isWithdrawalWindow(new Date('2026-10-25T01:59:59Z'))).toBe(false);
    expect(isWithdrawalWindow(new Date('2026-10-25T02:00:00Z'))).toBe(true);
    expect(isWithdrawalWindow(new Date('2026-10-25T14:59:59Z'))).toBe(true);
    expect(isWithdrawalWindow(new Date('2026-10-25T15:00:00Z'))).toBe(false);
  });

  it('每审核通过 60 单产生一次提现机会', () => {
    expect(withdrawalQuota(59, 0)).toBe(0);
    expect(withdrawalQuota(60, 0)).toBe(1);
    expect(withdrawalQuota(120, 1)).toBe(1);
  });
});
