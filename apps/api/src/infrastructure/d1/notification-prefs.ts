import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type UpdateNotificationPrefsBody } from '@utmmsc/shared';
import { isMissingSchemaError } from './channels';
import { nowIso } from './time';

/**
 * Switch columns as a LEFT JOIN returns them; null means no row, so the default. pref_moments and pref_timetable
 * are undefined where a query leaves them out: the device join in push-devices.ts does so on purpose, so a
 * database without migration 0016 or 0017 can never silence chat pushes. Its prefs.moments and prefs.timetable
 * are therefore always the default, and moments and timetable pushes read their switches through
 * listMomentsOptOut and listTimetableOptOut instead.
 * LEFT JOIN 返回的开关列；null 表示没有记录，取默认值。查询未选取 pref_moments 和 pref_timetable 时它们为 undefined：
 * push-devices.ts 的设备联表查询有意不选它们，这样缺少迁移 0016 或 0017 的数据库永远不会让聊天推送失效。因此那里的
 * prefs.moments 和 prefs.timetable 总是默认值，动态推送和课表推送改用 listMomentsOptOut 和 listTimetableOptOut 读取这两个开关。
 */
export interface PrefColumns {
  pref_messages: number | null;
  pref_events: number | null;
  pref_preview: number | null;
  pref_moments?: number | null;
  pref_timetable?: number | null;
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
    timetable: on(row.pref_timetable, DEFAULT_NOTIFICATION_PREFS.timetable),
  };
}

type Switch = keyof NotificationPrefs;

/**
 * The switch columns in three tiers, newest first: after migration 0017 added timetable, after 0016 added
 * moments, and before both.
 * 三个阶段的开关列，从新到旧：迁移 0017 加入 timetable 之后、迁移 0016 加入 moments 之后，以及两者之前。
 */
const TIERS: readonly (readonly Switch[])[] = [
  ['messages', 'events', 'preview', 'moments', 'timetable'],
  ['messages', 'events', 'preview', 'moments'],
  ['messages', 'events', 'preview'],
];

const IDS_PER_QUERY = 90;

function selectList(columns: readonly Switch[]): string {
  return columns.map((column) => `${column} AS pref_${column}`).join(', ');
}

async function selectPrefs(db: D1Database, memberId: string, columns: readonly Switch[]): Promise<NotificationPrefs> {
  const row = await db.prepare(`SELECT ${selectList(columns)} FROM notification_prefs WHERE member_id = ?`).bind(memberId).first<PrefColumns>();
  return row ? prefsFromColumns(row) : { ...DEFAULT_NOTIFICATION_PREFS };
}

/**
 * A member without a row, or a database before migration 0015, gets every switch on. Before migration 0017
 * timetable is on, and before 0016 moments is on too; the other switches are read as stored.
 * 没有记录的成员，或迁移 0015 之前的数据库，所有开关都是开启的。迁移 0017 之前 timetable 为开启，迁移 0016 之前 moments
 * 也为开启；其他开关按已存的值读取。
 */
export async function findNotificationPrefs(db: D1Database, memberId: string): Promise<NotificationPrefs> {
  for (const columns of TIERS) {
    try {
      return await selectPrefs(db, memberId, columns);
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }
  return { ...DEFAULT_NOTIFICATION_PREFS };
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
 * Applies only the fields present in the patch. Before migration 0017 the other switches still save, and before
 * 0016 all but moments do; a change to a switch the database does not have yet fails with the missing-schema
 * error, before anything is written.
 * 只修改补丁中出现的字段。迁移 0017 之前，其他开关仍可保存；迁移 0016 之前，除 moments 以外的开关仍可保存。
 * 修改数据库中尚不存在的开关会以缺少表结构的错误失败，且不会写入任何内容。
 */
export async function updateNotificationPrefs(db: D1Database, memberId: string, patch: UpdateNotificationPrefsBody): Promise<NotificationPrefs> {
  for (let tier = 0; ; tier += 1) {
    const columns = TIERS[tier] as readonly Switch[];
    const older = TIERS[tier + 1];
    try {
      return await upsertPrefs(db, memberId, patch, columns);
    } catch (err) {
      // Falls back only while the patch touches nothing the older tier lacks.
      // 只有补丁不涉及较旧阶段所缺的开关时才退回较旧阶段。
      const lost = older ? columns.filter((column) => !older.includes(column)) : [];
      if (!isMissingSchemaError(err) || !older || lost.some((column) => patch[column] !== undefined)) throw err;
    }
  }
}

async function listOptOut(db: D1Database, column: 'moments' | 'timetable', memberIds: readonly string[]): Promise<Set<string>> {
  const off = new Set<string>();
  const unique = [...new Set(memberIds)];
  try {
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const slice = unique.slice(i, i + IDS_PER_QUERY);
      const result = await db
        .prepare(`SELECT member_id FROM notification_prefs WHERE ${column} = 0 AND member_id IN (${slice.map(() => '?').join(', ')})`)
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

/**
 * Those of these members who turned 好友动态互动 off. A query of its own, apart from the device join, so a
 * database before migration 0016 reads as everyone on and chat pushes never depend on the column.
 * 这些成员中关闭了「好友动态互动」的人。这是独立于设备联表的单独查询，因此迁移 0016 之前的数据库按全部开启处理，聊天推送也从不依赖这一列。
 */
export function listMomentsOptOut(db: D1Database, memberIds: readonly string[]): Promise<Set<string>> {
  return listOptOut(db, 'moments', memberIds);
}

/**
 * Those of these members who turned 课表提醒 off, read like listMomentsOptOut: a database before migration 0017
 * reads as everyone on, and the device join never depends on the column.
 * 这些成员中关闭了「课表提醒」的人，读取方式与 listMomentsOptOut 相同：迁移 0017 之前的数据库按全部开启处理，设备联表也从不依赖这一列。
 */
export function listTimetableOptOut(db: D1Database, memberIds: readonly string[]): Promise<Set<string>> {
  return listOptOut(db, 'timetable', memberIds);
}
