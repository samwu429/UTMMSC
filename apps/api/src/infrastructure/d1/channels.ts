import { DEFAULT_HISTORY_VISIBILITY, type ChannelAudience, type HistoryVisibility, type PostPolicy } from '@utmmsc/shared';
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
  /** Undefined until migration 0013 runs; callers then apply no history floor. */
  /** 迁移 0013 执行之前为 undefined；此时调用方不设历史下限。 */
  history_visibility?: HistoryVisibility;
  history_floor_since?: string | null;
  /**
   * An uploaded icon under channel-icon/ or preset:<id>; null shows the text tile. Undefined until migration 0018
   * runs, so readers fall back to the text tile and the icon routes answer 503.
   * channel-icon/ 下上传的图标或 preset:<id>；为 null 时显示文字头像。迁移 0018 执行之前为 undefined，
   * 此时读取方退回文字头像，图标接口返回 503。
   */
  icon_key?: string | null;
  /** When the icon last changed, in toISOString form. */
  /** 图标最后修改的时间，格式与 toISOString 一致。 */
  icon_updated_at?: string | null;
}

/**
 * True for errors raised because a newer migration has not been applied yet. Reads that hit one
 * fall back to the behaviour from before that migration.
 * 因较新的迁移尚未执行而产生的错误返回 true。遇到这类错误的读取会退回到该迁移之前的行为。
 */
export function isMissingSchemaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such (table|column)|has no column named/i.test(message);
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

/**
 * Runs the first batch the database accepts. Each later attempt leaves out columns a newer migration
 * adds, so the Worker keeps working whether it is deployed before or after that migration.
 * 执行数据库接受的第一组语句。后面的每一组都省略较新迁移才添加的列，因此无论 Worker 在该迁移之前还是之后部署都能正常工作。
 */
async function batchWithFallback(db: D1Database, attempts: readonly (() => D1PreparedStatement[])[]): Promise<D1Result[]> {
  let lastError: unknown = null;
  for (const build of attempts) {
    const statements = build();
    if (statements.length === 0) return [];
    try {
      return await db.batch(statements);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * One membership row. Tracked rows are written by code that keeps join times across saves; rows
 * without the mark predate that and count as joined before the history policy started.
 * 一条成员记录。带标记的行由保存时会保留加入时间的代码写入；没有标记的行早于此，视为在历史策略开始之前加入。
 */
function insertMembership(db: D1Database, channelId: string, memberId: string, joinedAt: string, tracked: boolean): D1PreparedStatement {
  if (!tracked) {
    return db.prepare('INSERT OR IGNORE INTO channel_memberships (channel_id, member_id, joined_at) VALUES (?, ?, ?)').bind(channelId, memberId, joinedAt);
  }
  return db
    .prepare('INSERT OR IGNORE INTO channel_memberships (channel_id, member_id, joined_at, join_tracked) VALUES (?, ?, ?, 1)')
    .bind(channelId, memberId, joinedAt);
}

/**
 * Custom-channel memberships of one member, with the time each started. The time is null for rows
 * written before join times were kept, which the history policy treats as joined before it started.
 * 某成员所在的指定成员频道，以及各自的加入时间。在开始保留加入时间之前写入的行，时间为 null，历史策略将其视为在策略开始之前加入。
 */
export async function listMembershipJoins(db: D1Database, memberId: string): Promise<Map<string, string | null>> {
  try {
    const result = await db
      .prepare('SELECT channel_id, CASE WHEN join_tracked = 1 THEN joined_at ELSE NULL END AS joined_at FROM channel_memberships WHERE member_id = ?')
      .bind(memberId)
      .all<{ channel_id: string; joined_at: string | null }>();
    return new Map(result.results.map((r) => [r.channel_id, r.joined_at]));
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
    const result = await db
      .prepare('SELECT channel_id, joined_at FROM channel_memberships WHERE member_id = ?')
      .bind(memberId)
      .all<{ channel_id: string; joined_at: string }>();
    return new Map(result.results.map((r) => [r.channel_id, r.joined_at]));
  }
}

export async function listMembershipChannelIds(db: D1Database, memberId: string): Promise<Set<string>> {
  return new Set((await listMembershipJoins(db, memberId)).keys());
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'channel';
}

export interface CreateChannelInput {
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  historyVisibility?: HistoryVisibility;
  createdBy: string;
  memberIds: string[];
}

/** A new channel starts its history policy at creation, so nobody is grandfathered into it. */
/** 新频道的历史策略从创建时开始，不存在被保留完整历史的旧成员。 */
export async function createChannel(db: D1Database, input: CreateChannelInput): Promise<ChannelRow> {
  const id = randomId('ch');
  const slug = `${slugify(input.name)}-${id.slice(-6).toLowerCase()}`;
  const ts = nowIso();
  const uniqueMembers = new Set(input.memberIds);
  uniqueMembers.add(input.createdBy);
  const memberships = (tracked: boolean) => [...uniqueMembers].map((memberId) => insertMembership(db, id, memberId, ts, tracked));
  const withPolicy = () =>
    db
      .prepare(
        `INSERT INTO channels (id, slug, name, description, audience, post_policy, created_by, created_at, history_visibility, history_floor_since)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, slug, input.name, input.description, input.audience, input.postPolicy, input.createdBy, ts, input.historyVisibility ?? DEFAULT_HISTORY_VISIBILITY, ts);
  // Before migration 0013 the policy columns do not exist; a failed batch rolls back, so the next attempt starts clean.
  // 迁移 0013 之前没有策略列；失败的一组语句会整体回滚，下一次尝试从干净的状态开始。
  const legacy = () =>
    db
      .prepare(
        `INSERT INTO channels (id, slug, name, description, audience, post_policy, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, slug, input.name, input.description, input.audience, input.postPolicy, input.createdBy, ts);
  await batchWithFallback(db, [
    () => [withPolicy(), ...memberships(true)],
    () => [withPolicy(), ...memberships(false)],
    () => [legacy(), ...memberships(false)],
  ]);
  const row = await findChannel(db, id);
  if (!row) throw new Error('channel insert did not persist');
  return row;
}

export interface ChannelPatch {
  name?: string;
  description?: string | null;
  audience?: ChannelAudience;
  postPolicy?: PostPolicy;
  historyVisibility?: HistoryVisibility;
}

export async function updateChannel(db: D1Database, id: string, patch: ChannelPatch): Promise<void> {
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
  if (patch.historyVisibility !== undefined) {
    // Switching back to since_join restarts the policy now, so everyone currently in the channel keeps
    // the history they can already see. SET expressions read the row as it was before this update,
    // so saving since_join again leaves the instant alone.
    // 切回 since_join 时策略从现在重新开始，频道里现有的人保留已能看到的历史。SET 表达式读取的是本次更新之前的行，因此再次保存 since_join 不会改动该时刻。
    sets.push('history_visibility = ?');
    params.push(patch.historyVisibility);
    if (patch.historyVisibility === 'since_join') {
      sets.push("history_floor_since = CASE WHEN history_visibility = 'since_join' AND history_floor_since IS NOT NULL THEN history_floor_since ELSE ? END");
      params.push(nowIso());
    }
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
}

/**
 * Compare-and-swap of the channel icon: writes `next` only while the stored key is still `expected`, so two admins
 * changing the icon at once never lose track of which uploaded objects are still in use. Returns false when the
 * key moved on or the channel is gone; the caller reads the row again. Throws a missing-schema error before
 * migration 0018.
 * 频道图标的比较并交换：只有当已存的键仍为 `expected` 时才写入 `next`，两位管理员同时修改图标时也不会弄错哪些上传对象仍在使用。
 * 键已被改动或频道已不存在时返回 false，由调用方重新读取。迁移 0018 之前抛出缺少表结构的错误。
 */
export async function setChannelIcon(db: D1Database, id: string, expected: string | null, next: string | null, at: string = nowIso()): Promise<boolean> {
  const result = await db
    .prepare('UPDATE channels SET icon_key = ?, icon_updated_at = ? WHERE id = ? AND icon_key IS ?')
    .bind(next, at, id, expected)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listChannelMemberIds(db: D1Database, channelId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT member_id FROM channel_memberships WHERE channel_id = ? ORDER BY joined_at ASC')
    .bind(channelId)
    .all<{ member_id: string }>();
  return result.results.map((row) => row.member_id);
}

/** Adds members and returns only the ids that were not already in the channel. */
/** 添加成员，只返回此前不在频道里的 id。 */
export async function addChannelMembers(db: D1Database, channelId: string, memberIds: string[]): Promise<string[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];
  const ts = nowIso();
  const inserts = (tracked: boolean) => () => unique.map((memberId) => insertMembership(db, channelId, memberId, ts, tracked));
  const results = await batchWithFallback(db, [inserts(true), inserts(false)]);
  return unique.filter((_, i) => (results[i]?.meta.changes ?? 0) > 0);
}

export async function removeChannelMember(db: D1Database, channelId: string, memberId: string): Promise<void> {
  await db.prepare('DELETE FROM channel_memberships WHERE channel_id = ? AND member_id = ?').bind(channelId, memberId).run();
}

export interface MembershipPlan {
  add: string[];
  remove: string[];
}

/** Difference between the stored member list and the requested one; duplicates count once. */
/** 已存成员名单与请求名单之间的差异；重复的 id 只算一次。 */
export function planMembershipReplace(existingIds: readonly string[], nextIds: readonly string[]): MembershipPlan {
  const existing = new Set(existingIds);
  const next = new Set(nextIds);
  return {
    add: [...next].filter((id) => !existing.has(id)),
    remove: [...existing].filter((id) => !next.has(id)),
  };
}

/**
 * Replaces the explicit membership list used by custom-audience channels. Members who stay keep
 * their original join time; only removed and added rows are written. readerSince gives the time a
 * member already started reading the channel under its previous audience: an added member joins at
 * that time instead of now, and a member who stays with a later recorded time is moved back to it.
 * 重写指定成员频道用的成员名单。保留下来的成员维持原加入时间；只写入被移除和新加入的行。readerSince 给出成员在之前的受众下
 * 已开始阅读该频道的时间：新加入的成员以该时间加入而不是当前时间；保留的成员若记录的时间更晚，则改回该时间。
 */
export async function replaceChannelMembers(
  db: D1Database,
  channelId: string,
  memberIds: string[],
  options: { readerSince?: ReadonlyMap<string, string> } = {},
): Promise<{ added: string[]; removed: string[] }> {
  const existing = await listChannelMemberIds(db, channelId);
  const plan = planMembershipReplace(existing, memberIds);
  const before = new Set(existing);
  const after = new Set(memberIds);
  const earlier = [...(options.readerSince ?? new Map<string, string>())].filter(([memberId]) => before.has(memberId) && after.has(memberId));
  const ts = nowIso();
  const statements = (tracked: boolean) => () => [
    ...plan.remove.map((memberId) => db.prepare('DELETE FROM channel_memberships WHERE channel_id = ? AND member_id = ?').bind(channelId, memberId)),
    ...plan.add.map((memberId) => insertMembership(db, channelId, memberId, options.readerSince?.get(memberId) ?? ts, tracked)),
    // Untracked rows already count as joined before the policy, so only tracked times move back.
    // 无标记的行已视为在策略开始之前加入，因此只有带标记的时间需要改回。
    ...earlier.map(([memberId, at]) =>
      db
        .prepare(`UPDATE channel_memberships SET joined_at = ? WHERE channel_id = ? AND member_id = ? AND joined_at > ?${tracked ? ' AND join_tracked = 1' : ''}`)
        .bind(at, channelId, memberId, at),
    ),
  ];
  await batchWithFallback(db, [statements(true), statements(false)]);
  return { added: plan.add, removed: plan.remove };
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
