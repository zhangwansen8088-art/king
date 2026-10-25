-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."UserRole" AS ENUM ('ADMIN', 'PROMOTER', 'MERCHANT');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "public"."TaskStatus" AS ENUM ('OPEN', 'PAUSED', 'ENDED');

-- CreateEnum
CREATE TYPE "public"."RewardType" AS ENUM ('NORMAL', 'WELFARE');

-- CreateEnum
CREATE TYPE "public"."SubmissionStatus" AS ENUM ('CLAIMED', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."WithdrawalStatus" AS ENUM ('PENDING', 'PAID', 'REJECTED');

-- CreateEnum
CREATE TYPE "public"."LedgerType" AS ENUM ('MANUAL_ADJUSTMENT', 'TASK_BUDGET_FREEZE', 'TASK_BUDGET_SETTLEMENT', 'TASK_BUDGET_REFUND', 'GUARANTEE_FREEZE', 'GUARANTEE_REFUND', 'COMMISSION', 'REFERRAL', 'WITHDRAWAL_REQUEST', 'WITHDRAWAL_PAID', 'WITHDRAWAL_REFUND');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" "public"."UserRole" NOT NULL,
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "parentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MerchantProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Wallet" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "availableCents" BIGINT NOT NULL DEFAULT 0,
    "frozenCents" BIGINT NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Task" (
    "id" UUID NOT NULL,
    "clientRequestId" TEXT NOT NULL,
    "merchantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "adContent" TEXT NOT NULL,
    "publicPoints" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "adFeeCents" BIGINT NOT NULL,
    "rewardType" "public"."RewardType" NOT NULL,
    "welfareClaimRule" TEXT NOT NULL DEFAULT '',
    "commissionCents" BIGINT NOT NULL,
    "referralCents" BIGINT NOT NULL,
    "maxClaims" INTEGER NOT NULL,
    "claimedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "budgetReservedCents" BIGINT NOT NULL,
    "budgetSpentCents" BIGINT NOT NULL DEFAULT 0,
    "budgetRefundedCents" BIGINT NOT NULL DEFAULT 0,
    "status" "public"."TaskStatus" NOT NULL DEFAULT 'OPEN',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Submission" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "promoterId" UUID NOT NULL,
    "depositCents" BIGINT NOT NULL,
    "status" "public"."SubmissionStatus" NOT NULL DEFAULT 'CLAIMED',
    "proofText" TEXT NOT NULL DEFAULT '',
    "proofUrl" TEXT NOT NULL DEFAULT '',
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "reviewerId" UUID,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Withdrawal" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "payoutAccount" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "public"."WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerId" UUID,
    "reviewNote" TEXT NOT NULL DEFAULT '',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" UUID,
    "userAgent" TEXT NOT NULL DEFAULT '',
    "ipAddress" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LedgerEntry" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "public"."LedgerType" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "availableBeforeCents" BIGINT NOT NULL,
    "availableAfterCents" BIGINT NOT NULL,
    "frozenBeforeCents" BIGINT NOT NULL,
    "frozenAfterCents" BIGINT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "public"."User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantProfile_userId_key" ON "public"."MerchantProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "public"."Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_clientRequestId_key" ON "public"."Task"("clientRequestId");

-- CreateIndex
CREATE INDEX "Task_status_startsAt_endsAt_idx" ON "public"."Task"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "Task_merchantId_createdAt_idx" ON "public"."Task"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Submission_promoterId_status_idx" ON "public"."Submission"("promoterId", "status");

-- CreateIndex
CREATE INDEX "Submission_status_createdAt_idx" ON "public"."Submission"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_taskId_promoterId_key" ON "public"."Submission"("taskId", "promoterId");

-- CreateIndex
CREATE INDEX "Withdrawal_userId_status_idx" ON "public"."Withdrawal"("userId", "status");

-- CreateIndex
CREATE INDEX "Withdrawal_status_requestedAt_idx" ON "public"."Withdrawal"("status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "public"."RefreshSession"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshSession_userId_expiresAt_idx" ON "public"."RefreshSession"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "public"."LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_walletId_createdAt_idx" ON "public"."LedgerEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_referenceType_referenceId_idx" ON "public"."LedgerEntry"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "public"."AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MerchantProfile" ADD CONSTRAINT "MerchantProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Task" ADD CONSTRAINT "Task_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "public"."MerchantProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "public"."Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_promoterId_fkey" FOREIGN KEY ("promoterId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Submission" ADD CONSTRAINT "Submission_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Withdrawal" ADD CONSTRAINT "Withdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Withdrawal" ADD CONSTRAINT "Withdrawal_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshSession" ADD CONSTRAINT "RefreshSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LedgerEntry" ADD CONSTRAINT "LedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "public"."Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

