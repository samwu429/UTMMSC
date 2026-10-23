import type { EventNotificationKind, EventNotificationRow, EventNotificationStatus } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { isMissingSchemaError } from './channels';

export interface EventNoticeRow {
  id: string;
  event_id: string;
  kind: EventNotificationKind;
  send_at: string;
  status: EventNotificationStatus;
  sent_at: string | null;
  recipient_count: number | null;
  claimed_at: string | null;
  attempts: number;
  created_at: string;
}

/** A claimed row that has not finished within this time is treated as abandoned. */
/** 已领取的行在这段时间内没有完成，视为已被放弃。 */
export const STUCK_AFTER_MS = 30 * 60 * 1000;
/** A row is sent at most this many times; an abandoned row goes back to pending only once. */
/** 一行最多发送这么多次；被放弃的行只回到 pending 一次。 */
export const NOTICE_ATTEMPTS_MAX = 2;
/** Notices still pending this long after their event started are no longer useful. */
/** 活动开始超过这么久仍未发出的通知已失去意义。 */
export const STALE_AFTER_START_MS = 60 * 60 * 1000;
/** A custom notice this late after its own time is dropped once its event is under way. */
/** 活动开始后，比自己的时间晚了这么久的自定义通知不再发送。 */
export const CUSTOM_LATE_MAX_MS = 60 * 60 * 1000;

/**
 * Whether a due notice is too late to send. Publish and morning notices lapse an hour after the event
 * starts. A custom time may be set up to a day after the start, for example to ask for feedback, so it
 * lapses only when its event started over an hour ago and the notice itself is over an hour late.
 * 到期的通知是否已太晚而不再发送。发布通知和当天早上提醒在活动开始一小时后失效。自定义时间最晚可设在活动开始后一天（例如收集反馈），
 * 因此只有在活动开始超过一小时、且通知本身也晚了超过一小时时才失效。
 */
export function isStaleNotice(notice: { kind: EventNotificationKind; sendAt: string }, startsAt: string, now: number): boolean {
  const start = Date.parse(startsAt);
  if (!(start < now - STALE_AFTER_START_MS)) return false;
  return notice.kind !== 'custom' || Date.parse(notice.sendAt) < now - CUSTOM_LATE_MAX_MS;
}

const IDS_PER_QUERY = 90;

export function toNotificationRow(row: EventNoticeRow): EventNotificationRow {
  return { id: row.id, kind: row.kind, sendAt: row.send_at, status: row.status, sentAt: row.sent_at, recipientCount: row.recipient_count };
}

/** Insert statements for an event's planned notices, to run in the same batch as the event row. */
/** 活动通知计划的插入语句，与活动行在同一批中执行。 */
export function insertNoticeStatements(db: D1Database, eventId: string, notices: readonly { kind: EventNotificationKind; sendAt: string }[], createdAt: string): D1PreparedStatement[] {
  return notices.map((notice) =>
    db
      .prepare("INSERT INTO event_notifications (id, event_id, kind, send_at, status, attempts, created_at) VALUES (?, ?, ?, ?, 'pending', 0, ?)")
      .bind(randomId('evn'), eventId, notice.kind, notice.sendAt, createdAt),
  );
}

/** Notices of these events, oldest send time first. Empty before migration 0015. */
/** 这些活动的通知，按发送时间从早到晚。迁移 0015 之前为空。 */
export async function listNoticesForEvents(db: D1Database, eventIds: readonly string[]): Promise<Map<string, EventNoticeRow[]>> {
  const byEvent = new Map<string, EventNoticeRow[]>();
  const unique = [...new Set(eventIds)];
  try {
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const slice = unique.slice(i, i + IDS_PER_QUERY);
      const result = await db
        .prepare(`SELECT * FROM event_notifications WHERE event_id IN (${slice.map(() => '?').join(', ')}) ORDER BY send_at ASC, id ASC`)
        .bind(...slice)
        .all<EventNoticeRow>();
      for (const row of result.results) {
        const list = byEvent.get(row.event_id) ?? [];
        list.push(row);
        byEvent.set(row.event_id, list);
      }
    }
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
  return byEvent;
}

const CLAIM_SET = "status = 'sending', claimed_at = ?, attempts = attempts + 1";

/** Takes one pending row for sending; null when another sender already has it. */
/** 领取一行待发送的通知；已被其他发送方领取时返回 null。 */
export async function claimNotice(db: D1Database, id: string, now: Date): Promise<EventNoticeRow | null> {
  return db
    .prepare(`UPDATE event_notifications SET ${CLAIM_SET} WHERE id = ? AND status = 'pending' RETURNING *`)
    .bind(now.toISOString(), id)
    .first<EventNoticeRow>();
}

/** Claims due rows in one statement, so two overlapping runs never take the same row. */
/** 用一条语句领取到期的行，两次重叠的执行不会领到同一行。 */
export async function claimDueNotices(db: D1Database, now: Date, limit: number): Promise<EventNoticeRow[]> {
  const ts = now.toISOString();
  const result = await db
    .prepare(
      `UPDATE event_notifications SET ${CLAIM_SET}
       WHERE status = 'pending' AND id IN (
         SELECT id FROM event_notifications WHERE status = 'pending' AND send_at <= ? ORDER BY send_at ASC LIMIT ?
       )
       RETURNING *`,
    )
    .bind(ts, ts, limit)
    .all<EventNoticeRow>();
  return result.results;
}

/** Rows abandoned in sending go back to pending once, and fail after that. */
/** 卡在发送中的行回到 pending 一次，之后再卡住则记为失败。 */
export async function requeueStuckNotices(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE event_notifications
       SET status = CASE WHEN attempts < ? THEN 'pending' ELSE 'failed' END, claimed_at = NULL
       WHERE status = 'sending' AND (claimed_at IS NULL OR claimed_at < ?)`,
    )
    .bind(NOTICE_ATTEMPTS_MAX, new Date(now.getTime() - STUCK_AFTER_MS).toISOString())
    .run();
}

/** Due rows that isStaleNotice calls too late are cancelled instead of sent. */
/** isStaleNotice 判定为太晚的到期行改为取消，不再发送。 */
export async function cancelStaleNotices(db: D1Database, now: Date): Promise<void> {
  await db
    .prepare(
      `UPDATE event_notifications SET status = 'cancelled'
       WHERE status = 'pending' AND send_at <= ? AND (kind != 'custom' OR send_at < ?)
         AND event_id IN (SELECT id FROM events WHERE starts_at < ?)`,
    )
    .bind(now.toISOString(), new Date(now.getTime() - CUSTOM_LATE_MAX_MS).toISOString(), new Date(now.getTime() - STALE_AFTER_START_MS).toISOString())
    .run();
}

/**
 * Finishes a claimed row. It only updates a row still in sending, so a row removed with its event is
 * never written back.
 * 结束一行已领取的通知。只更新仍在发送中的行，随活动一起删除的行不会被写回。
 */
export async function finishNotice(db: D1Database, id: string, status: 'sent' | 'failed' | 'cancelled', recipientCount: number | null, now: Date): Promise<void> {
  await db
    .prepare("UPDATE event_notifications SET status = ?, sent_at = ?, recipient_count = ?, claimed_at = NULL WHERE id = ? AND status = 'sending'")
    .bind(status, status === 'sent' ? now.toISOString() : null, recipientCount, id)
    .run();
}

export async function cancelPendingNotices(db: D1Database, eventId: string): Promise<void> {
  try {
    await db.prepare("UPDATE event_notifications SET status = 'cancelled' WHERE event_id = ? AND status = 'pending'").bind(eventId).run();
  } catch (err) {
    if (!isMissingSchemaError(err)) throw err;
  }
}
