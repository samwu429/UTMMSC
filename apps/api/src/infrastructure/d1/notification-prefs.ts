import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type UpdateNotificationPrefsBody } from '@utmmsc/shared';
import { isMissingSchemaError } from './channels';
import { nowIso } from './time';

/**
 * Switch columns as a LEFT JOIN returns them; null means no row, so the default. pref_moments is undefined
 * where a query leaves it out: the device join in push-devices.ts does so on purpose, so a database without
 * migration 0016 can never silence chat pushes. Its prefs.moments is therefore always the default, and
 * moments pushes read the switch through listMomentsOptOut instead.
 * LEFT JOIN 返回的开关列；null 表示没有记录，取默认值。查询未选取 pref_moments 时它为 undefined：push-devices.ts
 * 的设备联表查询有意不选它，这样缺少迁移 0016 的数据库永远不会让聊天推送失效。因此那里的 prefs.moments 总是默认值，
 * 动态推送改用 listMomentsOptOut 读取这个开关。
 */
export interface PrefColumns {
  pref_messages: number | null;
  pref_events: number | null;
  pref_preview: number | null;
  pref_moments?: number | null;
}

function on(value: number | null | undefined, fallback: boolean): boolean {
  return value === null || value === undefined ? fallback : value !== 0;
}

export function prefsFromColumns(row: PrefColumns): NotificationPrefs {
  return {
    messages: on(row.pref_messages, DEFAULT_NOTIFICATION_PREFS.messages),
    events: on(row.pref_events, DEFAULT_NOTIFICATION_PREFS.events),
    preview: on(row.pref_preview, DEFAULT_NOTIFICATION_PREFS.preview),
    moments: on(row.pref_moments, DEFAULT_NOTIFICATION_PREFS.moments),
  };
}

type Switch = keyof NotificationPrefs;

/** Every switch column, and the ones that existed before migration 0016 added moments. */
/** 全部开关列，以及迁移 0016 加入 moments 之前已有的列。 */
const SWITCHES: readonly Switch[] = ['messages', 'events', 'preview', 'moments'];
const LEGACY_SWITCHES: readonly Switch[] = ['messages', 'events', 'preview'];

const IDS_PER_QUERY = 90;

function selectList(columns: readonly Switch[]): string {
  return columns.map((column) => `${column} AS pref_${column}`).join(', ');
}

async function selectPrefs(db: D1Database, memberId: string, columns: readonly Switch[]): Promise<NotificationPrefs> {
  const row = await db.prepare(`SELECT ${selectList(columns)} FROM notification_prefs WHERE member_id = ?`).bind(memberId).first<PrefColumns>();
  return row ? prefsFromColumns(row) : { ...DEFAULT_NOTIFICATION_PREFS };
}

/**
 * A member without a row, or a database before migration 0015, gets every switch on. Before migration 0016
 * the other switches are read as stored and moments is on.
 * 没有记录的成员，或迁移 0015 之前的数据库，所有开关都是开启的。迁移 0016 之前，其他开关按已存的值读取，moments 为开启。
 */
export async function findNotificationPrefs(db: D1Database, memberId: string): Promise<NotificationPrefs> {
  try {
    return await selectPrefs(db, memberId, SWITCHES);
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
  try {
    return await selectPrefs(db, memberId, LEGACY_SWITCHES);
  } catch (err) {
    if (isMissingSchemaError(err)) return { ...DEFAULT_NOTIFICATION_PREFS };
    throw err;
  }
}

function flag(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

async function upsertPrefs(db: D1Database, memberId: string, patch: UpdateNotificationPrefsBody, columns: readonly Switch[]): Promise<NotificationPrefs> {
  const values = columns.map((column) => flag(patch[column]));
  const row = await db
    .prepare(
      `INSERT INTO notification_prefs (member_id, ${columns.join(', ')}, updated_at)
       VALUES (?, ${columns.map(() => 'COALESCE(?, 1)').join(', ')}, ?)
       ON CONFLICT (member_id) DO UPDATE SET
         ${columns.map((column) => `${column} = COALESCE(?, ${column})`).join(', ')},
         updated_at = excluded.updated_at
       RETURNING ${selectList(columns)}`,
    )
    .bind(memberId, ...values, nowIso(), ...values)
    .first<PrefColumns>();
  if (!row) throw new Error('notification prefs upsert did not persist');
  return prefsFromColumns(row);
}

/**
 * Applies only the fields present in the patch. Before migration 0016 the other switches still save; a change
 * to moments then fails with the missing-schema error, before anything is written.
 * 只修改补丁中出现的字段。迁移 0016 之前，其他开关仍可保存；此时修改 moments 会以缺少表结构的错误失败，且不会写入任何内容。
 */
export async function updateNotificationPrefs(db: D1Database, memberId: string, patch: UpdateNotificationPrefsBody): Promise<NotificationPrefs> {
  try {
    return await upsertPrefs(db, memberId, patch, SWITCHES);
  } catch (err) {
    if (!isMissingSchemaError(err) || patch.moments !== undefined) throw err;
  }
  return upsertPrefs(db, memberId, patch, LEGACY_SWITCHES);
}

/**
 * Those of these members who turned 好友动态互动 off. A query of its own, apart from the device join, so a
 * database before migration 0016 reads as everyone on and chat pushes never depend on the column.
 * 这些成员中关闭了「好友动态互动」的人。这是独立于设备联表的单独查询，因此迁移 0016 之前的数据库按全部开启处理，聊天推送也从不依赖这一列。
 */
export async function listMomentsOptOut(db: D1Database, memberIds: readonly string[]): Promise<Set<string>> {
  const off = new Set<string>();
  const unique = [...new Set(memberIds)];
  try {
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const slice = unique.slice(i, i + IDS_PER_QUERY);
      const result = await db
        .prepare(`SELECT member_id FROM notification_prefs WHERE moments = 0 AND member_id IN (${slice.map(() => '?').join(', ')})`)
        .bind(...slice)
        .all<{ member_id: string }>();
      for (const row of result.results) off.add(row.member_id);
    }
  } catch (err) {
    if (isMissingSchemaError(err)) return new Set();
    throw err;
  }
  return off;
}
