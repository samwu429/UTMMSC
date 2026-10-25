/**
 * Owner: T3, timetable web core. The course form's model (timetable-final.md section 10), kept pure so it is
 * tested. A form row holds one time on one or more days; saving gives one meeting per chosen day and keeps the id
 * a day already had, so reminders already sent and single skips survive an edit. The checks mirror the server's
 * readCourse, with the inline wording of the form.
 * 维护者：T3，课表网页核心。课程表单的模型（timetable-final.md 第 10 节），保持为纯函数以便测试。表单中的一行是一个或多个星期的同一时间；
 * 保存时每个选中的星期得到一个上课时间，并保留该星期原有的 id，因此已发出的提醒和单次停课在修改后仍然有效。检查与服务器的 readCourse 一致，
 * 使用表单的内联措辞。
 */
import {
  formatClockRange,
  meetingTimeProblem,
  normalizeCourseCode,
  shortCode,
  termFor,
  termWeekCount,
  TIMETABLE_DAY_END_MIN,
  TIMETABLE_DAY_START_MIN,
  TIMETABLE_LAST_START_MIN,
  TIMETABLE_LIMITS,
  TIMETABLE_MEETING_MIN_MIN,
  type CourseColor,
  type MeetingKind,
  type SaveCourseBody,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableMeeting,
  type TimetableTerm,
  type Weekday,
  type WeekRule,
} from '@utmmsc/shared';
import { nextCourseColor } from '../model/colors';
import { weekdayShort } from '../model/labels';
import type { TimetableConflict } from '../model/week';
import { endForDuration } from '../grid/geometry';

export interface MeetingRowDraft {
  /** A key for the list; never sent. */
  /** 列表用的键；不会发送。 */
  key: string;
  days: Weekday[];
  /** The meeting id each day already has, kept on save. */
  /** 每个星期已有的上课时间 id，保存时保留。 */
  ids: Partial<Record<Weekday, string>>;
  startMin: number;
  endMin: number;
  location: string;
  kind: MeetingKind;
  section: string;
  weekRule: WeekRule;
  weekList: number[];
}

export interface CourseDraft {
  id: string;
  /** Not saved yet, so 添加到已有课程 is offered. */
  /** 尚未保存，因此提供「添加到已有课程」。 */
  isNew: boolean;
  code: string;
  title: string;
  color: CourseColor;
  termId: string | null;
  notes: string;
  remind: boolean;
  rows: MeetingRowDraft[];
}

export const DURATION_CHOICES = [60, 90, 120, 180] as const;
export const DEFAULT_DURATION = 60;

/** The time templates under the rows: days and a duration; null days keep the row's first day (单次). */
/** 行下方的时间模板：星期与时长；days 为 null 时保留该行的第一个星期（单次）。 */
export const TIME_TEMPLATES: readonly { id: string; days: Weekday[] | null; duration: number }[] = [
  { id: 'mwf', days: [1, 3, 5], duration: 60 },
  { id: 'tth', days: [2, 4], duration: 90 },
  { id: 'once2', days: null, duration: 120 },
  { id: 'once3', days: null, duration: 180 },
];

function sameShape(a: TimetableMeeting, b: TimetableMeeting): boolean {
  return (
    a.startMin === b.startMin &&
    a.endMin === b.endMin &&
    a.location === b.location &&
    a.kind === b.kind &&
    a.section === b.section &&
    a.weekRule === b.weekRule &&
    (a.weekList ?? []).join(',') === (b.weekList ?? []).join(',')
  );
}

/** A row for one meeting of each day in `meetings`, which share everything but the weekday. */
/** 由 `meetings` 中各星期的上课时间组成的一行，它们除星期外完全相同。 */
function rowOf(key: string, meetings: TimetableMeeting[]): MeetingRowDraft {
  const first = meetings[0];
  if (!first) throw new Error('a row needs a meeting');
  const ids: Partial<Record<Weekday, string>> = {};
  for (const meeting of meetings) ids[meeting.weekday] = meeting.id;
  return {
    key,
    days: meetings.map((meeting) => meeting.weekday).sort((a, b) => a - b),
    ids,
    startMin: first.startMin,
    endMin: first.endMin,
    location: first.location ?? '',
    kind: first.kind,
    section: first.section ?? '',
    weekRule: first.weekRule,
    weekList: [...(first.weekList ?? [])],
  };
}

/**
 * The form for an existing course. Meetings that differ only by weekday share a row, as they were entered with
 * several day chips.
 * 已有课程的表单。只有星期不同的上课时间合为一行，与用多个星期选项录入时一致。
 */
export function draftFromCourse(course: TimetableCourse, newKey: () => string): CourseDraft {
  const groups: TimetableMeeting[][] = [];
  for (const meeting of course.meetings) {
    const group = groups.find((list) => list[0] && sameShape(list[0], meeting) && !list.some((other) => other.weekday === meeting.weekday));
    if (group) group.push(meeting);
    else groups.push([meeting]);
  }
  return {
    id: course.id,
    isNew: false,
    code: course.code,
    title: course.title ?? '',
    color: course.color,
    termId: course.termId,
    notes: course.notes ?? '',
    remind: course.remind,
    rows: groups.map((group) => rowOf(newKey(), group)),
  };
}

export interface NewRowAt {
  weekday: Weekday;
  startMin: number;
}

/** A row on the tapped slot, lasting the last duration used. */
/** 位于点按时间格的一行，时长为上次使用的时长。 */
export function rowAt(key: string, at: NewRowAt, durationMin: number): MeetingRowDraft {
  const startMin = Math.min(TIMETABLE_LAST_START_MIN, Math.max(TIMETABLE_DAY_START_MIN, at.startMin));
  return { key, days: [at.weekday], ids: {}, startMin, endMin: endForDuration(startMin, durationMin), location: '', kind: 'lec', section: '', weekRule: 'all', weekList: [] };
}

/**
 * A new course: the next unused colour, the term of the date being looked at (or none), reminders on, and one row
 * on the tapped slot.
 * 新课程：下一个未使用的颜色、当前所看日期所在的学期（或不属于学期）、开启上课提醒，以及位于点按时间格的一行。
 */
export function newCourseDraft(options: { id: string; courses: readonly TimetableCourse[]; terms: readonly TimetableTerm[]; date: string; at: NewRowAt; durationMin: number; rowKey: string }): CourseDraft {
  return {
    id: options.id,
    isNew: true,
    code: '',
    title: '',
    color: nextCourseColor(options.courses),
    termId: termFor(options.terms, options.date)?.id ?? null,
    notes: '',
    remind: true,
    rows: [rowAt(options.rowKey, options.at, options.durationMin)],
  };
}

/** 添加到已有课程: that course's form with one more row on the tapped slot. */
/** 添加到已有课程：该课程的表单，并在点按的时间格多加一行。 */
export function addToCourse(course: TimetableCourse, at: NewRowAt, durationMin: number, newKey: () => string): CourseDraft {
  const draft = draftFromCourse(course, newKey);
  return { ...draft, rows: [...draft.rows, rowAt(newKey(), at, durationMin)] };
}

/** + 添加上课时间: the previous row's time and location, no day chosen yet. */
/** 「+ 添加上课时间」：沿用上一行的时间和地点，尚未选择星期。 */
export function nextRow(previous: MeetingRowDraft | undefined, key: string): MeetingRowDraft {
  if (!previous) return rowAt(key, { weekday: 1, startMin: 600 }, DEFAULT_DURATION);
  return { ...previous, key, days: [], ids: {}, kind: previous.kind, section: '', weekList: [...previous.weekList] };
}

/** 复制这一行: the same row again, as new meetings. */
/** 「复制这一行」：再加一行相同的内容，作为新的上课时间。 */
export function copyRow(row: MeetingRowDraft, key: string): MeetingRowDraft {
  return { ...row, key, ids: {}, days: [...row.days], weekList: [...row.weekList] };
}

export function rowDuration(row: Pick<MeetingRowDraft, 'startMin' | 'endMin'>): number {
  return row.endMin - row.startMin;
}

/** A new start keeps the duration, shortened only where it would pass 21:00. */
/** 新的开始时间保持时长，只在会超过 21:00 时缩短。 */
export function withStart(row: MeetingRowDraft, startMin: number): MeetingRowDraft {
  const start = Math.min(TIMETABLE_LAST_START_MIN, Math.max(TIMETABLE_DAY_START_MIN, startMin));
  return { ...row, startMin: start, endMin: endForDuration(start, rowDuration(row)) };
}

export function withDuration(row: MeetingRowDraft, minutes: number): MeetingRowDraft {
  return { ...row, endMin: endForDuration(row.startMin, minutes) };
}

export function withTemplate(row: MeetingRowDraft, template: (typeof TIME_TEMPLATES)[number]): MeetingRowDraft {
  const days = template.days ?? (row.days[0] ? [row.days[0]] : []);
  return withDuration({ ...row, days: [...days] }, template.duration);
}

export function toggleDay(row: MeetingRowDraft, day: Weekday): MeetingRowDraft {
  const days = row.days.includes(day) ? row.days.filter((d) => d !== day) : [...row.days, day].sort((a, b) => a - b);
  return { ...row, days };
}

const SECTION_KIND: readonly [RegExp, MeetingKind][] = [
  [/^LEC/i, 'lec'],
  [/^TUT/i, 'tut'],
  [/^PRA/i, 'pra'],
  [/^LAB/i, 'lab'],
  [/^SEM/i, 'sem'],
];

/** The kind a section names, as Acorn writes them: TUT0103 is a tutorial. Null when it names none. */
/** 课程分组所表示的上课类型，按 Acorn 的写法：TUT0103 为辅导。没有表示类型时为 null。 */
export function kindOfSection(section: string): MeetingKind | null {
  const text = section.trim();
  for (const [pattern, kind] of SECTION_KIND) if (pattern.test(text)) return kind;
  return null;
}

/** Typing a section such as TUT0103 also sets the kind. */
/** 输入 TUT0103 这样的分组时同时设置上课类型。 */
export function withSection(row: MeetingRowDraft, section: string): MeetingRowDraft {
  const kind = kindOfSection(section);
  return { ...row, section: section.toUpperCase(), kind: kind ?? row.kind };
}

/* Select options. The selects only offer valid times, so a bad time can come only from imported data. */
/* 下拉选项。下拉框只提供有效时间，因此错误的时间只可能来自导入的数据。 */

/** 时: 9 to 20. */
/** 时：9 到 20。 */
export function startHours(): number[] {
  const out: number[] = [];
  for (let hour = TIMETABLE_DAY_START_MIN / 60; hour * 60 <= TIMETABLE_LAST_START_MIN; hour += 1) out.push(hour);
  return out;
}

/** 分 for a start hour: 5-minute steps, up to 20:50 in the last hour. */
/** 开始某小时的「分」：按 5 分钟，最后一小时到 20:50 为止。 */
export function startMinutes(hour: number): number[] {
  const out: number[] = [];
  for (let minute = 0; minute < 60; minute += 5) if (hour * 60 + minute <= TIMETABLE_LAST_START_MIN) out.push(minute);
  return out;
}

/** End hours: from the first allowed end (start + 10 min) up to 21. */
/** 结束的小时：从最早允许的结束时间（开始加 10 分钟）到 21。 */
export function endHours(startMin: number): number[] {
  const first = Math.floor((startMin + TIMETABLE_MEETING_MIN_MIN) / 60);
  const out: number[] = [];
  for (let hour = first; hour * 60 <= TIMETABLE_DAY_END_MIN; hour += 1) out.push(hour);
  return out;
}

export function endMinutes(startMin: number, hour: number): number[] {
  const out: number[] = [];
  for (let minute = 0; minute < 60; minute += 5) {
    const at = hour * 60 + minute;
    if (at >= startMin + TIMETABLE_MEETING_MIN_MIN && at <= TIMETABLE_DAY_END_MIN) out.push(minute);
  }
  return out;
}

/** An end chosen by hour keeps its minutes where it can, else takes the first that is allowed. */
/** 按小时选择结束时间时，尽量保留分钟数，否则取第一个允许的分钟。 */
export function endAtHour(row: MeetingRowDraft, hour: number): number {
  const minutes = endMinutes(row.startMin, hour);
  const keep = row.endMin % 60;
  const minute = minutes.includes(keep) ? keep : (minutes[0] ?? 0);
  return hour * 60 + minute;
}

/* Saving */
/* 保存 */

/** A stored course as the body that saves it again. */
/** 把已保存的课程转换为再次保存它的请求体。 */
export function bodyOfCourse(course: TimetableCourse): SaveCourseBody {
  return {
    id: course.id,
    termId: course.termId,
    code: course.code,
    title: course.title,
    color: course.color,
    notes: course.notes,
    remind: course.remind,
    meetings: course.meetings.map((meeting) => ({ ...meeting, weekList: meeting.weekList ? [...meeting.weekList] : null })),
  };
}

/** The meetings the rows describe, one per chosen day, in day and time order. */
/** 各行描述的上课时间，每个选中的星期一个，按星期和时间排序。 */
export function draftMeetings(draft: CourseDraft, newId: () => string, hasTerm: boolean): TimetableMeeting[] {
  const out: TimetableMeeting[] = [];
  for (const row of draft.rows) {
    const weekRule = hasTerm ? row.weekRule : 'all';
    for (const day of row.days) {
      out.push({
        id: row.ids[day] ?? newId(),
        kind: row.kind,
        section: row.section.trim() === '' ? null : row.section.trim(),
        weekday: day,
        startMin: row.startMin,
        endMin: row.endMin,
        location: row.location.trim() === '' ? null : row.location.trim(),
        weekRule,
        weekList: weekRule === 'list' ? [...row.weekList].sort((a, b) => a - b) : null,
      });
    }
  }
  return out.sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin);
}

export function draftToBody(draft: CourseDraft, newId: () => string, hasTerm: boolean): SaveCourseBody {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    id: draft.id,
    termId: draft.termId,
    code: normalizeCourseCode(draft.code),
    title: text(draft.title),
    color: draft.color,
    notes: text(draft.notes),
    remind: draft.remind,
    meetings: draftMeetings(draft, newId, hasTerm),
  };
}

export type RowProblem = 'no_day' | 'time' | 'too_short' | 'weeks_need_term' | 'no_weeks';

export interface DraftProblems {
  code: 'code' | null;
  rows: Record<string, RowProblem>;
  tooMany: boolean;
  any: boolean;
}

/** What keeps the form from saving, mirroring readCourse. */
/** 阻止表单保存的问题，与 readCourse 一致。 */
export function draftProblems(draft: CourseDraft, hasTerm: boolean): DraftProblems {
  const code = normalizeCourseCode(draft.code);
  const codeProblem = code === '' || Array.from(code).length > TIMETABLE_LIMITS.code ? 'code' : null;
  const rows: Record<string, RowProblem> = {};
  let count = 0;
  for (const row of draft.rows) {
    count += row.days.length;
    const time = meetingTimeProblem(row.startMin, row.endMin);
    if (row.days.length === 0) rows[row.key] = 'no_day';
    else if (time === 'invalid_meeting_time') rows[row.key] = 'time';
    else if (time === 'meeting_too_short') rows[row.key] = 'too_short';
    else if (row.weekRule !== 'all' && !hasTerm) rows[row.key] = 'weeks_need_term';
    else if (row.weekRule === 'list' && row.weekList.length === 0) rows[row.key] = 'no_weeks';
  }
  const tooMany = count > TIMETABLE_LIMITS.meetingsPerCourse;
  return { code: codeProblem, rows, tooMany, any: codeProblem !== null || tooMany || Object.keys(rows).length > 0 || draft.rows.length === 0 };
}

type Tr = (zh: string, en: string) => string;

/** The inline text of a row problem. */
/** 行问题的内联提示。 */
export function rowProblemText(problem: RowProblem, tr: Tr): string {
  switch (problem) {
    case 'no_day':
      return tr('请选择星期', 'Choose at least one day');
    case 'time':
      return tr('时间要在 09:00–21:00 之间', 'Times must be between 9:00 AM and 9:00 PM');
    case 'too_short':
      return tr('结束要比开始晚至少 10 分钟', 'The end must be at least 10 minutes after the start');
    case 'weeks_need_term':
      return tr('单双周和自定义周次需要先设置学期', 'Odd, even and custom weeks need a term');
    case 'no_weeks':
      return tr('请选择上课的周次', 'Choose the weeks');
  }
}

/**
 * The overlap notices: 与 CSC108 周三 10:00–11:00 时间重叠, one per other class, in day and time order. They never
 * stop the save.
 * 时间重叠提示：「与 CSC108 周三 10:00–11:00 时间重叠」，每节其他课一条，按星期和时间排序。从不阻止保存。
 */
export function conflictNotices(conflicts: readonly TimetableConflict[], locale: TimetableLocale): string[] {
  const seen = new Set<string>();
  const others = conflicts
    .map((conflict) => conflict.other)
    .filter((other) => {
      if (seen.has(other.meeting.id)) return false;
      seen.add(other.meeting.id);
      return true;
    })
    .sort((a, b) => a.meeting.weekday - b.meeting.weekday || a.meeting.startMin - b.meeting.startMin);
  return others.map(({ course, meeting }) => {
    const code = shortCode(course.code);
    const day = weekdayShort(meeting.weekday, locale);
    const range = formatClockRange(meeting.startMin, meeting.endMin, locale);
    return locale === 'en' ? `Overlaps ${code} ${day} ${range}` : `与 ${code} ${day} ${range} 时间重叠`;
  });
}

/** Locations already used, most recent course first, for the chips under 地点. */
/** 已经用过的地点，按课程最近修改排序，用于「地点」下方的选项。 */
export function recentLocations(courses: readonly TimetableCourse[], limit = 6): string[] {
  const out: string[] = [];
  const sorted = [...courses].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  for (const course of sorted) {
    for (const meeting of course.meetings) {
      const location = meeting.location?.trim();
      if (!location || out.includes(location)) continue;
      out.push(location);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Weeks a custom rule can choose: the term's weeks, or 1 to 40 while no term is chosen. */
/** 自定义周次可选的周：所选学期的周数；尚未选择学期时为 1 到 40。 */
export function selectableWeeks(term: Pick<TimetableTerm, 'startsOn' | 'endsOn'> | null): number[] {
  const count = term ? Math.min(TIMETABLE_LIMITS.termWeeks, Math.max(1, termWeekCount(term))) : TIMETABLE_LIMITS.termWeeks;
  return Array.from({ length: count }, (_, index) => index + 1);
}

/**
 * 复制到其他天: the course with the meeting copied onto each chosen day that does not already have the same class,
 * or null when that would pass 10 meetings.
 * 「复制到其他天」：把这个上课时间复制到每个所选星期（已有相同课的星期除外）之后的课程；超过 10 个上课时间时为 null。
 */
export function copyMeetingToDays(course: TimetableCourse, meeting: TimetableMeeting, days: readonly Weekday[], newId: () => string): SaveCourseBody | null {
  const body = bodyOfCourse(course);
  const added = days
    .filter((day) => day !== meeting.weekday && !course.meetings.some((m) => m.weekday === day && sameShape(m, meeting)))
    .map((day) => ({ ...meeting, id: newId(), weekday: day, weekList: meeting.weekList ? [...meeting.weekList] : null }));
  if (body.meetings.length + added.length > TIMETABLE_LIMITS.meetingsPerCourse) return null;
  return { ...body, meetings: [...body.meetings, ...added].sort((a, b) => a.weekday - b.weekday || a.startMin - b.startMin) };
}
