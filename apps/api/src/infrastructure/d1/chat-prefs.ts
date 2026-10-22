import type { ChatPrefs, UpdateChatPrefsBody } from '@utmmsc/shared';
import { isMissingSchemaError } from './channels';
import { nowIso } from './time';

/** Pin, mute, mark-as-unread and hide, per member and room. Missing rows mean all off. */
/** 按成员和房间保存的置顶、免打扰、标为未读和隐藏。没有记录表示全部关闭。 */

interface ChatPrefsRow {
  room_id: string;
  pinned: number;
  muted: number;
  marked_unread: number;
  hidden_at: string | null;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = Object.freeze({ pinned: false, muted: false, markedUnread: false, hiddenAt: null });

function toPrefs(row: ChatPrefsRow): ChatPrefs {
  return { pinned: row.pinned === 1, muted: row.muted === 1, markedUnread: row.marked_unread === 1, hiddenAt: row.hidden_at ?? null };
}

export async function listPrefs(db: D1Database, memberId: string): Promise<Map<string, ChatPrefs>> {
  try {
    const result = await db
      .prepare('SELECT room_id, pinned, muted, marked_unread, hidden_at FROM chat_prefs WHERE member_id = ?')
      .bind(memberId)
      .all<ChatPrefsRow>();
    return new Map(result.results.map((row) => [row.room_id, toPrefs(row)]));
  } catch (err) {
    if (isMissingSchemaError(err)) return new Map();
    throw err;
  }
}

export async function findPrefs(db: D1Database, memberId: string, roomId: string): Promise<ChatPrefs> {
  try {
    const row = await db
      .prepare('SELECT room_id, pinned, muted, marked_unread, hidden_at FROM chat_prefs WHERE member_id = ? AND room_id = ?')
      .bind(memberId, roomId)
      .first<ChatPrefsRow>();
    return row ? toPrefs(row) : { ...DEFAULT_CHAT_PREFS };
  } catch (err) {
    if (isMissingSchemaError(err)) return { ...DEFAULT_CHAT_PREFS };
    throw err;
  }
}

function flag(value: boolean | undefined): number | null {
  return value === undefined ? null : value ? 1 : 0;
}

/** Applies only the fields present in the patch. `hidden: true` stamps now; `hidden: false` clears it. */
/** 只修改补丁中出现的字段。`hidden: true` 记为当前时间；`hidden: false` 清除。 */
export async function upsertPrefs(db: D1Database, memberId: string, roomId: string, patch: UpdateChatPrefsBody): Promise<ChatPrefs> {
  const ts = nowIso();
  const pinned = flag(patch.pinned);
  const muted = flag(patch.muted);
  const markedUnread = flag(patch.markedUnread);
  const hidden = flag(patch.hidden);
  const hiddenAt = patch.hidden === true ? ts : null;
  const row = await db
    .prepare(
      `INSERT INTO chat_prefs (member_id, room_id, pinned, muted, marked_unread, hidden_at, updated_at)
       VALUES (?, ?, COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 0), ?, ?)
       ON CONFLICT (member_id, room_id) DO UPDATE SET
         pinned = COALESCE(?, pinned),
         muted = COALESCE(?, muted),
         marked_unread = COALESCE(?, marked_unread),
         hidden_at = CASE ? WHEN 1 THEN ? WHEN 0 THEN NULL ELSE hidden_at END,
         updated_at = excluded.updated_at
       RETURNING room_id, pinned, muted, marked_unread, hidden_at`,
    )
    .bind(memberId, roomId, pinned, muted, markedUnread, hiddenAt, ts, pinned, muted, markedUnread, hidden, hiddenAt)
    .first<ChatPrefsRow>();
  if (!row) throw new Error('chat prefs upsert did not persist');
  return toPrefs(row);
}

/** Opening or reading a room clears the manual unread mark, as in WeChat. */
/** 打开或读完房间会清除手动的未读标记，与微信一致。 */
export async function clearMarkedUnread(db: D1Database, memberId: string, roomId: string): Promise<void> {
  try {
    await db
      .prepare('UPDATE chat_prefs SET marked_unread = 0, updated_at = ? WHERE member_id = ? AND room_id = ? AND marked_unread = 1')
      .bind(nowIso(), memberId, roomId)
      .run();
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}
