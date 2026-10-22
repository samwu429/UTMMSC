import { orderedPair, type Role } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface DirectRow {
  id: string;
  member_low: string;
  member_high: string;
  last_message_at: string | null;
  last_preview: string | null;
  created_at: string;
}

export async function findDirect(db: D1Database, id: string): Promise<DirectRow | null> {
  return db.prepare('SELECT * FROM direct_conversations WHERE id = ?').bind(id).first<DirectRow>();
}

/** Returns the single conversation for a pair, creating it on first contact. */
/** 返回一对成员唯一的会话，首次联系时创建。 */
export async function openDirect(db: D1Database, a: string, b: string): Promise<DirectRow> {
  const [low, high] = orderedPair(a, b);
  const existing = await db
    .prepare('SELECT * FROM direct_conversations WHERE member_low = ? AND member_high = ?')
    .bind(low, high)
    .first<DirectRow>();
  if (existing) return existing;
  // Two first messages at once must not both insert; the loser reads the winner's row.
  // 两人同时首次发起时不能都插入；后到者读取先到者的那一行。
  await db
    .prepare('INSERT INTO direct_conversations (id, member_low, member_high, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (member_low, member_high) DO NOTHING')
    .bind(randomId('dm'), low, high, nowIso())
    .run();
  const created = await db
    .prepare('SELECT * FROM direct_conversations WHERE member_low = ? AND member_high = ?')
    .bind(low, high)
    .first<DirectRow>();
  if (!created) throw new Error('direct conversation insert did not persist');
  return created;
}

export interface DirectWithPeer extends DirectRow {
  peer_id: string;
  peer_name: string;
  peer_enrollment: 'student' | 'alumni';
  peer_graduation_year: number;
  peer_role: Role;
  peer_avatar_key: string | null;
}

export async function listDirectForMember(db: D1Database, memberId: string): Promise<DirectWithPeer[]> {
  const result = await db
    .prepare(
      `SELECT dc.*, m.id AS peer_id, m.display_name AS peer_name, m.enrollment_status AS peer_enrollment, m.graduation_year AS peer_graduation_year, m.role AS peer_role,
              m.avatar_key AS peer_avatar_key
       FROM direct_conversations dc
       JOIN members m ON m.id = CASE WHEN dc.member_low = ? THEN dc.member_high ELSE dc.member_low END
       WHERE dc.member_low = ? OR dc.member_high = ?
       ORDER BY COALESCE(dc.last_message_at, dc.created_at) DESC
       LIMIT 200`,
    )
    .bind(memberId, memberId, memberId)
    .all<DirectWithPeer>();
  return result.results;
}

export async function touchDirect(db: D1Database, id: string, at: string, preview: string): Promise<void> {
  await db.prepare('UPDATE direct_conversations SET last_message_at = ?, last_preview = ? WHERE id = ?').bind(at, preview, id).run();
}
