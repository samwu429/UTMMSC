/**
 * Owner: T4, timetable import and export. What the 导入日历文件 preview says, in both languages, kept apart from
 * the sheet so it can be tested: the file checks, each term, class and deadline line, what was left out, and why
 * the import button is off.
 * 维护者：T4，课表导入导出。「导入日历文件」预览中显示的文字（两种语言），与界面分开以便测试：文件检查、每个学期、每节课和每个截止时间的说明、
 * 未能导入的内容，以及导入按钮不可用的原因。
 */
import {
  TIMETABLE_DAY_END_MIN,
  TIMETABLE_DAY_START_MIN,
  TIMETABLE_LAST_START_MIN,
  TIMETABLE_MEETING_MIN_MIN,
  TIMETABLE_STEP_MIN,
  formatClockRange,
  termWeekCount,
  type TimetableLocale,
} from '@utmmsc/shared';
import { dueWhen } from '../model/formatDue';
import { dateRange, kindLabel, weekRuleText, weekdayShort } from '../model/labels';
import { parseIcs, type IcsCalendar } from './parse';
import type { ImportAssignmentDraft, ImportMeetingDraft, ImportPlan, ImportProblem, ImportTermDraft } from './plan';

/** Larger files are refused before they are read: a whole-life calendar export is never a timetable. */
/** 更大的文件在读取前就被拒绝：一辈子的日历导出不会是课表。 */
export const ICS_MAX_BYTES = 5 * 1024 * 1024;

export type CalendarFileProblem = 'too_large' | 'not_calendar' | 'nothing';

export type CalendarFileResult = { ok: true; calendar: IcsCalendar } | { ok: false; problem: CalendarFileProblem };

/** The file's text read as a calendar, or why it cannot be one. */
/** 把文件文字读成日历，或说明它为什么不是日历。 */
export function readCalendarText(text: string): CalendarFileResult {
  if (!/BEGIN:VCALENDAR/i.test(text)) return { ok: false, problem: 'not_calendar' };
  const calendar = parseIcs(text);
  if (calendar.events.length === 0) return { ok: false, problem: 'nothing' };
  return { ok: true, calendar };
}

/** Whether a plan offers anything at all to import. */
/** 导入计划中是否有任何可导入的内容。 */
export function planIsEmpty(plan: ImportPlan): boolean {
  return plan.courses.length === 0 && plan.assignments.length === 0;
}

export function fileProblemText(problem: CalendarFileProblem | 'unreadable', locale: TimetableLocale): string {
  const en = locale === 'en';
  switch (problem) {
    case 'too_large':
      return en ? 'The file is too large (5 MB at most).' : '文件太大（最大 5 MB）。';
    case 'not_calendar':
      return en ? "This isn't a calendar (.ics) file." : '这不是日历文件（.ics）。';
    case 'nothing':
      return en ? 'Nothing in this file can be imported as classes or deadlines.' : '文件中没有可以导入的课程或截止时间。';
    case 'unreadable':
      return en ? 'The file could not be read.' : '无法读取这个文件。';
  }
}

/** 9/8–12/1 · 13 周 · 阅读周：第 6 周. */
export function termLine(term: Pick<ImportTermDraft, 'startsOn' | 'endsOn' | 'skipWeeks'>, locale: TimetableLocale): string {
  const en = locale === 'en';
  const weeks = termWeekCount(term);
  const parts = [dateRange(term.startsOn, term.endsOn, locale), en ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'}` : `${weeks} 周`];
  if (term.skipWeeks.length) {
    const list = term.skipWeeks.join(en ? ', ' : '、');
    parts.push(en ? `No classes in week ${list}` : `第 ${list} 周不上课`);
  }
  return parts.join(' · ');
}

/** 周二 10:00–11:00 · DV 2074 · 讲座 LEC0101 · 每周 · 停课 1 次, using the given (possibly fixed) times. */
/** 周二 10:00–11:00 · DV 2074 · 讲座 LEC0101 · 每周 · 停课 1 次，使用给定的（可能已修改的）时间。 */
export function meetingLine(meeting: ImportMeetingDraft, startMin: number, endMin: number, locale: TimetableLocale): string {
  const en = locale === 'en';
  const parts = [`${weekdayShort(meeting.weekday, locale)} ${clockRange(startMin, endMin, locale)}`];
  if (meeting.location) parts.push(meeting.location);
  parts.push([kindLabel(meeting.kind, locale), meeting.section].filter(Boolean).join(' '));
  parts.push(weekRuleText(meeting, locale));
  const skips = meeting.skipDates.length;
  if (skips) parts.push(en ? `${skips} ${skips === 1 ? 'date' : 'dates'} off` : `停课 ${skips} 次`);
  return parts.join(' · ');
}

/**
 * A clock range that may lie outside the day, as an imported time can: past midnight it still reads as a clock.
 * 可能超出一天范围的时间段（导入的时间可能如此）：超过午夜后仍按时钟显示。
 */
function clockRange(startMin: number, endMin: number, locale: TimetableLocale): string {
  return formatClockRange(startMin % 1440, endMin === 1440 ? 1440 : endMin % 1440, locale);
}

/** Why the file's time cannot be used as it is. */
/** 文件中的时间为什么不能直接使用。 */
export function meetingProblemText(problem: NonNullable<ImportMeetingDraft['problem']>, locale: TimetableLocale): string {
  if (problem === 'meeting_too_short') return locale === 'en' ? 'Must end at least 10 minutes after it starts' : '结束要比开始晚至少 10 分钟';
  return locale === 'en' ? 'Must be between 9:00 AM and 9:00 PM' : '时间要在 09:00–21:00 之间';
}

/** MAT102 · 10月30日 周五 23:59, or the due time alone. */
/** MAT102 · 10月30日 周五 23:59，或只有截止时间。 */
export function assignmentLine(assignment: Pick<ImportAssignmentDraft, 'courseCode' | 'dueAt'>, nowMs: number, locale: TimetableLocale): string {
  const when = dueWhen(Date.parse(assignment.dueAt), nowMs, locale);
  return assignment.courseCode ? `${assignment.courseCode} · ${when}` : when;
}

/** 另有 3 个事件无法导入：1 个不是每周重复，2 个已经过去. Null when nothing was left out. */
/** 另有 3 个事件无法导入：1 个不是每周重复，2 个已经过去。没有遗漏时为 null。 */
export function ignoredText(ignored: ImportPlan['ignored'], locale: TimetableLocale): string | null {
  const en = locale === 'en';
  const total = ignored.repeating + ignored.allDay + ignored.noEnd + ignored.past;
  if (total === 0) return null;
  const parts: string[] = [];
  if (ignored.repeating) parts.push(en ? `${ignored.repeating} ${ignored.repeating === 1 ? "doesn't" : "don't"} repeat weekly` : `${ignored.repeating} 个不是每周重复`);
  if (ignored.allDay) parts.push(en ? `${ignored.allDay} ${ignored.allDay === 1 ? 'is' : 'are'} all-day` : `${ignored.allDay} 个是全天事件`);
  if (ignored.noEnd) parts.push(en ? `${ignored.noEnd} ${ignored.noEnd === 1 ? 'repeats' : 'repeat'} every few weeks with no end` : `${ignored.noEnd} 个隔周重复且没有结束日期`);
  if (ignored.past) parts.push(en ? `${ignored.past} ${ignored.past === 1 ? 'is' : 'are'} over or too far ahead` : `${ignored.past} 个已经过去或太远`);
  return en
    ? `${total} more ${total === 1 ? 'event' : 'events'} can't be imported: ${parts.join(', ')}.`
    : `另有 ${total} 个事件无法导入：${parts.join('，')}。`;
}

export function importProblemText(problem: ImportProblem, locale: TimetableLocale): string {
  const en = locale === 'en';
  switch (problem.kind) {
    case 'course_code':
      return en ? `Course codes need 1 to 20 characters${problem.code.trim() ? `: ${problem.code.trim()}` : ''}` : `课程代码需要 1 到 20 个字符${problem.code.trim() ? `：${problem.code.trim()}` : ''}`;
    case 'too_many_meetings':
      return en ? `${problem.code} can have at most 10 class times` : `${problem.code} 最多 10 个上课时间`;
    case 'meeting_time':
      return en ? `A class time of ${problem.code} is outside 9:00 AM–9:00 PM` : `${problem.code} 有上课时间不在 09:00–21:00 之间`;
    case 'too_many_courses':
      return en ? `You can have at most ${problem.max} courses` : `最多 ${problem.max} 门课程`;
    case 'too_many_terms':
      return en ? `You can have at most ${problem.max} terms` : `最多 ${problem.max} 个学期`;
    case 'too_many_skips':
      return en ? `You can have at most ${problem.max} dates with no class` : `停课日期最多 ${problem.max} 个`;
    case 'too_many_assignments':
      return en ? `You can have at most ${problem.max} open assignments` : `未完成的作业最多 ${problem.max} 项`;
    case 'term_name':
      return en ? 'Enter a name for each new term' : '请填写每个新学期的名称';
  }
}

/** 导入 2 门课程、3 项作业, or the one that is there. */
/** 导入 2 门课程、3 项作业，或只有其中一项。 */
export function importButtonText(counts: { courses: number; assignments: number }, locale: TimetableLocale): string {
  const en = locale === 'en';
  const parts: string[] = [];
  if (counts.courses) parts.push(en ? `${counts.courses} ${counts.courses === 1 ? 'course' : 'courses'}` : `${counts.courses} 门课程`);
  if (counts.assignments) parts.push(en ? `${counts.assignments} ${counts.assignments === 1 ? 'assignment' : 'assignments'}` : `${counts.assignments} 项作业`);
  if (!parts.length) return en ? 'Choose what to import' : '请选择要导入的内容';
  return en ? `Import ${parts.join(' and ')}` : `导入 ${parts.join('、')}`;
}

/** 已导入 2 门课程、3 项作业. */
export function importDoneText(counts: { courses: number; assignments: number }, locale: TimetableLocale): string {
  const button = importButtonText(counts, locale);
  return locale === 'en' ? button.replace(/^Import /, 'Imported ') : button.replace(/^导入 /, '已导入 ');
}

/** Every allowed start, 09:00 to 20:50 in 5-minute steps. */
/** 所有允许的开始时间：09:00 到 20:50，每 5 分钟一个。 */
export function startTimeOptions(): number[] {
  const out: number[] = [];
  for (let minute = TIMETABLE_DAY_START_MIN; minute <= TIMETABLE_LAST_START_MIN; minute += TIMETABLE_STEP_MIN) out.push(minute);
  return out;
}

/** Every allowed end for a start: 10 minutes later up to 21:00. */
/** 某个开始时间所有允许的结束时间：晚 10 分钟起到 21:00。 */
export function endTimeOptions(startMin: number): number[] {
  const out: number[] = [];
  for (let minute = startMin + TIMETABLE_MEETING_MIN_MIN; minute <= TIMETABLE_DAY_END_MIN; minute += TIMETABLE_STEP_MIN) out.push(minute);
  return out;
}

/** The end kept when the start moves: the same length when it still fits, else the nearest allowed end. */
/** 开始时间变化后保留的结束时间：仍能容纳时保持原时长，否则取最接近的允许结束时间。 */
export function endAfterStartChange(oldStart: number, oldEnd: number, newStart: number): number {
  const length = Math.max(TIMETABLE_MEETING_MIN_MIN, oldEnd - oldStart);
  return Math.min(TIMETABLE_DAY_END_MIN, Math.max(newStart + TIMETABLE_MEETING_MIN_MIN, newStart + length));
}
