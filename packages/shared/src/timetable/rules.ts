/**
 * Timetable input rules and the single definition of "a class takes place". The API checks every body with the
 * readers here and the app's forms mirror them; the reminder scan computes occursOn in SQL, and a randomized
 * test proves both agree.
 * 课表的输入规则，以及「这节课会上」的唯一定义。接口用这里的读取函数检查每个请求体，App 的表单与之保持一致；
 * 上课提醒扫描在 SQL 中计算 occursOn，并有随机测试证明两者一致。
 */
import { addDays, isTimetableDate, instantAt, isoWeekday, termContains, termWeekCount, weekOfTerm } from './time';
import {
  ASSIGNMENT_OFFSETS,
  ASSIGNMENT_OFFSETS_MAX,
  CLASS_LEADS,
  COURSE_COLORS,
  MEETING_KINDS,
  TIMETABLE_DAY_END_MIN,
  TIMETABLE_DAY_START_MIN,
  TIMETABLE_ID,
  TIMETABLE_LAST_START_MIN,
  TIMETABLE_LIMITS,
  TIMETABLE_MEETING_MIN_MIN,
  TIMETABLE_MESSAGES,
  TIMETABLE_STEP_MIN,
  WEEK_RULES,
  type AssignmentOffset,
  type ClassLead,
  type CourseColor,
  type ImportTimetableBody,
  type MeetingKind,
  type SaveAssignmentBody,
  type SaveCourseBody,
  type SaveTermBody,
  type SetSkipBody,
  type TimetableCourse,
  type TimetableErrorCode,
  type TimetableIdPrefix,
  type TimetableMeeting,
  type TimetableSkip,
  type TimetableTerm,
  type UpdateTimetableSettingsBody,
  type Weekday,
  type WeekRule,
} from './types';

/** A reader's answer: the cleaned value, or the refusal the API sends as it is. */
/** 读取函数的结果：清理后的值，或接口原样返回的拒绝。 */
export type TimetableReadResult<T> = { ok: true; value: T } | { ok: false; code: TimetableErrorCode; message: string };

const DAY_MS = 86_400_000;
/** dueAt may lie this far before now (an overdue item being edited) and this far after it. */
/** dueAt 最早可以早于现在这么久（编辑已逾期的作业），最晚可以晚于现在这么久。 */
const DUE_PAST_MS = 365 * DAY_MS;
const DUE_FUTURE_MS = 400 * DAY_MS;
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** Thrown inside a reader and turned into its answer, so nested checks stay flat. */
/** 在读取函数内部抛出、再转换成结果，使嵌套的检查保持扁平。 */
class Refusal {
  constructor(readonly code: TimetableErrorCode) {}
}

function refuse(code: TimetableErrorCode): never {
  throw new Refusal(code);
}

function answer<T>(read: () => T): TimetableReadResult<T> {
  try {
    return { ok: true, value: read() };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, code: err.code, message: TIMETABLE_MESSAGES[err.code] };
    throw err;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : refuse('invalid_body');
}

/* Text */

/** C0 and C1 control characters. */
/** C0 与 C1 控制字符。 */
function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function dropControls(text: string, keepNewline: boolean): string {
  let out = '';
  for (const ch of text) {
    if (keepNewline && ch === '\n') out += ch;
    else if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out;
}

/** One line: line breaks and tabs become spaces, other controls go, runs of spaces shrink to one, ends trimmed. */
/** 单行文字：换行和制表符变成空格，删去其他控制字符，连续空白缩成一个，去掉首尾空白。 */
export function cleanTimetableLine(raw: string): string {
  return dropControls(raw.replace(/\r\n?|[\n\t\u2028\u2029]/g, ' '), false)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Notes: line breaks become \n, tabs spaces, other controls go, trailing spaces and long blank runs shrink. */
/** 备注：换行统一为 \n，制表符变成空格，删去其他控制字符，去掉行尾空格，过长的空行缩短。 */
export function cleanTimetableNotes(raw: string): string {
  return dropControls(raw.replace(/\r\n?|[\u2028\u2029]/g, '\n').replace(/\t/g, ' '), true)
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** Cuts to `max` code points, so an emoji or a rare character counts once and is never split. */
/** 按码点截到 `max` 个字符，表情或生僻字只算一个，也不会被截断成半个。 */
function cap(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

function length(text: string): number {
  return Array.from(text).length;
}

/** Optional free text: absent or blank is null; longer text is cut to its cap. */
/** 可选的自由文字：缺省或空白为 null；超长时截到上限。 */
function optionalText(value: unknown, max: number, multiline = false): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') refuse('invalid_body');
  const cleaned = cap(multiline ? cleanTimetableNotes(value) : cleanTimetableLine(value), max);
  return cleaned === '' ? null : cleaned;
}

/** Required free text, cut to its cap; blank is refused with `code`. */
/** 必填的自由文字，超长时截到上限；空白时以 `code` 拒绝。 */
function requiredText(value: unknown, max: number, code: TimetableErrorCode): string {
  if (typeof value !== 'string') refuse(code);
  const cleaned = cap(cleanTimetableLine(value), max);
  return cleaned === '' ? refuse(code) : cleaned;
}

/**
 * A course code as stored: one line, ASCII letters uppercased (mat102h5f becomes MAT102H5F), 1 to 20 characters.
 * Codes are never cut, since a cut code would name another course.
 * 保存时的课程代码：单行，ASCII 字母转为大写（mat102h5f 变为 MAT102H5F），1 到 20 个字符。课程代码从不截断，截断后会变成另一门课。
 */
export function normalizeCourseCode(raw: string): string {
  return cleanTimetableLine(raw).replace(/[a-z]+/g, (letters) => letters.toUpperCase());
}

/* Ids */

/** Whether the value is a timetable id, of the given kind when one is named. */
/** 值是否为课表 id；指定类型时还要求类型一致。 */
export function isTimetableId(value: unknown, prefix?: TimetableIdPrefix): value is string {
  return typeof value === 'string' && TIMETABLE_ID.test(value) && (prefix === undefined || value.startsWith(`${prefix}_`));
}

function readId(value: unknown, prefix: TimetableIdPrefix): string {
  return isTimetableId(value, prefix) ? value : refuse('invalid_id');
}

function readOptionalId(value: unknown, prefix: TimetableIdPrefix): string | null {
  return value === undefined || value === null ? null : readId(value, prefix);
}

/* Meetings */

/**
 * Why a meeting time is refused, or null when it is fine: the start between 09:00 and 20:50, the end by 21:00,
 * both on 5-minute steps, at least 10 minutes long. The forms show the same text inline.
 * 上课时间被拒绝的原因；没有问题时为 null。开始在 09:00 到 20:50 之间，结束不晚于 21:00，都按 5 分钟设置，至少 10 分钟。表单内联显示同样的提示。
 */
export function meetingTimeProblem(startMin: unknown, endMin: unknown): 'invalid_meeting_time' | 'meeting_too_short' | null {
  if (typeof startMin !== 'number' || typeof endMin !== 'number' || !Number.isInteger(startMin) || !Number.isInteger(endMin)) return 'invalid_meeting_time';
  if (startMin % TIMETABLE_STEP_MIN !== 0 || endMin % TIMETABLE_STEP_MIN !== 0) return 'invalid_meeting_time';
  if (startMin < TIMETABLE_DAY_START_MIN || startMin > TIMETABLE_LAST_START_MIN || endMin > TIMETABLE_DAY_END_MIN) return 'invalid_meeting_time';
  if (endMin - startMin < TIMETABLE_MEETING_MIN_MIN) return 'meeting_too_short';
  return null;
}

function isWeekday(value: unknown): value is Weekday {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7;
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

/** Distinct whole weeks from 1 to `max`, ascending; null when the list breaks any of that. */
/** 1 到 `max` 之间互不重复的整数周次，升序；不满足时为 null。 */
function readWeeks(value: unknown, max: number): number[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  for (const week of value) {
    if (typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > max || seen.has(week)) return null;
    seen.add(week);
  }
  return [...seen].sort((a, b) => a - b);
}

function readMeeting(value: unknown, hasTerm: boolean): TimetableMeeting {
  const raw = record(value);
  const id = readId(raw.id, 'tm');
  const kind: MeetingKind = raw.kind === undefined ? 'lec' : oneOf(raw.kind, MEETING_KINDS) ? raw.kind : refuse('invalid_meeting_kind');
  if (!isWeekday(raw.weekday)) refuse('invalid_meeting_time');
  const problem = meetingTimeProblem(raw.startMin, raw.endMin);
  if (problem) refuse(problem);
  const weekRule: WeekRule = raw.weekRule === undefined ? 'all' : oneOf(raw.weekRule, WEEK_RULES) ? raw.weekRule : refuse('invalid_body');
  if (weekRule !== 'all' && !hasTerm) refuse('invalid_weeks');
  let weekList: number[] | null = null;
  if (weekRule === 'list') {
    weekList = readWeeks(raw.weekList, TIMETABLE_LIMITS.termWeeks);
    if (!weekList || weekList.length === 0) refuse('invalid_week_list');
  }
  return {
    id,
    kind,
    section: optionalText(raw.section, TIMETABLE_LIMITS.section),
    weekday: raw.weekday,
    startMin: raw.startMin as number,
    endMin: raw.endMin as number,
    location: optionalText(raw.location, TIMETABLE_LIMITS.location),
    weekRule,
    weekList,
  };
}

/* Readers */

function readTermBody(value: unknown): SaveTermBody {
  const raw = record(value);
  const id = readId(raw.id, 'tt');
  const name = requiredText(raw.name, TIMETABLE_LIMITS.termName, 'invalid_term_name');
  if (!isTimetableDate(raw.startsOn) || !isTimetableDate(raw.endsOn) || raw.startsOn > raw.endsOn) refuse('invalid_term');
  const term = { startsOn: raw.startsOn, endsOn: raw.endsOn };
  const weeks = termWeekCount(term);
  if (weeks > TIMETABLE_LIMITS.termWeeks) refuse('invalid_term');
  const skipWeeks = raw.skipWeeks === undefined ? [] : readWeeks(raw.skipWeeks, weeks);
  if (!skipWeeks) refuse('invalid_term');
  return { id, name, ...term, skipWeeks };
}

function readCourseBody(value: unknown): SaveCourseBody {
  const raw = record(value);
  const id = readId(raw.id, 'tc');
  const termId = readOptionalId(raw.termId, 'tt');
  if (typeof raw.code !== 'string') refuse('invalid_course_code');
  const code = normalizeCourseCode(raw.code);
  if (code === '' || length(code) > TIMETABLE_LIMITS.code) refuse('invalid_course_code');
  const color: CourseColor = oneOf(raw.color, COURSE_COLORS) ? raw.color : refuse('invalid_color');
  if (raw.remind !== undefined && typeof raw.remind !== 'boolean') refuse('invalid_body');
  if (!Array.isArray(raw.meetings)) refuse('invalid_body');
  if (raw.meetings.length > TIMETABLE_LIMITS.meetingsPerCourse) refuse('too_many_meetings');
  const meetings = raw.meetings.map((meeting) => readMeeting(meeting, termId !== null));
  if (new Set(meetings.map((meeting) => meeting.id)).size !== meetings.length) refuse('invalid_id');
  return {
    id,
    termId,
    code,
    title: optionalText(raw.title, TIMETABLE_LIMITS.title),
    color,
    notes: optionalText(raw.notes, TIMETABLE_LIMITS.notes, true),
    remind: raw.remind !== false,
    meetings,
  };
}

/** Listed tokens, no repeats, at most 3, in the canonical order of ASSIGNMENT_OFFSETS. */
/** 列出的提醒时间，不重复，最多 3 个，按 ASSIGNMENT_OFFSETS 的标准顺序排列。 */
function readOffsets(value: unknown): AssignmentOffset[] {
  if (!Array.isArray(value)) refuse('invalid_offset');
  const seen = new Set<AssignmentOffset>();
  for (const token of value) {
    if (!oneOf(token, ASSIGNMENT_OFFSETS) || seen.has(token)) refuse('invalid_offset');
    seen.add(token);
  }
  if (seen.size > ASSIGNMENT_OFFSETS_MAX) refuse('too_many_offsets');
  return ASSIGNMENT_OFFSETS.filter((token) => seen.has(token));
}

/** An ISO instant with a zone, on a whole minute, from a year ago to 400 days ahead, written as toISOString does. */
/** 带时区的 ISO 时间，整分钟，从一年前到 400 天之后，按 toISOString 的格式写出。 */
function readDueAt(value: unknown, nowMs: number): string {
  const match = typeof value === 'string' ? ISO_INSTANT.exec(value) : null;
  if (!match) refuse('invalid_due_time');
  // Date.parse rolls 02-30 over into March and reads 24:00, so the parts are checked first.
  // Date.parse 会把 02-30 顺延到三月，也接受 24:00，所以先逐项检查。
  const [text, date = '', hour = '', minute = '', second = '0', zoneHour = '0', zoneMinute = '0'] = match;
  if (!isTimetableDate(date) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || Number(zoneHour) > 23 || Number(zoneMinute) > 59) {
    refuse('invalid_due_time');
  }
  const ms = Date.parse(text);
  if (Number.isNaN(ms) || ms % 60_000 !== 0) refuse('invalid_due_time');
  if (ms < nowMs - DUE_PAST_MS || ms > nowMs + DUE_FUTURE_MS) refuse('invalid_due_time');
  return new Date(ms).toISOString();
}

function readAssignmentBody(value: unknown, nowMs: number): SaveAssignmentBody {
  const raw = record(value);
  const body: SaveAssignmentBody = {
    id: readId(raw.id, 'ta'),
    courseId: readOptionalId(raw.courseId, 'tc'),
    title: requiredText(raw.title, TIMETABLE_LIMITS.assignmentTitle, 'invalid_assignment_title'),
    notes: optionalText(raw.notes, TIMETABLE_LIMITS.notes, true),
    dueAt: readDueAt(raw.dueAt, nowMs),
    remindOffsets: readOffsets(raw.remindOffsets),
  };
  if (raw.done !== undefined) {
    if (typeof raw.done !== 'boolean') refuse('invalid_body');
    body.done = raw.done;
  }
  return body;
}

function readSkipBody(value: unknown): SetSkipBody & { label: string | null } {
  const raw = record(value);
  if (!isTimetableDate(raw.onDate)) refuse('invalid_skip_date');
  const meetingId = readOptionalId(raw.meetingId, 'tm');
  if (typeof raw.skipped !== 'boolean') refuse('invalid_body');
  return { onDate: raw.onDate, meetingId, skipped: raw.skipped, label: optionalText(raw.label, TIMETABLE_LIMITS.label) };
}

/** POST /terms. */
export function readTerm(value: unknown): TimetableReadResult<SaveTermBody> {
  return answer(() => readTermBody(value));
}

/** POST /courses. A week rule other than every week needs the course to have a term. */
/** POST /courses。除每周以外的周次规则都要求课程属于某个学期。 */
export function readCourse(value: unknown): TimetableReadResult<SaveCourseBody> {
  return answer(() => readCourseBody(value));
}

/** POST /assignments. nowMs bounds dueAt. */
/** POST /assignments。nowMs 用于限定 dueAt 的范围。 */
export function readAssignment(value: unknown, nowMs: number): TimetableReadResult<SaveAssignmentBody> {
  return answer(() => readAssignmentBody(value, nowMs));
}

/** POST /skips. */
export function readSkip(value: unknown): TimetableReadResult<SetSkipBody & { label: string | null }> {
  return answer(() => readSkipBody(value));
}

/** PATCH /settings: only the fields present; unknown fields are ignored. */
/** PATCH /settings：只包含出现的字段；未知字段被忽略。 */
export function readSettingsPatch(value: unknown): TimetableReadResult<UpdateTimetableSettingsBody> {
  return answer(() => {
    const raw = record(value);
    const patch: UpdateTimetableSettingsBody = {};
    if (raw.classReminders !== undefined) patch.classReminders = typeof raw.classReminders === 'boolean' ? raw.classReminders : refuse('invalid_settings');
    if (raw.classLeadMin !== undefined) {
      patch.classLeadMin = (CLASS_LEADS as readonly unknown[]).includes(raw.classLeadMin) ? (raw.classLeadMin as ClassLead) : refuse('invalid_settings');
    }
    if (raw.assignmentOffsets !== undefined) patch.assignmentOffsets = readOffsets(raw.assignmentOffsets);
    if (raw.showWeekend !== undefined) patch.showWeekend = oneOf(raw.showWeekend, ['always', 'auto'] as const) ? raw.showWeekend : refuse('invalid_settings');
    if (raw.locale !== undefined) patch.locale = oneOf(raw.locale, ['zh', 'en'] as const) ? raw.locale : refuse('invalid_settings');
    return patch;
  });
}

function list(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : refuse('invalid_body');
}

function unique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) refuse('invalid_id');
}

/**
 * POST /import, checked in full before anything is written. The caps here count the import alone; the API also
 * counts what the member already has. Meeting ids must be unique across every course, and repeated skips collapse.
 * POST /import，在写入任何内容之前完整检查。这里的上限只计算导入本身；接口还会加上成员已有的数量。上课时间 id 在所有课程中都不能重复，
 * 重复的停课记录合并为一条。
 */
export function readImport(value: unknown, nowMs: number): TimetableReadResult<ImportTimetableBody> {
  return answer(() => {
    const raw = record(value);
    const terms = list(raw.terms);
    const courses = list(raw.courses);
    const assignments = list(raw.assignments);
    const skips = list(raw.skips);
    if (terms.length > TIMETABLE_LIMITS.terms) refuse('too_many_terms');
    if (courses.length > TIMETABLE_LIMITS.courses) refuse('too_many_courses');
    if (assignments.length > TIMETABLE_LIMITS.assignments) refuse('too_many_assignments');
    if (skips.length > TIMETABLE_LIMITS.skips) refuse('too_many_skips');

    const body: ImportTimetableBody = {
      terms: terms.map(readTermBody),
      courses: courses.map(readCourseBody),
      assignments: assignments.map((item) => readAssignmentBody(item, nowMs)),
      skips: [],
    };
    unique(body.terms.map((term) => term.id));
    unique(body.courses.map((course) => course.id));
    unique(body.courses.flatMap((course) => course.meetings.map((meeting) => meeting.id)));
    unique(body.assignments.map((assignment) => assignment.id));
    if (body.assignments.filter((assignment) => assignment.done !== true).length > TIMETABLE_LIMITS.openAssignments) refuse('too_many_assignments');

    const seen = new Set<string>();
    for (const item of skips) {
      const skip = readSkipBody({ ...record(item), skipped: true });
      const key = skipKey(skip.onDate, skip.meetingId);
      if (seen.has(key)) continue;
      seen.add(key);
      body.skips.push({ onDate: skip.onDate, meetingId: skip.meetingId, label: skip.label });
    }
    return body;
  });
}

/* Occurrences */

/** What occurrence logic reads; the API response and the app's store both have this shape. */
/** 计算上课日期所需的数据；接口应答和 App 的 store 都是这个结构。 */
export interface TimetableData {
  terms: readonly TimetableTerm[];
  courses: readonly TimetableCourse[];
  skips: readonly TimetableSkip[];
}

/** One class on one date, with its Toronto start and end instants. */
/** 某一天的一节课，附带多伦多时间的开始与结束时刻。 */
export interface TimetableOccurrence {
  course: TimetableCourse;
  meeting: TimetableMeeting;
  date: string;
  startMs: number;
  endMs: number;
}

/** Skipped dates keyed by date and meeting id, or `*` for a whole day. */
/** 停课日期集合，键为日期加上课时间 id；整天停课时用 `*`。 */
export type SkipIndex = ReadonlySet<string>;

export function skipKey(date: string, meetingId: string | null): string {
  return `${date}|${meetingId ?? '*'}`;
}

export function indexSkips(skips: readonly Pick<TimetableSkip, 'onDate' | 'meetingId'>[]): Set<string> {
  return new Set(skips.map((skip) => skipKey(skip.onDate, skip.meetingId)));
}

/** Whether a holiday or a 本次不上 removes this meeting on this date. */
/** 假日或「本次不上」是否取消了这节课在这一天的上课。 */
export function isSkipped(skipIndex: SkipIndex, meetingId: string, date: string): boolean {
  return skipIndex.has(skipKey(date, null)) || skipIndex.has(skipKey(date, meetingId));
}

/**
 * The single definition of "class happens": right weekday; for a course in a term, inside the term, not a skipped
 * week, and in the meeting's weeks; and no holiday or single skip that day. A term-less course runs every week.
 * The class scan's SQL is tested equal to this.
 * 「这节课会上」的唯一定义：星期几相符；属于学期的课程还要在学期之内、不在停课周、并属于这节课的周次；当天没有假日或单次停课。
 * 不属于学期的课程每周都上。上课提醒扫描的 SQL 经测试与此一致。
 */
export function occursOn(
  meeting: Pick<TimetableMeeting, 'id' | 'weekday' | 'weekRule' | 'weekList'>,
  term: Pick<TimetableTerm, 'startsOn' | 'endsOn' | 'skipWeeks'> | null,
  skipIndex: SkipIndex,
  date: string,
): boolean {
  if (isoWeekday(date) !== meeting.weekday) return false;
  if (term) {
    if (!termContains(term, date)) return false;
    const week = weekOfTerm(term, date);
    if (term.skipWeeks.includes(week)) return false;
    if (meeting.weekRule === 'odd' && week % 2 !== 1) return false;
    if (meeting.weekRule === 'even' && week % 2 !== 0) return false;
    if (meeting.weekRule === 'list' && !(meeting.weekList ?? []).includes(week)) return false;
  }
  return !isSkipped(skipIndex, meeting.id, date);
}

/** The term a course runs in: null for a term-less course, undefined when its term is missing (then it never runs). */
/** 课程所在的学期：不属于学期的课程为 null；学期已不存在时为 undefined（此时课程不会上）。 */
export function courseTerm(course: Pick<TimetableCourse, 'termId'>, terms: ReadonlyMap<string, TimetableTerm>): TimetableTerm | null | undefined {
  return course.termId === null ? null : terms.get(course.termId);
}

/**
 * Every class from fromDate through toDate (both included), by start time. A course whose term is missing has
 * no classes, as in the scan, where the term join then fails.
 * 从 fromDate 到 toDate（含两端）的每一节课，按开始时间排序。学期已不存在的课程没有课，与扫描中学期联表失败时一致。
 */
export function occurrencesBetween(data: TimetableData, fromDate: string, toDate: string): TimetableOccurrence[] {
  const terms = new Map(data.terms.map((term) => [term.id, term]));
  const skipIndex = indexSkips(data.skips);
  const byWeekday = new Map<Weekday, { course: TimetableCourse; meeting: TimetableMeeting; term: TimetableTerm | null }[]>();
  for (const course of data.courses) {
    const term = courseTerm(course, terms);
    if (term === undefined) continue;
    for (const meeting of course.meetings) {
      const entries = byWeekday.get(meeting.weekday) ?? [];
      entries.push({ course, meeting, term });
      byWeekday.set(meeting.weekday, entries);
    }
  }
  const out: TimetableOccurrence[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    for (const { course, meeting, term } of byWeekday.get(isoWeekday(date)) ?? []) {
      if (!occursOn(meeting, term, skipIndex, date)) continue;
      out.push({ course, meeting, date, startMs: instantAt(date, meeting.startMin), endMs: instantAt(date, meeting.endMin) });
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || (a.meeting.id < b.meeting.id ? -1 : a.meeting.id > b.meeting.id ? 1 : 0));
}

const SHORT_CODE = /^([A-Z]{3}[A-D0-9][0-9]{2})(?:[HY][0-9])?(?:[FSY])?$/;

/** What a block shows: MAT102H5F as MAT102; anything that is not a UofT code shows its first 8 characters. */
/** 课表方块上显示的代码：MAT102H5F 显示为 MAT102；不是多伦多大学格式的代码显示前 8 个字符。 */
export function shortCode(code: string): string {
  const match = SHORT_CODE.exec(code);
  if (match?.[1]) return match[1];
  return Array.from(code).slice(0, 8).join('');
}
