import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AuthSessionRecord } from '../types';
import { EmptyState, LoadingBlock, Modal, errorMessage, formatFullDate, type Notice } from './ui';

interface SessionSecurityProps {
  onNotice: (notice: Notice) => void;
}

/**
 * 会话安全面板只展示服务端返回的白名单字段。
 * 当前会话由顶部“退出”处理，其他会话可单独撤销。
 */
export function SessionSecurityPanel({ onNotice }: SessionSecurityProps) {
  const [sessions, setSessions] = useState<AuthSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      setSessions(await api.get<AuthSessionRecord[]>('/auth/sessions'));
    } catch (caught) {
      onNotice({ kind: 'error', text: errorMessage(caught) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(session: AuthSessionRecord): Promise<void> {
    if (session.current) return;
    const confirmed = window.confirm(
      `确认撤销这个会话吗？\n\n设备：${session.userAgent || '未知设备'}\n来源 IP：${
        session.ipAddress || '未知'
      }`,
    );
    if (!confirmed) return;

    setRevokingId(session.id);
    try {
      await api.post(`/auth/sessions/${session.id}/revoke`);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      onNotice({ kind: 'success', text: '该会话已撤销，原有访问和刷新凭据均不可继续使用。' });
    } catch (caught) {
      onNotice({ kind: 'error', text: errorMessage(caught) });
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="stack-section session-security">
      <div className="section-heading">
        <div>
          <span>账号安全</span>
          <h2>登录会话</h2>
          <p>这里仅显示当前账号仍未过期、尚未撤销的登录会话；不会显示令牌内容。</p>
        </div>
        <button
          className="ghost-button"
          type="button"
          disabled={loading || revokingId !== null}
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          刷新列表
        </button>
      </div>

      {loading ? (
        <LoadingBlock text="正在读取登录会话…" />
      ) : sessions.length ? (
        <div className="session-list">
          {sessions.map((session) => (
            <article className="session-row" key={session.id}>
              <div className="session-identity">
                <span className={session.current ? 'session-badge current' : 'session-badge'}>
                  {session.current ? '当前设备' : '其他会话'}
                </span>
                <strong title={session.userAgent}>{session.userAgent || '未知设备'}</strong>
                <span title={session.ipAddress}>来源 IP：{session.ipAddress || '未知'}</span>
              </div>
              <dl className="session-meta">
                <div>
                  <dt>创建时间</dt>
                  <dd>{formatFullDate(session.createdAt)}</dd>
                </div>
                <div>
                  <dt>有效至</dt>
                  <dd>{formatFullDate(session.expiresAt)}</dd>
                </div>
              </dl>
              {session.current ? (
                <span className="session-note">使用顶部“退出”结束</span>
              ) : (
                <button
                  className="danger-text-button"
                  type="button"
                  disabled={revokingId !== null}
                  onClick={() => void revoke(session)}
                >
                  {revokingId === session.id ? '撤销中…' : '撤销会话'}
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="暂无有效会话" detail="当前登录会话可能已结束，请重新登录后再查看。" />
      )}
    </div>
  );
}

export function SessionSecurityModal({
  open,
  onClose,
  onNotice,
}: SessionSecurityProps & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="登录会话" detail="只管理当前账号自己的会话。" onClose={onClose}>
      <SessionSecurityPanel onNotice={onNotice} />
    </Modal>
  );
}
