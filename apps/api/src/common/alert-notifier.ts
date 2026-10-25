export interface ServerErrorAlert {
  type: 'http_server_error';
  service: 'max-promotion-api';
  environment: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  errorType: string;
  occurredAt: string;
}

export interface AlertNotifierOptions {
  webhookUrl: string | null;
  timeoutMs: number;
  cooldownMs: number;
}

type FetchImplementation = typeof fetch;

/**
 * 向通用 Webhook 推送服务端错误摘要。
 * 相同错误在冷却期内只发送一次，避免故障时形成告警风暴。
 */
export class AlertNotifier {
  private readonly lastAttemptAt = new Map<string, number>();

  constructor(
    private readonly options: AlertNotifierOptions,
    private readonly fetchImpl: FetchImplementation = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async notify(alert: ServerErrorAlert): Promise<boolean> {
    const url = this.options.webhookUrl;
    if (!url) return false;

    const currentTime = this.now();
    this.pruneExpiredAttempts(currentTime);
    const deduplicationKey = [
      alert.environment,
      alert.statusCode,
      alert.method,
      alert.path,
      alert.errorType,
    ].join('|');
    const previousAttempt = this.lastAttemptAt.get(deduplicationKey);
    if (previousAttempt !== undefined && currentTime - previousAttempt < this.options.cooldownMs) {
      return false;
    }

    // 发送前先占用冷却窗口，Webhook 故障时也不会被同一错误持续冲击。
    this.lastAttemptAt.set(deduplicationKey, currentTime);
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`告警 Webhook 返回 HTTP ${response.status}`);
    }
    return true;
  }

  private pruneExpiredAttempts(currentTime: number): void {
    for (const [key, attemptedAt] of this.lastAttemptAt) {
      if (currentTime - attemptedAt >= this.options.cooldownMs) {
        this.lastAttemptAt.delete(key);
      }
    }
  }
}

export function buildServerErrorAlert(input: {
  environment: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  errorType: string;
  occurredAt: Date;
}): ServerErrorAlert | null {
  if (input.statusCode < 500) return null;
  return {
    type: 'http_server_error',
    service: 'max-promotion-api',
    environment: input.environment,
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    errorType: input.errorType,
    occurredAt: input.occurredAt.toISOString(),
  };
}
