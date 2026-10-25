/** Events are planned and announced in Toronto time wherever the code runs. */
/** 无论代码在哪里运行，活动都按多伦多时间安排和通知。 */
export const NOTIFICATION_TIME_ZONE = 'America/Toronto';

const HOUR_MS = 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** Local calendar date and clock time in one time zone. month is 1-12, weekday is 0 (Sunday) to 6. */
/** 某时区的本地日期与时间。month 为 1-12，weekday 为 0（周日）到 6。 */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function wallClockAt(ms: number, timeZone: string = NOTIFICATION_TIME_ZONE): WallClock {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    // Some engines print midnight as 24 even with h23.
    // 即使指定 h23，有些引擎仍把午夜输出为 24。
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second'),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

/** Local time minus UTC at this instant, in milliseconds. */
/** 此刻本地时间与 UTC 之差，单位毫秒。 */
function offsetAt(ms: number, timeZone: string): number {
  const w = wallClockAt(ms, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - (ms - (((ms % 1000) + 1000) % 1000));
}

/**
 * The instant a local wall time names. Day and month overflow roll over as in Date.UTC, so day 0 is
 * the last day of the previous month. A time skipped by a spring-forward lands one hour earlier: 02:30 on
 * 2027-03-14 gives 06:30Z, which is 01:30 EST. A time the autumn change repeats gives its first, daylight time.
 * 本地时间对应的时刻。日、月溢出时与 Date.UTC 一样顺延，第 0 日即上个月最后一天。春季拨快时被跳过的时间会落在一小时之前：
 * 2027-03-14 的 02:30 得到 06:30Z，即东部标准时间 01:30。秋季切换时重复出现的时间取第一次，即夏令时的那个时刻。
 */
export function wallTimeToUtcMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string = NOTIFICATION_TIME_ZONE): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetAt(guess, timeZone);
  const candidate = guess - first;
  const second = offsetAt(candidate, timeZone);
  return second === first ? candidate : guess - second;
}

/**
 * When the morning-of reminder goes out, as an ISO instant. Normally 09:00 local on the event's date.
 * An event before 10:00 gets two hours' notice instead, but not before 06:00; an event at or before
 * 06:00 has no morning left, so its reminder goes out at 21:00 the evening before.
 * 当天早上提醒的发送时间（ISO）。通常为活动当天本地 09:00。活动在 10:00 之前开始时改为提前两小时，但不早于 06:00；
 * 活动在 06:00 或更早开始时当天早上已来不及，改为前一天晚上 21:00 提醒。
 */
export function morningOf(startsAtIso: string, timeZone: string = NOTIFICATION_TIME_ZONE): string {
  const start = Date.parse(startsAtIso);
  if (Number.isNaN(start)) throw new RangeError(`invalid start time: ${startsAtIso}`);
  const local = wallClockAt(start, timeZone);
  if (local.hour >= 10) return new Date(wallTimeToUtcMs(local.year, local.month, local.day, 9, 0, timeZone)).toISOString();
  const twoHoursBefore = start - 2 * HOUR_MS;
  const earliest = wallTimeToUtcMs(local.year, local.month, local.day, 6, 0, timeZone);
  if (twoHoursBefore >= earliest) return new Date(twoHoursBefore).toISOString();
  if (earliest < start) return new Date(earliest).toISOString();
  return new Date(wallTimeToUtcMs(local.year, local.month, local.day - 1, 21, 0, timeZone)).toISOString();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Event time as notifications show it, e.g. 10月25日 周六 14:00. */
/** 通知中显示的活动时间，例如 10月25日 周六 14:00。 */
export function formatEventTimeZh(iso: string, timeZone: string = NOTIFICATION_TIME_ZONE): string {
  const w = wallClockAt(Date.parse(iso), timeZone);
  return `${w.month}月${w.day}日 ${WEEKDAYS_ZH[w.weekday] ?? ''} ${pad(w.hour)}:${pad(w.minute)}`;
}

/** Local value for an <input type="datetime-local">, e.g. 2026-10-25T14:00. */
/** 供 <input type="datetime-local"> 使用的本地值，例如 2026-10-25T14:00。 */
export function isoToZonedLocal(iso: string, timeZone: string = NOTIFICATION_TIME_ZONE): string {
  const w = wallClockAt(Date.parse(iso), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** Reads a datetime-local value as wall time in the zone; null when it is not one. */
/** 把 datetime-local 的值按该时区的本地时间读取；格式不对时返回 null。 */
export function zonedLocalToIso(local: string, timeZone: string = NOTIFICATION_TIME_ZONE): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(local.trim());
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (hour > 23 || minute > 59) return null;
  // Rejects dates such as 02-30 instead of rolling them into the next month.
  // 拒绝 02-30 这类日期，而不是顺延到下个月。
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Date(wallTimeToUtcMs(year, month, day, hour, minute, timeZone)).toISOString();
}
