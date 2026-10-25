import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { commissionForAdFee, referralForCommission } from '@max-promotion/contracts';
import { api } from '../api';
import type {
  AdminDashboard,
  AdminWallet,
  AuditLogPage,
  MerchantSummary,
  SessionUser,
  Submission,
  SubmissionPage,
  Task,
  TaskPage,
  Withdrawal,
} from '../types';
import {
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  Money,
  NoticeBar,
  StatusPill,
  centsToYuanInput,
  errorMessage,
  formatDate,
  formatFullDate,
  fromDateTimeLocal,
  toDateTimeLocal,
  yuanToCents,
  type Notice,
} from '../components/ui';

type AdminSection = 'overview' | 'merchants' | 'tasks' | 'reviews' | 'withdrawals' | 'audit';

interface AdminWorkspaceProps {
  user: SessionUser;
  onLogout: () => Promise<void>;
}

const navItems: Array<{ id: AdminSection; label: string; index: string }> = [
  { id: 'overview', label: '总览', index: '台' },
  { id: 'merchants', label: '商户与资金', index: '商' },
  { id: 'tasks', label: '任务管理', index: '任' },
  { id: 'reviews', label: '凭证审核', index: '审' },
  { id: 'withdrawals', label: '提现处理', index: '提' },
  { id: 'audit', label: '审计日志', index: '记' },
];

function signedYuanToCents(value: string): string | null {
  const normalized = value.trim();
  if (!/^-?\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [yuan = '0', fraction = ''] = unsigned.split('.');
  const cents = BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0'));
  return `${negative ? '-' : ''}${cents}`;
}

function safeExternalUrl(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function AdminWorkspace({ user, onLogout }: AdminWorkspaceProps) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [wallets, setWallets] = useState<AdminWallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const [merchantModalOpen, setMerchantModalOpen] = useState(false);
  const [editingMerchant, setEditingMerchant] = useState<MerchantSummary | null>(null);
  const [walletTarget, setWalletTarget] = useState<AdminWallet | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<Submission | null>(null);
  const [withdrawalTarget, setWithdrawalTarget] = useState<Withdrawal | null>(null);
  const showError = useCallback((text: string) => setNotice({ kind: 'error', text }), []);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        if (section === 'overview') {
          setDashboard(await api.get<AdminDashboard>('/admin/dashboard'));
        } else if (section === 'merchants') {
          const [nextDashboard, nextMerchants, nextWallets] = await Promise.all([
            api.get<AdminDashboard>('/admin/dashboard'),
            api.get<MerchantSummary[]>('/admin/merchants'),
            api.get<AdminWallet[]>('/admin/wallets'),
          ]);
          setDashboard(nextDashboard);
          setMerchants(nextMerchants);
          setWallets(nextWallets);
        } else if (section === 'tasks') {
          const [nextDashboard, nextMerchants] = await Promise.all([
            api.get<AdminDashboard>('/admin/dashboard'),
            api.get<MerchantSummary[]>('/admin/merchants'),
          ]);
          setDashboard(nextDashboard);
          setMerchants(nextMerchants);
        } else if (section === 'reviews') {
          setDashboard(await api.get<AdminDashboard>('/admin/dashboard'));
        } else if (section === 'withdrawals') {
          const [nextDashboard, nextWithdrawals] = await Promise.all([
            api.get<AdminDashboard>('/admin/dashboard'),
            api.get<Withdrawal[]>('/admin/withdrawals'),
          ]);
          setDashboard(nextDashboard);
          setWithdrawals(nextWithdrawals);
        } else {
          setDashboard(await api.get<AdminDashboard>('/admin/dashboard'));
        }
      } catch (caught) {
        setNotice({ kind: 'error', text: errorMessage(caught) });
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [section],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    void load().finally(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [load]);

  async function afterMutation(message: string) {
    setNotice({ kind: 'success', text: message });
    if (section === 'tasks') setTaskRefreshKey((current) => current + 1);
    if (section === 'reviews') setReviewRefreshKey((current) => current + 1);
    await load(true);
  }

  async function handleLogout() {
    setLoggingOut(true);
    await onLogout();
  }

  const pendingTotal = (dashboard?.pendingSubmissions ?? 0) + (dashboard?.pendingWithdrawals ?? 0);

  return (
    <div className="workspace-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <div>
            <strong>MAX 众推台</strong>
            <span>平台管理后台</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="管理员导航">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={section === item.id ? 'active' : ''}
              onClick={() => setSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
            >
              <span className="nav-index" aria-hidden="true">
                {item.index}
              </span>
              <span>{item.label}</span>
              {item.id === 'reviews' && dashboard?.pendingSubmissions ? (
                <span className="nav-count">{dashboard.pendingSubmissions}</span>
              ) : null}
              {item.id === 'withdrawals' && dashboard?.pendingWithdrawals ? (
                <span className="nav-count">{dashboard.pendingWithdrawals}</span>
              ) : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-merchant-note">
          <span>商户入口已撤销</span>
          <p>商户资料、余额、发任务和审核均在本后台完成。</p>
        </div>

        <div className="sidebar-user">
          <span className="avatar">{user.displayName.slice(0, 1)}</span>
          <div>
            <strong>{user.displayName}</strong>
            <span>管理员</span>
          </div>
          <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
            {loggingOut ? '退出中' : '退出'}
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="workspace-topbar">
          <div>
            <span className="topbar-context">管理员连续作业台</span>
            <h1>{navItems.find((item) => item.id === section)?.label}</h1>
          </div>
          <div className="topbar-summary">
            <div>
              <span>待处理</span>
              <strong>{pendingTotal}</strong>
            </div>
            <div>
              <span>在投任务</span>
              <strong>{dashboard?.openTasks ?? '—'}</strong>
            </div>
            <button
              className="ghost-button mobile-logout"
              type="button"
              onClick={() => void handleLogout()}
            >
              退出
            </button>
          </div>
        </header>

        <NoticeBar notice={notice} onClose={() => setNotice(null)} />

        <main className="admin-content">
          {loading ? (
            <LoadingBlock />
          ) : section === 'overview' ? (
            <OverviewSection dashboard={dashboard} onNavigate={setSection} />
          ) : section === 'merchants' ? (
            <MerchantsSection
              merchants={merchants}
              wallets={wallets}
              onNew={() => {
                setEditingMerchant(null);
                setMerchantModalOpen(true);
              }}
              onEdit={(merchant) => {
                setEditingMerchant(merchant);
                setMerchantModalOpen(true);
              }}
              onAdjust={setWalletTarget}
            />
          ) : section === 'tasks' ? (
            <TasksSection
              refreshKey={taskRefreshKey}
              onError={showError}
              onCreate={() => setTaskModalOpen(true)}
              onStatus={async (task, status) => {
                try {
                  await api.patch(`/admin/tasks/${task.id}/status`, { status });
                  await afterMutation(`任务“${task.title}”状态已更新。`);
                } catch (caught) {
                  setNotice({ kind: 'error', text: errorMessage(caught) });
                }
              }}
            />
          ) : section === 'reviews' ? (
            <ReviewsSection
              refreshKey={reviewRefreshKey}
              onError={showError}
              onReview={setReviewTarget}
            />
          ) : section === 'withdrawals' ? (
            <WithdrawalsSection withdrawals={withdrawals} onReview={setWithdrawalTarget} />
          ) : (
            <AuditSection onError={showError} />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="管理员移动导航">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={section === item.id ? 'active' : ''}
            onClick={() => setSection(item.id)}
            aria-current={section === item.id ? 'page' : undefined}
          >
            <span aria-hidden="true">{item.index}</span>
            {item.label.slice(0, 2)}
          </button>
        ))}
      </nav>

      <MerchantModal
        open={merchantModalOpen}
        merchant={editingMerchant}
        onClose={() => setMerchantModalOpen(false)}
        onSaved={async (isEdit) => {
          setMerchantModalOpen(false);
          await afterMutation(isEdit ? '商户资料已更新。' : '商户资料已写入后台。');
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />

      <WalletModal
        target={walletTarget}
        onClose={() => setWalletTarget(null)}
        onSaved={async () => {
          setWalletTarget(null);
          await afterMutation('调账完成，资金流水与审计记录已同步写入。');
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />

      <TaskModal
        open={taskModalOpen}
        merchants={merchants}
        onClose={() => setTaskModalOpen(false)}
        onSaved={async () => {
          setTaskModalOpen(false);
          await afterMutation('任务已发布，最高预算已转入冻结余额。');
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />

      <ReviewModal
        submission={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onSaved={async (approved) => {
          setReviewTarget(null);
          await afterMutation(
            approved ? '审核通过，保证金、佣金与返佣已结算。' : '凭证已驳回，保证金已原额退回。',
          );
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />

      <WithdrawalReviewModal
        withdrawal={withdrawalTarget}
        onClose={() => setWithdrawalTarget(null)}
        onSaved={async (paid) => {
          setWithdrawalTarget(null);
          await afterMutation(paid ? '已确认打款并从余额扣款。' : '提现申请已驳回，未产生扣款。');
        }}
        onError={(message) => setNotice({ kind: 'error', text: message })}
      />
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}

function OverviewSection({
  dashboard,
  onNavigate,
}: {
  dashboard: AdminDashboard | null;
  onNavigate: (section: AdminSection) => void;
}) {
  if (!dashboard) return <EmptyState title="暂无总览数据" detail="刷新后重试。" />;

  return (
    <div className="overview-grid">
      <section className="funds-ticket overview-ticket">
        <div className="ticket-head">
          <span>平台可支配余额</span>
          <span className="ticket-seal">台账</span>
        </div>
        <Money cents={dashboard.totalAvailableCents} size="large" />
        <div className="ticket-split">
          <div>
            <span>冻结中</span>
            <Money cents={dashboard.totalFrozenCents} size="small" />
          </div>
          <div>
            <span>后台商户</span>
            <strong>{dashboard.merchants} 家</strong>
          </div>
        </div>
        <p>商户没有独立账户界面，余额与经营资料由管理员在此维护。</p>
      </section>

      <section className="overview-queue">
        <SectionHeading eyebrow="今日优先" title="待处理队列">
          先处理会影响资金和任务进度的项目。
        </SectionHeading>
        <button type="button" className="queue-row" onClick={() => onNavigate('reviews')}>
          <span className="queue-mark queue-warm">审</span>
          <span>
            <strong>凭证待审核</strong>
            <small>通过后立即结算预算与佣金</small>
          </span>
          <b>{dashboard.pendingSubmissions}</b>
        </button>
        <button type="button" className="queue-row" onClick={() => onNavigate('withdrawals')}>
          <span className="queue-mark queue-brass">提</span>
          <span>
            <strong>提现待处理</strong>
            <small>确认打款时才扣减推广客户余额</small>
          </span>
          <b>{dashboard.pendingWithdrawals}</b>
        </button>
        <button type="button" className="queue-row" onClick={() => onNavigate('tasks')}>
          <span className="queue-mark queue-good">任</span>
          <span>
            <strong>进行中任务</strong>
            <small>可暂停任务或结束并退回剩余预算</small>
          </span>
          <b>{dashboard.openTasks}</b>
        </button>
      </section>

      <section className="recent-audit">
        <SectionHeading eyebrow="最近动作" title="审计摘要">
          关键操作只追加、不覆盖。
        </SectionHeading>
        {dashboard.auditLogs.length ? (
          <div className="audit-lines">
            {dashboard.auditLogs.map((log) => (
              <div className="audit-line" key={log.id}>
                <span className="audit-time">{formatDate(log.createdAt)}</span>
                <span className="audit-dot" aria-hidden="true" />
                <div>
                  <strong>{log.actor?.displayName ?? '系统'}</strong>
                  <p>{log.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="还没有审计记录" detail="首笔业务操作后会显示在这里。" />
        )}
      </section>
    </div>
  );
}

function MerchantsSection({
  merchants,
  wallets,
  onNew,
  onEdit,
  onAdjust,
}: {
  merchants: MerchantSummary[];
  wallets: AdminWallet[];
  onNew: () => void;
  onEdit: (merchant: MerchantSummary) => void;
  onAdjust: (wallet: AdminWallet) => void;
}) {
  const [accountFilter, setAccountFilter] = useState<'ALL' | 'MERCHANT' | 'PROMOTER'>('MERCHANT');
  const visibleWallets = wallets.filter(
    (wallet) => accountFilter === 'ALL' || wallet.role === accountFilter,
  );

  return (
    <div className="stack-section">
      <SectionHeading
        eyebrow="资料与余额"
        title="商户统一台账"
        action={
          <button className="primary-button" type="button" onClick={onNew}>
            新增商户资料
          </button>
        }
      >
        商户不能登录系统；其资料、预算和任务由管理员代为操作。
      </SectionHeading>

      <section className="ledger-table-wrap">
        <div className="table-caption">
          <span>商户资料</span>
          <span>{merchants.length} 家</span>
        </div>
        {merchants.length ? (
          <div className="table-scroll">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>商户 / 联系人</th>
                  <th>可用余额</th>
                  <th>冻结预算</th>
                  <th>任务数</th>
                  <th>状态</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {merchants.map((merchant) => {
                  const wallet = wallets.find((item) => item.merchantProfile?.id === merchant.id);
                  return (
                    <tr key={merchant.id}>
                      <td>
                        <strong>{merchant.companyName}</strong>
                        <span>
                          {merchant.contactName}
                          {merchant.contactPhone ? ` · ${merchant.contactPhone}` : ''}
                        </span>
                      </td>
                      <td>
                        {merchant.user.wallet ? (
                          <Money cents={merchant.user.wallet.availableCents} size="small" />
                        ) : (
                          '未开通'
                        )}
                      </td>
                      <td>
                        {merchant.user.wallet ? (
                          <Money cents={merchant.user.wallet.frozenCents} size="small" />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{merchant.tasks.length}</td>
                      <td>
                        <StatusPill status={merchant.user.status} />
                      </td>
                      <td>
                        <div className="row-actions">
                          <button type="button" onClick={() => onEdit(merchant)}>
                            编辑资料
                          </button>
                          {wallet ? (
                            <button type="button" onClick={() => onAdjust(wallet)}>
                              调账
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="尚未建立商户资料"
            detail="点击“新增商户资料”后，再为商户充值并发布任务。"
          />
        )}
      </section>

      <section className="accounts-section">
        <div className="table-caption accounts-caption">
          <div>
            <span>资金账户</span>
            <p>调账只改可用余额，必须填写原因并生成资金流水。</p>
          </div>
          <div className="segmented-control" aria-label="账户类型筛选">
            {(['MERCHANT', 'PROMOTER', 'ALL'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={accountFilter === value ? 'active' : ''}
                onClick={() => setAccountFilter(value)}
              >
                {value === 'MERCHANT' ? '商户' : value === 'PROMOTER' ? '推广客户' : '全部'}
              </button>
            ))}
          </div>
        </div>
        <div className="account-list">
          {visibleWallets.map((wallet) => (
            <div className="account-row" key={wallet.id}>
              <span className="account-role">{wallet.role === 'MERCHANT' ? '商' : '推'}</span>
              <div className="account-name">
                <strong>{wallet.merchantProfile?.companyName ?? wallet.displayName}</strong>
                <span>
                  {wallet.role === 'MERCHANT' ? '后台商户资料' : '推广客户'}
                  {wallet.parent ? ` · 上级 ${wallet.parent.displayName}` : ''}
                </span>
              </div>
              <div className="account-money">
                <span>可用</span>
                <Money cents={wallet.wallet?.availableCents ?? '0'} size="small" />
              </div>
              <div className="account-money">
                <span>冻结</span>
                <Money cents={wallet.wallet?.frozenCents ?? '0'} size="small" />
              </div>
              <button
                className="small-button"
                type="button"
                disabled={!wallet.wallet}
                onClick={() => onAdjust(wallet)}
              >
                调整余额
              </button>
            </div>
          ))}
          {!visibleWallets.length ? (
            <EmptyState title="暂无匹配的资金账户" detail="切换账户类型后再查看。" />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function TasksSection({
  refreshKey,
  onError,
  onCreate,
  onStatus,
}: {
  refreshKey: number;
  onError: (message: string) => void;
  onCreate: () => void;
  onStatus: (task: Task, status: 'OPEN' | 'PAUSED' | 'ENDED') => Promise<void>;
}) {
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'PAUSED' | 'ENDED'>('ALL');
  const [pageData, setPageData] = useState<TaskPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busyTask, setBusyTask] = useState('');

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filter !== 'ALL') params.set('status', filter);

    setLoading(true);
    void api
      .get<TaskPage>(`/admin/tasks?${params.toString()}`)
      .then((nextPage) => {
        if (!active) return;
        setPageData(nextPage);
        if (nextPage.page !== page) setPage(nextPage.page);
      })
      .catch((caught) => {
        if (active) onError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, onError, page, pageSize, refreshKey]);

  async function update(task: Task, status: 'OPEN' | 'PAUSED' | 'ENDED') {
    setBusyTask(task.id);
    await onStatus(task, status);
    setBusyTask('');
  }

  const tasks = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (pageData?.pageSize ?? pageSize)));

  return (
    <div className="stack-section">
      <SectionHeading
        eyebrow="预算控制"
        title="推广任务"
        action={
          <button className="primary-button" type="button" onClick={onCreate}>
            发布任务
          </button>
        }
      >
        发布时冻结商户最高预算，审核通过后按实际结算。
      </SectionHeading>

      <div className="task-list-controls">
        <div className="filter-bar">
          {(['ALL', 'OPEN', 'PAUSED', 'ENDED'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'active' : ''}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {value === 'ALL'
                ? '全部'
                : value === 'OPEN'
                  ? '进行中'
                  : value === 'PAUSED'
                    ? '已暂停'
                    : '已结束'}
            </button>
          ))}
        </div>
        <label className="page-size-control">
          <span>每页</span>
          <select
            value={pageSize}
            aria-label="任务每页数量"
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value} 条
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="task-ledger">
          {tasks.map((task) => {
            const progress = task.maxClaims
              ? Math.min(100, Math.round((task.claimedCount / task.maxClaims) * 100))
              : 0;
            return (
              <article className="task-row" key={task.id}>
                <div className="task-row-head">
                  <div className="task-identity">
                    <span className="task-number">任务</span>
                    <div>
                      <h3>{task.title}</h3>
                      <p>
                        {task.merchant?.companyName ?? '商户资料'} · {task.region} ·{' '}
                        {task.rewardType === 'NORMAL' ? '普通任务' : '福利任务'}
                      </p>
                    </div>
                  </div>
                  <div className="task-row-status">
                    <StatusPill status={task.status} />
                    <span>{formatDate(task.endsAt)} 截止</span>
                  </div>
                </div>
                <div className="task-data-grid">
                  <div>
                    <span>单笔佣金</span>
                    <Money cents={task.commissionCents} size="small" />
                  </div>
                  <div>
                    <span>一级返佣</span>
                    <Money cents={task.referralCents} size="small" />
                  </div>
                  <div>
                    <span>最高预算</span>
                    <Money cents={task.budgetReservedCents} size="small" />
                  </div>
                  <div>
                    <span>已结算</span>
                    <Money cents={task.budgetSpentCents} size="small" />
                  </div>
                </div>
                <div className="task-progress">
                  <div>
                    <span>
                      已领取 {task.claimedCount} / {task.maxClaims}
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <span className="progress-track">
                    <span style={{ width: `${progress}%` }} />
                  </span>
                </div>
                <div className="task-actions">
                  {task.status === 'OPEN' ? (
                    <button
                      className="small-button"
                      type="button"
                      disabled={busyTask === task.id}
                      onClick={() => void update(task, 'PAUSED')}
                    >
                      暂停任务
                    </button>
                  ) : null}
                  {task.status === 'PAUSED' ? (
                    <button
                      className="small-button"
                      type="button"
                      disabled={busyTask === task.id}
                      onClick={() => void update(task, 'OPEN')}
                    >
                      恢复任务
                    </button>
                  ) : null}
                  {task.status !== 'ENDED' ? (
                    <button
                      className="small-button danger-button"
                      type="button"
                      disabled={busyTask === task.id}
                      onClick={() => void update(task, 'ENDED')}
                    >
                      结束并退余款
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!tasks.length ? (
            <EmptyState
              title="没有符合条件的任务"
              detail={
                total ? '切换到其他状态后再查看。' : '发布首个任务后，预算和进度会显示在这里。'
              }
            />
          ) : null}
        </div>
      )}
      <div className="list-pagination" aria-label="任务分页">
        <span>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        <div>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewsSection({
  refreshKey,
  onError,
  onReview,
}: {
  refreshKey: number;
  onError: (message: string) => void;
  onReview: (submission: Submission) => void;
}) {
  const [filter, setFilter] = useState<'ALL' | Submission['status']>('SUBMITTED');
  const [pageData, setPageData] = useState<SubmissionPage | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filter !== 'ALL') params.set('status', filter);

    setLoading(true);
    void api
      .get<SubmissionPage>(`/admin/submissions?${params.toString()}`)
      .then((nextPage) => {
        if (!active) return;
        setPageData(nextPage);
        if (nextPage.page !== page) setPage(nextPage.page);
      })
      .catch((caught) => {
        if (active) onError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, onError, page, pageSize, refreshKey]);

  const submissions = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (pageData?.pageSize ?? pageSize)));

  return (
    <div className="stack-section">
      <SectionHeading eyebrow="证据核验" title="凭证审核">
        通过会结算预算和佣金；驳回只退回推荐客户的保证金。
      </SectionHeading>
      <div className="task-list-controls">
        <div className="filter-bar">
          {(['SUBMITTED', 'APPROVED', 'REJECTED', 'ALL'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={filter === value ? 'active' : ''}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {value === 'SUBMITTED'
                ? '待审核'
                : value === 'APPROVED'
                  ? '已通过'
                  : value === 'REJECTED'
                    ? '已驳回'
                    : '全部记录'}
            </button>
          ))}
        </div>
        <label className="page-size-control">
          <span>每页</span>
          <select
            value={pageSize}
            aria-label="凭证每页数量"
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 20, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value} 条
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="review-grid">
          {submissions.map((submission) => {
            const proofUrl = safeExternalUrl(submission.proofUrl);
            return (
              <article className="review-card" key={submission.id}>
                <div className="review-card-head">
                  <div>
                    <span className="review-sequence">{submission.task.region}</span>
                    <h3>{submission.task.title}</h3>
                    <p>
                      {submission.promoter?.displayName ?? '推广客户'} ·{' '}
                      {formatDate(submission.submittedAt ?? submission.claimedAt)} 提交
                    </p>
                  </div>
                  <StatusPill status={submission.status} />
                </div>
                <div className="proof-box">
                  <span>凭证说明</span>
                  <p>{submission.proofText || '尚未填写凭证说明'}</p>
                  {proofUrl ? (
                    <a href={proofUrl} target="_blank" rel="noreferrer">
                      查看外部凭证
                    </a>
                  ) : submission.proofUrl ? (
                    <span className="danger-text">凭证链接格式不受支持</span>
                  ) : (
                    <span className="muted-text">未附带外部链接</span>
                  )}
                </div>
                <div className="review-meta">
                  <div>
                    <span>单笔佣金</span>
                    <Money cents={submission.task.commissionCents} size="small" />
                  </div>
                  <div>
                    <span>保证金</span>
                    <Money cents={submission.depositCents} size="small" />
                  </div>
                </div>
                {submission.status === 'SUBMITTED' ? (
                  <button
                    className="primary-button full-button"
                    type="button"
                    onClick={() => onReview(submission)}
                  >
                    核验并处理
                  </button>
                ) : (
                  <p className="review-note">
                    处理人：{submission.reviewer?.displayName ?? '—'}
                    {submission.reviewNote ? ` · ${submission.reviewNote}` : ''}
                  </p>
                )}
              </article>
            );
          })}
          {!submissions.length ? (
            <EmptyState
              title="没有符合条件的凭证"
              detail={total ? '切换到其他状态后再查看。' : '推广客户提交凭证后会出现在这里。'}
            />
          ) : null}
        </div>
      )}
      <div className="list-pagination" aria-label="凭证分页">
        <span>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        <div>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function WithdrawalsSection({
  withdrawals,
  onReview,
}: {
  withdrawals: Withdrawal[];
  onReview: (withdrawal: Withdrawal) => void;
}) {
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const visible = withdrawals.filter(
    (withdrawal) => filter === 'ALL' || withdrawal.status === 'PENDING',
  );

  return (
    <div className="stack-section">
      <SectionHeading eyebrow="线下打款登记" title="提现处理">
        申请时余额不动，管理员确认打款后才从可用余额扣款。
      </SectionHeading>
      <div className="filter-bar">
        <button
          type="button"
          className={filter === 'PENDING' ? 'active' : ''}
          onClick={() => setFilter('PENDING')}
        >
          待处理
        </button>
        <button
          type="button"
          className={filter === 'ALL' ? 'active' : ''}
          onClick={() => setFilter('ALL')}
        >
          全部记录
        </button>
      </div>

      <div className="withdrawal-list">
        {visible.map((withdrawal) => (
          <article className="withdrawal-row" key={withdrawal.id}>
            <div className="withdrawal-person">
              <span className="avatar">{withdrawal.user.displayName.slice(0, 1)}</span>
              <div>
                <strong>{withdrawal.user.displayName}</strong>
                <span>{formatFullDate(withdrawal.requestedAt)} 申请</span>
              </div>
            </div>
            <div className="withdrawal-amount">
              <span>申请金额</span>
              <Money cents={withdrawal.amountCents} />
            </div>
            <div className="withdrawal-account">
              <span>收款信息</span>
              <strong>{withdrawal.payoutAccount}</strong>
              {withdrawal.note ? <small>{withdrawal.note}</small> : null}
            </div>
            <div className="withdrawal-state">
              <StatusPill status={withdrawal.status} />
              {withdrawal.status === 'PENDING' ? (
                <button
                  className="primary-button small-button"
                  type="button"
                  onClick={() => onReview(withdrawal)}
                >
                  处理
                </button>
              ) : (
                <small>
                  {withdrawal.reviewer?.displayName ?? '—'}
                  {withdrawal.reviewNote ? ` · ${withdrawal.reviewNote}` : ''}
                </small>
              )}
            </div>
          </article>
        ))}
        {!visible.length ? (
          <EmptyState title="当前没有待处理提现" detail="推广客户提交申请后会显示在这里。" />
        ) : null}
      </div>
    </div>
  );
}

function AuditSection({ onError }: { onError: (message: string) => void }) {
  const [pageData, setPageData] = useState<AuditLogPage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draftAction, setDraftAction] = useState('');
  const [draftEntityType, setDraftEntityType] = useState('');
  const [filters, setFilters] = useState({ action: '', entityType: '' });

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({
      page: String(page),
      pageSize: '20',
    });
    if (filters.action) params.set('action', filters.action);
    if (filters.entityType) params.set('entityType', filters.entityType);

    setLoading(true);
    void api
      .get<AuditLogPage>(`/admin/audit-logs?${params.toString()}`)
      .then((nextPage) => {
        if (!active) return;
        setPageData(nextPage);
        if (nextPage.page !== page) setPage(nextPage.page);
      })
      .catch((caught) => {
        if (active) onError(errorMessage(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, onError, page]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({
      action: draftAction.trim(),
      entityType: draftEntityType.trim(),
    });
    setPage(1);
  }

  function clearFilters() {
    setDraftAction('');
    setDraftEntityType('');
    setFilters({ action: '', entityType: '' });
    setPage(1);
  }

  const logs = pageData?.items ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (pageData?.pageSize ?? 20)));

  return (
    <div className="stack-section">
      <SectionHeading eyebrow="只追加记录" title="审计日志">
        管理员对商户、资金、任务和审核的动作都会留下记录。
      </SectionHeading>
      <form className="audit-filters" onSubmit={applyFilters}>
        <label>
          <span>动作</span>
          <input
            value={draftAction}
            onChange={(event) => setDraftAction(event.target.value)}
            placeholder="例如：MERCHANT"
          />
        </label>
        <label>
          <span>实体类型</span>
          <input
            value={draftEntityType}
            onChange={(event) => setDraftEntityType(event.target.value)}
            placeholder="例如：WALLET"
          />
        </label>
        <div className="audit-filter-actions">
          <button className="primary-button" type="submit">
            筛选
          </button>
          <button className="ghost-button" type="button" onClick={clearFilters}>
            清除
          </button>
        </div>
      </form>
      {loading ? (
        <LoadingBlock />
      ) : (
        <div className="audit-table">
          {logs.map((log) => (
            <article className="audit-table-row" key={log.id}>
              <time>{formatFullDate(log.createdAt)}</time>
              <span className="audit-action">{log.action}</span>
              <div>
                <strong>{log.actor?.displayName ?? '系统'}</strong>
                <p>{log.detail}</p>
              </div>
              <span className="audit-entity">
                {log.entityType}
                <small>{log.entityId.slice(0, 8)}</small>
              </span>
            </article>
          ))}
          {!logs.length ? (
            <EmptyState title="暂无审计记录" detail="系统产生业务操作后会记录在这里。" />
          ) : null}
        </div>
      )}
      <div className="audit-pagination" aria-label="审计日志分页">
        <span>
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
        <div>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            上一页
          </button>
          <button
            className="ghost-button"
            type="button"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

function MerchantModal({
  open,
  merchant,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  merchant: MerchantSummary | null;
  onClose: () => void;
  onSaved: (isEdit: boolean) => Promise<void>;
  onError: (message: string) => void;
}) {
  const initial = useMemo(
    () => ({
      companyName: merchant?.companyName ?? '',
      displayName: merchant?.user.displayName ?? '',
      contactName: merchant?.contactName ?? '',
      contactPhone: merchant?.contactPhone ?? '',
      note: merchant?.note ?? '',
      status: merchant?.user.status ?? 'ACTIVE',
    }),
    [merchant],
  );
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setForm(initial), [initial, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (merchant) {
        await api.patch(`/admin/merchants/${merchant.id}`, form);
      } else {
        await api.post('/admin/merchants', {
          companyName: form.companyName,
          displayName: form.displayName,
          contactName: form.contactName,
          ...(form.contactPhone ? { contactPhone: form.contactPhone } : {}),
          ...(form.note ? { note: form.note } : {}),
        });
      }
      await onSaved(Boolean(merchant));
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={merchant ? '编辑商户资料' : '新增商户资料'}
      detail="资料保存在后台；系统不会创建可登录的商户账号。"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="商户名称">
            <input
              required
              minLength={2}
              maxLength={100}
              value={form.companyName}
              onChange={(event) => setForm({ ...form, companyName: event.target.value })}
              placeholder="例如：青禾茶饮"
            />
          </Field>
          <Field label="后台显示名">
            <input
              required
              minLength={2}
              maxLength={100}
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="例如：青禾茶饮运营"
            />
          </Field>
          <Field label="联系人">
            <input
              required
              maxLength={100}
              value={form.contactName}
              onChange={(event) => setForm({ ...form, contactName: event.target.value })}
              placeholder="姓名"
            />
          </Field>
          <Field label="联系电话">
            <input
              maxLength={100}
              value={form.contactPhone}
              onChange={(event) => setForm({ ...form, contactPhone: event.target.value })}
              placeholder="可选"
            />
          </Field>
          {merchant ? (
            <Field label="资料状态">
              <select
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as 'ACTIVE' | 'DISABLED',
                  })
                }
              >
                <option value="ACTIVE">正常</option>
                <option value="DISABLED">停用</option>
              </select>
            </Field>
          ) : null}
          <Field label="内部备注" wide>
            <textarea
              maxLength={1000}
              rows={4}
              value={form.note}
              onChange={(event) => setForm({ ...form, note: event.target.value })}
              placeholder="记录合作范围、对接人或其他内部信息"
            />
          </Field>
        </div>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在保存…' : merchant ? '保存资料' : '写入后台'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function WalletModal({
  target,
  onClose,
  onSaved,
  onError,
}: {
  target: AdminWallet | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) {
      setAmount('');
      setReason('');
    }
  }, [target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const amountCents = signedYuanToCents(amount);
    if (!amountCents || amountCents === '0') {
      onError('请输入非零金额，最多保留两位小数。');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/admin/wallets/${target.id}/adjust`, {
        requestId: crypto.randomUUID(),
        amountCents,
        reason,
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
      open={Boolean(target)}
      title="调整资金账户"
      detail={
        target
          ? `${target.merchantProfile?.companyName ?? target.displayName} · 当前可用 ${centsToYuanInput(target.wallet?.availableCents ?? '0')} 元`
          : undefined
      }
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <div className="modal-warning">
          <strong>这会直接改变可用余额</strong>
          <p>正数增加、负数扣减。系统会同时写入资金流水和审计日志，不能直接改余额数字。</p>
        </div>
        <Field label="调账金额（元）" hint="例如 1000.00 增加，-200.00 扣减">
          <input
            required
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="调账原因" hint="至少 5 个字，之后会显示在审计日志里">
          <textarea
            required
            minLength={5}
            maxLength={500}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：录入线下合同预付款"
          />
        </Field>
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? '正在入账…' : '确认调账'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TaskModal({
  open,
  merchants,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  merchants: MerchantSummary[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const getInitialTimes = () => {
    const start = new Date(Date.now() + 10 * 60 * 1_000);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1_000);
    return { start: toDateTimeLocal(start), end: toDateTimeLocal(end) };
  };
  const [initialTimes] = useState(getInitialTimes);
  const [form, setForm] = useState({
    merchantId: '',
    title: '',
    description: '',
    adContent: '',
    publicPoints: '',
    region: '',
    adFee: '',
    rewardType: 'NORMAL' as 'NORMAL' | 'WELFARE',
    welfareClaimRule: '',
    maxClaims: '100',
    startsAt: initialTimes.start,
    endsAt: initialTimes.end,
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const firstMerchant = merchants.find(
      (merchant) => merchant.user.status === 'ACTIVE' && merchant.user.wallet,
    );
    setForm((current) => ({
      ...current,
      merchantId: firstMerchant?.id ?? '',
    }));
  }, [open, merchants]);

  const pricing = useMemo(() => {
    const cents = yuanToCents(form.adFee);
    const maxClaims = Number(form.maxClaims);
    if (!cents || !Number.isSafeInteger(maxClaims) || maxClaims < 1) return null;
    const numericCents = Number(cents);
    if (!Number.isSafeInteger(numericCents)) return null;
    const commission = commissionForAdFee(numericCents, form.rewardType);
    const referral = referralForCommission(commission);
    return {
      commission: BigInt(commission),
      referral: BigInt(referral),
      budget: BigInt(maxClaims) * BigInt(commission + referral),
    };
  }, [form.adFee, form.maxClaims, form.rewardType]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const adFeeCents = yuanToCents(form.adFee);
    if (!adFeeCents) {
      onError('广告费必须是有效金额，最多保留两位小数。');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/tasks', {
        requestId: crypto.randomUUID(),
        merchantId: form.merchantId,
        title: form.title,
        ...(form.description ? { description: form.description } : {}),
        adContent: form.adContent,
        publicPoints: form.publicPoints,
        region: form.region,
        adFeeCents,
        rewardType: form.rewardType,
        ...(form.rewardType === 'WELFARE' ? { welfareClaimRule: form.welfareClaimRule } : {}),
        maxClaims: Number(form.maxClaims),
        startsAt: fromDateTimeLocal(form.startsAt),
        endsAt: fromDateTimeLocal(form.endsAt),
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
      title="发布推广任务"
      detail="以商户资料的名义创建任务；发布成功后立即冻结最高预算。"
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        {!merchants.length ? (
          <div className="modal-warning danger-warning">
            <strong>还没有商户资料</strong>
            <p>请先在“商户与资金”中新增商户并充值，再发布任务。</p>
          </div>
        ) : null}
        <div className="form-grid">
          <Field label="归属商户" wide>
            <select
              required
              value={form.merchantId}
              onChange={(event) => setForm({ ...form, merchantId: event.target.value })}
            >
              <option value="">选择商户资料</option>
              {merchants.map((merchant) => (
                <option
                  key={merchant.id}
                  value={merchant.id}
                  disabled={merchant.user.status !== 'ACTIVE' || !merchant.user.wallet}
                >
                  {merchant.companyName}
                  {merchant.user.wallet
                    ? ` · 可用 ${centsToYuanInput(merchant.user.wallet.availableCents)} 元`
                    : ' · 未开通钱包'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="任务名称">
            <input
              required
              minLength={2}
              maxLength={80}
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="例如：商圈门店到店展示"
            />
          </Field>
          <Field label="投放地区">
            <input
              required
              maxLength={100}
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
              placeholder="例如：杭州市西湖区"
            />
          </Field>
          <Field label="广告内容" wide>
            <textarea
              required
              minLength={2}
              maxLength={1000}
              rows={3}
              value={form.adContent}
              onChange={(event) => setForm({ ...form, adContent: event.target.value })}
              placeholder="推广客户需要展示或执行的内容"
            />
          </Field>
          <Field label="公开要点" wide>
            <textarea
              required
              maxLength={300}
              rows={2}
              value={form.publicPoints}
              onChange={(event) => setForm({ ...form, publicPoints: event.target.value })}
              placeholder="凭证需要体现的关键信息"
            />
          </Field>
          <Field label="内部说明" wide>
            <textarea
              maxLength={1000}
              rows={2}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="可选，记录投放口径"
            />
          </Field>
          <Field label="单笔广告费（元）">
            <input
              required
              inputMode="decimal"
              value={form.adFee}
              onChange={(event) => setForm({ ...form, adFee: event.target.value })}
              placeholder="1000.00"
            />
          </Field>
          <Field label="任务类型">
            <select
              value={form.rewardType}
              onChange={(event) =>
                setForm({
                  ...form,
                  rewardType: event.target.value as 'NORMAL' | 'WELFARE',
                })
              }
            >
              <option value="NORMAL">普通任务</option>
              <option value="WELFARE">福利任务</option>
            </select>
          </Field>
          <Field label="领取名额">
            <input
              required
              type="number"
              min={1}
              max={10000}
              value={form.maxClaims}
              onChange={(event) => setForm({ ...form, maxClaims: event.target.value })}
            />
          </Field>
          <Field label="开始时间">
            <input
              required
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
            />
          </Field>
          <Field label="结束时间">
            <input
              required
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
            />
          </Field>
          {form.rewardType === 'WELFARE' ? (
            <Field label="福利领取规则" wide>
              <textarea
                required
                maxLength={500}
                rows={3}
                value={form.welfareClaimRule}
                onChange={(event) => setForm({ ...form, welfareClaimRule: event.target.value })}
                placeholder="填写领取对象、方式和数量"
              />
            </Field>
          ) : null}
        </div>
        {pricing ? (
          <div className="pricing-preview">
            <div>
              <span>单笔佣金</span>
              <Money cents={pricing.commission} size="small" />
            </div>
            <div>
              <span>一级返佣</span>
              <Money cents={pricing.referral} size="small" />
            </div>
            <div>
              <span>将冻结预算</span>
              <Money cents={pricing.budget} />
            </div>
          </div>
        ) : null}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary-button"
            type="submit"
            disabled={submitting || !merchants.length}
          >
            {submitting ? '正在发布…' : '发布并冻结预算'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewModal({
  submission,
  onClose,
  onSaved,
  onError,
}: {
  submission: Submission | null;
  onClose: () => void;
  onSaved: (approved: boolean) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'APPROVED' | 'REJECTED' | null>(null);

  useEffect(() => setNote(''), [submission]);

  async function review(decision: 'APPROVED' | 'REJECTED') {
    if (!submission) return;
    setSubmitting(decision);
    try {
      await api.post(`/admin/submissions/${submission.id}/review`, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await onSaved(decision === 'APPROVED');
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Modal
      open={Boolean(submission)}
      title="核验推广凭证"
      detail={
        submission
          ? `${submission.task.title} · ${submission.promoter?.displayName ?? '推广客户'}`
          : undefined
      }
      onClose={onClose}
    >
      {submission ? (
        <div className="modal-form">
          <div className="proof-box proof-box-large">
            <span>提交说明</span>
            <p>{submission.proofText}</p>
            {safeExternalUrl(submission.proofUrl) ? (
              <a href={safeExternalUrl(submission.proofUrl)!} target="_blank" rel="noreferrer">
                在新窗口查看凭证
              </a>
            ) : (
              <span className="muted-text">没有可安全打开的外部链接</span>
            )}
          </div>
          <div className="settlement-note">
            <strong>通过后立即结算</strong>
            <p>
              退回保证金 <Money cents={submission.depositCents} size="small" />
              ，从任务预算扣款并发放佣金与一级返佣。
            </p>
          </div>
          <Field label="审核备注" hint="驳回时建议写明需要补充的凭证">
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="填写核验结论"
            />
          </Field>
          <div className="modal-actions">
            <button
              className="danger-outline-button"
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => void review('REJECTED')}
            >
              {submitting === 'REJECTED' ? '正在驳回…' : '驳回并退保证金'}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => void review('APPROVED')}
            >
              {submitting === 'APPROVED' ? '正在结算…' : '通过并结算'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}

function WithdrawalReviewModal({
  withdrawal,
  onClose,
  onSaved,
  onError,
}: {
  withdrawal: Withdrawal | null;
  onClose: () => void;
  onSaved: (paid: boolean) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState<'PAID' | 'REJECTED' | null>(null);

  useEffect(() => setNote(''), [withdrawal]);

  async function review(decision: 'PAID' | 'REJECTED') {
    if (!withdrawal) return;
    setSubmitting(decision);
    try {
      await api.post(`/admin/withdrawals/${withdrawal.id}/review`, {
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      await onSaved(decision === 'PAID');
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Modal
      open={Boolean(withdrawal)}
      title="处理提现申请"
      detail={
        withdrawal ? `${withdrawal.user.displayName} · ${withdrawal.payoutAccount}` : undefined
      }
      onClose={onClose}
    >
      {withdrawal ? (
        <div className="modal-form">
          <div className="withdrawal-confirm-ticket">
            <span>本次申请金额</span>
            <Money cents={withdrawal.amountCents} size="large" />
            <small>确认打款之前，这笔钱仍在推广客户的可用余额中。</small>
          </div>
          <Field label="处理备注" hint="建议填写打款流水号，或驳回原因">
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：支付宝流水号 20261025…"
            />
          </Field>
          <div className="modal-actions">
            <button
              className="danger-outline-button"
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => void review('REJECTED')}
            >
              {submitting === 'REJECTED' ? '正在驳回…' : '驳回归还额度'}
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={Boolean(submitting)}
              onClick={() => void review('PAID')}
            >
              {submitting === 'PAID' ? '正在扣款…' : '确认已打款'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
