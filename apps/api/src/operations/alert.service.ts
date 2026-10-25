import { Injectable, Logger } from '@nestjs/common';
import {
  AlertNotifier,
  type LoginLockoutAlert,
  type ServerErrorAlert,
} from '../common/alert-notifier';
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

  /**
   * 登录锁定告警只发送哈希标识和锁定信息，不发送账号、密码或原始 IP。
   */
  async notifyLoginLockout(alert: LoginLockoutAlert): Promise<void> {
    try {
      const sent = await this.notifier.notify(alert);
      if (sent) {
        this.logger.warn(
          JSON.stringify({
            type: 'login_lockout_alert_sent',
            scope: alert.scope,
            subjectHash: alert.subjectHash.slice(0, 12),
          }),
        );
      }
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          type: 'login_lockout_alert_failed',
          scope: alert.scope,
          errorType: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }
  }
}
