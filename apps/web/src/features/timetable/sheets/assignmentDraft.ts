/**
 * Owner: T3, timetable web core. The assignment form's model: the due date and time chips, read as Toronto time
 * whatever the device's zone; 课前, the chosen course's next class; and the reminder chips, at most three. The
 * checks mirror the server's readAssignment.
 * 维护者：T3，课表网页核心。作业表单的模型：截止日期和时间的选项，无论设备在哪个时区都按多伦多时间理解；「课前」即所选课程的下一节课；
 * 以及最多三个的提醒选项。检查与服务器的 readAssignment 一致。
 */
import {
  addDays,
  ASSIGNMENT_OFFSETS,
  ASSIGNMENT_OFFSETS_MAX,
  instantAt,
  isoWeekday,
  TIMETABLE_LIMITS,
  torontoDateOf,
  torontoMinuteOf,
  type AssignmentOffset,
  type SaveAssignmentBody,
  type TimetableAssignment,
  type TimetableData,
  type TimetableLocale,
} from '@utmmsc/shared';
import { dueMsOf, isDueDate } from '../model/formatDue';
import { indexTimetable, occurrencesOn } from '../model/occurrences';

export interface AssignmentDraft {
  id: string;
  isNew: boolean;
  title: string;
  courseId: string | null;
  /** Toronto date, YYYY-MM-DD. */
  /** 多伦多日期，YYYY-MM-DD。 */
  dueDate: string;
  /** Toronto minutes after midnight; 23:59 is allowed. */
  /** 多伦多时间午夜起的分钟数；允许 23:59。 */
  dueMin: number;
  offsets: AssignmentOffset[];
  notes: string;
}

export const DEFAULT_DUE_MIN = 23 * 60 + 59;
export const AFTERNOON_DUE_MIN = 17 * 60;

const DAY_MS = 86_400_000;
const DUE_PAST_DAYS = 365;
const DUE_FUTURE_DAYS = 400;
const DUE_PAST_MS = DUE_PAST_DAYS * DAY_MS;
const DUE_FUTURE_MS = DUE_FUTURE_DAYS * DAY_MS;
const BEFORE_CLASS_HORIZON_DAYS = 400;

/** A new assignment: due tomorrow at 23:59 with the default reminders, for the course it was added from. */
/** 新作业：明天 23:59 截止，使用默认提醒，属于添加时所在的课程。 */
export function newAssignmentDraft(options: { id: string; nowMs: number; offsets: readonly AssignmentOffset[]; courseId?: string | null; title?: string }): AssignmentDraft {
  return {
    id: options.id,
    isNew: true,
    title: options.title ?? '',
    courseId: options.courseId ?? null,
    dueDate: addDays(torontoDateOf(options.nowMs), 1),
    dueMin: DEFAULT_DUE_MIN,
    offsets: [...options.offsets],
    notes: '',
  };
}

/** An assignment in the form; a due time that cannot be read leaves the date empty, so the form asks for one. */
/** 表单中的作业；无法读取的截止时间会让日期留空，表单因此要求重新选择日期。 */
export function draftFromAssignment(assignment: TimetableAssignment): AssignmentDraft {
  const ms = dueMsOf(assignment.dueAt);
  return {
    id: assignment.id,
    isNew: false,
    title: assignment.title,
    courseId: assignment.courseId,
    dueDate: ms === null ? '' : torontoDateOf(ms),
    dueMin: ms === null ? DEFAULT_DUE_MIN : torontoMinuteOf(ms),
    offsets: [...assignment.remindOffsets],
    notes: assignment.notes ?? '',
  };
}

export type DueDateChip = 'today' | 'tomorrow' | 'friday' | 'monday';

/**
 * The dates behind 今天 / 明天 / 本周五 / 下周一. Friday is this week's, or next week's once this one has passed.
 * 「今天 / 明天 / 本周五 / 下周一」对应的日期。周五为本周的周五；本周的已过去时为下周的。
 */
export function dueDateChips(today: string): Record<DueDateChip, string> {
  const weekday = isoWeekday(today);
  const friday = addDays(today, 5 - weekday);
  return {
    today,
    tomorrow: addDays(today, 1),
    friday: friday < today ? addDays(friday, 7) : friday,
    monday: addDays(today, 8 - weekday),
  };
}

/**
 * The min and max of the 选日期 picker: a year back to 400 days ahead, the window the server accepts, so pickers
 * never offer a year the form would refuse.
 * 「选日期」选择器的最小值和最大值：一年前到 400 天之后，即服务器接受的范围，因此选择器不会提供表单会拒绝的年份。
 */
export function dueDateBounds(today: string): { min: string; max: string } {
  return { min: addDays(today, -DUE_PAST_DAYS), max: addDays(today, DUE_FUTURE_DAYS) };
}

/** Hours for 选时间, and its minutes: 5-minute steps plus 59, for deadlines such as 23:59. */
/** 「选时间」的小时和分钟：分钟按 5 分钟，另加 59，用于 23:59 这样的截止时间。 */
export const DUE_HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);
export const DUE_MINUTES: readonly number[] = [...Array.from({ length: 12 }, (_, index) => index * 5), 59];

/** 课前: the start of the course's next class from now on, or null when it has none within 400 days. */
/** 「课前」：该课程从现在起下一节课的开始时间；400 天内没有课时为 null。 */
export function beforeClass(data: TimetableData, courseId: string | null, nowMs: number): { date: string; minute: number } | null {
  if (!courseId) return null;
  const course = data.courses.find((c) => c.id === courseId);
  if (!course || course.meetings.length === 0) return null;
  const index = indexTimetable({ terms: data.terms, courses: [course], skips: data.skips });
  const today = torontoDateOf(nowMs);
  for (let offset = 0; offset <= BEFORE_CLASS_HORIZON_DAYS; offset += 1) {
    const next = occurrencesOn(index, addDays(today, offset)).find((occurrence) => occurrence.startMs > nowMs);
    if (next) return { date: next.date, minute: next.meeting.startMin };
  }
  return null;
}

export function dueAtOf(draft: Pick<AssignmentDraft, 'dueDate' | 'dueMin'>): string {
  return new Date(instantAt(draft.dueDate, draft.dueMin)).toISOString();
}

/** The reminder chips: tapping one adds or removes it; a fourth is refused (最多选 3 个提醒). */
/** 提醒选项：点按一个就加入或去掉；第四个会被拒绝（最多选 3 个提醒）。 */
export function toggleOffset(offsets: readonly AssignmentOffset[], token: AssignmentOffset): { offsets: AssignmentOffset[]; refused: boolean } {
  if (offsets.includes(token)) return { offsets: offsets.filter((t) => t !== token), refused: false };
  if (offsets.length >= ASSIGNMENT_OFFSETS_MAX) return { offsets: [...offsets], refused: true };
  const set = new Set([...offsets, token]);
  return { offsets: ASSIGNMENT_OFFSETS.filter((t) => set.has(t)), refused: false };
}

const OFFSET_ZH: Record<AssignmentOffset, string> = { '1w': '1周', '2d': '2天', '1d': '1天', morning: '当天早上', '3h': '3小时', '1h': '1小时', '30m': '30分钟' };
const OFFSET_EN: Record<AssignmentOffset, string> = { '1w': '1 week', '2d': '2 days', '1d': '1 day', morning: 'Morning of', '3h': '3 h', '1h': '1 h', '30m': '30 min' };

export function offsetLabel(token: AssignmentOffset, locale: TimetableLocale): string {
  return (locale === 'en' ? OFFSET_EN : OFFSET_ZH)[token];
}

export type AssignmentProblem = 'title' | 'due_range';

/**
 * What keeps the form from saving: a blank title, or a due time more than a year ago or 400 days ahead. A missing
 * date or one outside 2000-2100 is out of range too, checked before any calendar helper can throw on it.
 * 阻止表单保存的问题：作业名称为空，或截止时间早于一年前、晚于 400 天之后。没有日期或日期不在 2000-2100 年之间也算超出范围，
 * 并且在任何日历工具可能因此抛出异常之前就检查。
 */
export function assignmentProblem(draft: AssignmentDraft, nowMs: number): AssignmentProblem | null {
  if (draft.title.trim() === '') return 'title';
  if (!isDueDate(draft.dueDate)) return 'due_range';
  const due = instantAt(draft.dueDate, draft.dueMin);
  if (due < nowMs - DUE_PAST_MS || due > nowMs + DUE_FUTURE_MS) return 'due_range';
  return null;
}

export function draftToBody(draft: AssignmentDraft): SaveAssignmentBody {
  const notes = draft.notes.trim();
  return {
    id: draft.id,
    courseId: draft.courseId,
    title: Array.from(draft.title.trim()).slice(0, TIMETABLE_LIMITS.assignmentTitle).join(''),
    notes: notes === '' ? null : notes,
    dueAt: dueAtOf(draft),
    remindOffsets: ASSIGNMENT_OFFSETS.filter((token) => draft.offsets.includes(token)),
  };
}
