import type { AuthSession } from './types';

interface ErrorPayload {
  message?: string | string[];
  statusCode?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let csrfToken: string | null = null;
let refreshInFlight: Promise<AuthSession | null> | null = null;

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}

function setSessionTokens(session: Pick<AuthSession, 'accessToken' | 'csrfToken'>): void {
  accessToken = session.accessToken;
  csrfToken = session.csrfToken;
}

export function clearSessionTokens(): void {
  accessToken = null;
  csrfToken = null;
}

async function parseError(response: Response): Promise<ApiError> {
  let message = `请求失败（${response.status}）`;
  try {
    const payload = (await response.json()) as ErrorPayload;
    if (Array.isArray(payload.message)) message = payload.message.join('；');
    else if (payload.message) message = payload.message;
  } catch {
    // 非 JSON 错误保持通用提示。
  }
  return new ApiError(message, response.status);
}

async function rawRequest<T>(
  path: string,
  init: RequestInit = {},
  withAccessToken = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (withAccessToken && accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function loginRequest(username: string, password: string): Promise<AuthSession> {
  const session = await rawRequest<AuthSession>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
    false,
  );
  setSessionTokens(session);
  return session;
}

export async function refreshRequest(): Promise<AuthSession | null> {
  if (refreshInFlight) return refreshInFlight;
  const token = readCookie('max_csrf');
  if (!token) return null;

  refreshInFlight = rawRequest<AuthSession>(
    '/auth/refresh',
    {
      method: 'POST',
      headers: { 'X-CSRF-Token': token },
    },
    false,
  )
    .then((session) => {
      setSessionTokens(session);
      return session;
    })
    .catch(() => {
      clearSessionTokens();
      return null;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export async function logoutRequest(): Promise<void> {
  const token = csrfToken ?? readCookie('max_csrf');
  try {
    await rawRequest<{ success: true }>(
      '/auth/logout',
      {
        method: 'POST',
        headers: token ? { 'X-CSRF-Token': token } : {},
      },
      false,
    );
  } finally {
    clearSessionTokens();
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await rawRequest<T>(path, init);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    const session = await refreshRequest();
    if (!session) throw error;
    return rawRequest<T>(path, init);
  }
}

export const api = {
  get: <T>(path: string) => apiRequest<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  patch: <T>(path: string, body: unknown) =>
    apiRequest<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
