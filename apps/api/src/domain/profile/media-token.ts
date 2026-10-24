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
 * built from it stay the same all day and the browser cache (private, max-age=86400) actually hits. A token
 * still lives at least seven days.
 * 在 `now` 签发的令牌何时过期：下一个 UTC 零点再加七天。同一个 UTC 日内签发的令牌声明完全相同，而 signPayload 是确定的，
 * 因此令牌字符串以及用它拼出的媒体网址整天不变，浏览器缓存（private, max-age=86400）才能真正命中。令牌仍至少有效七天。
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
