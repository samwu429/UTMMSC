import {
  DEFAULT_EVENT_NOTIFICATION_PLAN,
  EVENT_CUSTOM_TIMES_MAX,
  morningOf,
  type EventNotificationKind,
  type EventNotificationPlan,
} from '@utmmsc/shared';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A morning notice due within this long after the publish notice is dropped, so publishing an event
 * at 08:30 for the same afternoon does not send two notices half an hour apart.
 * 当天早上提醒若在发布通知之后这么短的时间内就要发出，则不再单独发送；在 08:30 发布当天下午的活动时不会半小时内连发两条。
 */
export const MORNING_MERGE_MS = 60 * 60 * 1000;

export interface PlanError {
  code: string;
  message: string;
}

export type PlanResult<T> = { ok: true; value: T } | { ok: false; error: PlanError };

const shapeError: PlanError = { code: 'invalid_notifications', message: '通知设置格式错误' };

function flag(value: unknown, fallback: boolean): boolean | null {
  if (value === undefined || value === null) return fallback;
  return typeof value === 'boolean' ? value : null;
}

/** Reads the `notifications` field of an event body. Missing fields take the defaults. */
/** 读取活动请求体中的 `notifications` 字段。缺少的字段取默认值。 */
export function readEventNotificationPlan(raw: unknown): PlanResult<EventNotificationPlan> {
  if (raw === undefined || raw === null) return { ok: true, value: { ...DEFAULT_EVENT_NOTIFICATION_PLAN, customTimes: [] } };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: shapeError };
  const record = raw as Record<string, unknown>;
  const notifyOnPublish = flag(record.notifyOnPublish, DEFAULT_EVENT_NOTIFICATION_PLAN.notifyOnPublish);
  const notifyMorningOf = flag(record.notifyMorningOf, DEFAULT_EVENT_NOTIFICATION_PLAN.notifyMorningOf);
  const times = record.customTimes ?? [];
  if (notifyOnPublish === null || notifyMorningOf === null || !Array.isArray(times)) return { ok: false, error: shapeError };
  if (times.length > EVENT_CUSTOM_TIMES_MAX) {
    return { ok: false, error: { code: 'too_many_notice_times', message: `自定义通知时间最多 ${EVENT_CUSTOM_TIMES_MAX} 个` } };
  }
  if (!times.every((t): t is string => typeof t === 'string' && t.length > 0 && t.length <= 40)) {
    return { ok: false, error: { code: 'invalid_notice_time', message: '通知时间无效' } };
  }
  return { ok: true, value: { notifyOnPublish, notifyMorningOf, customTimes: times } };
}

export interface PlannedNotice {
  kind: EventNotificationKind;
  sendAt: string;
}

/**
 * Turns the publisher's choices into rows: the publish notice now, the morning notice if it is still
 * ahead, and each custom time. Custom times must be in the future and no later than a day after the
 * start; duplicates, including one equal to the morning notice, count once.
 * 把发布人的选择转换为通知计划：发布通知立即发送；当天早上提醒仍在将来时加入；以及每个自定义时间。
 * 自定义时间必须晚于现在，且不晚于活动开始后一天；重复的时间（包括与当天早上提醒相同的时间）只算一次。
 */
export function scheduleEventNotifications(input: { startsAt: string; plan: EventNotificationPlan; now: Date }): PlanResult<PlannedNotice[]> {
  const now = input.now.getTime();
  const start = Date.parse(input.startsAt);
  if (Number.isNaN(start)) return { ok: false, error: { code: 'invalid_date', message: '开始时间无效' } };
  if (input.plan.customTimes.length > EVENT_CUSTOM_TIMES_MAX) {
    return { ok: false, error: { code: 'too_many_notice_times', message: `自定义通知时间最多 ${EVENT_CUSTOM_TIMES_MAX} 个` } };
  }

  const custom = new Set<number>();
  for (const raw of input.plan.customTimes) {
    const at = Date.parse(raw);
    if (Number.isNaN(at)) return { ok: false, error: { code: 'invalid_notice_time', message: '通知时间无效' } };
    if (at <= now) return { ok: false, error: { code: 'notice_time_past', message: '通知时间必须晚于现在' } };
    if (at > start + DAY_MS) return { ok: false, error: { code: 'notice_time_too_late', message: '通知时间不能晚于活动开始后一天' } };
    custom.add(at);
  }

  const notices: PlannedNotice[] = [];
  if (input.plan.notifyOnPublish) notices.push({ kind: 'publish', sendAt: new Date(now).toISOString() });
  if (input.plan.notifyMorningOf) {
    const morning = Date.parse(morningOf(new Date(start).toISOString()));
    const mergedIntoPublish = input.plan.notifyOnPublish && morning - now < MORNING_MERGE_MS;
    if (morning > now && !mergedIntoPublish) {
      notices.push({ kind: 'morning', sendAt: new Date(morning).toISOString() });
      custom.delete(morning);
    }
  }
  for (const at of [...custom].sort((a, b) => a - b)) notices.push({ kind: 'custom', sendAt: new Date(at).toISOString() });
  notices.sort((a, b) => a.sendAt.localeCompare(b.sendAt));
  return { ok: true, value: notices };
}
