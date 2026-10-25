import type { MemberRow } from './members';
import { nowIso } from './time';

/** What the session check found: no live session, or a live session and its member row (null when the row is gone). */
/** 会话检查的结果：没有有效会话；或有效会话及其成员记录（记录已不存在时为 null）。 */
export type LiveSessionMember = { member: MemberRow | null } | null;

/**
 * The live session and its member in one query, instead of a session lookup followed by a member lookup: every
 * signed-in request saves one database round trip. Both sides are found by primary key. The LEFT JOIN keeps a
 * live session whose member row is missing apart from a session that is not live, so each gets its own error.
 * 一次查询同时取得有效会话及其成员，而不是先查会话再查成员：每个已登录请求因此少一次数据库往返。两边都按主键查找。
 * LEFT JOIN 让「会话有效但成员记录不存在」与「会话无效」区分开，各自返回不同的错误。
 */
export async function findLiveSessionMember(db: D1Database, sessionId: string, memberId: string, now: string = nowIso()): Promise<LiveSessionMember> {
  const row = await db
    .prepare(
      `SELECT m.* FROM sessions s LEFT JOIN members m ON m.id = s.member_id
       WHERE s.id = ? AND s.member_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(sessionId, memberId, now)
    .first<MemberRow | Record<keyof MemberRow, null>>();
  if (!row) return null;
  return { member: row.id === null ? null : (row as MemberRow) };
}
