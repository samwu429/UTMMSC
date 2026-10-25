import type { AdminAnnouncementRow } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import type { MomentCursor } from '../../domain/moments/cursor';
import { nowIso } from './time';

export async function recordAnnouncement(db: D1Database, input: { title: string; body: string; sentBy: string; recipientCount: number; emailed: boolean }): Promise<void> {
  await db
    .prepare('INSERT INTO announcements (id, title, body, sent_by, sent_at, recipient_count, emailed) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId('ann'), input.title, input.body, input.sentBy, nowIso(), input.recipientCount, input.emailed ? 1 : 0)
    .run();
}

interface AnnouncementListRow {
  id: string;
  title: string;
  body: string;
  sent_at: string;
  recipient_count: number;
  emailed: number;
  sender_id: string | null;
  sender_name: string | null;
}

/** Announcements per page of the admin history. */
/** 管理后台公告记录每页的条数。 */
export const ANNOUNCEMENT_PAGE = 20;

/**
 * Sent announcements, newest first, keyed on (sent_at, id) so a page never repeats or skips a row when two were sent
 * in the same millisecond. `cursor` is the last row of the previous page. The sender is joined in for the history
 * line and is null if their row is gone.
 * 已发送的公告，从新到旧，以 (sent_at, id) 为键分页，即使两条在同一毫秒发出也不会重复或漏掉。`cursor` 是上一页的最后一行。
 * 发送人一并查出，用于记录中的说明；其成员记录不存在时为 null。
 */
export async function listAnnouncements(
  db: D1Database,
  options: { cursor: MomentCursor | null; limit?: number },
): Promise<{ announcements: AdminAnnouncementRow[]; nextCursor: MomentCursor | null }> {
  const limit = options.limit ?? ANNOUNCEMENT_PAGE;
  const values: unknown[] = [];
  let after = '';
  if (options.cursor) {
    after = 'WHERE (a.sent_at, a.id) < (?1, ?2)';
    values.push(options.cursor.at, options.cursor.id);
  }
  values.push(limit + 1);
  const result = await db
    .prepare(
      `SELECT a.id, a.title, a.body, a.sent_at, a.recipient_count, a.emailed, m.id AS sender_id, m.display_name AS sender_name
       FROM announcements a
       LEFT JOIN members m ON m.id = a.sent_by
       ${after}
       ORDER BY a.sent_at DESC, a.id DESC
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<AnnouncementListRow>();
  const rows = result.results.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    announcements: rows.map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      sentAt: row.sent_at,
      recipientCount: Number(row.recipient_count),
      emailed: Number(row.emailed) === 1,
      sentBy: row.sender_id ? { id: row.sender_id, displayName: row.sender_name ?? '' } : null,
    })),
    nextCursor: result.results.length > limit && last ? { at: last.sent_at, id: last.id } : null,
  };
}
