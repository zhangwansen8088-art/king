import { parseTrustProxy } from './trust-proxy';

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
};

const number = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`环境变量 ${name} 必须是数字`);
  return parsed;
};

const integer = (name: string, fallback: number, minimum: number, maximum: number): number => {
  const parsed = number(name, fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`环境变量 ${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return parsed;
};

const webhookUrl = (): string | null => {
  const raw = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('环境变量 ALERT_WEBHOOK_URL 必须是合法网址');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('环境变量 ALERT_WEBHOOK_URL 只支持 HTTP 或 HTTPS');
  }
  return parsed.toString();
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
  alertWebhookUrl: string | null;
  alertWebhookTimeoutMs: number;
  alertCooldownMinutes: number;
  auditRetentionDays: number;
  auditCleanupIntervalHours: number;
  auditCleanupBatchSize: number;
  trustProxy: string[];
  loginMaxFailures: number;
  loginWindowMinutes: number;
  loginLockMinutes: number;
  loginAttemptRetentionHours: number;
}

export function loadEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const jwtSecret = required('JWT_SECRET');
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET 至少需要 32 个字符');
  const auditRetentionDays = integer('AUDIT_RETENTION_DAYS', 0, 0, 3_650);
  if (auditRetentionDays > 0 && auditRetentionDays < 30) {
    throw new Error('AUDIT_RETENTION_DAYS 只能设为 0（关闭）或不低于 30 天');
  }
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
    alertWebhookUrl: webhookUrl(),
    alertWebhookTimeoutMs: integer('ALERT_WEBHOOK_TIMEOUT_MS', 5_000, 1_000, 15_000),
    alertCooldownMinutes: integer('ALERT_COOLDOWN_MINUTES', 15, 1, 1_440),
    auditRetentionDays,
    auditCleanupIntervalHours: integer('AUDIT_CLEANUP_INTERVAL_HOURS', 24, 1, 168),
    auditCleanupBatchSize: integer('AUDIT_CLEANUP_BATCH_SIZE', 1_000, 100, 10_000),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY_CIDRS),
    loginMaxFailures: integer('LOGIN_MAX_FAILURES', 5, 3, 20),
    loginWindowMinutes: integer('LOGIN_WINDOW_MINUTES', 15, 1, 1_440),
    loginLockMinutes: integer('LOGIN_LOCK_MINUTES', 15, 1, 1_440),
    loginAttemptRetentionHours: integer('LOGIN_ATTEMPT_RETENTION_HOURS', 24, 1, 720),
  };
}
