import type { ChannelAudience, Role } from '@utmmsc/shared';
import { audienceRoleFilter } from '../../domain/authorization/channel-access';

/**
 * Who is in a room, for member counts and the member picker. Audience channels count active members
 * who match the audience, custom channels count their membership rows, and a direct conversation has
 * its two participants. Channel managers who can read every channel are not counted unless they match.
 * 房间里有谁，用于人数和成员选择。受众频道统计符合受众的在用成员，指定成员频道统计成员记录，私聊为两位参与者。
 * 能读取所有频道的频道管理者，只有符合受众时才计入。
 */

export type RoomRef =
  | { kind: 'channel'; channelId: string; audience: ChannelAudience }
  | { kind: 'direct'; memberIds: readonly [string, string] };

export interface RoomMemberRow {
  id: string;
  display_name: string;
  avatar_key: string | null;
  role: Role;
}

export const ROOM_MEMBERS_PAGE_MAX = 50;

interface Scope {
  from: string;
  clauses: string[];
  params: unknown[];
}

function scopeOf(room: RoomRef): Scope {
  if (room.kind === 'direct') {
    return { from: 'members m', clauses: ["m.status = 'active'", 'm.id IN (?, ?)'], params: [room.memberIds[0], room.memberIds[1]] };
  }
  const filter = audienceRoleFilter(room.audience);
  switch (filter.kind) {
    case 'all':
      return { from: 'members m', clauses: ["m.status = 'active'"], params: [] };
    case 'enrollment':
      return { from: 'members m', clauses: ["m.status = 'active'", 'm.enrollment_status = ?'], params: [filter.status] };
    case 'roles':
      return {
        from: 'members m',
        clauses: ["m.status = 'active'", `m.role IN (${filter.roles.map(() => '?').join(', ')})`],
        params: [...filter.roles],
      };
    case 'custom':
      return {
        from: 'channel_memberships cm JOIN members m ON m.id = cm.member_id',
        clauses: ["m.status = 'active'", 'cm.channel_id = ?'],
        params: [room.channelId],
      };
  }
}

/** LIKE pattern that matches the query literally; % and _ typed by the user are not wildcards. */
/** 按字面匹配查询词的 LIKE 模式；用户输入的 % 和 _ 不作为通配符。 */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

function withQuery(scope: Scope, q: string | null): Scope {
  if (!q) return scope;
  return { ...scope, clauses: [...scope.clauses, "m.display_name LIKE ? ESCAPE '\\'"], params: [...scope.params, likePattern(q)] };
}

export async function countRoomMembers(db: D1Database, room: RoomRef, q: string | null = null): Promise<number> {
  const scope = withQuery(scopeOf(room), q);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM ${scope.from} WHERE ${scope.clauses.join(' AND ')}`)
    .bind(...scope.params)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface RoomMembersPage {
  members: RoomMemberRow[];
  /** Keyset position after the last row, or null on the last page. */
  /** 最后一行之后的键集位置；最后一页为 null。 */
  next: { name: string; id: string } | null;
}

/** Keyset pagination on (display_name case-insensitive, id) keeps pages stable while members join. */
/** 以（不区分大小写的 display_name, id）做键集分页，成员加入时页面保持稳定。 */
export async function listRoomMembers(
  db: D1Database,
  room: RoomRef,
  options: { q: string | null; after: { name: string; id: string } | null; limit: number },
): Promise<RoomMembersPage> {
  const limit = Math.min(Math.max(Math.trunc(options.limit) || 1, 1), ROOM_MEMBERS_PAGE_MAX);
  const scope = withQuery(scopeOf(room), options.q);
  const clauses = [...scope.clauses];
  const params = [...scope.params];
  if (options.after) {
    clauses.push('(m.display_name COLLATE NOCASE > ? OR (m.display_name COLLATE NOCASE = ? AND m.id > ?))');
    params.push(options.after.name, options.after.name, options.after.id);
  }
  params.push(limit + 1);
  const result = await db
    .prepare(
      `SELECT m.id, m.display_name, m.avatar_key, m.role FROM ${scope.from}
       WHERE ${clauses.join(' AND ')}
       ORDER BY m.display_name COLLATE NOCASE, m.id
       LIMIT ?`,
    )
    .bind(...params)
    .all<RoomMemberRow>();
  const rows = result.results;
  const members = rows.slice(0, limit);
  const last = members[members.length - 1];
  return { members, next: rows.length > limit && last ? { name: last.display_name, id: last.id } : null };
}
