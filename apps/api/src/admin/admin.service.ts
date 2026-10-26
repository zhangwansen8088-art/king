import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { FundsService } from '../business/funds.service';
import { priceTask } from '../business/business-rules';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdjustWalletDto,
  AuditLogQueryDto,
  CreateMerchantDto,
  CreateTaskDto,
  MerchantExportQueryDto,
  MerchantQueryDto,
  ReviewSubmissionDto,
  ReviewWithdrawalDto,
  SubmissionQueryDto,
  TaskQueryDto,
  UpdateMerchantDto,
  WalletQueryDto,
  WithdrawalQueryDto,
} from './admin.dto';

function toCsvCell(value: string | number | bigint | null | undefined): string {
  let text = value == null ? '' : String(value).replace(/\r\n?/g, '\n');
  // 防止 Excel 将用户输入解释为公式，避免 CSV 公式注入。
  if (/^[=+\-@\t]/.test(text.trimStart())) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly funds: FundsService,
  ) {}

  async dashboard() {
    const [
      merchants,
      openTasks,
      pendingSubmissions,
      pendingWithdrawals,
      availableAggregate,
      frozenAggregate,
      auditLogs,
    ] = await Promise.all([
      this.prisma.merchantProfile.count(),
      this.prisma.task.count({ where: { status: 'OPEN' } }),
      this.prisma.submission.count({ where: { status: 'SUBMITTED' } }),
      this.prisma.withdrawal.count({ where: { status: 'PENDING' } }),
      this.prisma.wallet.aggregate({ _sum: { availableCents: true } }),
      this.prisma.wallet.aggregate({ _sum: { frozenCents: true } }),
      this.prisma.auditLog.findMany({
        include: { actor: { select: { displayName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);
    return {
      merchants,
      openTasks,
      pendingSubmissions,
      pendingWithdrawals,
      totalAvailableCents: availableAggregate._sum.availableCents ?? 0n,
      totalFrozenCents: frozenAggregate._sum.frozenCents ?? 0n,
      auditLogs,
    };
  }

  async merchants() {
    try {
      // 用 select 限定字段：user 整条带出会包含 passwordHash 等凭据字段。
      return await this.prisma.merchantProfile.findMany({
        select: {
          id: true,
          userId: true,
          companyName: true,
          contactName: true,
          contactPhone: true,
          note: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              status: true,
              wallet: true,
            },
          },
          _count: { select: { tasks: true } },
        },
        // 同一创建时间下使用主键兜底，确保商户选择列表顺序稳定。
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
    } catch (caught) {
      this.logger.error(
        '查询商户选择列表失败',
        caught instanceof Error ? caught.stack : String(caught),
      );
      throw new InternalServerErrorException('商户选择列表加载失败，请稍后重试');
    }
  }

  async merchantProfiles(query: MerchantQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    const keyword = query.search?.trim();
    const where = this.merchantWhere(query.status, keyword);

    try {
      const total = await this.prisma.merchantProfile.count({ where });
      // 筛选后数据减少时回退到最后一页，防止用户停留在空页。
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, lastPage);
      const items = await this.prisma.merchantProfile.findMany({
        where,
        select: {
          id: true,
          userId: true,
          companyName: true,
          contactName: true,
          contactPhone: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              status: true,
              wallet: true,
            },
          },
          // 页面只展示任务数量，避免将每家商户的全部任务明细装入列表响应。
          _count: { select: { tasks: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, total, page, pageSize };
    } catch (caught) {
      // 数据库错误仅写入服务端日志，返回内容不暴露 SQL、连接串等内部信息。
      this.logger.error(
        '查询商户资料列表失败',
        caught instanceof Error ? caught.stack : String(caught),
      );
      throw new InternalServerErrorException('商户资料列表加载失败，请稍后重试');
    }
  }

  async merchantProfilesCsv(query: MerchantExportQueryDto = {}) {
    const keyword = query.search?.trim();
    const where = this.merchantWhere(query.status, keyword);

    try {
      const rows = await this.prisma.merchantProfile.findMany({
        where,
        select: {
          companyName: true,
          contactName: true,
          contactPhone: true,
          note: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: {
              username: true,
              displayName: true,
              status: true,
              wallet: {
                select: {
                  availableCents: true,
                  frozenCents: true,
                },
              },
            },
          },
          _count: { select: { tasks: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const header = [
        '商户名称',
        '账号名称',
        '账号显示名',
        '联系人',
        '联系电话',
        '账号状态',
        '任务数量',
        '可用余额（分）',
        '冻结余额（分）',
        '备注',
        '创建时间',
        '更新时间',
      ];
      const lines = rows.map((row) =>
        [
          row.companyName,
          row.user.username,
          row.user.displayName,
          row.contactName,
          row.contactPhone,
          row.user.status === 'ACTIVE' ? '正常' : '停用',
          row._count.tasks,
          row.user.wallet?.availableCents.toString() ?? '',
          row.user.wallet?.frozenCents.toString() ?? '',
          row.note,
          row.createdAt.toISOString(),
          row.updatedAt.toISOString(),
        ]
          .map(toCsvCell)
          .join(','),
      );

      // BOM 让 Excel 正确识别 UTF-8 中文，CRLF 兼容常见表格软件。
      return `\uFEFF${[header.map(toCsvCell).join(','), ...lines].join('\r\n')}\r\n`;
    } catch (caught) {
      this.logger.error(
        '导出商户资料失败',
        caught instanceof Error ? caught.stack : String(caught),
      );
      throw new InternalServerErrorException('商户资料导出失败，请稍后重试');
    }
  }

  async createMerchant(adminId: string, body: CreateMerchantDto) {
    const passwordHash = await argon2.hash(randomBytes(32).toString('base64url'));
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          username: `merchant-${randomUUID()}`,
          passwordHash,
          displayName: body.displayName.trim(),
          role: 'MERCHANT',
          wallet: { create: {} },
          merchantProfile: {
            create: {
              companyName: body.companyName.trim(),
              contactName: body.contactName.trim(),
              contactPhone: body.contactPhone?.trim() ?? '',
              note: body.note?.trim() ?? '',
            },
          },
        },
        include: { wallet: true, merchantProfile: true },
      });
      await this.funds.audit(
        tx,
        adminId,
        'MERCHANT_CREATE',
        'MERCHANT',
        user.merchantProfile!.id,
        `创建商户资料“${body.companyName.trim()}”。商户没有独立登录入口。`,
      );
      return user;
    });
  }

  async updateMerchant(adminId: string, id: string, body: UpdateMerchantDto) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.merchantProfile.findUnique({ where: { id } });
      if (!profile) throw new NotFoundException('商户资料不存在');
      const updated = await tx.merchantProfile.update({
        where: { id },
        data: {
          ...(body.companyName !== undefined ? { companyName: body.companyName.trim() } : {}),
          ...(body.contactName !== undefined ? { contactName: body.contactName.trim() } : {}),
          ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone.trim() } : {}),
          ...(body.note !== undefined ? { note: body.note.trim() } : {}),
        },
      });
      if (body.displayName !== undefined || body.status !== undefined) {
        await tx.user.update({
          where: { id: profile.userId },
          data: {
            ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          },
        });
      }
      await this.funds.audit(tx, adminId, 'MERCHANT_UPDATE', 'MERCHANT', id, '更新商户资料', {
        ...body,
      });
      return updated;
    });
  }

  async tasks(query: TaskQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    const where: Prisma.TaskWhereInput = query.status ? { status: query.status } : {};
    const total = await this.prisma.task.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, lastPage);
    const items = await this.prisma.task.findMany({
      where,
      include: {
        merchant: { include: { user: { select: { displayName: true } } } },
        _count: { select: { submissions: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async createTask(adminId: string, body: CreateTaskDto) {
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const merchantConfirmation = body.merchantConfirmation.trim();
    if (endsAt <= startsAt) throw new BadRequestException('任务结束时间必须晚于开始时间');
    if (body.rewardType === 'WELFARE' && !body.welfareClaimRule?.trim()) {
      throw new BadRequestException('福利任务必须填写领取对象、方式和数量');
    }
    // 未经数据提供方确认、没有可追溯依据的内容不得进入推广系统。
    if (!body.merchantConfirmed) {
      throw new BadRequestException('发布前必须取得数据提供方对广告内容的确认');
    }
    if (merchantConfirmation.length < 10) {
      throw new BadRequestException('商户确认依据至少需要 10 个有效字符');
    }

    const pricing = priceTask(BigInt(body.adFeeCents), body.rewardType, body.maxClaims);
    return this.prisma.serializable(async (tx) => {
      const duplicate = await tx.task.findUnique({
        where: { clientRequestId: body.requestId },
        include: { merchant: true },
      });
      if (duplicate) return duplicate;

      const merchant = await tx.merchantProfile.findUnique({
        where: { id: body.merchantId },
        include: { user: { include: { wallet: true } } },
      });
      if (!merchant || merchant.user.status !== 'ACTIVE') {
        throw new NotFoundException('商户资料不存在或已停用');
      }
      if (
        !merchant.user.wallet ||
        merchant.user.wallet.availableCents < pricing.maximumBudgetCents
      ) {
        throw new BadRequestException('商户可用广告余额不足');
      }

      const task = await tx.task.create({
        data: {
          clientRequestId: body.requestId,
          merchantId: merchant.id,
          title: body.title.trim(),
          description: body.description?.trim() ?? '',
          adContent: body.adContent.trim(),
          publicPoints: body.publicPoints.trim(),
          region: body.region.trim(),
          adFeeCents: BigInt(body.adFeeCents),
          rewardType: body.rewardType,
          welfareClaimRule: body.rewardType === 'WELFARE' ? body.welfareClaimRule!.trim() : '',
          commissionCents: pricing.commissionCents,
          referralCents: pricing.referralCents,
          maxClaims: body.maxClaims,
          budgetReservedCents: pricing.maximumBudgetCents,
          startsAt,
          endsAt,
          createdByAdminId: adminId,
        },
      });
      await this.funds.change(tx, {
        userId: merchant.userId,
        availableDelta: -pricing.maximumBudgetCents,
        frozenDelta: pricing.maximumBudgetCents,
        type: 'TASK_BUDGET_FREEZE',
        referenceType: 'TASK',
        referenceId: task.id,
        idempotencyKey: `task:${task.id}:budget:freeze`,
        memo: `发布“${task.title}”，预留最高广告预算`,
        actorId: adminId,
      });
      await this.funds.audit(
        tx,
        adminId,
        'TASK_CREATE',
        'TASK',
        task.id,
        `为商户“${merchant.companyName}”发布任务“${task.title}”，冻结预算 ${pricing.maximumBudgetCents} 分；商户确认依据：${merchantConfirmation}`,
      );
      return task;
    });
  }

  async updateTaskStatus(adminId: string, taskId: string, status: 'OPEN' | 'PAUSED' | 'ENDED') {
    return this.prisma.serializable(async (tx) => {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        include: { merchant: true },
      });
      if (!task) throw new NotFoundException('推广任务不存在');
      if (task.status === 'ENDED') throw new BadRequestException('任务已经结束');
      if (status === 'ENDED') {
        const unresolved = await tx.submission.count({
          where: { taskId, status: { in: ['CLAIMED', 'SUBMITTED'] } },
        });
        if (unresolved > 0) {
          throw new BadRequestException('仍有待提交或待审核记录，暂不能结束任务');
        }
        const remaining =
          task.budgetReservedCents - task.budgetSpentCents - task.budgetRefundedCents;
        if (remaining > 0n) {
          await this.funds.change(tx, {
            userId: task.merchant.userId,
            availableDelta: remaining,
            frozenDelta: -remaining,
            type: 'TASK_BUDGET_REFUND',
            referenceType: 'TASK',
            referenceId: task.id,
            idempotencyKey: `task:${task.id}:budget:refund`,
            memo: `结束“${task.title}”，退回剩余广告预算`,
            actorId: adminId,
          });
        }
        await tx.task.update({
          where: { id: taskId },
          data: {
            budgetRefundedCents: { increment: remaining > 0n ? remaining : 0n },
            status,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.task.update({
          where: { id: taskId },
          data: { status, version: { increment: 1 } },
        });
      }
      await this.funds.audit(
        tx,
        adminId,
        'TASK_STATUS',
        'TASK',
        task.id,
        `任务“${task.title}”状态调整为 ${status}`,
      );
      return tx.task.findUnique({ where: { id: taskId } });
    });
  }

  async submissions(query: SubmissionQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    const where: Prisma.SubmissionWhereInput = query.status ? { status: query.status } : {};
    const total = await this.prisma.submission.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, lastPage);
    const items = await this.prisma.submission.findMany({
      where,
      include: {
        task: { include: { merchant: true } },
        promoter: { select: { id: true, username: true, displayName: true } },
        reviewer: { select: { id: true, displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async reviewSubmission(adminId: string, submissionId: string, body: ReviewSubmissionDto) {
    const verificationBasis = body.verificationBasis.trim();
    if (verificationBasis.length < 10) {
      throw new BadRequestException('核验依据至少需要 10 个有效字符');
    }
    if (body.decision === 'APPROVED' && body.counterpartyConfirmed !== true) {
      throw new BadRequestException('审核通过前必须取得数据提供方确认');
    }

    return this.prisma.serializable(async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: submissionId },
        include: {
          task: { include: { merchant: true } },
          promoter: { include: { parent: true } },
        },
      });
      if (!submission) throw new NotFoundException('推广提交不存在');
      if (submission.status !== 'SUBMITTED') {
        throw new BadRequestException('该提交已经处理，不能重复审核');
      }
      // 把核验依据写入审核记录，确保结算结果可追溯。
      const extraNote = body.note?.trim() ?? '';
      const confirmationText = body.counterpartyConfirmed ? '数据提供方已确认' : '数据提供方未确认';
      const note = [
        `核验依据：${verificationBasis}`,
        confirmationText,
        ...(extraNote ? [`备注：${extraNote}`] : []),
      ].join('；');
      await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: body.decision,
          reviewerId: adminId,
          reviewNote: note,
          reviewedAt: new Date(),
        },
      });
      if (body.decision === 'REJECTED') {
        if (submission.depositCents > 0n) {
          await this.funds.change(tx, {
            userId: submission.promoterId,
            availableDelta: submission.depositCents,
            frozenDelta: -submission.depositCents,
            type: 'GUARANTEE_REFUND',
            referenceType: 'SUBMISSION',
            referenceId: submission.id,
            idempotencyKey: `submission:${submission.id}:guarantee:refund:rejected`,
            memo: '推广凭证被驳回，本单保证金原额退回',
            actorId: adminId,
          });
        }
      } else {
        const parent = submission.promoter.parent;
        const referralCents =
          parent && parent.role === 'PROMOTER' ? submission.task.referralCents : 0n;
        const settlementCents = submission.task.commissionCents + referralCents;
        const remainingBudget =
          submission.task.budgetReservedCents -
          submission.task.budgetSpentCents -
          submission.task.budgetRefundedCents;
        if (settlementCents > remainingBudget) {
          throw new BadRequestException('任务剩余预算不足，无法审核通过');
        }
        await this.funds.change(tx, {
          userId: submission.task.merchant.userId,
          frozenDelta: -settlementCents,
          type: 'TASK_BUDGET_SETTLEMENT',
          referenceType: 'SUBMISSION',
          referenceId: submission.id,
          idempotencyKey: `submission:${submission.id}:budget:settlement`,
          memo: '推广审核通过，结算本单佣金和直系上级返佣',
          actorId: adminId,
        });
        if (submission.depositCents > 0n) {
          await this.funds.change(tx, {
            userId: submission.promoterId,
            availableDelta: submission.depositCents,
            frozenDelta: -submission.depositCents,
            type: 'GUARANTEE_REFUND',
            referenceType: 'SUBMISSION',
            referenceId: submission.id,
            idempotencyKey: `submission:${submission.id}:guarantee:refund:approved`,
            memo: '推广审核通过，本单保证金原额退回',
            actorId: adminId,
          });
        }
        await this.funds.change(tx, {
          userId: submission.promoterId,
          availableDelta: submission.task.commissionCents,
          type: 'COMMISSION',
          referenceType: 'SUBMISSION',
          referenceId: submission.id,
          idempotencyKey: `submission:${submission.id}:commission`,
          memo: '推广任务审核通过，发放佣金',
          actorId: adminId,
        });
        if (parent && referralCents > 0n) {
          await this.funds.change(tx, {
            userId: parent.id,
            availableDelta: referralCents,
            type: 'REFERRAL',
            referenceType: 'SUBMISSION',
            referenceId: submission.id,
            idempotencyKey: `submission:${submission.id}:referral:1`,
            memo: '直属下级任务审核通过，发放一级返佣',
            actorId: adminId,
          });
        }
        await tx.task.update({
          where: { id: submission.taskId },
          data: {
            budgetSpentCents: { increment: settlementCents },
            approvedCount: { increment: 1 },
            version: { increment: 1 },
          },
        });
      }
      await this.funds.audit(
        tx,
        adminId,
        body.decision === 'APPROVED' ? 'SUBMISSION_APPROVE' : 'SUBMISSION_REJECT',
        'SUBMISSION',
        submission.id,
        body.decision === 'APPROVED'
          ? `数据提供方已确认并审核通过；核验依据：${verificationBasis}`
          : `审核驳回，退回保证金，不扣预算、不发佣金；核验依据：${verificationBasis}`,
      );
      return tx.submission.findUnique({ where: { id: submission.id } });
    });
  }

  async wallets(query: WalletQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    // 角色白名单固定在查询层，避免管理员账号被错误纳入资金账户列表。
    const where: Prisma.UserWhereInput = {
      role: query.role ?? { in: ['PROMOTER', 'MERCHANT'] },
      ...(query.status ? { status: query.status } : {}),
    };

    try {
      const total = await this.prisma.user.count({ where });
      // 数据减少或页码越界时回退到最后一页，避免前端停留在空页。
      const lastPage = Math.max(1, Math.ceil(total / pageSize));
      const page = Math.min(requestedPage, lastPage);
      const items = await this.prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          status: true,
          wallet: true,
          merchantProfile: { select: { id: true, companyName: true } },
          parent: { select: { id: true, displayName: true } },
        },
        // id 作为第二排序字段，保证同一创建时间下跨页结果稳定。
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { items, total, page, pageSize };
    } catch (caught) {
      // 数据库异常只记录服务端，不把底层连接或 SQL 信息返回给浏览器。
      this.logger.error(
        '查询资金账户列表失败',
        caught instanceof Error ? caught.stack : String(caught),
      );
      throw new InternalServerErrorException('资金账户列表加载失败，请稍后重试');
    }
  }

  async adjustWallet(adminId: string, userId: string, body: AdjustWalletDto) {
    const amount = BigInt(body.amountCents);
    if (amount === 0n) throw new BadRequestException('调账金额不能为零');
    return this.prisma.serializable(async (tx) => {
      const existing = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: `adjustment:${body.requestId}` },
      });
      if (existing) return { duplicated: true, ledger: existing };
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('账号不存在');
      const wallet = await this.funds.change(tx, {
        userId,
        availableDelta: amount,
        type: 'MANUAL_ADJUSTMENT',
        referenceType: 'ADJUSTMENT',
        referenceId: body.requestId,
        idempotencyKey: `adjustment:${body.requestId}`,
        memo: body.reason.trim(),
        actorId: adminId,
      });
      await this.funds.audit(
        tx,
        adminId,
        'WALLET_ADJUST',
        'USER',
        userId,
        `管理员调账 ${amount} 分；原因：${body.reason.trim()}`,
      );
      return { duplicated: false, wallet };
    });
  }

  async withdrawals(query: WithdrawalQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    const where: Prisma.WithdrawalWhereInput = query.status ? { status: query.status } : {};
    const total = await this.prisma.withdrawal.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, lastPage);
    const items = await this.prisma.withdrawal.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            wallet: { select: { availableCents: true, frozenCents: true } },
          },
        },
        reviewer: { select: { id: true, displayName: true } },
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async reviewWithdrawal(adminId: string, withdrawalId: string, body: ReviewWithdrawalDto) {
    return this.prisma.serializable(async (tx) => {
      const withdrawal = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
      if (!withdrawal) throw new NotFoundException('提现申请不存在');
      if (withdrawal.status !== 'PENDING') {
        throw new BadRequestException('提现申请已经处理');
      }
      const status = body.decision === 'PAID' ? 'PAID' : 'REJECTED';
      await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status,
          reviewerId: adminId,
          reviewNote: body.note?.trim() ?? '',
          reviewedAt: new Date(),
        },
      });
      if (status === 'PAID') {
        await this.funds.change(tx, {
          userId: withdrawal.userId,
          availableDelta: -withdrawal.amountCents,
          type: 'WITHDRAWAL_PAID',
          referenceType: 'WITHDRAWAL',
          referenceId: withdrawal.id,
          idempotencyKey: `withdrawal:${withdrawal.id}:paid`,
          memo: '管理员确认演示提现已打款，从可用余额扣除',
          actorId: adminId,
        });
      }
      await this.funds.audit(
        tx,
        adminId,
        `WITHDRAWAL_${status}`,
        'WITHDRAWAL',
        withdrawal.id,
        status === 'PAID'
          ? '确认提现已打款并扣减可用余额'
          : '驳回提现申请；申请阶段未扣款，无需退款',
      );
      return tx.withdrawal.findUnique({ where: { id: withdrawal.id } });
    });
  }

  async auditLogs(query: AuditLogQueryDto = {}) {
    const pageSize = query.pageSize ?? 20;
    const requestedPage = query.page ?? 1;
    const action = query.action?.trim();
    const entityType = query.entityType?.trim();
    const where: Prisma.AuditLogWhereInput = {
      ...(action ? { action: { contains: action, mode: 'insensitive' } } : {}),
      ...(entityType ? { entityType: { contains: entityType, mode: 'insensitive' } } : {}),
    };
    const total = await this.prisma.auditLog.count({ where });
    const lastPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, lastPage);
    const items = await this.prisma.auditLog.findMany({
      where,
      include: { actor: { select: { id: true, displayName: true, role: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  private merchantWhere(
    status: 'ACTIVE' | 'DISABLED' | undefined,
    keyword: string | undefined,
  ): Prisma.MerchantProfileWhereInput {
    return {
      ...(status ? { user: { status } } : {}),
      ...(keyword
        ? {
            OR: [
              { companyName: { contains: keyword, mode: 'insensitive' } },
              { contactName: { contains: keyword, mode: 'insensitive' } },
              { contactPhone: { contains: keyword, mode: 'insensitive' } },
              { user: { displayName: { contains: keyword, mode: 'insensitive' } } },
              { user: { username: { contains: keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }
}
