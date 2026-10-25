import { Module } from '@nestjs/common';
import { AlertService } from './alert.service';

/**
 * 运维告警由独立模块导出，接口模块共用同一冷却状态和 Webhook 配置。
 */
@Module({
  providers: [AlertService],
  exports: [AlertService],
})
export class OperationsModule {}
