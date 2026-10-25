/**
 * When to fetch a new room media token. Tokens are `base64url(payload).signature` and the payload carries `exp`
 * (server milliseconds), which the page may read but not trust. Day tokens stay the same all day, so they are
 * refreshed shortly before they end instead of every 50 minutes; an unreadable token keeps the old 50-minute rhythm.
 * 何时获取新的房间媒体令牌。令牌格式为 `base64url(负载).签名`，负载中带有 `exp`（服务器毫秒时间），页面可以读取但不能信任它。
 * 按天签发的令牌整天不变，因此在即将过期前才刷新，而不是每 50 分钟一次；无法读取的令牌沿用原来的 50 分钟节奏。
 */

/** For a token whose expiry cannot be read: the hour-long tokens of older servers, refreshed with ten minutes to spare. */
/** 无法读取过期时间的令牌：旧服务端一小时有效的令牌，提前十分钟刷新。 */
export const MEDIA_REFRESH_FALLBACK_MS = 50 * 60 * 1000;
/** A token is replaced this long before it expires, so lazy-loaded images never meet an expired link. */
/** 令牌在过期前这么久被替换，延迟加载的图片因此不会遇到过期的链接。 */
export const MEDIA_REFRESH_LEAD_MS = 10 * 60 * 1000;
/** Never sooner than this, so a token that is already expired or a far-off device clock cannot loop. */
/** 不早于这个间隔，已过期的令牌或严重偏差的设备时钟因此不会造成循环请求。 */
export const MEDIA_REFRESH_MIN_MS = 60 * 1000;
/** Never later than this, so a token that ends early on the server is still replaced in good time. */
/** 不晚于这个间隔，即使服务端提前结束令牌也能及时替换。 */
export const MEDIA_REFRESH_MAX_MS = 12 * 60 * 60 * 1000;

function base64UrlToText(value: string): string | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    return atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  } catch {
    return null;
  }
}

/** The token's exp in server milliseconds, or null when it cannot be read. */
/** 令牌的 exp（服务器毫秒时间）；无法读取时为 null。 */
export function mediaTokenExpiry(token: string | null | undefined): number | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const text = base64UrlToText(token.slice(0, dot));
  if (text === null) return null;
  try {
    const payload: unknown = JSON.parse(text);
    if (typeof payload !== 'object' || payload === null) return null;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Milliseconds until the token should be replaced. `skewMs` is server time minus device time, as the room's ready
 * frame reports it.
 * 距离应当替换令牌还有多少毫秒。`skewMs` 为服务器时间减去设备时间，取自房间 ready 帧。
 */
export function mediaRefreshDelay(token: string | null | undefined, now: number, skewMs = 0): number {
  const exp = mediaTokenExpiry(token);
  if (exp === null) return MEDIA_REFRESH_FALLBACK_MS;
  const delay = exp - skewMs - now - MEDIA_REFRESH_LEAD_MS;
  return Math.min(MEDIA_REFRESH_MAX_MS, Math.max(MEDIA_REFRESH_MIN_MS, delay));
}
