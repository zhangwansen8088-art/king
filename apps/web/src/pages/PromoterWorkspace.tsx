import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type {
  LedgerView,
  PromoterDashboard,
  PromoterExposureResponse,
  SessionUser,
  Submission,
} from '../types';
import {
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  Money,
  NoticeBar,
  StatusPill,
  errorMessage,
  formatDate,
  yuanToCents,
  type Notice,
} from '../components/ui';
import { SessionSecurityModal } from '../components/SessionSecurity';
import { useEffect } from 'react';

interface PromoterWorkspaceProps {
  user: SessionUser;
  onLogout: () => Promise<void>;
}

const ledgerNames: Record<string, string> = {
  MANUAL_ADJUSTMENT: '管理员调账',
  GUARANTEE_FREEZE: '领取任务冻结保证金',
  GUARANTEE_REFUND: '保证金退回',
  COMMISSION: '任务佣金',
  REFERRAL: '一级返佣',
  WITHDRAWAL_REQUEST: '提交提现申请',
  WITHDRAWAL_PAID: '提现已打款',
  WITHDRAWAL_REFUND: '提现退款',
};

export function PromoterWorkspace({ user, onLogout }: PromoterWorkspaceProps) {
  const [dashboard, setDashboard] = useState<PromoterDashboard | null>(null);
  const [exposure, setExposure] = useState<PromoterExposureResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [sessionSecurityOpen, setSessionSecurityOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [activePanel, setActivePanel] = useState<'dispatch' | 'ledger' | 'withdraw'>('dispatch');

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const [nextDashboard, nextExposure] = await Promise.all([
        api.get<PromoterDashboard>('/promoter/dashboard'),
        api.get<PromoterExposureResponse>('/promoter/exposures'),
      ]);
      setDashboard(nextDashboard);
      setExposure(nextExposure);
    } catch (caught) {
      setNotice({ kind: 'error', text: errorMessage(caught) });
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function claim() {
    setClaiming(true);
    setNotice(null);
    try {
      await api.post('/promoter/claims');
      await load(true);
      setNotice({ kind: 'success', text: '已随机分配一单，请按要求完成任务并提交凭证。' });
    } catch (caught) {
      setNotice({ kind: 'error', text: errorMessage(caught) });
    } finally {
      setClaiming(false);
    }
  }

  async function submitProof(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submission = dashboard?.activeSubmission;
    if (!submission) return;
    const formData = new FormData(event.currentTarget);
    const proofText = String(formData.get('proofText') ?? '');
    const proofUrl = String(formData.get('proofUrl') ?? '').trim();
    const authenticityConfirmed = formData.get('authenticityConfirmed') === 'true';
    setSubmittingProof(true);
    try {
      await api.post(`/promoter/submissions/${submission.id}`, {
        proofText,
        ...(proofUrl ? { proofUrl } : {}),
        authenticityConfirmed,
      });
      await load(true);
      setNotice({ kind: 'success', text: '凭证已提交，等待管理员审核。' });
    } catch (caught) {
      setNotice({ kind: 'error', text: errorMessage(caught) });
    } finally {
      setSubmittingProof(false);
    }
  }

  async function handleLogout() {
    setLoggingOut(true);
    await onLogout();
  }

  function scrollToPanel(panel: 'dispatch' | 'ledger' | 'withdraw') {
    setActivePanel(panel);
    document.getElementById(`promoter-${panel}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  return (
    <div className="promoter-shell">
      <aside className="promoter-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <strong>MAX 众推台</strong>
            <span>推广客户工作台</span>
          </div>
        </div>

        <nav className="promoter-nav" aria-label="推广工作台导航">
          <button
            type="button"
            className={activePanel === 'dispatch' ? 'active' : ''}
            onClick={() => scrollToPanel('dispatch')}
          >
            <span aria-hidden="true">派</span>
            随机派单
          </button>
          <button
            type="button"
            className={activePanel === 'ledger' ? 'active' : ''}
            onClick={() => scrollToPanel('ledger')}
          >
            <span aria-hidden="true">账</span>
            资金流水
          </button>
          <button
            type="button"
            className={activePanel === 'withdraw' ? 'active' : ''}
            onClick={() => scrollToPanel('withdraw')}
          >
            <span aria-hidden="true">提</span>
            申请提现
          </button>
          <button type="button" onClick={() => setSessionSecurityOpen(true)}>
            <span aria-hidden="true">安</span>
            会话安全
          </button>
        </nav>

        <div className="promoter-sidebar-motto">
          <span>随机派单</span>
          <p>每次只专注当前一单，提交并审核完成后才能领取下一单。</p>
        </div>

        <div className="sidebar-user">
          <span className="avatar">{user.displayName.slice(0, 1)}</span>
          <div>
            <strong>{user.displayName}</strong>
            <span>推广客户</span>
          </div>
          <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
            {loggingOut ? '退出中' : '退出'}
          </button>
        </div>
      </aside>

      <div className="promoter-main">
        <header className="promoter-header">
          <div>
            <span className="topbar-context">今日工作台</span>
            <h1>{user.displayName}，先完成手中这一单</h1>
          </div>
          <div className="daily-meter">
            <div>
              <span>今日已领取</span>
              <strong>
                {dashboard?.dailyClaims.claimed ?? '—'}
                <small> / {dashboard?.dailyClaims.limit ?? 60}</small>
              </strong>
            </div>
            <span className="meter-line" aria-hidden="true">
              <span
                style={{
                  width: `${Math.min(
                    100,
                    ((dashboard?.dailyClaims.claimed ?? 0) / (dashboard?.dailyClaims.limit ?? 60)) *
                      100,
                  )}%`,
                }}
              />
            </span>
          </div>
          <button
            className="ghost-button mobile-logout"
            type="button"
            onClick={() => void handleLogout()}
          >
            退出
          </button>
        </header>

        <NoticeBar notice={notice} onClose={() => setNotice(null)} />

        {loading ? (
          <LoadingBlock text="正在读取今日派单与余额…" />
        ) : dashboard ? (
          <main className="promoter-content">
            <section className="promoter-money-band">
              <div className="funds-ticket promoter-ticket">
                <div className="ticket-head">
                  <span>可用余额</span>
                  <span className="ticket-seal">可提</span>
                </div>
                <Money cents={dashboard.wallet.availableCents} size="large" />
                <div className="ticket-split">
                  <div>
                    <span>任务冻结</span>
                    <Money cents={dashboard.wallet.frozenCents} size="small" />
                  </div>
                  <div>
                    <span>今日剩余额度</span>
                    <strong>{dashboard.dailyClaims.remaining} 单</strong>
                  </div>
                </div>
              </div>
              <div className="promoter-rule-card">
                <span className="rule-number">{dashboard.withdrawal.remainingQuota}</span>
                <div>
                  <strong>可用提现次数</strong>
                  <p>
                    已审核通过 {dashboard.withdrawal.approvedClaims} 单，每满 60 单增加一次机会。
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!dashboard.withdrawal.canApply}
                  onClick={() => setWithdrawOpen(true)}
                >
                  申请提现
                </button>
              </div>
            </section>

            <section
              className="dispatch-section"
              id="promoter-dispatch"
              aria-labelledby="dispatch-title"
            >
              {dashboard.activeSubmission ? (
                <ActiveTask
                  submission={dashboard.activeSubmission}
                  submitting={submittingProof}
                  onSubmit={submitProof}
                />
              ) : (
                <div className="dispatch-empty">
                  <div className="dispatch-empty-copy">
                    <span className="section-kicker">下一步</span>
                    <h2 id="dispatch-title">随机领取一单</h2>
                    <p>
                      系统从当前进行中的任务里随机分配；普通任务冻结可用余额
                      70%–74%，福利任务按该任务广告费冻结，余额不足时冻结现有可用余额。
                    </p>
                    <button
                      className="primary-button dispatch-button"
                      type="button"
                      onClick={() => void claim()}
                      disabled={claiming || dashboard.dailyClaims.remaining <= 0}
                    >
                      {claiming
                        ? '正在随机派单…'
                        : dashboard.dailyClaims.remaining <= 0
                          ? '今日额度已用完'
                          : '随机领取任务'}
                    </button>
                    <small>当前没有可领取任务时，请稍后再试。</small>
                  </div>
                  <div className="dispatch-ticket-visual" aria-hidden="true">
                    <span>随机派单</span>
                    <strong>一单一结</strong>
                    <span>审核通过后退保证金并结算佣金</span>
                  </div>
                </div>
              )}
            </section>

            <section className="promoter-lower-grid">
              <div className="submission-history">
                <div className="subsection-heading">
                  <div>
                    <span>最近记录</span>
                    <h2>任务进度</h2>
                  </div>
                  <span>{dashboard.recentSubmissions.length} 条</span>
                </div>
                {dashboard.recentSubmissions.length ? (
                  <div className="submission-lines">
                    {dashboard.recentSubmissions.map((submission) => (
                      <div className="submission-line" key={submission.id}>
                        <span className="submission-date">{formatDate(submission.claimedAt)}</span>
                        <div>
                          <strong>{submission.task.title}</strong>
                          <span>
                            保证金 <Money cents={submission.depositCents} size="small" /> ·{' '}
                            {submission.task.region}
                          </span>
                        </div>
                        <StatusPill status={submission.status} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title="还没有任务记录"
                    detail="领取第一单后，进度会在这里持续记录。"
                  />
                )}
              </div>

              <aside
                className="withdraw-side"
                id="promoter-withdraw"
                aria-labelledby="withdraw-title"
              >
                <span className="section-kicker">提现机会</span>
                <h2 id="withdraw-title">每 60 单一次</h2>
                <div className="withdraw-quota">
                  <strong>{dashboard.withdrawal.remainingQuota}</strong>
                  <span>次可用</span>
                </div>
                <p>{dashboard.withdrawal.timeText}</p>
                <div className="quota-rule">
                  <span>已用 {dashboard.withdrawal.usedQuota} 次</span>
                  <span>累计 {dashboard.withdrawal.totalQuota} 次</span>
                </div>
                <button
                  className="primary-button full-button"
                  type="button"
                  onClick={() => setWithdrawOpen(true)}
                  disabled={!dashboard.withdrawal.canApply}
                >
                  {dashboard.withdrawal.canApply
                    ? '填写提现申请'
                    : dashboard.withdrawal.withinTime
                      ? '提现次数不足'
                      : '当前不在申请时段'}
                </button>
                <small>申请不扣余额，管理员确认打款后才扣款。</small>
              </aside>
            </section>

            <section className="workspace-card" aria-labelledby="exposure-title">
              <div className="section-heading">
                <div>
                  <span className="section-kicker">数据回顾</span>
                  <h2 id="exposure-title">我的曝光</h2>
                </div>
                <div className="quota-rule">
                  <span>曝光 {exposure?.totals.exposureCount ?? 0}</span>
                  <span>点击 {exposure?.totals.clickCount ?? 0}</span>
                  <span>转化 {exposure?.totals.conversionCount ?? 0}</span>
                </div>
              </div>
              {exposure?.items.length ? (
                <div className="simple-table">
                  {exposure.items.map((item) => (
                    <div className="simple-table-row" key={item.id}>
                      <span>
                        {item.statDate} · {item.taskTitle}
                      </span>
                      <strong>
                        {item.exposureCount} / {item.clickCount} / {item.conversionCount}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="暂无曝光数据"
                  detail="管理员导入后，这里会显示最近 30 天数据。"
                />
              )}
            </section>

            <LedgerSection ledger={dashboard.ledger} />

            <section className="promoter-rules">
              <div>
                <span>1</span>
                <strong>只领取一单</strong>
                <p>当前单未审核完成时，不能领取下一单。</p>
              </div>
              <div>
                <span>2</span>
                <strong>凭证要对应公开要点</strong>
                <p>图片或说明中应能核对关键信息，否则可能被驳回。</p>
              </div>
              <div>
                <span>3</span>
                <strong>先完成再提现</strong>
                <p>提现申请有固定时段和次数，确认前不扣余额。</p>
              </div>
            </section>
          </main>
        ) : (
          <EmptyState title="工作台没有加载出来" detail="请刷新页面后重试。" />
        )}
      </div>

      <nav className="mobile-nav promoter-mobile-nav" aria-label="推广移动导航">
        <button type="button" onClick={() => scrollToPanel('dispatch')}>
          <span aria-hidden="true">派</span>派单
        </button>
        <button type="button" onClick={() => scrollToPanel('ledger')}>
          <span aria-hidden="true">账</span>流水
        </button>
        <button type="button" onClick={() => scrollToPanel('withdraw')}>
          <span aria-hidden="true">提</span>提现
        </button>
        <button type="button" onClick={() => setSessionSecurityOpen(true)}>
          <span aria-hidden="true">安</span>安全
        </button>
      </nav>

      <SessionSecurityModal
        open={sessionSecurityOpen}
        onClose={() => setSessionSecurityOpen(false)}
        onNotice={setNotice}
      />

      <WithdrawModal
        open={withdrawOpen}
        dashboard={dashboard}
        onClose={() => setWithdrawOpen(false)}
        onSaved={async () => {
          setWithdrawOpen(false);
          await load(true);
          setNotice({
            kind: 'success',
            text: '提现申请已提交，管理员确认打款前不会扣减余额。',
          });
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />
    </div>
  );
}

function ActiveTask({
  submission,
  submitting,
  onSubmit,
}: {
  submission: Submission;
  submitting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
}) {
  const task = submission.task;
  if (submission.status === 'SUBMITTED') {
    return (
      <div className="waiting-task">
        <span className="section-kicker">凭证已提交</span>
        <h2 id="dispatch-title">等待管理员审核</h2>
        <p>
          “{task.title}
          ”的凭证已进入审核队列。审核通过会退回保证金并发放佣金；驳回也会原额退回保证金。
        </p>
        <div className="waiting-task-meta">
          <div>
            <span>保证金</span>
            <Money cents={submission.depositCents} />
          </div>
          <div>
            <span>预计佣金</span>
            <Money cents={task.commissionCents} />
          </div>
          <div>
            <span>提交时间</span>
            <strong>{formatDate(submission.submittedAt)}</strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <article className="active-task">
      <div className="active-task-head">
        <div>
          <span className="section-kicker">本单已锁定</span>
          <h2 id="dispatch-title">{task.title}</h2>
          <p>
            {task.merchant?.companyName ?? '商户任务'} · {task.region} ·{' '}
            {task.rewardType === 'NORMAL' ? '普通任务' : '福利任务'}
          </p>
        </div>
        <div className="active-task-money">
          <span>完成佣金</span>
          <Money cents={task.commissionCents} size="large" />
        </div>
      </div>

      <div className="task-instructions">
        <div>
          <span>广告内容</span>
          <p>{task.adContent}</p>
        </div>
        <div>
          <span>凭证公开要点</span>
          <p>{task.publicPoints}</p>
        </div>
        {task.welfareClaimRule ? (
          <div>
            <span>福利领取规则</span>
            <p>{task.welfareClaimRule}</p>
          </div>
        ) : null}
      </div>

      <div className="active-task-foot">
        <span>
          已冻结保证金 <Money cents={submission.depositCents} size="small" />
        </span>
        <span>完成时间 {formatDate(task.endsAt)} 前</span>
      </div>

      <form className="proof-form" onSubmit={(event) => void onSubmit(event)}>
        <div className="proof-form-heading">
          <div>
            <span>提交前核对</span>
            <h3>填写完成凭证</h3>
          </div>
          <p>说明要足够具体，外部链接仅支持 http 或 https。</p>
        </div>
        <Field label="凭证说明">
          <textarea
            name="proofText"
            required
            minLength={5}
            maxLength={2000}
            rows={4}
            placeholder="说明何时、在哪里、如何完成任务，并对应上面的公开要点"
          />
        </Field>
        <Field label="凭证链接" hint="可选；可填写图片或视频的公网地址">
          <input name="proofUrl" type="url" maxLength={2000} placeholder="https://…" />
        </Field>
        <label className="authenticity-confirmation">
          <input name="authenticityConfirmed" type="checkbox" value="true" required />
          <span>我确认任务由本人真实完成，凭证可核验；不接受虚假、拼接或重复使用的内容。</span>
        </label>
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? '正在提交…' : '提交凭证并等待审核'}
        </button>
      </form>
    </article>
  );
}

function LedgerSection({ ledger }: { ledger: LedgerView[] }) {
  return (
    <section className="ledger-section" id="promoter-ledger">
      <div className="subsection-heading">
        <div>
          <span>资金去向</span>
          <h2>最近流水</h2>
        </div>
        <span>只追加记录</span>
      </div>
      <div className="ledger-list">
        {ledger.map((entry) => {
          const amount = BigInt(entry.amountCents);
          return (
            <div className="ledger-entry" key={entry.id}>
              <span className={amount >= 0n ? 'ledger-plus' : 'ledger-minus'}>
                {amount > 0n ? '+' : amount < 0n ? '−' : ''}
              </span>
              <div>
                <strong>{ledgerNames[entry.type] ?? entry.type}</strong>
                <p>{entry.memo}</p>
              </div>
              <span className="ledger-date">{formatDate(entry.createdAt)}</span>
              <Money cents={amount} size="small" />
              <div className="ledger-balance">
                <span>可用余额</span>
                <Money cents={entry.availableAfterCents} size="small" />
              </div>
            </div>
          );
        })}
        {!ledger.length ? (
          <EmptyState title="暂无资金流水" detail="领取任务、审核结算或收到调账后会记入这里。" />
        ) : null}
      </div>
    </section>
  );
}

function WithdrawModal({
  open,
  dashboard,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  dashboard: PromoterDashboard | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [payoutAccount, setPayoutAccount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount('');
      setPayoutAccount('');
      setNote('');
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = yuanToCents(amount);
    if (!amountCents) {
      onError('提现金额必须是有效金额，最多保留两位小数。');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/promoter/withdrawals', {
        amountCents,
        payoutAccount,
        ...(note ? { note } : {}),
      });
      await onSaved();
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="提交提现申请"
      detail="申请阶段不扣余额；管理员确认打款后才会扣减。"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="withdraw-availability">
          <div>
            <span>可用余额</span>
            <Money cents={dashboard?.wallet.availableCents ?? '0'} />
          </div>
          <div>
            <span>剩余提现次数</span>
            <strong>{dashboard?.withdrawal.remainingQuota ?? 0} 次</strong>
          </div>
        </div>
        <Field label="提现金额（元）" hint="单次 ¥500.00 至 ¥500,000.00">
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="500.00"
          />
        </Field>
        <Field label="收款信息" hint="填写实际线下打款所需的信息">
          <input
            required
            minLength={2}
            maxLength={500}
            value={payoutAccount}
            onChange={(event) => setPayoutAccount(event.target.value)}
            placeholder="例如：支付宝 · 收款人姓名"
          />
        </Field>
        <Field label="备注" hint="可选">
          <textarea
            maxLength={500}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="补充说明"
          />
        </Field>
        <p className="form-helper">{dashboard?.withdrawal.timeText}</p>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !dashboard?.withdrawal.canApply}
          >
            {submitting ? '正在提交…' : '提交提现申请'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
