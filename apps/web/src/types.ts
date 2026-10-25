import type {
  AuthSession,
  LedgerView,
  SessionUser,
  SubmissionStatus,
  TaskStatus,
  WithdrawalStatus,
} from '@max-promotion/contracts';

export type {
  AuthSession,
  LedgerView,
  SessionUser,
  SubmissionStatus,
  TaskStatus,
  WithdrawalStatus,
};

export interface Wallet {
  id: string;
  userId: string;
  availableCents: string;
  frozenCents: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantProfile {
  id: string;
  userId: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface MerchantSummary extends MerchantProfile {
  user: {
    id: string;
    username: string;
    displayName: string;
    status: 'ACTIVE' | 'DISABLED';
    wallet: Wallet | null;
  };
  tasks: Array<{
    id: string;
    status: TaskStatus;
    budgetReservedCents: string;
    budgetSpentCents: string;
    budgetRefundedCents: string;
  }>;
}

export interface Task {
  id: string;
  clientRequestId: string;
  merchantId: string;
  title: string;
  description: string;
  adContent: string;
  publicPoints: string;
  region: string;
  adFeeCents: string;
  rewardType: 'NORMAL' | 'WELFARE';
  welfareClaimRule: string;
  commissionCents: string;
  referralCents: string;
  maxClaims: number;
  claimedCount: number;
  approvedCount: number;
  budgetReservedCents: string;
  budgetSpentCents: string;
  budgetRefundedCents: string;
  status: TaskStatus;
  startsAt: string;
  endsAt: string;
  merchant?: MerchantProfile & {
    user?: { displayName: string };
  };
  _count?: { submissions: number };
  createdAt: string;
  updatedAt: string;
}

export interface TaskPage {
  items: Task[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Submission {
  id: string;
  taskId: string;
  promoterId: string;
  depositCents: string;
  status: SubmissionStatus;
  proofText: string;
  proofUrl: string;
  reviewNote: string;
  claimedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  task: Task;
  promoter?: {
    id: string;
    username: string;
    displayName: string;
  };
  reviewer?: {
    id: string;
    displayName: string;
  } | null;
}

export interface Withdrawal {
  id: string;
  userId: string;
  amountCents: string;
  payoutAccount: string;
  note: string;
  status: WithdrawalStatus;
  reviewNote: string;
  requestedAt: string;
  reviewedAt: string | null;
  user: {
    id: string;
    username: string;
    displayName: string;
    wallet?: {
      availableCents: string;
      frozenCents: string;
    } | null;
  };
  reviewer?: {
    id: string;
    displayName: string;
  } | null;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
  actor: {
    id?: string;
    displayName: string;
    role?: string;
  } | null;
}

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminDashboard {
  merchants: number;
  openTasks: number;
  pendingSubmissions: number;
  pendingWithdrawals: number;
  totalAvailableCents: string;
  totalFrozenCents: string;
  auditLogs: AuditLog[];
}

export interface AdminWallet {
  id: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'PROMOTER' | 'MERCHANT';
  status: 'ACTIVE' | 'DISABLED';
  wallet: Wallet | null;
  merchantProfile: {
    id: string;
    companyName: string;
  } | null;
  parent: {
    id: string;
    displayName: string;
  } | null;
}

export interface WithdrawalQuota {
  approvedClaims: number;
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  withinTime: boolean;
  timeText: string;
  canApply: boolean;
}

export interface PromoterDashboard {
  wallet: {
    availableCents: string;
    frozenCents: string;
  };
  dailyClaims: {
    claimed: number;
    limit: number;
    remaining: number;
  };
  activeSubmission: Submission | null;
  recentSubmissions: Submission[];
  ledger: LedgerView[];
  withdrawal: WithdrawalQuota;
}
