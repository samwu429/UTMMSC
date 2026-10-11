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

export async function updateChannel(db: D1Database, id: string, patch: { name?: string; description?: string | null; postPolicy?: PostPolicy }): Promise<void> {
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
  if (patch.postPolicy !== undefined) {
    sets.push('post_policy = ?');
    params.push(patch.postPolicy);
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
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

export async function touchChannel(db: D1Database, channelId: string, at: string): Promise<void> {
  await db.prepare('UPDATE channels SET last_message_at = ? WHERE id = ?').bind(at, channelId).run();
}
