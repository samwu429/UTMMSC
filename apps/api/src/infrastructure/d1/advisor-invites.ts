import { bytesToBase64Url, randomBytes, randomId, sha256Hex } from '../../domain/crypto/encoding';
import { nowIso } from './time';

const INVITE_MS = 14 * 24 * 60 * 60 * 1000;

export interface AdvisorInviteRow {
  id: string;
  email: string;
  token_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_by: string;
  created_at: string;
}

export async function hashInviteToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Latest unused invite for this inbox, if it has not expired. */
/** 这个邮箱最新的未使用邀请，且尚未过期。 */
export async function findLiveInviteByEmail(db: D1Database, email: string, now: string = nowIso()): Promise<AdvisorInviteRow | null> {
  return db
    .prepare(
      `SELECT * FROM advisor_invites
       WHERE email = ? AND consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(email, now)
    .first<AdvisorInviteRow>();
}

export async function findLiveInviteByToken(db: D1Database, token: string, now: string = nowIso()): Promise<AdvisorInviteRow | null> {
  const row = await db.prepare('SELECT * FROM advisor_invites WHERE token_hash = ?').bind(await hashInviteToken(token)).first<AdvisorInviteRow>();
  if (!row || row.consumed_at || row.expires_at <= now) return null;
  return row;
}

export async function listOpenInvites(db: D1Database, now: string = nowIso()): Promise<AdvisorInviteRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM advisor_invites
       WHERE consumed_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .bind(now)
    .all<AdvisorInviteRow>();
  return result.results;
}

/** Replaces any open invite for the same email. Returns the raw token once; only its hash is stored. */
/** 替换同一邮箱尚未使用的邀请。原始令牌只返回这一次，库存的是哈希。 */
export async function issueAdvisorInvite(db: D1Database, email: string, createdBy: string): Promise<{ id: string; token: string; expiresAt: string }> {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + INVITE_MS).toISOString();
  const token = bytesToBase64Url(randomBytes(32));
  const id = randomId('inv');
  await db.prepare('UPDATE advisor_invites SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').bind(now, email).run();
  await db
    .prepare(
      `INSERT INTO advisor_invites (id, email, token_hash, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, email, await hashInviteToken(token), expiresAt, createdBy, now)
    .run();
  return { id, token, expiresAt };
}

export async function consumeAdvisorInvite(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE advisor_invites SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso(), id).run();
}
