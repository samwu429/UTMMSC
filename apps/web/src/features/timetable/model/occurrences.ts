/**
 * Owner: T3, timetable web core. Classes per date, built on the shared occursOn so the screens agree with the
 * reminder scan. The meetings are indexed by weekday once, and each date costs one Toronto offset lookup: daylight
 * saving changes at 02:00, so the offset at noon holds for every time from 03:00 to midnight, which covers the
 * 09:00-21:00 window.
 * 维护者：T3，课表网页核心。按日期列出的课，基于共享的 occursOn，因此各页面与提醒扫描的结果一致。上课时间按星期几只建一次索引，
 * 每个日期只需查一次多伦多时差：夏令时在 02:00 切换，所以中午的时差适用于 03:00 到午夜的所有时刻，覆盖 09:00-21:00 的范围。
 */
import {
  addDays,
  courseTerm,
  indexSkips,
  instantAt,
  isoWeekday,
  isSkipped,
  occursOn,
  type SkipIndex,
  type TimetableCourse,
  type TimetableData,
  type TimetableMeeting,
  type TimetableOccurrence,
  type TimetableTerm,
  type Weekday,
} from '@utmmsc/shared';

const MINUTE_MS = 60_000;
const NOON_MIN = 720;
/** From this minute on, the noon offset is exact. */
/** 从这一分钟起，中午的时差是准确的。 */
const NOON_EXACT_FROM_MIN = 180;
const NO_SKIPS: SkipIndex = new Set();

export interface IndexedMeeting {
  course: TimetableCourse;
  meeting: TimetableMeeting;
  term: TimetableTerm | null;
}

export interface TimetableIndex {
  byWeekday: ReadonlyMap<Weekday, readonly IndexedMeeting[]>;
  skips: SkipIndex;
  terms: ReadonlyMap<string, TimetableTerm>;
}

/** Meetings by weekday; a course whose term is missing has no classes, as in the scan. */
/** 按星期几索引的上课时间；学期已不存在的课程没有课，与扫描一致。 */
export function indexTimetable(data: TimetableData): TimetableIndex {
  const terms = new Map(data.terms.map((term) => [term.id, term]));
  const byWeekday = new Map<Weekday, IndexedMeeting[]>();
  for (const course of data.courses) {
    const term = courseTerm(course, terms);
    if (term === undefined) continue;
    for (const meeting of course.meetings) {
      const entries = byWeekday.get(meeting.weekday) ?? [];
      entries.push({ course, meeting, term });
      byWeekday.set(meeting.weekday, entries);
    }
  }
  return { byWeekday, skips: indexSkips(data.skips), terms };
}

/** The instant of a minute of a date, given that date's noon. */
/** 已知某日中午的时刻，求该日某一分钟的时刻。 */
function minuteInstant(date: string, noonMs: number, minute: number): number {
  return minute >= NOON_EXACT_FROM_MIN ? noonMs + (minute - NOON_MIN) * MINUTE_MS : instantAt(date, minute);
}

export interface DayOccurrence extends TimetableOccurrence {
  /** A holiday or 本次不上 removed it; only returned when asked for. */
  /** 被假日或「本次不上」取消；只在要求时返回。 */
  skipped: boolean;
}

export function compareOccurrences(a: TimetableOccurrence, b: TimetableOccurrence): number {
  return a.startMs - b.startMs || a.endMs - b.endMs || (a.meeting.id < b.meeting.id ? -1 : a.meeting.id > b.meeting.id ? 1 : 0);
}

/**
 * Classes on one date, by start. With includeSkipped, classes removed by a holiday or a single skip come back
 * marked skipped; a skipped term week (reading week) never has classes.
 * 某一天的课，按开始时间排序。includeSkipped 为 true 时，被假日或单次停课取消的课也会返回并标记为已停课；
 * 学期中不上课的周（阅读周）从来没有课。
 */
export function occurrencesOn(index: TimetableIndex, date: string, includeSkipped = false): DayOccurrence[] {
  const entries = index.byWeekday.get(isoWeekday(date));
  if (!entries || entries.length === 0) return [];
  let noonMs: number | null = null;
  const out: DayOccurrence[] = [];
  for (const { course, meeting, term } of entries) {
    if (!occursOn(meeting, term, NO_SKIPS, date)) continue;
    const skipped = isSkipped(index.skips, meeting.id, date);
    if (skipped && !includeSkipped) continue;
    noonMs ??= instantAt(date, NOON_MIN);
    out.push({ course, meeting, date, startMs: minuteInstant(date, noonMs, meeting.startMin), endMs: minuteInstant(date, noonMs, meeting.endMin), skipped });
  }
  return out.sort(compareOccurrences);
}

/**
 * The first date from `fromDate` on (at most `days` days) with a class that has not ended by `afterMs`, and those
 * classes. Null when there is none in that span.
 * 从 `fromDate` 起（最多 `days` 天）第一个有在 `afterMs` 之前尚未结束的课的日期，以及这些课。该范围内没有时为 null。
 */
export function firstDayWithClasses(index: TimetableIndex, fromDate: string, days: number, afterMs: number): DayOccurrence[] | null {
  if (index.byWeekday.size === 0) return null;
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(fromDate, offset);
    const classes = occurrencesOn(index, date).filter((occurrence) => occurrence.endMs > afterMs);
    if (classes.length > 0) return classes;
  }
  return null;
}
