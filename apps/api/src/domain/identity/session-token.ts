import { signPayload, verifyPayload } from '../crypto/hmac';

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionClaims {
  kind: 'session';
  sid: string;
  mid: string;
  exp: number;
}

export async function issueSessionToken(secret: string, sessionId: string, memberId: string, expiresAt: Date): Promise<string> {
  const claims: SessionClaims = { kind: 'session', sid: sessionId, mid: memberId, exp: expiresAt.getTime() };
  return signPayload(secret, claims);
}

/** Verifies signature and expiry only; the caller still confirms the session row has not been revoked. */
/** 只校验签名与过期；调用方仍需确认会话记录未被撤销。 */
export async function readSessionToken(secret: string, token: string, now: Date = new Date()): Promise<SessionClaims | null> {
  const claims = await verifyPayload<SessionClaims>(secret, token);
  if (!claims || claims.kind !== 'session') return null;
  if (typeof claims.sid !== 'string' || typeof claims.mid !== 'string' || typeof claims.exp !== 'number') return null;
  if (claims.exp <= now.getTime()) return null;
  return claims;
}
