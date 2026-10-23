import { NOTIFICATION_TIME_ZONE, isoToZonedLocal, morningOf, wallClockAt, wallTimeToUtcMs, zonedLocalToIso } from '@utmmsc/shared';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Mirrors the server: with the publish notice on, a morning notice due within this long is not sent on its own.
 * 与服务器一致：开启发布通知时，若当天早上提醒在这段时间内就要发出，则不再单独发送。
 */
export const MORNING_MERGE_MS = HOUR_MS;

/** A custom time must leave a little room, since the cron runs every five minutes. */
/** 自定义时间要留一点余量，因为定时任务每五分钟运行一次。 */
const SUGGEST_MARGIN_MS = 10 * 60 * 1000;

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dayKey(ms: number, timeZone: string): number {
  const w = wallClockAt(ms, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day);
}

/**
 * What happens to the morning-of notice: scheduled (on the event day, or the evening before for an event
 * at or before 06:00), merged into the publish notice because it is due within the hour, or already passed.
 * `early` says why an event before 10:00 is not told at 9:00: two hours before the start, or at 06:00, the
 * earliest morning time, which gives an event before 08:00 less than two hours.
 * 当天早上提醒的去向：已安排（活动当天，或活动在 06:00 或更早开始时的前一天晚上）、因一小时内就要发出而并入发布通知，或时间已过。
 * `early` 说明 10:00 之前的活动为何不在 9:00 提醒：提前两小时，或在最早的早上时间 06:00 提醒（08:00 之前的活动因此不足两小时）。
 */
export type MorningPlan =
  | { kind: 'scheduled'; sendAt: string; day: 'same' | 'before'; clock: string; early: 'two-hours' | 'earliest' | null }
  | { kind: 'merged'; sendAt: string }
  | { kind: 'passed'; sendAt: string };

export function planMorning(startsAtIso: string, nowMs: number, notifyOnPublish: boolean, timeZone: string = NOTIFICATION_TIME_ZONE): MorningPlan | null {
  const start = Date.parse(startsAtIso);
  if (Number.isNaN(start)) return null;
  const sendAt = morningOf(startsAtIso, timeZone);
  const at = Date.parse(sendAt);
  if (at <= nowMs) return { kind: 'passed', sendAt };
  if (notifyOnPublish && at - nowMs < MORNING_MERGE_MS) return { kind: 'merged', sendAt };
  const w = wallClockAt(at, timeZone);
  const day = dayKey(at, timeZone) === dayKey(start, timeZone) ? 'same' : 'before';
  const early = day === 'same' && wallClockAt(start, timeZone).hour < 10 ? (start - at === 2 * HOUR_MS ? 'two-hours' : 'earliest') : null;
  return { kind: 'scheduled', sendAt, day, clock: `${w.hour}:${pad(w.minute)}`, early };
}

export type CustomTimeIssue = 'empty' | 'invalid' | 'past' | 'too-late' | 'duplicate';

/**
 * Checks each datetime-local value as Toronto time against the server's rules: after now, no later than a
 * day after the start, and listed once.
 * 把每个 datetime-local 值按多伦多时间，依服务器规则检查：晚于现在、不晚于活动开始后一天、不重复。
 */
export function customTimeIssues(values: readonly string[], startsAtIso: string | null, nowMs: number, timeZone: string = NOTIFICATION_TIME_ZONE): (CustomTimeIssue | null)[] {
  const start = startsAtIso ? Date.parse(startsAtIso) : Number.NaN;
  const seen = new Set<number>();
  return values.map((value) => {
    if (!value.trim()) return 'empty';
    const iso = zonedLocalToIso(value, timeZone);
    if (!iso) return 'invalid';
    const at = Date.parse(iso);
    if (at <= nowMs) return 'past';
    if (!Number.isNaN(start) && at > start + DAY_MS) return 'too-late';
    if (seen.has(at)) return 'duplicate';
    seen.add(at);
    return null;
  });
}

/** The ISO instants to send, or null while any value has an issue. */
/** 要提交的 ISO 时间；只要有一个值有问题就返回 null。 */
export function customTimesToIso(values: readonly string[], startsAtIso: string | null, nowMs: number, timeZone: string = NOTIFICATION_TIME_ZONE): string[] | null {
  if (customTimeIssues(values, startsAtIso, nowMs, timeZone).some((issue) => issue !== null)) return null;
  return values.map((value) => zonedLocalToIso(value, timeZone) as string);
}

/**
 * Starting value for a new custom time: the day before at the same clock time, else an hour before the
 * start, skipping times already listed or too close to now. Empty when nothing fits.
 * 新增自定义时间的初始值：前一天的同一时刻，否则开始前一小时；跳过已列出或离现在太近的时间。都不合适时为空。
 */
export function suggestCustomTime(startsAtIso: string | null, existing: readonly string[], nowMs: number, timeZone: string = NOTIFICATION_TIME_ZONE): string {
  if (!startsAtIso) return '';
  const start = Date.parse(startsAtIso);
  if (Number.isNaN(start)) return '';
  const taken = new Set(existing.map((value) => zonedLocalToIso(value, timeZone)).filter((iso): iso is string => iso !== null).map((iso) => Date.parse(iso)));
  const w = wallClockAt(start, timeZone);
  const dayBefore = wallTimeToUtcMs(w.year, w.month, w.day - 1, w.hour, w.minute, timeZone);
  for (const at of [dayBefore, start - HOUR_MS]) {
    if (at - nowMs < SUGGEST_MARGIN_MS || taken.has(at)) continue;
    return isoToZonedLocal(new Date(at).toISOString(), timeZone);
  }
  return '';
}

/** A notice time in Toronto: 10月25日 周六 09:00, or Sat, Oct 25, 09:00. */
/** 多伦多时间的通知时刻：10月25日 周六 09:00，或 Sat, Oct 25, 09:00。 */
export function formatNoticeTime(iso: string, locale: 'zh' | 'en', timeZone: string = NOTIFICATION_TIME_ZONE): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const w = wallClockAt(ms, timeZone);
  const clock = `${pad(w.hour)}:${pad(w.minute)}`;
  if (locale === 'en') return `${WEEKDAYS_EN[w.weekday] ?? ''}, ${MONTHS_EN[w.month - 1] ?? ''} ${w.day}, ${clock}`;
  return `${w.month}月${w.day}日 ${WEEKDAYS_ZH[w.weekday] ?? ''} ${clock}`;
}
