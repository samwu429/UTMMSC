import { sha256Hex } from '../crypto/encoding';

export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODE_RESEND_INTERVAL_MS = 60 * 1000;
export const CODE_HOURLY_LIMIT = 5;

/** Six decimal digits drawn from a CSPRNG; leading zeros are kept so every code has equal length. */
/** 由安全随机源生成的六位十进制数字；保留前导零使所有验证码等长。 */
export function generateCode(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  const value = (buffer[0] ?? 0) % 10 ** CODE_LENGTH;
  return String(value).padStart(CODE_LENGTH, '0');
}

export function isCodeShape(code: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);
}

/** Codes are stored hashed with the email so a leaked table cannot be replayed against another address. */
/** 验证码与邮箱一起哈希后存储，表泄露也无法对其他地址重放。 */
export function hashCode(email: string, code: string): Promise<string> {
  return sha256Hex(`${email}\n${code}`);
}

export interface VerificationState {
  expiresAt: string;
  attempts: number;
  consumedAt: string | null;
}

export type VerificationOutcome = 'ok' | 'expired' | 'consumed' | 'too_many_attempts';

export function evaluateVerification(state: VerificationState, now: Date = new Date()): VerificationOutcome {
  if (state.consumedAt) return 'consumed';
  if (new Date(state.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (state.attempts >= CODE_MAX_ATTEMPTS) return 'too_many_attempts';
  return 'ok';
}
