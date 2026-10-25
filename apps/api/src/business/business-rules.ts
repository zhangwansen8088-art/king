import {
  commissionForAdFee,
  referralForCommission,
  type RewardType,
} from '@max-promotion/contracts';

export interface TaskPricing {
  commissionCents: bigint;
  referralCents: bigint;
  maximumBudgetCents: bigint;
}

export function priceTask(
  adFeeCents: bigint,
  rewardType: RewardType,
  maxClaims: number,
): TaskPricing {
  if (adFeeCents < 1n || adFeeCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('广告费必须是有效的整数分');
  }
  if (!Number.isInteger(maxClaims) || maxClaims < 1 || maxClaims > 10_000) {
    throw new Error('任务名额必须是 1 到 10000 之间的整数');
  }
  const commissionCents = BigInt(commissionForAdFee(Number(adFeeCents), rewardType));
  if (commissionCents < 1n) throw new Error('按广告费计算的佣金不足一分');
  const referralCents = BigInt(referralForCommission(Number(commissionCents)));
  return {
    commissionCents,
    referralCents,
    maximumBudgetCents: BigInt(maxClaims) * (commissionCents + referralCents),
  };
}

export function randomGuaranteeCents(availableCents: bigint): bigint {
  const percentage = BigInt(70 + Math.floor(Math.random() * 5));
  return (availableCents * percentage) / 100n;
}

export function shanghaiDayBounds(now = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const startText = `${get('year')}-${get('month')}-${get('day')}T00:00:00+08:00`;
  const start = new Date(startText);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1_000) };
}

export function isWithdrawalWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  return hour >= 10 && hour < 23;
}

export function withdrawalQuota(approvedClaims: number, usedQuota: number): number {
  return Math.max(0, Math.floor(approvedClaims / 60) - usedQuota);
}
