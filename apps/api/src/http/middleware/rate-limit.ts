import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../context';
import { tooMany, unauthorized } from '../errors';

interface Bucket {
  count: number;
  resetAt: number;
}

const PRUNE_ABOVE = 5000;

/**
 * Counts one request against `key`, throwing 429 once `limit` requests fell in the current window. Expired
 * buckets are dropped when the map grows large, so an isolate's memory stays bounded.
 * 把一次请求计入 `key`，当前窗口内已满 `limit` 次时抛出 429。映射变大时删除已过期的计数，隔离实例的内存因此有上限。
 */
function take(buckets: Map<string, Bucket>, key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
  } else if (bucket.count >= limit) {
    throw tooMany();
  } else {
    bucket.count += 1;
  }
  if (buckets.size > PRUNE_ABOVE) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }
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
    take(buckets, `${c.req.path}:${ip}`, limit, windowMs);
    await next();
  };
}

/** Shared by every memberRateLimit, so one name is one budget wherever it is mounted. */
/** 所有 memberRateLimit 共用，同一个名称无论挂在哪里都是同一份额度。 */
const memberBuckets = new Map<string, Bucket>();

/**
 * In-memory window per isolate keyed by `${name}:${member id}`, for routes behind requireSession. Members on
 * one campus network share an IP, so keying by member keeps one busy member from using up everyone's limit,
 * and keying by name rather than path lets every route of one action share a budget (/moments/posts/a/like
 * and /moments/posts/b/like count together). Routes that give the same name share the count, each with its
 * own limit. Durable caps, such as posts per day, are counted in D1 by the routes themselves.
 * 单个隔离实例内的内存窗口，按 `${name}:${成员 id}` 计数，用于 requireSession 之后的接口。同一校园网的成员共用 IP，
 * 按成员计数可避免一位频繁操作的成员用光所有人的额度；按名称而不是路径计数，同一操作的所有接口共用一份额度
 * （/moments/posts/a/like 和 /moments/posts/b/like 合并计数）。使用同一名称的接口共用计数，各自按自己的上限判断。
 * 持久的上限（例如每天的发帖数）由接口自己在 D1 中统计。
 */
export function memberRateLimit(name: string, limit: number, windowMs: number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const member = c.get('member');
    // Mounted before requireSession by mistake: refuse rather than let every request share one anonymous bucket.
    // 误挂在 requireSession 之前时直接拒绝，而不是让所有请求共用一个匿名计数。
    if (!member) throw unauthorized();
    take(memberBuckets, `${name}:${member.id}`, limit, windowMs);
    await next();
  };
}
