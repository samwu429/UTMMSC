import type { ChannelAudience, PostPolicy } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface ChannelRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: ChannelAudience;
  post_policy: PostPolicy;
  created_by: string | null;
  created_at: string;
  last_message_at: string | null;
}

export async function listChannels(db: D1Database): Promise<ChannelRow[]> {
  const result = await db.prepare('SELECT * FROM channels ORDER BY created_at ASC').all<ChannelRow>();
  return result.results;
}

export async function findChannel(db: D1Database, id: string): Promise<ChannelRow | null> {
  return db.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<ChannelRow>();
}

export async function isChannelMember(db: D1Database, channelId: string, memberId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS one FROM channel_memberships WHERE channel_id = ? AND member_id = ?')
    .bind(channelId, memberId)
    .first<{ one: number }>();
  return row !== null;
}

export async function listMembershipChannelIds(db: D1Database, memberId: string): Promise<Set<string>> {
  const result = await db.prepare('SELECT channel_id FROM channel_memberships WHERE member_id = ?').bind(memberId).all<{ channel_id: string }>();
  return new Set(result.results.map((r) => r.channel_id));
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'channel';
}

export interface CreateChannelInput {
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  createdBy: string;
  memberIds: string[];
}

export async function createChannel(db: D1Database, input: CreateChannelInput): Promise<ChannelRow> {
  const id = randomId('ch');
  const slug = `${slugify(input.name)}-${id.slice(-6).toLowerCase()}`;
  const ts = nowIso();
  const statements = [
    db
      .prepare(
        `INSERT INTO channels (id, slug, name, description, audience, post_policy, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, slug, input.name, input.description, input.audience, input.postPolicy, input.createdBy, ts),
  ];
  const uniqueMembers = new Set(input.memberIds);
  uniqueMembers.add(input.createdBy);
  for (const memberId of uniqueMembers) {
    statements.push(
      db.prepare('INSERT OR IGNORE INTO channel_memberships (channel_id, member_id, joined_at) VALUES (?, ?, ?)').bind(id, memberId, ts),
    );
  }
  await db.batch(statements);
  const row = await findChannel(db, id);
  if (!row) throw new Error('channel insert did not persist');
  return row;
}

export async function updateChannel(
  db: D1Database,
  id: string,
  patch: { name?: string; description?: string | null; audience?: ChannelAudience; postPolicy?: PostPolicy },
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.description !== undefined) {
    sets.push('description = ?');
    params.push(patch.description);
  }
  if (patch.audience !== undefined) {
    sets.push('audience = ?');
    params.push(patch.audience);
  }
  if (patch.postPolicy !== undefined) {
    sets.push('post_policy = ?');
    params.push(patch.postPolicy);
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
}

export async function listChannelMemberIds(db: D1Database, channelId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT member_id FROM channel_memberships WHERE channel_id = ? ORDER BY joined_at ASC')
    .bind(channelId)
    .all<{ member_id: string }>();
  return result.results.map((row) => row.member_id);
}

export async function addChannelMembers(db: D1Database, channelId: string, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) return;
  const ts = nowIso();
  await db.batch(
    memberIds.map((memberId) =>
      db.prepare('INSERT OR IGNORE INTO channel_memberships (channel_id, member_id, joined_at) VALUES (?, ?, ?)').bind(channelId, memberId, ts),
    ),
  );
}

export async function removeChannelMember(db: D1Database, channelId: string, memberId: string): Promise<void> {
  await db.prepare('DELETE FROM channel_memberships WHERE channel_id = ? AND member_id = ?').bind(channelId, memberId).run();
}

/** Replaces the explicit membership list used by custom-audience channels. */
/** 重写指定成员频道用的成员名单。 */
export async function replaceChannelMembers(db: D1Database, channelId: string, memberIds: string[]): Promise<void> {
  const unique = [...new Set(memberIds)];
  const ts = nowIso();
  const statements = [db.prepare('DELETE FROM channel_memberships WHERE channel_id = ?').bind(channelId)];
  for (const memberId of unique) {
    statements.push(
      db.prepare('INSERT INTO channel_memberships (channel_id, member_id, joined_at) VALUES (?, ?, ?)').bind(channelId, memberId, ts),
    );
  }
  await db.batch(statements);
}

/** Memberships cascade away with the channel row. Room history in the Durable Object is left behind. */
/** 成员记录随频道行一起删掉。Durable Object 里的房间历史会留下来，但列表里已经看不到。 */
export async function deleteChannel(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM channels WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function touchChannel(db: D1Database, channelId: string, at: string): Promise<void> {
  await db.prepare('UPDATE channels SET last_message_at = ? WHERE id = ?').bind(at, channelId).run();
}
