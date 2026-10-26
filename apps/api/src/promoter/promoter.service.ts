import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isWithdrawalWindow,
  randomGuaranteeCents,
  shanghaiDayBounds,
  withdrawalQuota,
} from '../business/business-rules';
import { FundsService } from '../business/funds.service';
import { PrismaService } from '../prisma/prisma.service';
import type { SubmitProofDto, CreateWithdrawalDto } from './promoter.dto';

// 只接受公网 http/https 地址，拦截内网、本机地址和带账号密码的链接。
function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;

    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname.includes('.') && !hostname.includes(':')) return false;
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      return false;
    }

    const octets = hostname.split('.').map(Number);
    if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet))) {
      const [first = -1, second = -1] = octets;
      return !(
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        first >= 224
      );
    }

    if (hostname.includes(':')) {
      return !(
        hostname === '::1' ||
        hostname.startsWith('fc') ||
        hostname.startsWith('fd') ||
        hostname.startsWith('fe8') ||
        hostname.startsWith('fe9') ||
        hostname.startsWith('fea') ||
        hostname.startsWith('feb')
      );
    }
    return true;
  } catch {
    return false;
  }
}

// 推广端只下发任务展示所需字段；商户联系人/电话/备注、广告费与预算属于商户内部数据，不下发。
const PROMOTER_TASK_SELECT = {
  id: true,
  title: true,
  adContent: true,
  publicPoints: true,
  region: true,
  rewardType: true,
  welfareClaimRule: true,
  commissionCents: true,
  endsAt: true,
  merchant: { select: { id: true, companyName: true, displayName: true } },
} as const;

const PROMOTER_SUBMISSION_INCLUDE = { task: { select: PROMOTER_TASK_SELECT } } as const;

@Injectable()
export class PromoterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funds: FundsService,
  ) {}

  async dashboard(userId: string) {
    const { start, end } = shanghaiDayBounds();
    const [wallet, claimedToday, active, recentSubmissions, ledger, withdrawal] = await Promise.all(
      [
        this.funds.walletView(userId),
        this.prisma.submission.count({
          where: { promoterId: userId, claimedAt: { gte: start, lt: end } },
        }),
        this.prisma.submission.findFirst({
          where: { promoterId: userId, status: { in: ['CLAIMED', 'SUBMITTED'] } },
          include: PROMOTER_SUBMISSION_INCLUDE,
          orderBy: { claimedAt: 'desc' },
        }),
        this.prisma.submission.findMany({
          where: { promoterId: userId },
          include: PROMOTER_SUBMISSION_INCLUDE,
          orderBy: { claimedAt: 'desc' },
          take: 12,
        }),
        this.funds.ledgerView(userId, 30),
        this.withdrawalStatus(userId),
      ],
    );

    return {
      wallet,
      dailyClaims: {
        claimed: claimedToday,
        limit: 60,
        remaining: Math.max(0, 60 - claimedToday),
      },
      activeSubmission: active,
      recentSubmissions,
      ledger,
      withdrawal,
    };
  }

  async claimRandom(userId: string) {
    return this.prisma.serializable(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user || user.role !== 'PROMOTER' || user.status !== 'ACTIVE') {
          throw new BadRequestException('推广账号不可用');
        }
        const active = await tx.submission.findFirst({
          where: { promoterId: userId, status: { in: ['CLAIMED', 'SUBMITTED'] } },
        });
        if (active) {
          throw new BadRequestException('请先完成并等待当前任务审核');
        }

        const { start, end } = shanghaiDayBounds();
        const claimedToday = await tx.submission.count({
          where: { promoterId: userId, claimedAt: { gte: start, lt: end } },
        });
        if (claimedToday >= 60) throw new BadRequestException('今天已达到 60 单上限');

        const now = new Date();
        const candidates = await tx.task.findMany({
          where: {
            status: 'OPEN',
            rewardType: { in: ['NORMAL', 'WELFARE'] },
            startsAt: { lte: now },
            endsAt: { gte: now },
            submissions: { none: { promoterId: userId } },
          },
          orderBy: { createdAt: 'asc' },
          take: 100,
        });
        const available = candidates.filter((task) => task.claimedCount < task.maxClaims);
        if (!available.length) throw new BadRequestException('当前没有可随机分配的推广任务');
        const task = available[Math.floor(Math.random() * available.length)];
        if (!task) throw new BadRequestException('当前没有可随机分配的推广任务');

        const wallet = await tx.wallet.findUnique({ where: { userId } });
        if (!wallet) throw new NotFoundException('资金钱包不存在');
        const depositCents =
          task.rewardType === 'WELFARE'
            ? task.adFeeCents < wallet.availableCents
              ? task.adFeeCents
              : wallet.availableCents
            : randomGuaranteeCents(wallet.availableCents);
        if (task.rewardType === 'NORMAL' && depositCents < 1n) {
          throw new BadRequestException('可用余额不足，无法领取任务');
        }

        const submission = await tx.submission.create({
          data: { taskId: task.id, promoterId: userId, depositCents },
        });
        await tx.task.update({
          where: { id: task.id },
          data: { claimedCount: { increment: 1 }, version: { increment: 1 } },
        });
        if (depositCents > 0n) {
          await this.funds.change(tx, {
            userId,
            availableDelta: -depositCents,
            frozenDelta: depositCents,
            type: 'GUARANTEE_FREEZE',
            referenceType: 'SUBMISSION',
            referenceId: submission.id,
            idempotencyKey: `submission:${submission.id}:guarantee:freeze`,
            memo: `领取“${task.title}”，冻结本单保证金`,
            actorId: userId,
          });
        }
        await this.funds.audit(
          tx,
          userId,
          'SUBMISSION_CLAIM',
          'SUBMISSION',
          submission.id,
          `随机领取任务“${task.title}”，冻结保证金 ${depositCents} 分`,
        );
        return submission;
      },
      () => new BadRequestException('当前没有可随机分配的推广任务'),
    );
  }

  async submitProof(userId: string, submissionId: string, body: SubmitProofDto) {
    return this.prisma.serializable(async (tx) => {
      const proofText = body.proofText.trim();
      const proofUrl = body.proofUrl?.trim() ?? '';
      if (proofText.length < 5) {
        throw new BadRequestException('凭证说明至少需要 5 个有效字符');
      }
      // 真实性声明由服务端强制校验，不能只依赖前端勾选框。
      if (body.authenticityConfirmed !== true) {
        throw new BadRequestException('提交前必须确认推广凭证真实有效');
      }
      if (proofUrl && !isPublicHttpUrl(proofUrl)) {
        throw new BadRequestException('凭证链接必须是可公开访问的 http 或 https 地址');
      }

      const submission = await tx.submission.findFirst({
        where: { id: submissionId, promoterId: userId },
        include: { task: true },
      });
      if (!submission) throw new NotFoundException('推广任务不存在');
      if (submission.status !== 'CLAIMED') {
        throw new BadRequestException('当前任务不是待提交状态');
      }
      const updated = await tx.submission.update({
        where: { id: submission.id },
        data: {
          status: 'SUBMITTED',
          proofText,
          proofUrl,
          submittedAt: new Date(),
        },
      });
      await this.funds.audit(
        tx,
        userId,
        'SUBMISSION_SEND',
        'SUBMISSION',
        submission.id,
        `提交任务“${submission.task.title}”的推广凭证，提交人已确认真实有效`,
      );
      return updated;
    });
  }

  async requestWithdrawal(userId: string, body: CreateWithdrawalDto) {
    return this.prisma.serializable(async (tx) => {
      const amount = BigInt(body.amountCents);
      if (amount < 50_000n || amount > 50_000_000n) {
        throw new BadRequestException('提现金额必须在 ¥500.00 到 ¥500,000.00 之间');
      }
      if (!isWithdrawalWindow()) {
        throw new BadRequestException('提现申请时间为北京时间每天 10:00 至 22:59:59');
      }
      const status = await this.withdrawalStatusWithClient(tx, userId);
      if (status.remainingQuota <= 0) {
        throw new BadRequestException('提现次数不足，每审核通过 60 单增加一次');
      }
      const [wallet, pendingWithdrawals] = await Promise.all([
        tx.wallet.findUnique({ where: { userId } }),
        tx.withdrawal.aggregate({
          where: { userId, status: 'PENDING' },
          _sum: { amountCents: true },
        }),
      ]);
      const pendingAmount = pendingWithdrawals._sum.amountCents ?? 0n;
      if (!wallet || wallet.availableCents - pendingAmount < amount) {
        throw new BadRequestException('可用余额不足（含待审核提现占用）');
      }
      const withdrawal = await tx.withdrawal.create({
        data: {
          userId,
          amountCents: amount,
          payoutAccount: body.payoutAccount.trim(),
          note: body.note?.trim() ?? '',
        },
      });
      await this.funds.change(tx, {
        userId,
        type: 'WITHDRAWAL_REQUEST',
        referenceType: 'WITHDRAWAL',
        referenceId: withdrawal.id,
        idempotencyKey: `withdrawal:${withdrawal.id}:request`,
        memo: '提交提现申请，申请阶段不扣款',
        actorId: userId,
      });
      await this.funds.audit(
        tx,
        userId,
        'WITHDRAWAL_REQUEST',
        'WITHDRAWAL',
        withdrawal.id,
        `提交演示提现申请 ${amount} 分，申请阶段不扣款`,
      );
      return withdrawal;
    });
  }

  async withdrawalStatus(userId: string) {
    return this.withdrawalStatusWithClient(this.prisma, userId);
  }

  private async withdrawalStatusWithClient(
    client: Pick<PrismaService, 'submission' | 'withdrawal'>,
    userId: string,
  ) {
    const [approvedClaims, usedQuota] = await Promise.all([
      client.submission.count({ where: { promoterId: userId, status: 'APPROVED' } }),
      client.withdrawal.count({
        where: { userId, status: { in: ['PENDING', 'PAID'] } },
      }),
    ]);
    const totalQuota = Math.floor(approvedClaims / 60);
    const remainingQuota = withdrawalQuota(approvedClaims, usedQuota);
    const withinTime = isWithdrawalWindow();
    return {
      approvedClaims,
      totalQuota,
      usedQuota,
      remainingQuota,
      withinTime,
      timeText: '每天北京时间 10:00 至 22:59:59',
      canApply: withinTime && remainingQuota > 0,
    };
  }
}
