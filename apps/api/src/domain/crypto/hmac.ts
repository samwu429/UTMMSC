import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, timingSafeEqual, utf8ToBytes } from './encoding';

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/**
 * Signs a JSON payload as `base64url(payload).base64url(signature)`. Used for session tokens and
 * room tickets so the Worker can reject forgeries without touching storage.
 * 把 JSON 负载签名为 `base64url(payload).base64url(signature)`。用于会话令牌与房间票据，Worker 可在不访问存储的情况下拒绝伪造。
 */
export async function signPayload(secret: string, payload: unknown): Promise<string> {
  const key = await importKey(secret);
  const body = bytesToBase64Url(utf8ToBytes(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', key, utf8ToBytes(body));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyPayload<T>(secret: string, token: string): Promise<T | null> {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const providedSig = base64UrlToBytes(token.slice(dot + 1));
  if (!providedSig) return null;
  const key = await importKey(secret);
  const expectedSig = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8ToBytes(body)));
  if (!timingSafeEqual(providedSig, expectedSig)) return null;
  const bodyBytes = base64UrlToBytes(body);
  if (!bodyBytes) return null;
  try {
    return JSON.parse(bytesToUtf8(bodyBytes)) as T;
  } catch {
    return null;
  }
}
