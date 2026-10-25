import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_LOGGED_PATH_LENGTH = 512;

export interface AccessLogEntry {
  type: 'http_request';
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  aborted: boolean;
}

/**
 * 接收上游传入的合法请求 ID，非法值一律重新生成，防止日志注入。
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

/**
 * 只记录路径，不记录查询参数，避免令牌、手机号等敏感值进入日志。
 */
export function getAccessLogPath(originalUrl: string): string {
  const path = originalUrl.split(/[?#]/, 1)[0] || '/';
  return path.slice(0, MAX_LOGGED_PATH_LENGTH);
}

export function createAccessLogEntry(
  request: Pick<Request, 'method' | 'originalUrl'>,
  response: Pick<Response, 'statusCode'>,
  requestId: string,
  durationNs: bigint,
  aborted = false,
): AccessLogEntry {
  return {
    type: 'http_request',
    requestId,
    method: request.method,
    path: getAccessLogPath(request.originalUrl),
    statusCode: response.statusCode,
    durationMs: Math.round(Number(durationNs) / 1_000_000),
    aborted,
  };
}

/**
 * 为每次请求生成关联 ID，并在响应结束后输出一行 JSON 访问日志。
 */
export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const requestId = resolveRequestId(request.headers['x-request-id']);
  const startedAt = process.hrtime.bigint();
  let logged = false;

  response.setHeader('X-Request-ID', requestId);

  const writeLog = (aborted: boolean): void => {
    if (logged) return;
    logged = true;
    const entry = createAccessLogEntry(
      request,
      response,
      requestId,
      process.hrtime.bigint() - startedAt,
      aborted,
    );
    process.stdout.write(`${JSON.stringify(entry)}\n`);
  };

  // finish 表示正常完成；客户端提前断开时由 close 补记，避免漏日志。
  response.once('finish', () => writeLog(false));
  response.once('close', () => writeLog(!response.writableFinished));
  next();
}
