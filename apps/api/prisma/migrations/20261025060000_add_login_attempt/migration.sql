-- CreateEnum
CREATE TYPE "public"."LoginAttemptScope" AS ENUM ('ACCOUNT', 'IP');

-- CreateTable
CREATE TABLE "public"."LoginAttempt" (
    "id" UUID NOT NULL,
    "scope" "public"."LoginAttemptScope" NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "lastFailedAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_scope_subjectHash_key" ON "public"."LoginAttempt"("scope", "subjectHash");

-- CreateIndex
CREATE INDEX "LoginAttempt_updatedAt_idx" ON "public"."LoginAttempt"("updatedAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_lockedUntil_idx" ON "public"."LoginAttempt"("lockedUntil");
