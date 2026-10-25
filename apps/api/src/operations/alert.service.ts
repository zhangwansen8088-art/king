import { Injectable, Logger } from '@nestjs/common';
import { AlertNotifier, type ServerErrorAlert } from '../common/alert-notifier';
import { loadEnv } from '../config/env';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly notifier: AlertNotifier;

  constructor() {
    const env = loadEnv();
    this.notifier = new AlertNotifier({
      webhookUrl: env.alertWebhookUrl,
      timeoutMs: env.alertWebhookTimeoutMs,
      cooldownMs: env.alertCooldownMinutes * 60_000,
    });
  }

  /**
   * 告警失败不能影响业务响应，只保留无敏感信息的结构化日志。
   */
  async notifyServerError(alert: ServerErrorAlert): Promise<void> {
    try {
      const sent = await this.notifier.notify(alert);
      if (sent) {
        this.logger.warn(
          JSON.stringify({
            type: 'alert_sent',
            requestId: alert.requestId,
            statusCode: alert.statusCode,
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          type: 'alert_delivery_failed',
          requestId: alert.requestId,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
