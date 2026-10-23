import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs, type UpdateNotificationPrefsBody } from '@utmmsc/shared';
import { isMissingSchemaError } from './channels';
import { nowIso } from './time';

/** Switch columns as a LEFT JOIN returns them; null means no row, so the default. */
/** LEFT JOIN 返回的开关列；null 表示没有记录，取默认值。 */
export interface PrefColumns {
  pref_messages: number | null;
  pref_events: number | null;
  pref_preview: number | null;
}

function on(value: number | null | undefined, fallback: boolean): boolean {
  return value === null || value === undefined ? fallback : value !== 0;
}

export function prefsFromColumns(row: PrefColumns): NotificationPrefs {
  return {
    messages: on(row.pref_messages, DEFAULT_NOTIFICATION_PREFS.messages),
    events: on(row.pref_events, DEFAULT_NOTIFICATION_PREFS.events),
    preview: on(row.pref_preview, DEFAULT_NOTIFICATION_PREFS.preview),
  };
}

const SELECT_PREFS = 'SELECT messages AS pref_messages, events AS pref_events, preview AS pref_preview FROM notification_prefs WHERE member_id = ?';

/** A member without a row, or a database before migration 0015, gets every switch on. */
/** 没有记录的成员，或迁移 0015 之前的数据库，所有开关都是开启的。 */
export async function findNotificationPrefs(db: D1Database, memberId: string): Promise<NotificationPrefs> {
  try {
    const row = await db.prepare(SELECT_PREFS).bind(memberId).first<PrefColumns>();
    return row ? prefsFromColumns(row) : { ...DEFAULT_NOTIFICATION_PREFS };
  } catch (err) {
    if (isMissingSchemaError(err)) return { ...DEFAULT_NOTIFICATION_PREFS };
    throw err;
  }
}

function flag(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/** Applies only the fields present in the patch. */
/** 只修改补丁中出现的字段。 */
export async function updateNotificationPrefs(db: D1Database, memberId: string, patch: UpdateNotificationPrefsBody): Promise<NotificationPrefs> {
  const messages = flag(patch.messages);
  const events = flag(patch.events);
  const preview = flag(patch.preview);
  const row = await db
    .prepare(
      `INSERT INTO notification_prefs (member_id, messages, events, preview, updated_at)
       VALUES (?, COALESCE(?, 1), COALESCE(?, 1), COALESCE(?, 1), ?)
       ON CONFLICT (member_id) DO UPDATE SET
         messages = COALESCE(?, messages),
         events = COALESCE(?, events),
         preview = COALESCE(?, preview),
         updated_at = excluded.updated_at
       RETURNING messages AS pref_messages, events AS pref_events, preview AS pref_preview`,
    )
    .bind(memberId, messages, events, preview, nowIso(), messages, events, preview)
    .first<PrefColumns>();
  if (!row) throw new Error('notification prefs upsert did not persist');
  return prefsFromColumns(row);
}
