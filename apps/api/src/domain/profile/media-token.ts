import { signPayload, verifyPayload } from '../crypto/hmac';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface ProfileMediaClaims {
  kind: 'profile-media';
  exp: number;
}

/** A token an image or video tag can carry in the query string. It is not a session. */
/** 图片和视频标签放在查询串里的令牌。它不是登录会话。 */
export async function issueProfileMediaToken(secret: string): Promise<string> {
  return signPayload(secret, { kind: 'profile-media', exp: Date.now() + TTL_MS } satisfies ProfileMediaClaims);
}

export async function readProfileMediaToken(secret: string, token: string): Promise<boolean> {
  const claims = await verifyPayload<ProfileMediaClaims>(secret, token);
  return Boolean(claims && claims.kind === 'profile-media' && claims.exp > Date.now());
}
