import { base64UrlToBytes, bytesToBase64Url, randomBytes, timingSafeEqual, utf8ToBytes } from '../crypto/encoding';

const ALGORITHM = 'pbkdf2-sha256';
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Produces `pbkdf2-sha256$iterations$salt$hash`; parameters travel with the hash for future upgrades. */
/** 生成 `pbkdf2-sha256$iterations$salt$hash`；参数随哈希保存，便于日后升级。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, ITERATIONS);
  return [ALGORITHM, String(ITERATIONS), bytesToBase64Url(salt), bytesToBase64Url(hash)].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, hashText] = stored.split('$');
  if (algorithm !== ALGORITHM || !iterationsText || !saltText || !hashText) return false;
  const iterations = Number(iterationsText);
  const salt = base64UrlToBytes(saltText);
  const expected = base64UrlToBytes(hashText);
  if (!Number.isInteger(iterations) || iterations <= 0 || !salt || !expected) return false;
  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}
