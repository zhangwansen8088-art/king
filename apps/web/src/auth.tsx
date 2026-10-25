import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { clearSessionTokens, loginRequest, logoutRequest, refreshRequest } from './api';
import type { SessionUser } from './types';

interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void refreshRequest().then((session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  async function login(username: string, password: string): Promise<SessionUser> {
    const session = await loginRequest(username, password);
    setUser(session.user);
    return session.user;
  }

  async function logout(): Promise<void> {
    try {
      await logoutRequest();
    } finally {
      clearSessionTokens();
      setUser(null);
    }
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 未初始化');
  return value;
}
