import { ArgumentsHost, Catch, HttpException, HttpStatus, type HttpServer } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AlertService } from '../operations/alert.service';
import { buildServerErrorAlert } from './alert-notifier';
import { getAccessLogPath } from './request-logging.middleware';

@Catch()
export class AlertExceptionFilter extends BaseExceptionFilter {
  constructor(
    applicationRef: HttpServer,
    private readonly alerts: AlertService,
  ) {
    super(applicationRef);
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    const statusCode =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const context = host.switchToHttp();
      const request = context.getRequest<Request>();
      const response = context.getResponse<Response>();
      const responseRequestId = response.getHeader('X-Request-ID');
      const alert = buildServerErrorAlert({
        environment: process.env.NODE_ENV ?? 'development',
        requestId: typeof responseRequestId === 'string' ? responseRequestId : 'unknown',
        method: request.method,
        path: getAccessLogPath(request.originalUrl),
        statusCode,
        errorType: exception instanceof Error ? exception.name : 'UnknownError',
        occurredAt: new Date(),
      });
      if (alert) void this.alerts.notifyServerError(alert);
    }

    // 保留 NestJS 原有错误响应格式，避免前端鉴权和表单校验行为变化。
    super.catch(exception, host);
  }
}
