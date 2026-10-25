/**
 * Owner: T4, timetable import and export. Builds the .ics export on the device: one weekly VEVENT per meeting in
 * Toronto time, with every day without class as an EXDATE, and one VEVENT with alarms per open assignment.
 * X-UTMMSC-* properties carry what plain calendars have no field for, so importing the file again restores the
 * timetable exactly; other calendars ignore them.
 * 维护者：T4，课表导入导出。在设备上生成 .ics 导出文件：每个上课时间一个按多伦多时间每周重复的 VEVENT，所有不上课的日期写成 EXDATE；
 * 每项未完成的作业一个带提醒的 VEVENT。普通日历没有对应字段的内容写在 X-UTMMSC-* 属性中，再次导入该文件可以完整恢复课表；其他日历会忽略这些属性。
 */
import {
  TIMETABLE_TIME_ZONE,
  addDays,
  courseTerm,
  indexSkips,
  instantAt,
  isoWeekday,
  mondayOf,
  morningOf,
  occursOn,
  shortCode,
  torontoDateOf,
  torontoMinuteOf,
  type AssignmentOffset,
  type MeetingKind,
  type SkipIndex,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableMeeting,
  type TimetableSkip,
  type TimetableTerm,
  type Weekday,
} from '@utmmsc/shared';
import { CRLF, escapeIcsText, foldIcsLine, formatIcsLocal, formatIcsUtc, icsLine } from './ics';

export const ICS_FILE_NAME = 'utmmsc-timetable.ics';
export const ICS_MIME_TYPE = 'text/calendar';
const UID_DOMAIN = 'utmmsc.com';
/** How many weeks a term-less class looks ahead for its first class that is not skipped. */
/** 不属于学期的课向后查找第一节未停课的课时最多查看的周数。 */
const FIRST_CLASS_SEARCH_WEEKS = 60;

/** Toronto's rules since 2007, which every calendar app reads the same way. */
/** 多伦多自 2007 年起的夏令时规则，所有日历 App 的理解都相同。 */
const TORONTO_VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TIMETABLE_TIME_ZONE}`,
  `X-LIC-LOCATION:${TIMETABLE_TIME_ZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:19700308T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:19701101T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const DAY_CODES: Readonly<Record<Weekday, string>> = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };

const KIND_LABELS: Readonly<Record<MeetingKind, { zh: string; en: string }>> = {
  lec: { zh: '讲座', en: 'Lecture' },
  tut: { zh: '辅导', en: 'Tutorial' },
  pra: { zh: '实践', en: 'Practical' },
  lab: { zh: '实验', en: 'Lab' },
  sem: { zh: '研讨', en: 'Seminar' },
  other: { zh: '其他', en: 'Other' },
};

/** Alarm triggers. Day and week durations are nominal in RFC 5545, so they keep the wall time across DST as the app does. */
/** 提醒触发时间。RFC 5545 中按天和按周的时长是名义时长，跨夏令时仍保持时钟时间，与 App 一致。 */
const OFFSET_TRIGGERS: Readonly<Record<Exclude<AssignmentOffset, 'morning'>, string>> = {
  '1w': '-P1W',
  '2d': '-P2D',
  '1d': '-P1D',
  '3h': '-PT3H',
  '1h': '-PT1H',
  '30m': '-PT30M',
};

export interface IcsExportData {
  terms: readonly TimetableTerm[];
  courses: readonly TimetableCourse[];
  skips: readonly TimetableSkip[];
  assignments: readonly TimetableAssignment[];
}

export interface IcsExportOptions {
  /** DTSTAMP, and where a term-less class starts: the Monday of this Toronto week. */
  /** 用于 DTSTAMP，以及不属于学期的课的起点：多伦多本周的周一。 */
  nowMs: number;
  /** Language of the summaries and the calendar name. */
  /** 摘要与日历名称所用的语言。 */
  locale: TimetableLocale;
}

export function meetingKindLabel(kind: MeetingKind, locale: TimetableLocale): string {
  return KIND_LABELS[kind][locale];
}

function dateValue(date: string): string {
  return date.replace(/-/g, '');
}

/** The first date on or after `date` that falls on `weekday`. */
/** `date` 当天或之后第一个星期为 `weekday` 的日期。 */
export function firstWeekdayFrom(date: string, weekday: Weekday): string {
  return addDays(date, (weekday - isoWeekday(date) + 7) % 7);
}

function textLine(name: string, text: string): string {
  return icsLine(name, escapeIcsText(text));
}

function localLine(name: string, date: string, minute: number): string {
  return icsLine(name, formatIcsLocal(date, minute), { TZID: TIMETABLE_TIME_ZONE });
}

/** Where a meeting's weekly rule starts, which dates it leaves out, and when it ends. */
/** 上课时间每周规则的起点、排除的日期以及结束时间。 */
interface MeetingSeries {
  first: string;
  interval: 1 | 2;
  exdates: string[];
  untilMs: number | null;
}

function termSeries(meeting: TimetableMeeting, term: TimetableTerm, skipIndex: SkipIndex): MeetingSeries | null {
  const held: string[] = [];
  for (let date = firstWeekdayFrom(term.startsOn, meeting.weekday); date <= term.endsOn; date = addDays(date, 7)) {
    if (occursOn(meeting, term, skipIndex, date)) held.push(date);
  }
  const first = held[0];
  if (first === undefined) return null;
  // Odd and even weeks repeat every two weeks from the first class, which is already in the right week.
  // 单双周从第一节课起每两周重复一次，第一节课本身已在正确的周。
  const interval = meeting.weekRule === 'odd' || meeting.weekRule === 'even' ? 2 : 1;
  const kept = new Set(held);
  const exdates: string[] = [];
  for (let date = first; date <= term.endsOn; date = addDays(date, 7 * interval)) if (!kept.has(date)) exdates.push(date);
  // The last second of the term's last Toronto day, in UTC as RFC 5545 requires next to a TZID start.
  // 学期最后一天（多伦多时间）的最后一秒，按 RFC 5545 在 TZID 起始时间旁使用 UTC。
  return { first, interval, exdates, untilMs: instantAt(term.endsOn, 23 * 60 + 59) + 59_000 };
}

function openSeries(meeting: TimetableMeeting, skips: readonly TimetableSkip[], skipIndex: SkipIndex, nowMs: number): MeetingSeries {
  let first = firstWeekdayFrom(mondayOf(torontoDateOf(nowMs)), meeting.weekday);
  for (let week = 0; week < FIRST_CLASS_SEARCH_WEEKS && !occursOn(meeting, null, skipIndex, first); week += 1) first = addDays(first, 7);
  const exdates = new Set<string>();
  for (const skip of skips) {
    if (skip.onDate <= first || isoWeekday(skip.onDate) !== meeting.weekday) continue;
    if (skip.meetingId === null || skip.meetingId === meeting.id) exdates.add(skip.onDate);
  }
  return { first, interval: 1, exdates: [...exdates].sort(), untilMs: null };
}

function weeksValue(meeting: TimetableMeeting): string {
  return meeting.weekRule === 'list' ? ['list', ...(meeting.weekList ?? [])].join(' ') : meeting.weekRule;
}

function meetingEvent(
  course: TimetableCourse,
  meeting: TimetableMeeting,
  term: TimetableTerm | null,
  series: MeetingSeries,
  stamp: string,
  locale: TimetableLocale,
): string[] {
  const rule = ['FREQ=WEEKLY'];
  if (series.interval === 2) rule.push('INTERVAL=2');
  rule.push(`BYDAY=${DAY_CODES[meeting.weekday]}`);
  if (series.untilMs !== null) rule.push(`UNTIL=${formatIcsUtc(series.untilMs)}`);
  const kind = meeting.kind === 'other' ? '' : ` ${meetingKindLabel(meeting.kind, locale)}`;
  const summary = `${course.code}${kind}${meeting.section ? ` ${meeting.section}` : ''}`;
  const description = [course.title, course.notes].filter((part): part is string => Boolean(part)).join('\n\n');
  const lines = [
    'BEGIN:VEVENT',
    `UID:${meeting.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    localLine('DTSTART', series.first, meeting.startMin),
    localLine('DTEND', series.first, meeting.endMin),
    `RRULE:${rule.join(';')}`,
    ...series.exdates.map((date) => localLine('EXDATE', date, meeting.startMin)),
    textLine('SUMMARY', summary),
  ];
  if (meeting.location) lines.push(textLine('LOCATION', meeting.location));
  if (description) lines.push(textLine('DESCRIPTION', description));
  lines.push(
    'X-UTMMSC-ITEM:class',
    textLine('X-UTMMSC-COURSE', course.id),
    textLine('X-UTMMSC-CODE', course.code),
    `X-UTMMSC-KIND:${meeting.kind}`,
    `X-UTMMSC-COLOR:${course.color}`,
  );
  if (meeting.section) lines.push(textLine('X-UTMMSC-SECTION', meeting.section));
  if (course.title) lines.push(textLine('X-UTMMSC-TITLE', course.title));
  lines.push(`X-UTMMSC-WEEKS:${weeksValue(meeting)}`);
  if (!course.remind) lines.push('X-UTMMSC-REMIND:0');
  if (term) {
    lines.push(
      textLine('X-UTMMSC-TERM', term.name),
      `X-UTMMSC-TERM-DATES:${dateValue(term.startsOn)}/${dateValue(term.endsOn)}`,
    );
    if (term.skipWeeks.length) lines.push(`X-UTMMSC-TERM-SKIP:${term.skipWeeks.join(' ')}`);
  }
  lines.push('END:VEVENT');
  return lines;
}

/** DTSTART of a deadline: Toronto wall time, or UTC in the repeated hour of November where wall time is ambiguous. */
/** 截止时间的 DTSTART：多伦多时钟时间；十一月重复的那一小时中时钟时间有歧义，改用 UTC。 */
function instantLine(name: string, ms: number): string {
  const date = torontoDateOf(ms);
  const minute = torontoMinuteOf(ms);
  return instantAt(date, minute) === ms ? localLine(name, date, minute) : `${name}:${formatIcsUtc(ms)}`;
}

function assignmentEvent(assignment: TimetableAssignment, course: TimetableCourse | null, stamp: string): string[] {
  const due = Date.parse(assignment.dueAt);
  const summary = course ? `${assignment.title} · ${shortCode(course.code)}` : assignment.title;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${assignment.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    instantLine('DTSTART', due),
    instantLine('DTEND', due),
    textLine('SUMMARY', summary),
  ];
  if (assignment.notes) lines.push(textLine('DESCRIPTION', assignment.notes));
  lines.push('X-UTMMSC-ITEM:assignment', textLine('X-UTMMSC-TITLE', assignment.title));
  if (course) lines.push(textLine('X-UTMMSC-COURSE', course.id));
  lines.push(`X-UTMMSC-OFFSETS:${assignment.remindOffsets.join(' ')}`);
  for (const offset of assignment.remindOffsets) {
    const trigger =
      offset === 'morning'
        ? icsLine('TRIGGER', formatIcsUtc(Date.parse(morningOf(new Date(due).toISOString(), TIMETABLE_TIME_ZONE))), { VALUE: 'DATE-TIME' })
        : `TRIGGER:${OFFSET_TRIGGERS[offset]}`;
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', textLine('DESCRIPTION', assignment.title), trigger, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

/**
 * The whole calendar as text: CRLF line ends, folded lines, escaped text. Courses whose term is gone and terms
 * with no class left are skipped, as are done assignments.
 * 整个日历的文本：CRLF 换行、折行、转义文字。学期已不存在的课程、没有剩下任何课的学期以及已完成的作业都会被跳过。
 */
export function buildTimetableIcs(data: IcsExportData, options: IcsExportOptions): string {
  const { nowMs, locale } = options;
  const stamp = formatIcsUtc(Math.floor(nowMs / 1000) * 1000);
  const terms = new Map(data.terms.map((term) => [term.id, term]));
  const skipIndex = indexSkips(data.skips);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//UTMMSC//Timetable//${locale === 'en' ? 'EN' : 'ZH'}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    textLine('X-WR-CALNAME', locale === 'en' ? 'UTMMSC timetable' : 'UTMMSC 课表'),
    `X-WR-TIMEZONE:${TIMETABLE_TIME_ZONE}`,
    ...TORONTO_VTIMEZONE,
  ];
  for (const course of data.courses) {
    const term = courseTerm(course, terms);
    if (term === undefined) continue;
    for (const meeting of course.meetings) {
      const series = term ? termSeries(meeting, term, skipIndex) : openSeries(meeting, data.skips, skipIndex, nowMs);
      if (series) lines.push(...meetingEvent(course, meeting, term, series, stamp, locale));
    }
  }
  const courses = new Map(data.courses.map((course) => [course.id, course]));
  const open = data.assignments.filter((assignment) => assignment.doneAt === null).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  for (const assignment of open) {
    const course = assignment.courseId ? (courses.get(assignment.courseId) ?? null) : null;
    lines.push(...assignmentEvent(assignment, course, stamp));
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}
