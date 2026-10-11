import { randomId } from '../../domain/crypto/encoding';
import { SESSION_TTL_MS } from '../../domain/identity/session-token';
import { nowIso } from './time';

export interface SessionRow {
  id: string;
  member_id: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

export async function createSession(db: D1Database, memberId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomId('ses');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .prepare('INSERT INTO sessions (id, member_id, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, NULL)')
    .bind(id, memberId, expiresAt.toISOString(), nowIso())
    .run();
  return { id, expiresAt };
}

export async function isSessionLive(db: D1Database, sessionId: string, memberId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT id FROM sessions WHERE id = ? AND member_id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(sessionId, memberId, nowIso())
    .first<{ id: string }>();
  return row !== null;
}

export async function revokeSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(), sessionId).run();
}

export async function revokeAllSessions(db: D1Database, memberId: string): Promise<void> {
  await db.prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL').bind(nowIso(), memberId).run();
}
