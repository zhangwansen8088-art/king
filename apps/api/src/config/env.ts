const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const number = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`环境变量 ${name} 必须是数字`);
  return parsed;
};

export interface AppEnv {
  nodeEnv: string;
  port: number;
  webOrigin: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenDays: number;
  refreshCookieName: string;
  csrfCookieName: string;
  enableSwagger: boolean;
  cookieSecure: boolean;
}

export function loadEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET 至少需要 32 个字符');
  const cookieSecure =
    process.env.COOKIE_SECURE === undefined
      ? nodeEnv === 'production'
      : process.env.COOKIE_SECURE === 'true';

  return {
    nodeEnv,
    port: number('PORT', 3000),
    webOrigin: required('WEB_ORIGIN'),
    jwtSecret,
    accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTokenDays: number('REFRESH_TOKEN_DAYS', 7),
    refreshCookieName: process.env.REFRESH_COOKIE_NAME ?? 'max_refresh',
    csrfCookieName: 'max_csrf',
    enableSwagger: process.env.ENABLE_SWAGGER !== 'false',
    cookieSecure,
  };
}
