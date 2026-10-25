import { useEffect, type ReactNode } from 'react';
import { formatCny } from '@max-promotion/contracts';

export type Notice = { kind: 'success' | 'error' | 'info'; text: string } | null;

const statusText: Record<string, string> = {
  ACTIVE: '正常',
  DISABLED: '已停用',
  OPEN: '进行中',
  PAUSED: '已暂停',
  ENDED: '已结束',
  CLAIMED: '待提交',
  SUBMITTED: '待审核',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  PENDING: '待处理',
  PAID: '已打款',
  NORMAL: '普通任务',
  WELFARE: '福利任务',
  ADMIN: '管理员',
  PROMOTER: '推广客户',
  MERCHANT: '后台商户资料',
};

export function statusLabel(status: string): string {
  return statusText[status] ?? status;
}

export function StatusPill({
  status,
  tone,
}: {
  status: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  const inferred =
    tone ??
    (['APPROVED', 'PAID', 'OPEN', 'ACTIVE'].includes(status)
      ? 'good'
      : ['PENDING', 'SUBMITTED', 'CLAIMED', 'PAUSED'].includes(status)
        ? 'warn'
        : ['REJECTED', 'DISABLED', 'ENDED'].includes(status)
          ? 'danger'
          : 'neutral');
  return <span className={`status-pill status-${inferred}`}>{statusLabel(status)}</span>;
}

export function Money({
  cents,
  size = 'normal',
  className = '',
}: {
  cents: string | bigint | number;
  size?: 'small' | 'normal' | 'large';
  className?: string;
}) {
  return <span className={`money money-${size} ${className}`.trim()}>{formatCny(cents)}</span>;
}

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind}`} role="status">
      <span>{notice.text}</span>
      <button className="notice-close" type="button" onClick={onClose} aria-label="关闭提示">
        ×
      </button>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <span className="empty-rule" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function LoadingBlock({ text = '正在读取台账…' }: { text?: string }) {
  return (
    <div className="loading-block" aria-live="polite">
      <span className="loading-line" />
      <span>{text}</span>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  wide = false,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Modal({
  open,
  title,
  detail,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  detail?: string | undefined;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {detail ? <p>{detail}</p> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function formatFullDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value: string): string {
  return new Date(value).toISOString();
}

export function yuanToCents(value: string): string | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [yuan = '0', fraction = ''] = normalized.split('.');
  return (BigInt(yuan) * 100n + BigInt(fraction.padEnd(2, '0'))).toString();
}

export function centsToYuanInput(value: string): string {
  const cents = BigInt(value);
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const yuan = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${yuan}.${fraction}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}
