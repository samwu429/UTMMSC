import { randomId } from '../../domain/crypto/encoding';
import { CODE_HOURLY_LIMIT, CODE_MAX_ATTEMPTS, CODE_RESEND_INTERVAL_MS, CODE_TTL_MS } from '../../domain/identity/verification-code';
import { isoAfter, nowIso } from './time';

export type VerificationPurpose = 'register' | 'reset';

export interface VerificationRow {
  id: string;
  email: string;
  code_hash: string;
  purpose: VerificationPurpose;
  expires_at: string;
  attempts: number;
  consumed_at: string | null;
  created_at: string;
}

export type SendGate = 'ok' | 'too_soon' | 'hourly_limit';

/** Applies resend spacing and the hourly cap before a new code is generated. */
/** 生成新验证码前检查重发间隔与每小时上限。 */
export async function checkSendGate(db: D1Database, email: string, purpose: VerificationPurpose): Promise<SendGate> {
  const now = Date.now();
  const recent = await db
    .prepare('SELECT created_at FROM email_verifications WHERE email = ? AND purpose = ? AND created_at > ? ORDER BY created_at DESC')
    .bind(email, purpose, new Date(now - 60 * 60 * 1000).toISOString())
    .all<{ created_at: string }>();
  const rows = recent.results;
  if (rows.length >= CODE_HOURLY_LIMIT) return 'hourly_limit';
  const latest = rows[0];
  if (latest && now - new Date(latest.created_at).getTime() < CODE_RESEND_INTERVAL_MS) return 'too_soon';
  return 'ok';
}

export async function storeVerification(db: D1Database, email: string, purpose: VerificationPurpose, codeHash: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO email_verifications (id, email, code_hash, purpose, expires_at, attempts, consumed_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL, ?)`,
    )
    .bind(randomId('ver'), email, codeHash, purpose, isoAfter(CODE_TTL_MS), nowIso())
    .run();
}

export async function latestVerification(db: D1Database, email: string, purpose: VerificationPurpose): Promise<VerificationRow | null> {
  return db
    .prepare('SELECT * FROM email_verifications WHERE email = ? AND purpose = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .bind(email, purpose)
    .first<VerificationRow>();
}

/**
 * Takes one attempt in a single statement so parallel guesses cannot all read the same count.
 * Returns false when the code has no attempts left or was already used.
 * 用一条语句占用一次尝试，并发猜测无法读到同一个计数。没有剩余次数或已被使用时返回 false。
 */
export async function recordAttempt(db: D1Database, id: string): Promise<boolean> {
  const row = await db
    .prepare('UPDATE email_verifications SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND consumed_at IS NULL RETURNING attempts')
    .bind(id, CODE_MAX_ATTEMPTS)
    .first<{ attempts: number }>();
  return row !== null;
}

/** Returns false if another request consumed the code first. */
/** 若验证码已被另一请求先用掉则返回 false。 */
export async function consumeVerification(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('UPDATE email_verifications SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso(), id).run();
  return (result.meta.changes ?? 0) === 1;
}
