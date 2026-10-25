import { signPayload, verifyPayload } from '../crypto/hmac';

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_MS = 7 * DAY_MS;

interface ProfileMediaClaims {
  kind: 'profile-media';
  exp: number;
}

/**
 * When a token issued at `now` expires: the next UTC midnight plus seven days. Every token issued on one UTC
 * day carries the same claims, and signPayload is deterministic, so the token string and every media URL
 * built from it stay the same all day and the browser cache (immutable for a year, r2/objects.ts) actually
 * hits. A token still lives at least seven days.
 * 在 `now` 签发的令牌何时过期：下一个 UTC 零点再加七天。同一个 UTC 日内签发的令牌声明完全相同，而 signPayload 是确定的，
 * 因此令牌字符串以及用它拼出的媒体网址整天不变，浏览器缓存（不可变、保留一年，见 r2/objects.ts）才能真正命中。令牌仍至少有效七天。
 */
export function profileMediaTokenExpiry(now: number): number {
  return (Math.floor(now / DAY_MS) + 1) * DAY_MS + TTL_MS;
}

/** A token an image or video tag can carry in the query string. It is not a session. */
/** 图片和视频标签放在查询串里的令牌。它不是登录会话。 */
export async function issueProfileMediaToken(secret: string, now: number = Date.now()): Promise<string> {
  return signPayload(secret, { kind: 'profile-media', exp: profileMediaTokenExpiry(now) } satisfies ProfileMediaClaims);
}

export async function readProfileMediaToken(secret: string, token: string, now: number = Date.now()): Promise<boolean> {
  const claims = await verifyPayload<ProfileMediaClaims>(secret, token);
  return Boolean(claims && claims.kind === 'profile-media' && claims.exp > now);
}

/**
 * Chat images are scoped to one room, so their token is short-lived next to the profile one: it expires at the
 * second UTC midnight after it is issued, and so lives between one and two days. Every ticket of one UTC day
 * carries the same token, which keeps each image URL the same all day and lets the browser cache hit across app
 * restarts. A client that refreshes its token more often than once a day never holds an expired one. A member who
 * loses access to the room keeps reaching images they already knew for at most two days, against the seven of
 * profile media.
 * 聊天图片只属于一个房间，因此它的令牌比个人资料的令牌短：在签发后的第二个 UTC 零点过期，有效期在一天到两天之间。
 * 同一个 UTC 日内的所有票据携带相同的令牌，每张图片的网址整天不变，浏览器缓存在 App 重启后也能命中。客户端只要每天刷新令牌不止一次，
 * 就永远不会拿着过期的令牌。失去房间权限的成员最多还能在两天内访问其已知道的图片，而个人资料媒体是七天。
 */
export function chatMediaTokenExpiry(now: number): number {
  return (Math.floor(now / DAY_MS) + 2) * DAY_MS;
}

interface ChatMediaClaims {
  kind: 'media';
  roomId: string;
  exp: number;
}

/** A token that lets image tags load one room's chat images. */
/** 让图片标签加载某个房间聊天图片的令牌。 */
export async function issueChatMediaToken(secret: string, roomId: string, now: number = Date.now()): Promise<string> {
  return signPayload(secret, { kind: 'media', roomId, exp: chatMediaTokenExpiry(now) } satisfies ChatMediaClaims);
}

/** The room a chat media token opens, or null when it is forged, expired or of another kind. */
/** 聊天媒体令牌所开放的房间；令牌被伪造、已过期或类型不符时为 null。 */
export async function readChatMediaToken(secret: string, token: string, now: number = Date.now()): Promise<string | null> {
  const claims = await verifyPayload<ChatMediaClaims>(secret, token);
  if (!claims || claims.kind !== 'media' || typeof claims.roomId !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now) return null;
  return claims.roomId;
}
