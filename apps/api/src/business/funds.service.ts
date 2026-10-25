import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface FundChangeInput {
  userId: string;
  availableDelta?: bigint;
  frozenDelta?: bigint;
  type: LedgerType;
  referenceType: string;
  referenceId: string;
  idempotencyKey: string;
  memo: string;
  actorId?: string | null;
}

@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  async change(tx: Prisma.TransactionClient, input: FundChangeInput) {
    const wallet = await tx.wallet.findUnique({ where: { userId: input.userId } });
    if (!wallet) throw new NotFoundException('资金钱包不存在');

    const availableAfter = wallet.availableCents + (input.availableDelta ?? 0n);
    const frozenAfter = wallet.frozenCents + (input.frozenDelta ?? 0n);
    if (availableAfter < 0n || frozenAfter < 0n) {
      throw new BadRequestException('余额不足，资金操作已取消');
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        availableCents: availableAfter,
        frozenCents: frozenAfter,
        version: { increment: 1 },
      },
    });
    await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        type: input.type,
        amountCents: input.availableDelta ?? 0n,
        availableBeforeCents: wallet.availableCents,
        availableAfterCents: availableAfter,
        frozenBeforeCents: wallet.frozenCents,
        frozenAfterCents: frozenAfter,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        memo: input.memo,
        actorId: input.actorId ?? null,
      },
    });
    return updated;
  }

  async audit(
    tx: Prisma.TransactionClient,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    detail: string,
    metadata?: Prisma.InputJsonValue,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { actorId, action, entityType, entityId, detail, ...(metadata ? { metadata } : {}) },
    });
  }

  async walletView(userId: string) {
    const wallet = await this.findWallet(userId);
    return {
      availableCents: wallet.availableCents,
      frozenCents: wallet.frozenCents,
    };
  }

  async ledgerView(userId: string, take = 100) {
    const wallet = await this.findWallet(userId);
    return this.ledgerByWallet(wallet.id, take);
  }

  async ledgerByWallet(walletId: string, take = 100) {
    return this.walletLedger(walletId, take);
  }

  private async findWallet(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('资金钱包不存在');
    return wallet;
  }

  private async walletLedger(walletId: string, take: number) {
    return this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
    });
  }
}
