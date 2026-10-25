import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { errorMessage } from './ui';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      await login(username, password);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand" aria-labelledby="login-brand-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            M
          </span>
          <span>MAX 众推台</span>
        </div>

        <div className="login-statement">
          <p className="login-kicker">推广任务与资金台账</p>
          <h1 id="login-brand-title">
            每一单有去向
            <br />
            每一笔有凭据
          </h1>
          <p className="login-intro">
            管理员统一维护商户资料、任务预算与审核；推广客户领取随机任务并提交凭证。
          </p>
        </div>

        <div className="login-role-note">
          <span className="login-role-rule" aria-hidden="true" />
          <div>
            <strong>统一登录入口</strong>
            <p>仅管理员和推广客户可登录。商户资料由平台在后台代管，不设独立商户界面。</p>
          </div>
        </div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-form-wrap">
          <p className="form-step">身份验证</p>
          <h2 id="login-title">登录工作台</h2>
          <p className="login-form-copy">请使用已分配的管理员或推广客户账号。</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              <span>账号</span>
              <input
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="输入登录账号"
                required
              />
            </label>
            <label>
              <span>密码</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入登录密码"
                required
              />
            </label>

            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}

            <button className="primary-button login-submit" type="submit" disabled={submitting}>
              {submitting ? '正在验证…' : '进入工作台'}
            </button>
          </form>

          <p className="login-footnote">连续登录失败会被记录在审计日志中。请勿共享账号或密码。</p>
        </div>
      </section>
    </main>
  );
}
