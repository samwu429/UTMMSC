/**
 * Owner: T3, timetable web core. How a deadline reads in the assignment rows and on the home card, in Toronto time.
 * 维护者：T3，课表网页核心。作业列表和首页卡片中截止时间的写法，按多伦多时间。
 */
import { daysBetween, formatClock, isoWeekday, isTimetableDate, torontoDateOf, torontoMinuteOf, type TimetableLocale } from '@utmmsc/shared';
import { monthDay, weekdayShort } from './labels';

/**
 * Deadlines are read only from 2000 to 2100. A date outside that window, such as a half-typed year 0002 from the
 * date picker or a damaged stored item, counts as no date, so no label or form meets a year the calendar helpers
 * refuse (they throw before 1970) and nothing throws while a screen draws.
 * 截止时间只在 2000 年到 2100 年之间读取。超出范围的日期，例如日期选择器中只输入了一半的年份 0002，或损坏的已存条目，
 * 都按没有日期处理，因此标签和表单都不会遇到日历工具拒绝的年份（1970 年之前会抛出异常），绘制页面时也不会抛出异常。
 */
export const DUE_DATE_MIN = '2000-01-01';
export const DUE_DATE_MAX = '2100-12-31';
const DUE_MS_MIN = Date.UTC(2000, 0, 1);
const DUE_MS_END = Date.UTC(2101, 0, 1);

/** Whether a value is a real YYYY-MM-DD date inside the deadline window. */
/** 值是否为截止时间范围内真实的 YYYY-MM-DD 日期。 */
export function isDueDate(value: unknown): value is string {
  return isTimetableDate(value) && value >= DUE_DATE_MIN && value <= DUE_DATE_MAX;
}

function inDueWindow(ms: number): boolean {
  return Number.isFinite(ms) && ms >= DUE_MS_MIN && ms < DUE_MS_END;
}

/** The instant of a stored dueAt, or null when it does not parse or lies outside the deadline window. */
/** 已存 dueAt 对应的时刻；无法解析或超出截止时间范围时为 null。 */
export function dueMsOf(dueAt: string): number | null {
  const ms = Date.parse(dueAt);
  return inDueWindow(ms) ? ms : null;
}

export interface DueLabel {
  /** 周五 23:59 / Fri 11:59 PM, or 今天 / 明天 when near. */
  /** 周五 23:59 / Fri 11:59 PM；临近时为今天 / 明天。 */
  when: string;
  /** 还剩 5 小时 / 5 h left, or 逾期 2 天 / 2 days overdue. */
  /** 还剩 5 小时 / 5 h left，或逾期 2 天 / 2 days overdue。 */
  relative: string;
  overdue: boolean;
  /** Due within the next 48 hours and not overdue. */
  /** 在接下来 48 小时内截止且尚未逾期。 */
  dueSoon: boolean;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SOON_MS = 48 * HOUR_MS;

/** 今天 23:59, 明天 17:00, 周五 23:59 within the week ahead, otherwise 11月3日 周二 23:59; empty outside 2000-2100. */
/** 今天 23:59、明天 17:00；一周之内为周五 23:59，否则为 11月3日 周二 23:59；不在 2000-2100 年之间时为空。 */
export function dueWhen(dueMs: number, nowMs: number, locale: TimetableLocale): string {
  if (!inDueWindow(dueMs) || !inDueWindow(nowMs)) return '';
  const date = torontoDateOf(dueMs);
  const clock = formatClock(torontoMinuteOf(dueMs), locale);
  const days = daysBetween(torontoDateOf(nowMs), date);
  const en = locale === 'en';
  if (days === 0) return en ? `Today ${clock}` : `今天 ${clock}`;
  if (days === 1) return en ? `Tomorrow ${clock}` : `明天 ${clock}`;
  if (days === -1) return en ? `Yesterday ${clock}` : `昨天 ${clock}`;
  const weekday = weekdayShort(isoWeekday(date), locale);
  if (days > 1 && days < 7) return `${weekday} ${clock}`;
  return en ? `${weekday}, ${monthDay(date, 'en')}, ${clock}` : `${monthDay(date, 'zh')} ${weekday} ${clock}`;
}

/** 25 分钟 / 5 小时 / 2 天, rounded down, never less than one unit. */
/** 25 分钟 / 5 小时 / 2 天，向下取整，至少为一个单位。 */
export function spanText(ms: number, locale: TimetableLocale): string {
  const en = locale === 'en';
  if (ms < HOUR_MS) {
    const minutes = Math.max(1, Math.floor(ms / MINUTE_MS));
    return en ? `${minutes} min` : `${minutes} 分钟`;
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    return en ? `${hours} h` : `${hours} 小时`;
  }
  const days = Math.floor(ms / DAY_MS);
  return en ? `${days} ${days === 1 ? 'day' : 'days'}` : `${days} 天`;
}

export function formatDue(dueAt: string, nowMs: number, locale: TimetableLocale): DueLabel {
  const due = dueMsOf(dueAt);
  if (due === null) return { when: '', relative: '', overdue: false, dueSoon: false };
  const overdue = due < nowMs;
  const span = spanText(Math.abs(due - nowMs), locale);
  const relative = overdue ? (locale === 'en' ? `${span} overdue` : `逾期 ${span}`) : locale === 'en' ? `${span} left` : `还剩 ${span}`;
  return { when: dueWhen(due, nowMs, locale), relative, overdue, dueSoon: !overdue && due - nowMs <= SOON_MS };
}
