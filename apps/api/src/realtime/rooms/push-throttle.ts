import type { MessageRecipient } from '../../infrastructure/push/chat';

/** When this room last pushed a message to one member, in epoch milliseconds. */
/** 本房间上次向某成员推送消息的时间，单位为毫秒时间戳。 */
export interface PushMark {
  lastPushAt: number;
  /** Last push that @-mentioned them, or null. */
  /** 上次 @ 到此人的推送时间，没有时为 null。 */
  lastMentionAt: number | null;
}

interface PushMarkRow extends Record<string, SqlStorageValue> {
  member_id: string;
  last_push_at: number;
  last_mention_at: number | null;
}

/** A time ahead of now means the clock moved back; it no longer holds anyone off. */
/** 晚于现在的时间说明时钟回拨过，不再用它拦截推送。 */
function isRecent(at: number | null, now: number, intervalMs: number): boolean {
  return at !== null && at <= now && now - at < intervalMs;
}

/**
 * Recipients who may be pushed now: anyone this room has not pushed within the interval. A mention may
 * follow an ordinary push inside the interval, so being @-mentioned is never hidden behind chatter;
 * mention pushes themselves are held to one per interval.
 * 此刻可以推送的收件人：本房间在间隔内没有推送过的人。间隔内的普通推送之后仍可再推一条 @，避免 @ 被闲聊淹没；@ 推送本身每个间隔最多一条。
 */
export function selectUnthrottled(
  recipients: readonly MessageRecipient[],
  marks: ReadonlyMap<string, PushMark>,
  now: number,
  intervalMs: number,
): MessageRecipient[] {
  return recipients.filter((recipient) => {
    const mark = marks.get(recipient.memberId);
    if (!mark || !isRecent(mark.lastPushAt, now, intervalMs)) return true;
    return recipient.mentioned && !isRecent(mark.lastMentionAt, now, intervalMs);
  });
}

/**
 * Applies the throttle with this room's push_throttle table and records the pushes it allows. Rows
 * older than the interval are dropped first, so the table only ever holds members pushed moments ago.
 * 用本房间的 push_throttle 表执行限流，并记下允许的推送。先删除超出间隔的行，表里只会留下刚刚推送过的成员。
 */
export function claimPushSlots(sql: SqlStorage, recipients: readonly MessageRecipient[], now: number, intervalMs: number): string[] {
  sql.exec('DELETE FROM push_throttle WHERE last_push_at <= ? OR last_push_at > ?', now - intervalMs, now);
  if (recipients.length === 0) return [];
  const marks = new Map<string, PushMark>();
  for (const row of sql.exec<PushMarkRow>('SELECT member_id, last_push_at, last_mention_at FROM push_throttle')) {
    marks.set(row.member_id, { lastPushAt: row.last_push_at, lastMentionAt: row.last_mention_at });
  }
  const allowed = selectUnthrottled(recipients, marks, now, intervalMs);
  for (const recipient of allowed) {
    sql.exec(
      `INSERT INTO push_throttle (member_id, last_push_at, last_mention_at) VALUES (?, ?, ?)
       ON CONFLICT(member_id) DO UPDATE SET
         last_push_at = excluded.last_push_at,
         last_mention_at = COALESCE(excluded.last_mention_at, push_throttle.last_mention_at)`,
      recipient.memberId,
      now,
      recipient.mentioned ? now : null,
    );
  }
  return allowed.map((recipient) => recipient.memberId);
}
