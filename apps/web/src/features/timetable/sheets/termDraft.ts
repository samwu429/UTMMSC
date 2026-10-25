/**
 * Owner: T3, timetable web core. The models of the term sheet and the holidays sheet: a new term's name and dates
 * from the calendar, 复制到新学期 (every course copied with new ids, week rules back to 每周), the checks that
 * mirror readTerm, and holiday ranges expanded into single dates.
 * 维护者：T3，课表网页核心。学期表单和假日表单的模型：根据日历给出新学期的名称和日期；「复制到新学期」（每门课以新 id 复制，周次恢复为每周）；
 * 与 readTerm 一致的检查；以及把假日的日期范围展开为单个日期。
 */
import {
  addDays,
  daysBetween,
  isTimetableDate,
  mondayOf,
  termWeekCount,
  TIMETABLE_LIMITS,
  type SaveCourseBody,
  type SaveTermBody,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableSkip,
  type TimetableTerm,
} from '@utmmsc/shared';

/** A term lasts 13 weeks unless changed: UTM's 12 teaching weeks plus reading week. */
/** 学期默认 13 周：UTM 的 12 个教学周加上阅读周。 */
export const DEFAULT_TERM_WEEKS = 13;

type Season = 'fall' | 'winter' | 'summer';

function seasonOf(month: number): Season {
  if (month >= 9) return 'fall';
  if (month >= 5) return 'summer';
  return 'winter';
}

function seasonName(year: number, season: Season, locale: TimetableLocale): string {
  if (locale === 'en') return `${season === 'fall' ? 'Fall' : season === 'winter' ? 'Winter' : 'Summer'} ${year}`;
  return `${year} ${season === 'fall' ? '秋季' : season === 'winter' ? '冬季' : '夏季'}`;
}

/** 2026 秋季 from September, 2027 冬季 from January, 2027 夏季 from May. */
/** 9 月起为 2026 秋季，1 月起为 2027 冬季，5 月起为 2027 夏季。 */
export function defaultTermName(date: string, locale: TimetableLocale): string {
  const year = Number(date.slice(0, 4));
  return seasonName(year, seasonOf(Number(date.slice(5, 7))), locale);
}

/** A new term: named from today's month, starting Monday of this week, 13 weeks long. */
/** 新学期：按本月命名，从本周一开始，共 13 周。 */
export function newTermDraft(id: string, today: string, locale: TimetableLocale): SaveTermBody {
  const startsOn = mondayOf(today);
  return { id, name: defaultTermName(today, locale), startsOn, endsOn: addDays(startsOn, DEFAULT_TERM_WEEKS * 7 - 1), skipWeeks: [] };
}

/** The end that keeps the default length after the start moved. */
/** 开始日期改变后，保持默认长度的结束日期。 */
export function defaultEnd(startsOn: string): string {
  return addDays(startsOn, DEFAULT_TERM_WEEKS * 7 - 1);
}

/**
 * 复制到新学期: the term after `source` (fall, then winter, then summer), starting the Monday after it ends.
 * 「复制到新学期」：`source` 之后的学期（秋季之后为冬季，再之后为夏季），从它结束后的周一开始。
 */
export function nextTermDraft(id: string, source: Pick<TimetableTerm, 'endsOn'>, locale: TimetableLocale): SaveTermBody {
  const startsOn = addDays(mondayOf(source.endsOn), 7);
  const month = Number(source.endsOn.slice(5, 7));
  const year = Number(source.endsOn.slice(0, 4));
  const season = seasonOf(month);
  const next: Season = season === 'fall' ? 'winter' : season === 'winter' ? 'summer' : 'fall';
  const nextYear = season === 'fall' ? year + 1 : year;
  return { id, name: seasonName(nextYear, next, locale), startsOn, endsOn: defaultEnd(startsOn), skipWeeks: [] };
}

/** Copies of a term's courses for another term: new ids, every meeting back to 每周. */
/** 某学期课程在另一学期的副本：新的 id，所有上课时间恢复为每周。 */
export function copyCourses(courses: readonly TimetableCourse[], fromTermId: string, toTermId: string, newCourseId: () => string, newMeetingId: () => string): SaveCourseBody[] {
  return courses
    .filter((course) => course.termId === fromTermId)
    .map((course) => ({
      id: newCourseId(),
      termId: toTermId,
      code: course.code,
      title: course.title,
      color: course.color,
      notes: course.notes,
      remind: course.remind,
      meetings: course.meetings.map((meeting) => ({ ...meeting, id: newMeetingId(), weekRule: 'all' as const, weekList: null })),
    }));
}

export type TermProblem = 'name' | 'dates' | 'too_long' | 'too_many';

/** What keeps a term from saving, mirroring readTerm and the 6-term limit. */
/** 阻止学期保存的问题，与 readTerm 及 6 个学期的上限一致。 */
export function termProblem(draft: SaveTermBody, terms: readonly Pick<TimetableTerm, 'id'>[]): TermProblem | null {
  if (draft.name.trim() === '') return 'name';
  if (!isTimetableDate(draft.startsOn) || !isTimetableDate(draft.endsOn) || draft.startsOn > draft.endsOn) return 'dates';
  if (termWeekCount(draft) > TIMETABLE_LIMITS.termWeeks) return 'too_long';
  if (!terms.some((term) => term.id === draft.id) && terms.length >= TIMETABLE_LIMITS.terms) return 'too_many';
  return null;
}

/** Reading-week chips: weeks 1 to the term's length; skip weeks past a shortened term are dropped. */
/** 阅读周选项：第 1 周到学期的周数；学期缩短后超出的停课周会被去掉。 */
export function termWeeks(draft: Pick<SaveTermBody, 'startsOn' | 'endsOn'>): number[] {
  if (!isTimetableDate(draft.startsOn) || !isTimetableDate(draft.endsOn) || draft.startsOn > draft.endsOn) return [];
  const count = Math.min(TIMETABLE_LIMITS.termWeeks, termWeekCount(draft));
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function keepSkipWeeks(draft: SaveTermBody): SaveTermBody {
  const weeks = new Set(termWeeks(draft));
  return { ...draft, skipWeeks: draft.skipWeeks.filter((week) => weeks.has(week)) };
}

/** How many courses deleting the term also deletes (将同时删除 6 门课程). */
/** 删除学期时会一并删除的课程数（将同时删除 6 门课程）。 */
export function coursesInTerm(courses: readonly Pick<TimetableCourse, 'termId'>[], termId: string): number {
  return courses.filter((course) => course.termId === termId).length;
}

/**
 * The dates of a holiday range, both ends included, leaving out dates already marked and stopping at `room`
 * dates, so the 200-skip limit holds. Null when the range is not a valid one.
 * 假日范围内的日期（含两端），去掉已经标记的日期，并在 `room` 个日期处停止，以保证不超过 200 个停课的上限。范围无效时为 null。
 */
export function holidayDates(from: string, to: string, existing: readonly Pick<TimetableSkip, 'onDate' | 'meetingId'>[], room: number): string[] | null {
  if (!isTimetableDate(from) || !isTimetableDate(to || from)) return null;
  const end = to || from;
  if (end < from || daysBetween(from, end) > 366) return null;
  const taken = new Set(existing.filter((skip) => skip.meetingId === null).map((skip) => skip.onDate));
  const out: string[] = [];
  for (let date = from; date <= end && out.length < room; date = addDays(date, 1)) if (!taken.has(date)) out.push(date);
  return out;
}

/** Room left under the 200-skip limit. */
/** 距 200 个停课上限还剩的数量。 */
export function skipRoom(skips: readonly unknown[]): number {
  return Math.max(0, TIMETABLE_LIMITS.skips - skips.length);
}
