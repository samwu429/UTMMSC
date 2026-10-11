import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { tooMany } from '../errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory sliding window per isolate. It is a first line of defence for login and code
 * requests; the verification table enforces the durable per-email limits.
 * 单个隔离实例内的内存滑动窗口。作为登录与验证码请求的第一道防线；持久的按邮箱限制由验证表保证。
 */
export function rateLimit(limit: number, windowMs: number): MiddlewareHandler<AppEnv> {
  const buckets = new Map<string, Bucket>();
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else if (bucket.count >= limit) {
      throw tooMany();
    } else {
      bucket.count += 1;
    }
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    await next();
  };
}
