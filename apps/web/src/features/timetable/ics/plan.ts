/**
 * Owner: T4, timetable import and export. Turns the events of a calendar file into a preview of what 导入日历文件
 * would add: weekly events become courses (grouped by the course code in their summary, one meeting per BYDAY
 * day), their date range suggests a term, and EXDATEs become skips; one-off events are offered as assignments.
 * Then the member's choices become one POST /import body.
 * 维护者：T4，课表导入导出。把日历文件中的事件变成「导入日历文件」将要添加内容的预览：每周重复的事件变成课程（按摘要中的课程代码分组，
 * BYDAY 中每一天一个上课时间），其日期范围用来建议学期，EXDATE 变成停课；单次事件作为作业供选择。之后把成员的选择组成一次 POST /import 的请求体。
 */
import {
  ASSIGNMENT_OFFSETS,
  ASSIGNMENT_OFFSETS_MAX,
  COURSE_COLORS,
  TIMETABLE_DAY_END_MIN,
  TIMETABLE_DAY_START_MIN,
  TIMETABLE_LAST_START_MIN,
  TIMETABLE_LIMITS,
  TIMETABLE_MEETING_MIN_MIN,
  WEEK_RULES,
  addDays,
  cleanTimetableLine,
  cleanTimetableNotes,
  daysBetween,
  instantAt,
  isoWeekday,
  meetingTimeProblem,
  mondayOf,
  normalizeCourseCode,
  occursOn,
  shortCode,
  termContains,
  termWeekCount,
  torontoDateOf,
  weekOfTerm,
  type AssignmentOffset,
  type CourseColor,
  type ImportTimetableBody,
  type MeetingKind,
  type SaveCourseBody,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableIdPrefix,
  type TimetableLocale,
  type TimetableMeeting,
  type TimetableSettings,
  type TimetableSkip,
  type TimetableTerm,
  type WeekRule,
  type Weekday,
} from '@utmmsc/shared';
import { firstWeekdayFrom } from './build';
import { icsInstant, torontoWallTime, type IcsDateTime } from './ics';
import type { IcsCalendar, IcsEvent } from './parse';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Weeks a repeating event is unrolled before it counts as never ending. */
/** 重复事件展开的最多周数，超过后视为没有结束。 */
const MAX_UNROLL_WEEKS = 120;
/** Ranges that overlap by this share of the longer one are one term; a Fall course and a Y course stay apart. */
/** 重叠部分达到较长者这一比例的日期范围算作同一学期；秋季课程和全年课程因此分开。 */
const SAME_TERM_OVERLAP = 0.6;
/** An existing term is reused when the classes start and end within this many days of it. */
/** 课程的开始和结束都在已有学期的这么多天之内时，沿用这个学期。 */
const TERM_MATCH_DAYS = 14;
/** One-off events this far in the future at most, as the API allows. */
/** 单次事件最晚到这么远的将来，与接口限制一致。 */
const DUE_FUTURE_MS = 400 * DAY_MS;
const DAY_INDEX: Readonly<Record<string, Weekday>> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

export interface ImportContext {
  /** What the member already has. */
  /** 成员已有的内容。 */
  terms: readonly TimetableTerm[];
  courses: readonly TimetableCourse[];
  skips: readonly TimetableSkip[];
  assignments: readonly TimetableAssignment[];
  settings: Pick<TimetableSettings, 'assignmentOffsets'>;
  nowMs: number;
  locale: TimetableLocale;
  newId: (prefix: TimetableIdPrefix) => string;
}

export interface ImportTermDraft {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  skipWeeks: number[];
}

export type MeetingTimeProblem = 'invalid_meeting_time' | 'meeting_too_short';

export interface ImportMeetingDraft {
  id: string;
  weekday: Weekday;
  /** As in the file, in Toronto time; may lie outside 09:00-21:00 or off the 5-minute steps. */
  /** 文件中的时间（多伦多时间）；可能不在 09:00-21:00 之间或不在 5 分钟刻度上。 */
  startMin: number;
  endMin: number;
  problem: MeetingTimeProblem | null;
  /** The nearest allowed time, offered when the file's time must be fixed. */
  /** 最接近的允许时间；文件中的时间需要修改时提供。 */
  suggestedStart: number;
  suggestedEnd: number;
  kind: MeetingKind;
  section: string | null;
  location: string | null;
  weekRule: WeekRule;
  weekList: number[] | null;
  /** Dates this meeting does not take place although its rule says so, imported as single skips. */
  /** 按规则本应上课但不上的日期，作为单次停课导入。 */
  skipDates: string[];
}

export interface ImportCourseDraft {
  id: string;
  code: string;
  title: string | null;
  notes: string | null;
  color: CourseColor;
  remind: boolean;
  /** An existing term's id, a new term's id from `terms`, or null for every week with no end. */
  /** 已有学期的 id、`terms` 中新学期的 id，或 null 表示每周重复、没有结束。 */
  termId: string | null;
  meetings: ImportMeetingDraft[];
  /** The code of a course already in the same term, so the preview leaves this one unticked. */
  /** 同一学期中已存在的课程代码，预览因此默认不勾选这门课。 */
  duplicateOf: string | null;
  /**
   * The summary held a course code, or the event came from this app's export. Other weekly events (a gym slot, a
   * club meeting) are still offered, unticked.
   * 摘要中有课程代码，或事件来自本 App 的导出。其他每周事件（健身、社团例会）仍会列出，但默认不勾选。
   */
  recognized: boolean;
}

export interface ImportAssignmentDraft {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string;
  /** A course of this import or an existing one; null when none matched. */
  /** 本次导入或已有的课程；没有匹配时为 null。 */
  courseId: string | null;
  /** The short code the event named, used when its course is left out of the import. */
  /** 事件中提到的课程简码；其课程未被导入时用它重新匹配。 */
  courseCode: string | null;
  remindOffsets: AssignmentOffset[];
  /** Written by this app's export, so it is ticked by default. */
  /** 来自本 App 的导出，因此默认勾选。 */
  fromApp: boolean;
  /** An open assignment with the same title and deadline already exists. */
  /** 已有标题和截止时间都相同的未完成作业。 */
  duplicate: boolean;
}

export interface ImportPlan {
  /** New terms only; courses may also point at existing ones. */
  /** 仅新学期；课程也可能指向已有学期。 */
  terms: ImportTermDraft[];
  courses: ImportCourseDraft[];
  assignments: ImportAssignmentDraft[];
  /** Events that cannot become classes or assignments, by reason. */
  /** 无法变成课程或作业的事件，按原因计数。 */
  ignored: { repeating: number; allDay: number; noEnd: number; past: number };
}

/* Reading one event */
/* 读取一个事件 */

/** One weekday of one weekly event, in Toronto time. */
/** 某个每周重复事件中的一天，按多伦多时间。 */
interface Series {
  event: IcsEvent;
  weekday: Weekday;
  startMin: number;
  endMin: number;
  /** The generated dates on this weekday, before EXDATEs; null when it repeats with no end. */
  /** 这一天生成的日期（排除 EXDATE 之前）；没有结束时为 null。 */
  dates: string[] | null;
  first: string;
  interval: number;
  excluded: Set<string>;
}

function shiftWeekday(day: Weekday, shift: number): Weekday {
  return ((((day - 1 + shift) % 7) + 7) % 7 + 1) as Weekday;
}

function toDate(value: IcsDateTime, zones: ReadonlyMap<string, string>): string | null {
  if (value.minute === null) return value.date;
  return torontoWallTime(value, zones)?.date ?? null;
}

type SeriesResult = { ok: true; series: Series[] } | { ok: false; reason: 'repeating' | 'allDay' | 'noEnd' | 'empty' };

function seriesOf(event: IcsEvent, zones: ReadonlyMap<string, string>, moved: ReadonlySet<string>): SeriesResult {
  const rule = event.rule;
  if (!rule || rule.freq !== 'WEEKLY') return { ok: false, reason: 'repeating' };
  const start = torontoWallTime(event.start, zones);
  const startMs = icsInstant(event.start, zones);
  if (!start || startMs === null) return { ok: false, reason: 'allDay' };
  const endMs = event.end ? icsInstant(event.end, zones) : event.durationMs !== null ? startMs + event.durationMs : startMs;
  const length = endMs === null ? 0 : Math.round((endMs - startMs) / MINUTE_MS);
  const endMin = start.minute + length;
  // BYDAY names days in the event's own zone; a Z time at 00:30 on Wednesday is a Tuesday class in Toronto.
  // BYDAY 按事件自己的时区写星期；周三 00:30 的 Z 时间在多伦多是周二的课。
  const shift = daysBetween(event.start.date, start.date);
  const days = (rule.byDay.length ? rule.byDay.map((code) => DAY_INDEX[code]).filter((day): day is Weekday => day !== undefined).map((day) => shiftWeekday(day, shift)) : [isoWeekday(start.date)]).sort(
    (a, b) => a - b,
  );
  const untilDate = rule.until && rule.until.minute === null ? addDays(rule.until.date, shift) : null;
  const untilMs = rule.until && rule.until.minute !== null ? icsInstant(rule.until, zones) : null;
  const bounded = rule.until !== null || rule.count !== null;
  if (!bounded && rule.interval !== 1) return { ok: false, reason: 'noEnd' };

  const excluded = new Set<string>(moved);
  for (const value of event.exdates) {
    const date = toDate(value, zones);
    if (date) excluded.add(date);
  }

  const byDay = new Map<Weekday, string[]>(days.map((day) => [day, []]));
  let endless = !bounded;
  if (bounded) {
    let count = 0;
    let stopped = false;
    const monday = mondayOf(start.date);
    for (let week = 0; week < MAX_UNROLL_WEEKS && !stopped; week += rule.interval) {
      for (const day of days) {
        const date = addDays(monday, week * 7 + day - 1);
        if (date < start.date) continue;
        if ((untilDate !== null && date > untilDate) || (untilMs !== null && instantAt(date, start.minute) > untilMs)) {
          stopped = true;
          break;
        }
        byDay.get(day)?.push(date);
        count += 1;
        if (rule.count !== null && count >= rule.count) {
          stopped = true;
          break;
        }
      }
    }
    // Still going after MAX_UNROLL_WEEKS: treat it as never ending, which only a weekly rule can say.
    // 展开 MAX_UNROLL_WEEKS 周后仍未结束：视为没有结束，只有每周一次的规则能这样表示。
    if (!stopped) {
      if (rule.interval !== 1) return { ok: false, reason: 'noEnd' };
      endless = true;
    }
  }

  const series: Series[] = [];
  for (const day of days) {
    const dates = byDay.get(day) ?? [];
    if (!endless && dates.length === 0) continue;
    series.push({
      event,
      weekday: day,
      startMin: start.minute,
      endMin,
      dates: endless ? null : dates,
      first: endless ? firstWeekdayFrom(start.date, day) : (dates[0] ?? start.date),
      interval: rule.interval,
      excluded,
    });
  }
  return series.length ? { ok: true, series } : { ok: false, reason: 'empty' };
}

/* What a summary says */
/* 摘要中的信息 */

// No lookbehind: Safari before 16.4 cannot parse it, and this chunk must load there.
// 不使用后行断言：16.4 之前的 Safari 无法解析，而这个代码块必须能在那里加载。
const CODE_IN_TEXT = /(^|[^A-Za-z0-9])([A-Za-z]{3}[A-Da-d0-9]\d{2})(?:\s?([HYhy]\d)(?:\s?([FSYfsy]))?)?(?![A-Za-z0-9])/;
const SECTION_IN_TEXT = /(^|[^A-Za-z0-9])(LEC|TUT|PRA|LAB|SEM)\s?(\d{4})(?![A-Za-z0-9])/i;
const KIND_WORDS: readonly [MeetingKind, RegExp][] = [
  ['tut', /tutorial|\btut\b|辅导|习题课/i],
  ['pra', /practical|\bpra\b|实践/i],
  ['lab', /\blab\b|laboratory|实验/i],
  ['sem', /seminar|\bsem\b|研讨/i],
  ['lec', /lecture|\blec\b|讲座|讲课/i],
];

interface CodeMatch {
  /** MAT102H5F, written without spaces and upper case. */
  /** MAT102H5F，不含空格、大写。 */
  code: string;
  /** The summary with the code taken out. */
  /** 去掉课程代码后的摘要。 */
  rest: string;
}

/** The UofT course code in a summary, such as MAT102H5 F or csc108. */
/** 摘要中的多伦多大学课程代码，例如 MAT102H5 F 或 csc108。 */
export function findCourseCode(text: string): CodeMatch | null {
  const match = CODE_IN_TEXT.exec(text);
  if (!match) return null;
  const [whole, lead = '', base = '', weight = '', session = ''] = match;
  const code = `${base}${weight}${session}`.toUpperCase();
  const at = match.index + lead.length;
  return { code, rest: `${text.slice(0, at)} ${text.slice(match.index + whole.length)}` };
}

function tidy(text: string): string {
  return cleanTimetableLine(text.replace(/[[\](){}（）【】]/g, ' '))
    .replace(/^[\s\-–—·|:：,，/]+|[\s\-–—·|:：,，/]+$/g, '')
    .trim();
}

interface Identity {
  /** Groups events of one course. */
  /** 用于把同一门课的事件归为一组。 */
  key: string;
  code: string;
  title: string | null;
  notes: string | null;
  kind: MeetingKind;
  section: string | null;
  color: CourseColor | null;
  remind: boolean;
}

function cap(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('').trim();
}

function readKind(value: string | undefined): MeetingKind | null {
  return value && (['lec', 'tut', 'pra', 'lab', 'sem', 'other'] as const).includes(value as MeetingKind) ? (value as MeetingKind) : null;
}

function identify(event: IcsEvent, fallbackCode: string): Identity {
  const x = event.extras;
  if (x.ITEM === 'class' && x.CODE) {
    const title = x.TITLE ? cap(x.TITLE, TIMETABLE_LIMITS.title) : null;
    // The export writes the title, a blank line and the notes into DESCRIPTION.
    // 导出时 DESCRIPTION 中依次是标题、空行和备注。
    let notes = event.description;
    if (title && notes.startsWith(title)) notes = notes.slice(title.length).replace(/^\n+/, '');
    const color = (COURSE_COLORS as readonly string[]).includes(x.COLOR ?? '') ? (x.COLOR as CourseColor) : null;
    return {
      key: `app:${x.COURSE ?? x.CODE}`,
      code: normalizeCourseCode(x.CODE),
      title,
      notes: notes ? cap(cleanTimetableNotes(notes), TIMETABLE_LIMITS.notes) || null : null,
      kind: readKind(x.KIND) ?? 'lec',
      section: x.SECTION ? cap(cleanTimetableLine(x.SECTION), TIMETABLE_LIMITS.section) || null : null,
      color,
      remind: x.REMIND !== '0',
    };
  }
  let rest = event.summary;
  let section: string | null = null;
  let kind: MeetingKind | null = null;
  const sectionMatch = SECTION_IN_TEXT.exec(rest);
  if (sectionMatch) {
    const [whole, lead = '', word = '', digits = ''] = sectionMatch;
    section = `${word.toUpperCase()}${digits}`;
    kind = readKind(word.toLowerCase());
    rest = `${rest.slice(0, sectionMatch.index + lead.length)} ${rest.slice(sectionMatch.index + whole.length)}`;
  }
  const found = findCourseCode(rest);
  if (found) rest = found.rest;
  for (const [word, pattern] of KIND_WORDS) {
    if (!pattern.test(rest)) continue;
    kind ??= word;
    rest = rest.replace(pattern, ' ');
    break;
  }
  const leftover = tidy(rest);
  if (found) {
    // MAT102H5 LEC0101 and MAT102 Tutorial are one course, so events group by the short code.
    // MAT102H5 LEC0101 和 MAT102 Tutorial 是同一门课，所以事件按简码分组。
    return {
      key: `code:${shortCode(found.code)}`,
      code: found.code,
      title: leftover ? cap(leftover, TIMETABLE_LIMITS.title) : null,
      notes: null,
      kind: kind ?? 'lec',
      section,
      color: null,
      remind: true,
    };
  }
  // No course code: the summary itself names the course (Choir, Gym...).
  // 没有课程代码：摘要本身就是课程名称（例如合唱团、健身）。
  const summary = tidy(event.summary) || fallbackCode;
  return {
    key: `text:${summary.toLowerCase()}`,
    code: cap(normalizeCourseCode(summary), TIMETABLE_LIMITS.code) || fallbackCode,
    title: cap(summary, TIMETABLE_LIMITS.title),
    notes: null,
    kind: kind ?? 'other',
    section,
    color: null,
    remind: true,
  };
}

/* Terms */
/* 学期 */

interface Span {
  start: string;
  end: string;
  /** From this app's export: the term exactly as it was. */
  /** 来自本 App 的导出：与原来完全相同的学期。 */
  exact: { name: string; skipWeeks: number[] } | null;
  members: Series[];
}

function spanLength(start: string, end: string): number {
  return daysBetween(start, end) + 1;
}

function overlapShare(a: { start: string; end: string }, b: { start: string; end: string }): number {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  if (start > end) return 0;
  return spanLength(start, end) / Math.max(spanLength(a.start, a.end), spanLength(b.start, b.end));
}

function readAppTerm(event: IcsEvent): { startsOn: string; endsOn: string; name: string; skipWeeks: number[] } | null {
  const dates = /^(\d{4})(\d{2})(\d{2})\/(\d{4})(\d{2})(\d{2})$/.exec(event.extras['TERM-DATES'] ?? '');
  if (!dates) return null;
  const startsOn = `${dates[1]}-${dates[2]}-${dates[3]}`;
  const endsOn = `${dates[4]}-${dates[5]}-${dates[6]}`;
  if (startsOn > endsOn || termWeekCount({ startsOn, endsOn }) > TIMETABLE_LIMITS.termWeeks) return null;
  const weeks = termWeekCount({ startsOn, endsOn });
  const skipWeeks = [...new Set((event.extras['TERM-SKIP'] ?? '').split(/\s+/).map(Number))].filter((week) => Number.isInteger(week) && week >= 1 && week <= weeks).sort((a, b) => a - b);
  return { startsOn, endsOn, name: event.extras.TERM ?? '', skipWeeks };
}

/** 2026 秋季 / Fall 2026, from the month the classes start; a span longer than half a year is a full year. */
/** 按开课月份得到「2026 秋季」/「Fall 2026」；超过半年的范围为全年。 */
export function suggestTermName(startsOn: string, endsOn: string, locale: TimetableLocale): string {
  const year = Number(startsOn.slice(0, 4));
  const month = Number(startsOn.slice(5, 7));
  if (daysBetween(startsOn, endsOn) > 26 * 7) return locale === 'en' ? `${year}–${year + 1} full year` : `${year}–${year + 1} 全年`;
  if (month <= 4) return locale === 'en' ? `Winter ${year}` : `${year} 冬季`;
  if (month <= 8) return locale === 'en' ? `Summer ${year}` : `${year} 夏季`;
  return locale === 'en' ? `Fall ${year}` : `${year} 秋季`;
}

function clusterSpans(series: readonly Series[]): Span[] {
  const spans: Span[] = [];
  const sorted = [...series].sort((a, b) => (a.dates?.[0] ?? '').localeCompare(b.dates?.[0] ?? ''));
  for (const item of sorted) {
    const dates = item.dates ?? [];
    const start = dates[0];
    const end = dates[dates.length - 1];
    if (!start || !end) continue;
    const app = readAppTerm(item.event);
    if (app) {
      let span = spans.find((s) => s.exact && s.start === app.startsOn && s.end === app.endsOn && s.exact.name === app.name);
      if (!span) {
        span = { start: app.startsOn, end: app.endsOn, exact: { name: app.name, skipWeeks: app.skipWeeks }, members: [] };
        spans.push(span);
      }
      span.members.push(item);
      continue;
    }
    const own = { start, end };
    const span = spans.find((s) => {
      if (s.exact || overlapShare(s, own) < SAME_TERM_OVERLAP) return false;
      const merged = { startsOn: s.start < start ? s.start : start, endsOn: s.end > end ? s.end : end };
      return termWeekCount(merged) <= TIMETABLE_LIMITS.termWeeks;
    });
    if (span) {
      if (start < span.start) span.start = start;
      if (end > span.end) span.end = end;
      span.members.push(item);
    } else {
      spans.push({ start, end, exact: null, members: [item] });
    }
  }
  return spans;
}

/** The existing term these classes belong to: every class inside it, starting and ending near its dates. */
/** 这些课所属的已有学期：所有课都在学期之内，且开始和结束时间都接近学期日期。 */
function matchExistingTerm(span: Span, terms: readonly TimetableTerm[]): TimetableTerm | null {
  let best: TimetableTerm | null = null;
  for (const term of terms) {
    const fits = span.exact
      ? term.startsOn === span.start && term.endsOn === span.end
      : span.members.every((item) => (item.dates ?? []).every((date) => termContains(term, date))) &&
        Math.abs(daysBetween(term.startsOn, span.start)) <= TERM_MATCH_DAYS &&
        Math.abs(daysBetween(term.endsOn, span.end)) <= TERM_MATCH_DAYS;
    if (fits && (!best || daysBetween(term.startsOn, term.endsOn) < daysBetween(best.startsOn, best.endsOn))) best = term;
  }
  return best;
}

/* Week rules and skips */
/* 周次规则与停课 */

/** A simple rule may add this many dates the file did not have, each a single skip, before a week list is used. */
/** 简单规则最多可以多出这么多文件中没有的日期（每个都成为单次停课），超过时改用周次列表。 */
const MAX_EXTRA_SKIPS = 2;

function readAppWeeks(value: string | undefined, termWeeks: number): { rule: WeekRule; list: number[] | null } | null {
  if (!value) return null;
  const [rule, ...rest] = value.trim().split(/\s+/);
  if (!rule || !(WEEK_RULES as readonly string[]).includes(rule)) return null;
  if (rule !== 'list') return { rule: rule as WeekRule, list: null };
  const list = [...new Set(rest.map(Number))].filter((week) => Number.isInteger(week) && week >= 1 && week <= Math.min(termWeeks, TIMETABLE_LIMITS.termWeeks)).sort((a, b) => a - b);
  return list.length ? { rule: 'list', list } : null;
}

const NO_SKIPS: ReadonlySet<string> = new Set();

/** The dates a rule gives inside the term, before single skips. */
/** 规则在学期内给出的日期（不计单次停课）。 */
function ruleDates(weekday: Weekday, rule: WeekRule, list: number[] | null, term: TimetableTerm): string[] {
  const out: string[] = [];
  const meeting = { id: '', weekday, weekRule: rule, weekList: list };
  for (let date = firstWeekdayFrom(term.startsOn, weekday); date <= term.endsOn; date = addDays(date, 7)) {
    if (occursOn(meeting, term, NO_SKIPS, date)) out.push(date);
  }
  return out;
}

/**
 * The rule of a series in a term: the one in the file from this app's export, else the simplest of every week, odd
 * weeks or even weeks that holds every generated class and adds at most MAX_EXTRA_SKIPS more (a series that starts a
 * week after the term, for example; those become single skips), else the list of its weeks. Skips are then the
 * rule's dates that do not take place.
 * 某一系列在学期中的规则：来自本 App 导出的文件直接使用其中的规则；否则在每周、单周、双周中取最简单的一个，它要包含所有生成的课，
 * 且最多多出 MAX_EXTRA_SKIPS 节（例如比学期晚一周开始的系列；多出的成为单次停课）；都不行时使用周次列表。停课即规则给出、但实际不上课的日期。
 */
function placeInTerm(item: Series, term: TimetableTerm): { rule: WeekRule; list: number[] | null; skipDates: string[] } | null {
  const generated = (item.dates ?? []).filter((date) => termContains(term, date));
  if (!generated.length) return null;
  const weeks = termWeekCount(term);
  let chosen = readAppWeeks(item.event.extras.WEEKS, weeks);
  if (!chosen) {
    const generatedSet = new Set(generated);
    const anyWeek = { ...term, skipWeeks: [] };
    let best: { rule: WeekRule; extra: number } | null = null;
    for (const rule of ['all', 'odd', 'even'] as const) {
      const covering = new Set(ruleDates(item.weekday, rule, null, anyWeek));
      if (!generated.every((date) => covering.has(date))) continue;
      const extra = ruleDates(item.weekday, rule, null, term).filter((date) => !generatedSet.has(date)).length;
      if (extra <= MAX_EXTRA_SKIPS && (!best || extra < best.extra)) best = { rule, extra };
    }
    if (best) {
      chosen = { rule: best.rule, list: null };
    } else {
      // The term's own skip weeks have no class anyway, so they stay out of the list.
      // 学期自己的停课周本来就没有课，所以不放进列表。
      const list = [...new Set(generated.map((date) => weekOfTerm(term, date)))].filter((week) => !term.skipWeeks.includes(week)).sort((a, b) => a - b);
      if (!list.length) return null;
      chosen = { rule: 'list', list };
    }
  }
  const held = new Set(generated.filter((date) => !item.excluded.has(date)));
  const skipDates = ruleDates(item.weekday, chosen.rule, chosen.list, term).filter((date) => !held.has(date));
  return { rule: chosen.rule, list: chosen.list, skipDates };
}

/**
 * Weeks of a new term in which every class of the file is cancelled, at least two of them: reading week. They
 * become the term's skip weeks instead of a pile of single skips.
 * 新学期中文件里所有课都取消的周（至少两节课）：即阅读周。它们成为学期的停课周，而不是一堆单次停课。
 */
function detectSkipWeeks(span: Span, startsOn: string, endsOn: string): number[] {
  const term = { startsOn, endsOn };
  const perWeek = new Map<number, { total: number; cancelled: number }>();
  for (const item of span.members) {
    for (const date of item.dates ?? []) {
      if (!termContains(term, date)) continue;
      const week = weekOfTerm(term, date);
      const entry = perWeek.get(week) ?? { total: 0, cancelled: 0 };
      entry.total += 1;
      if (item.excluded.has(date)) entry.cancelled += 1;
      perWeek.set(week, entry);
    }
  }
  return [...perWeek]
    .filter(([, entry]) => entry.total >= 2 && entry.cancelled === entry.total)
    .map(([week]) => week)
    .sort((a, b) => a - b);
}

/* Meeting times */
/* 上课时间 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The nearest allowed start and end: inside 09:00-21:00, on 5-minute steps, at least 10 minutes. */
/** 最接近的允许开始和结束时间：在 09:00-21:00 之内，按 5 分钟，至少 10 分钟。 */
export function suggestMeetingTime(startMin: number, endMin: number): { start: number; end: number } {
  const start = clamp(Math.round(startMin / 5) * 5, TIMETABLE_DAY_START_MIN, TIMETABLE_LAST_START_MIN);
  const wanted = endMin > startMin ? Math.round(endMin / 5) * 5 : start + 60;
  const end = clamp(wanted, start + TIMETABLE_MEETING_MIN_MIN, TIMETABLE_DAY_END_MIN);
  return { start, end };
}

/* The plan */
/* 导入计划 */

function nextColor(used: Set<CourseColor>, index: number): CourseColor {
  const free = COURSE_COLORS.find((color) => !used.has(color));
  const color = free ?? COURSE_COLORS[index % COURSE_COLORS.length] ?? 'purple';
  used.add(color);
  return color;
}

function readOffsets(value: string): AssignmentOffset[] {
  const wanted = new Set(value.split(/\s+/));
  return ASSIGNMENT_OFFSETS.filter((token) => wanted.has(token)).slice(0, ASSIGNMENT_OFFSETS_MAX);
}

/** "due", "deadline" and 截止 say nothing an assignment does not already say. */
/** 「due」「deadline」和「截止」对作业来说是多余的。 */
const DUE_WORDS = /(^|\s)(?:due|deadline|截止)(?=\s|$)/gi;

/** Assignment title from a summary: this app's own title, or the summary with a bracketed course code removed. */
/** 摘要中的作业标题：本 App 自己的标题，或去掉方括号中课程代码后的摘要。 */
function assignmentTitle(event: IcsEvent): { title: string; code: string | null } {
  if (event.extras.ITEM === 'assignment' && event.extras.TITLE) {
    return { title: cap(cleanTimetableLine(event.extras.TITLE), TIMETABLE_LIMITS.assignmentTitle), code: null };
  }
  const found = findCourseCode(event.summary);
  // "PS3 [MAT102H5 F LEC0101]" from Quercus: the bracket goes, the rest is the title.
  // Quercus 的「PS3 [MAT102H5 F LEC0101]」：去掉方括号部分，其余是标题。
  const withoutBracket = event.summary.replace(/\s*[[【(（][^\]】)）]*[A-Za-z]{3}[A-Da-d0-9]\d{2}[^\]】)）]*[\]】)）]\s*/, ' ');
  // "MAT102 PS3" or "PS3 due MAT102": the code goes as well, since the course is shown beside the title.
  // 「MAT102 PS3」或「PS3 due MAT102」：课程代码也去掉，因为课程会显示在标题旁边。
  const withoutCode = (findCourseCode(withoutBracket)?.rest ?? withoutBracket).replace(DUE_WORDS, ' ');
  const title = tidy(withoutCode) || tidy(withoutBracket) || tidy(event.summary);
  return { title: cap(title, TIMETABLE_LIMITS.assignmentTitle), code: found ? shortCode(found.code) : null };
}

/**
 * The preview of an import. Pure: ids come from context.newId, the time from context.nowMs.
 * 导入的预览。纯函数：id 来自 context.newId，时间来自 context.nowMs。
 */
export function planImport(calendar: IcsCalendar, context: ImportContext): ImportPlan {
  const ignored = { repeating: 0, allDay: 0, noEnd: 0, past: 0 };
  const live = calendar.events.filter((event) => event.status !== 'CANCELLED');

  // A replaced occurrence (RECURRENCE-ID) no longer happens at its original date.
  // 被替换的那一次（RECURRENCE-ID）不再在原日期发生。
  const moved = new Map<string, Set<string>>();
  for (const event of calendar.events) {
    if (!event.recurrenceId || !event.uid) continue;
    const date = toDate(event.recurrenceId, calendar.zones);
    if (!date) continue;
    const dates = moved.get(event.uid) ?? new Set<string>();
    dates.add(date);
    moved.set(event.uid, dates);
  }

  const today = torontoDateOf(context.nowMs);
  const masters = live.filter((event) => !event.recurrenceId);
  const weekly: Series[] = [];
  const oneOff: IcsEvent[] = [];
  for (const event of masters) {
    if (event.unreadableRepeat) {
      ignored.repeating += 1;
      continue;
    }
    if (!event.rule) {
      oneOff.push(event);
      continue;
    }
    const result = seriesOf(event, calendar.zones, (event.uid && moved.get(event.uid)) || new Set());
    if (result.ok) {
      // A series whose last class is before today belongs to a term that is over; a full calendar export has many.
      // 最后一节课在今天之前的系列属于已结束的学期；完整的日历导出中这类事件很多。
      const current = result.series.filter((item) => item.dates === null || item.dates.some((date) => date >= today));
      if (current.length) weekly.push(...current);
      else ignored.past += 1;
    } else if (result.reason === 'repeating') ignored.repeating += 1;
    else if (result.reason === 'allDay') ignored.allDay += 1;
    else if (result.reason === 'noEnd') ignored.noEnd += 1;
  }

  // Terms: bounded series that fit in 40 weeks are clustered; the rest repeat every week with no term.
  // 学期：在 40 周以内结束的系列按日期聚类；其余的每周重复，不属于学期。
  const fitsTerm = (item: Series) => {
    const dates = item.dates;
    const first = dates?.[0];
    const last = dates?.[dates.length - 1];
    return Boolean(first && last && termWeekCount({ startsOn: first, endsOn: last }) <= TIMETABLE_LIMITS.termWeeks);
  };
  const termed = weekly.filter(fitsTerm);
  const open = weekly.filter((item) => !fitsTerm(item) && item.interval === 1);
  ignored.noEnd += weekly.filter((item) => !fitsTerm(item) && item.interval !== 1).length;

  const newTerms: ImportTermDraft[] = [];
  const termOf = new Map<Series, TimetableTerm>();
  for (const span of clusterSpans(termed)) {
    const existing = matchExistingTerm(span, context.terms);
    let term: TimetableTerm;
    if (existing) {
      term = existing;
    } else {
      const skipWeeks = span.exact ? span.exact.skipWeeks : detectSkipWeeks(span, span.start, span.end);
      const name = cap(cleanTimetableLine(span.exact?.name ?? ''), TIMETABLE_LIMITS.termName) || suggestTermName(span.start, span.end, context.locale);
      const draft: ImportTermDraft = { id: context.newId('tt'), name, startsOn: span.start, endsOn: span.end, skipWeeks };
      newTerms.push(draft);
      term = { ...draft, updatedAt: '' };
    }
    for (const item of span.members) termOf.set(item, term);
  }

  // Courses: one per course identity and term.
  // 课程：每个课程身份和学期组合一门。
  const fallbackCode = context.locale === 'en' ? 'COURSE' : '课程';
  const usedColors = new Set<CourseColor>(context.courses.map((course) => course.color));
  const groups = new Map<string, ImportCourseDraft>();
  const groupKeys = new Map<string, ImportCourseDraft[]>();
  const meetingKeys = new Map<ImportCourseDraft, Set<string>>();
  for (const item of [...termed, ...open].sort((a, b) => a.first.localeCompare(b.first) || a.weekday - b.weekday || a.startMin - b.startMin)) {
    const identity = identify(item.event, fallbackCode);
    const term = termOf.get(item) ?? null;
    let placed: { rule: WeekRule; list: number[] | null; skipDates: string[] } | null;
    if (term) {
      placed = placeInTerm(item, term);
    } else {
      // A course with no term repeats with no end, so only the days without class from today on matter.
      // 不属于学期的课程没有结束日期，因此只需要今天及以后的停课日。
      const skips = [...item.excluded].filter(
        (date) => date >= item.first && date >= today && isoWeekday(date) === item.weekday && (item.dates === null || item.dates.includes(date)),
      );
      placed = { rule: 'all', list: null, skipDates: skips.sort() };
    }
    if (!placed) continue;
    const key = `${identity.key}|${term?.id ?? '-'}`;
    let course = groups.get(key);
    if (!course) {
      const duplicate = context.courses.find((existing) => existing.termId === (term?.id ?? null) && shortCode(existing.code) === shortCode(identity.code));
      course = {
        id: context.newId('tc'),
        code: identity.code,
        title: identity.title,
        notes: identity.notes,
        color: identity.color ?? nextColor(usedColors, groups.size),
        remind: identity.remind,
        termId: term?.id ?? null,
        meetings: [],
        duplicateOf: duplicate ? duplicate.code : null,
        recognized: !identity.key.startsWith('text:'),
      };
      if (identity.color) usedColors.add(identity.color);
      groups.set(key, course);
      groupKeys.set(identity.key, [...(groupKeys.get(identity.key) ?? []), course]);
      meetingKeys.set(course, new Set());
    }
    course.title ??= identity.title;
    // The fullest form of the code wins: MAT102H5F over MAT102.
    // 取最完整的课程代码：MAT102H5F 优先于 MAT102。
    if (identity.key.startsWith('code:') && identity.code.length > course.code.length) course.code = identity.code;
    const location = item.event.location ? cap(cleanTimetableLine(item.event.location), TIMETABLE_LIMITS.location) || null : null;
    const sameKey = [item.weekday, item.startMin, item.endMin, location, identity.kind, identity.section, placed.rule, placed.list?.join(' ')].join('|');
    const seen = meetingKeys.get(course);
    if (seen?.has(sameKey)) continue;
    seen?.add(sameKey);
    const suggested = suggestMeetingTime(item.startMin, item.endMin);
    course.meetings.push({
      id: context.newId('tm'),
      weekday: item.weekday,
      startMin: item.startMin,
      endMin: item.endMin,
      problem: meetingTimeProblem(item.startMin, item.endMin),
      suggestedStart: suggested.start,
      suggestedEnd: suggested.end,
      kind: identity.kind,
      section: identity.section,
      location,
      weekRule: placed.rule,
      weekList: placed.list,
      skipDates: placed.skipDates,
    });
  }
  const courses = [...groups.values()];
  const termsUsed = new Set(courses.map((course) => course.termId));

  // Assignments: one-off events from the start of today to 400 days ahead, earliest first.
  // 作业：从今天开始到 400 天之后的单次事件，按时间先后排列。
  const fromMs = instantAt(today, 0);
  const openKeys = new Set(context.assignments.filter((item) => item.doneAt === null).map((item) => `${item.title}|${Date.parse(item.dueAt)}`));
  const seenAssignments = new Set<string>();
  const assignments: ImportAssignmentDraft[] = [];
  for (const event of oneOff) {
    const startMs = icsInstant(event.start, calendar.zones);
    const due = startMs === null ? instantAt(event.start.date, 23 * 60 + 59) : Math.floor(startMs / MINUTE_MS) * MINUTE_MS;
    if (due < fromMs || due > context.nowMs + DUE_FUTURE_MS) {
      ignored.past += 1;
      continue;
    }
    const { title, code } = assignmentTitle(event);
    if (!title) continue;
    const key = `${title}|${due}`;
    if (seenAssignments.has(key)) continue;
    seenAssignments.add(key);
    const fromApp = event.extras.ITEM === 'assignment';
    const appCourse = fromApp && event.extras.COURSE ? groupKeys.get(`app:${event.extras.COURSE}`) : undefined;
    const dueDate = torontoDateOf(due);
    const pick = (list: readonly ImportCourseDraft[] | undefined) => {
      if (!list?.length) return null;
      const inTerm = list.find((course) => {
        const term = course.termId ? (newTerms.find((t) => t.id === course.termId) ?? context.terms.find((t) => t.id === course.termId)) : null;
        return term ? termContains(term, dueDate) : false;
      });
      return inTerm ?? list[0] ?? null;
    };
    const byCode = code ? courses.filter((course) => shortCode(course.code) === code) : [];
    const imported = pick(appCourse) ?? pick(byCode);
    const existing = !imported && code ? context.courses.find((course) => shortCode(course.code) === code) : undefined;
    const courseCode = imported ? shortCode(imported.code) : existing ? shortCode(existing.code) : code;
    assignments.push({
      id: context.newId('ta'),
      title,
      notes: fromApp && event.description ? cap(cleanTimetableNotes(event.description), TIMETABLE_LIMITS.notes) || null : null,
      dueAt: new Date(due).toISOString(),
      courseId: imported?.id ?? existing?.id ?? null,
      courseCode,
      remindOffsets: fromApp ? readOffsets(event.extras.OFFSETS ?? '') : [...context.settings.assignmentOffsets],
      fromApp,
      duplicate: openKeys.has(key),
    });
  }
  assignments.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));

  return {
    terms: newTerms.filter((term) => termsUsed.has(term.id)),
    courses,
    assignments: assignments.slice(0, TIMETABLE_LIMITS.openAssignments),
    ignored,
  };
}

/* Choices */
/* 选择 */

export interface ImportChoices {
  /** Course id to whether it is ticked and its (editable) code. */
  /** 课程 id 到是否勾选及其（可编辑的）代码。 */
  courses: Record<string, { include: boolean; code: string }>;
  /** Meeting id to whether it is ticked and its time, fixed if the file's was not allowed. */
  /** 上课时间 id 到是否勾选及其时间（文件中的时间不允许时为修改后的时间）。 */
  meetings: Record<string, { include: boolean; startMin: number; endMin: number }>;
  /** New term id to its (editable) name. */
  /** 新学期 id 到其（可编辑的）名称。 */
  terms: Record<string, string>;
  assignments: Record<string, boolean>;
}

/**
 * Ticked: courses with a course code that are not already there, meetings whose time is allowed, and assignments
 * from this app's own export.
 * 默认勾选：有课程代码且尚未存在的课程、时间允许的上课时间，以及来自本 App 导出的作业。
 */
export function defaultChoices(plan: ImportPlan): ImportChoices {
  const choices: ImportChoices = { courses: {}, meetings: {}, terms: {}, assignments: {} };
  for (const term of plan.terms) choices.terms[term.id] = term.name;
  for (const course of plan.courses) {
    choices.courses[course.id] = { include: course.recognized && course.duplicateOf === null, code: course.code };
    for (const meeting of course.meetings) {
      choices.meetings[meeting.id] = meeting.problem
        ? { include: false, startMin: meeting.suggestedStart, endMin: meeting.suggestedEnd }
        : { include: true, startMin: meeting.startMin, endMin: meeting.endMin };
    }
  }
  for (const assignment of plan.assignments) choices.assignments[assignment.id] = assignment.fromApp && !assignment.duplicate;
  return choices;
}

export type ImportProblem =
  | { kind: 'course_code'; code: string }
  | { kind: 'too_many_meetings'; code: string }
  | { kind: 'meeting_time'; code: string }
  | { kind: 'too_many_courses'; max: number }
  | { kind: 'too_many_terms'; max: number }
  | { kind: 'too_many_skips'; max: number }
  | { kind: 'too_many_assignments'; max: number }
  | { kind: 'term_name' };

export interface ImportBuild {
  body: ImportTimetableBody;
  /** Anything here keeps the import button off. */
  /** 只要这里有内容，导入按钮就不可用。 */
  problems: ImportProblem[];
  counts: { courses: number; assignments: number };
}

/** The POST /import body for the ticked items, and what stops it from being sent. */
/** 已勾选内容的 POST /import 请求体，以及阻止发送的问题。 */
export function buildImportBody(plan: ImportPlan, choices: ImportChoices, context: Pick<ImportContext, 'terms' | 'courses' | 'skips' | 'assignments'>): ImportBuild {
  const problems: ImportProblem[] = [];
  const courses: SaveCourseBody[] = [];
  const skips: ImportTimetableBody['skips'] = [];
  for (const course of plan.courses) {
    const choice = choices.courses[course.id];
    if (!choice?.include) continue;
    const meetings: TimetableMeeting[] = [];
    for (const meeting of course.meetings) {
      const pick = choices.meetings[meeting.id];
      if (!pick?.include) continue;
      meetings.push({
        id: meeting.id,
        kind: meeting.kind,
        section: meeting.section,
        weekday: meeting.weekday,
        startMin: pick.startMin,
        endMin: pick.endMin,
        location: meeting.location,
        weekRule: meeting.weekRule,
        weekList: meeting.weekList,
      });
      for (const onDate of meeting.skipDates) skips.push({ onDate, meetingId: meeting.id, label: null });
    }
    if (!meetings.length) continue;
    const code = normalizeCourseCode(choice.code);
    if (!code || Array.from(code).length > TIMETABLE_LIMITS.code) problems.push({ kind: 'course_code', code: choice.code });
    if (meetings.length > TIMETABLE_LIMITS.meetingsPerCourse) problems.push({ kind: 'too_many_meetings', code: code || choice.code });
    if (meetings.some((meeting) => meetingTimeProblem(meeting.startMin, meeting.endMin) !== null)) problems.push({ kind: 'meeting_time', code: code || choice.code });
    courses.push({ id: course.id, termId: course.termId, code, title: course.title, color: course.color, notes: course.notes, remind: course.remind, meetings });
  }

  const usedTerms = new Set(courses.map((course) => course.termId));
  const terms = plan.terms
    .filter((term) => usedTerms.has(term.id))
    .map((term) => ({ id: term.id, name: cap(cleanTimetableLine(choices.terms[term.id] ?? term.name), TIMETABLE_LIMITS.termName), startsOn: term.startsOn, endsOn: term.endsOn, skipWeeks: term.skipWeeks }));
  if (terms.some((term) => !term.name)) problems.push({ kind: 'term_name' });

  // An assignment whose imported course was unticked falls back to an existing course with the same code.
  // 所属课程未被勾选的作业，改为对应同一代码的已有课程。
  const included = new Set(courses.map((course) => course.id));
  const assignments: ImportTimetableBody['assignments'] = [];
  for (const assignment of plan.assignments) {
    if (!choices.assignments[assignment.id]) continue;
    let courseId = assignment.courseId;
    const importedCourse = courseId ? plan.courses.find((course) => course.id === courseId) : undefined;
    if (importedCourse && !included.has(importedCourse.id)) {
      const code = assignment.courseCode;
      courseId = code ? (context.courses.find((course) => shortCode(course.code) === code)?.id ?? null) : null;
    }
    assignments.push({ id: assignment.id, courseId, title: assignment.title, notes: assignment.notes, dueAt: assignment.dueAt, remindOffsets: assignment.remindOffsets });
  }

  if (context.courses.length + courses.length > TIMETABLE_LIMITS.courses) problems.push({ kind: 'too_many_courses', max: TIMETABLE_LIMITS.courses });
  if (context.terms.length + terms.length > TIMETABLE_LIMITS.terms) problems.push({ kind: 'too_many_terms', max: TIMETABLE_LIMITS.terms });
  if (context.skips.length + skips.length > TIMETABLE_LIMITS.skips) problems.push({ kind: 'too_many_skips', max: TIMETABLE_LIMITS.skips });
  const openNow = context.assignments.filter((item) => item.doneAt === null).length;
  if (openNow + assignments.length > TIMETABLE_LIMITS.openAssignments) problems.push({ kind: 'too_many_assignments', max: TIMETABLE_LIMITS.openAssignments });

  return { body: { terms, courses, assignments, skips }, problems, counts: { courses: courses.length, assignments: assignments.length } };
}

/** Occurrence check data of an import body, for previews and tests. */
/** 导入请求体对应的课程数据，用于预览和测试。 */
export function importedData(body: ImportTimetableBody, existingTerms: readonly TimetableTerm[] = []): {
  terms: TimetableTerm[];
  courses: TimetableCourse[];
  skips: TimetableSkip[];
} {
  return {
    terms: [...existingTerms, ...body.terms.map((term) => ({ ...term, updatedAt: '' }))],
    courses: body.courses.map((course) => ({ ...course, updatedAt: '' })),
    skips: body.skips.map((skip) => ({ onDate: skip.onDate, meetingId: skip.meetingId, label: skip.label ?? null })),
  };
}

