/**
 * Calendar and clock helpers for the timetable, always in Toronto time whatever the device's time zone. Dates are
 * YYYY-MM-DD strings and their arithmetic is pure calendar arithmetic, so daylight saving never moves a date.
 * 课表用的日期与时间工具，无论设备在哪个时区都按多伦多时间计算。日期是 YYYY-MM-DD 字符串，日期运算是纯日历运算，夏令时不会让日期错位。
 */
import { NOTIFICATION_TIME_ZONE, wallClockAt, wallTimeToUtcMs } from '../notifications/schedule';
import type { TimetableLocale, TimetableTerm, Weekday } from './types';

/** The timetable's zone: the campus, not the device. */
/** 课表使用的时区：校园所在地，而不是设备所在地。 */
export const TIMETABLE_TIME_ZONE = NOTIFICATION_TIME_ZONE;

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MIN = 1970;
const YEAR_MAX = 9999;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Year, month (1-12) and day of a valid date, or null. */
/** 有效日期的年、月（1-12）、日；无效时为 null。 */
function dateParts(date: string): [number, number, number] | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < YEAR_MIN || year > YEAR_MAX || month < 1 || month > 12 || day < 1) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return [year, month, day];
}

function requireParts(date: string): [number, number, number] {
  const parts = dateParts(date);
  if (!parts) throw new RangeError(`invalid date: ${date}`);
  return parts;
}

/** Days since 1970-01-01 for a date. */
/** 日期距 1970-01-01 的天数。 */
function dayNumber(date: string): number {
  const [year, month, day] = requireParts(date);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function fromDayNumber(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

/** Whether a value is a real calendar date written YYYY-MM-DD (2026-02-30 is not). */
/** 值是否为写成 YYYY-MM-DD 的真实日历日期（2026-02-30 不是）。 */
export function isTimetableDate(value: unknown): value is string {
  return typeof value === 'string' && dateParts(value) !== null;
}

/** The Toronto date of an instant, YYYY-MM-DD. */
/** 某一时刻在多伦多的日期，YYYY-MM-DD。 */
export function torontoDateOf(ms: number): string {
  const w = wallClockAt(ms, TIMETABLE_TIME_ZONE);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Minutes after Toronto midnight at an instant, 0-1439. */
/** 某一时刻距多伦多午夜的分钟数，0-1439。 */
export function torontoMinuteOf(ms: number): number {
  const w = wallClockAt(ms, TIMETABLE_TIME_ZONE);
  return w.hour * 60 + w.minute;
}

/** 1 for Monday through 7 for Sunday. */
/** 周一为 1，周日为 7。 */
export function isoWeekday(date: string): Weekday {
  const [year, month, day] = requireParts(date);
  const sunday0 = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (sunday0 === 0 ? 7 : sunday0) as Weekday;
}

/** The date n days later (n may be negative). */
/** n 天之后的日期（n 可以为负）。 */
export function addDays(date: string, n: number): string {
  return fromDayNumber(dayNumber(date) + n);
}

/** Whole days from one date to another; negative when `to` is earlier. */
/** 从一个日期到另一个日期的整天数；`to` 更早时为负。 */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** The Monday of the Monday-to-Sunday week holding the date. */
/** 包含该日期的周一到周日那一周的周一。 */
export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The term week of a date: week 1 is the Monday-to-Sunday week holding startsOn, so a term that starts on a
 * Thursday has a short week 1. Dates before the term give 0 or less and dates after it give more than the
 * term's length, so callers check the term range first. The class scan computes the same number in SQL.
 * 日期所在的学期周次：第 1 周是包含 startsOn 的周一到周日，因此周四开学的学期第 1 周较短。学期之前的日期得到 0 或更小的值，
 * 学期之后的日期得到超过学期长度的值，调用方需先检查日期是否在学期内。上课提醒扫描在 SQL 中算出同样的周次。
 */
export function weekOfTerm(term: Pick<TimetableTerm, 'startsOn'>, date: string): number {
  return Math.floor(daysBetween(mondayOf(term.startsOn), date) / 7) + 1;
}

/** Weeks a term spans, counting its short first and last weeks. */
/** 学期跨越的周数，包括不满一周的第一周和最后一周。 */
export function termWeekCount(term: Pick<TimetableTerm, 'startsOn' | 'endsOn'>): number {
  return weekOfTerm(term, term.endsOn);
}

/** Whether the date lies inside the term, both ends included. */
/** 日期是否在学期之内（含首尾两天）。 */
export function termContains(term: Pick<TimetableTerm, 'startsOn' | 'endsOn'>, date: string): boolean {
  return term.startsOn <= date && date <= term.endsOn;
}

/**
 * The shortest term containing the date, so a summer session inside a longer term wins. Ties go to the term
 * that started later, then to the smaller id, so the answer never depends on list order.
 * 包含该日期的最短学期，因此包含在较长学期中的暑期课程优先。长度相同时取开始较晚的学期，再取 id 较小的，结果与列表顺序无关。
 */
export function termFor<T extends Pick<TimetableTerm, 'id' | 'startsOn' | 'endsOn'>>(terms: readonly T[], date: string): T | null {
  let best: T | null = null;
  let bestLength = Number.POSITIVE_INFINITY;
  for (const term of terms) {
    if (!termContains(term, date)) continue;
    const length = daysBetween(term.startsOn, term.endsOn);
    const better =
      best === null ||
      length < bestLength ||
      (length === bestLength && (term.startsOn > best.startsOn || (term.startsOn === best.startsOn && term.id < best.id)));
    if (better) {
      best = term;
      bestLength = length;
    }
  }
  return best;
}

/** The instant of a Toronto date and minute after midnight. */
/** 多伦多某日期、午夜起第几分钟所对应的时刻。 */
export function instantAt(date: string, minute: number): number {
  const [year, month, day] = requireParts(date);
  return wallTimeToUtcMs(year, month, day, Math.floor(minute / 60), minute % 60, TIMETABLE_TIME_ZONE);
}

function clockParts(minute: number): { hour: number; minute: number } {
  return { hour: Math.floor(minute / 60), minute: minute % 60 };
}

function half(hour: number): 'AM' | 'PM' {
  return hour % 24 < 12 ? 'AM' : 'PM';
}

function twelveHour(hour: number, minute: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12}:${pad(minute)}`;
}

/** 14:10 in Chinese, 2:10 PM in English. */
/** 中文为 14:10，英文为 2:10 PM。 */
export function formatClock(minute: number, locale: TimetableLocale): string {
  const c = clockParts(minute);
  if (locale === 'zh') return `${pad(c.hour)}:${pad(c.minute)}`;
  return `${twelveHour(c.hour, c.minute)} ${half(c.hour)}`;
}

/** 14:10–15:00 in Chinese; 2:10–3:00 PM in English, or 11:30 AM–12:20 PM across noon. */
/** 中文为 14:10–15:00；英文为 2:10–3:00 PM，跨过中午时为 11:30 AM–12:20 PM。 */
export function formatClockRange(start: number, end: number, locale: TimetableLocale): string {
  if (locale === 'zh') return `${formatClock(start, 'zh')}–${formatClock(end, 'zh')}`;
  const a = clockParts(start);
  const b = clockParts(end);
  if (half(a.hour) === half(b.hour)) return `${twelveHour(a.hour, a.minute)}–${twelveHour(b.hour, b.minute)} ${half(b.hour)}`;
  return `${formatClock(start, 'en')}–${formatClock(end, 'en')}`;
}
