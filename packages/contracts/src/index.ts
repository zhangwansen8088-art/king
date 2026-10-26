export const userRoles = ['ADMIN', 'PROMOTER', 'MERCHANT'] as const;
export type UserRole = (typeof userRoles)[number];

export const taskStatuses = ['OPEN', 'PAUSED', 'ENDED'] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const submissionStatuses = ['CLAIMED', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type SubmissionStatus = (typeof submissionStatuses)[number];

export const withdrawalStatuses = ['PENDING', 'PAID', 'REJECTED'] as const;
export type WithdrawalStatus = (typeof withdrawalStatuses)[number];

export const rewardTypes = ['NORMAL', 'WELFARE'] as const;
export type RewardType = (typeof rewardTypes)[number];

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSession {
  accessToken: string;
  csrfToken: string;
  user: SessionUser;
}

export interface AuthSessionRecord {
  id: string;
  current: boolean;
  userAgent: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
}

export interface WalletView {
  availableCents: string;
  frozenCents: string;
}

export interface LedgerView {
  id: string;
  type: string;
  amountCents: string;
  availableBeforeCents: string;
  availableAfterCents: string;
  frozenBeforeCents: string;
  frozenAfterCents: string;
  memo: string;
  createdAt: string;
}

export interface TaskView {
  id: string;
  title: string;
  description: string;
  adContent: string;
  publicPoints: string;
  region: string;
  rewardType: RewardType;
  adFeeCents: string;
  commissionCents: string;
  referralCents: string;
  maxClaims: number;
  claimedCount: number;
  budgetReservedCents: string;
  budgetSpentCents: string;
  budgetRefundedCents: string;
  status: TaskStatus;
  startsAt: string;
  endsAt: string;
  merchant: {
    id: string;
    companyName: string;
    displayName: string;
  };
}

export interface ExposureDailyView {
  id: string;
  taskId: string;
  promoterId: string;
  statDate: string;
  exposureCount: number;
  clickCount: number;
  conversionCount: number;
  note: string;
  taskTitle: string;
  createdAt: string;
}

export interface ExposureDailyTotals {
  exposureCount: number;
  clickCount: number;
  conversionCount: number;
}

export interface SubmissionView {
  id: string;
  status: SubmissionStatus;
  depositCents: string;
  proofText: string;
  proofUrl: string;
  reviewNote: string;
  claimedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  task: {
    id: string;
    title: string;
    adContent: string;
    publicPoints: string;
    region: string;
    rewardType: RewardType;
    commissionCents: string;
  };
  promoter: {
    id: string;
    displayName: string;
    username: string;
  };
}

export const MAX_DAILY_CLAIMS = 60;
export const WITHDRAWAL_MIN_CENTS = 50_000n;
export const WITHDRAWAL_MAX_CENTS = 50_000_000n;

export function formatCny(cents: string | bigint | number): string {
  const value = BigInt(cents);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const yuan = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  const grouped = yuan.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}¥${grouped}.${fraction}`;
}

export function commissionForAdFee(adFeeCents: number, rewardType: RewardType): number {
  if (!Number.isSafeInteger(adFeeCents) || adFeeCents < 1) {
    throw new Error('广告费必须是大于零的整数分');
  }
  if (rewardType === 'NORMAL') {
    return Math.floor((adFeeCents * 32) / 10_000);
  }
  return Math.floor((adFeeCents * 5) / 100);
}

export function referralForCommission(commissionCents: number): number {
  return Math.floor((commissionCents * 20) / 100);
}
