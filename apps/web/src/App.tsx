import { useAuth } from './auth';
import { LoginPage } from './components/LoginPage';
import { AdminWorkspace } from './pages/AdminWorkspace';
import { PromoterWorkspace } from './pages/PromoterWorkspace';

function SessionLoading() {
  return (
    <main className="session-loading">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <p>正在核对会话…</p>
    </main>
  );
}

export function App() {
  const { user, ready, logout } = useAuth();

  if (!ready) return <SessionLoading />;
  if (!user) return <LoginPage />;
  if (user.role === 'ADMIN') return <AdminWorkspace user={user} onLogout={logout} />;
  if (user.role === 'PROMOTER') {
    return <PromoterWorkspace user={user} onLogout={logout} />;
  }

  return (
    <main className="session-loading">
      <span className="brand-mark" aria-hidden="true">
        M
      </span>
      <h1>该身份没有工作台</h1>
      <p>商户资料只由管理员在后台维护，不提供独立登录界面。</p>
      <button className="secondary-button" type="button" onClick={() => void logout()}>
        退出登录
      </button>
    </main>
  );
}
