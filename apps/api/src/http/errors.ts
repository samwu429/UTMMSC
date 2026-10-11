import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Thrown by handlers to produce a structured error response. Messages are user-facing Chinese
 * strings; codes are stable identifiers the front end can branch on.
 * 由处理器抛出以生成结构化错误响应。message 为面向用户的中文；code 为前端可据此分支的稳定标识。
 */
export class ApiHttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new ApiHttpError(400, code, message);
export const unauthorized = (message = '请先登录') => new ApiHttpError(401, 'unauthorized', message);
export const forbidden = (message = '没有权限执行此操作') => new ApiHttpError(403, 'forbidden', message);
export const notFound = (message = '未找到') => new ApiHttpError(404, 'not_found', message);
export const conflict = (code: string, message: string) => new ApiHttpError(409, code, message);
export const tooMany = (message = '操作过于频繁，请稍后再试') => new ApiHttpError(429, 'rate_limited', message);

export function errorResponse(error: unknown, c: Context): Response {
  if (error instanceof ApiHttpError) {
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  console.error('[unhandled]', error);
  return c.json({ error: { code: 'internal', message: '服务器出错，请稍后再试' } }, 500);
}
