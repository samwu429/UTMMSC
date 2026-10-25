import {
  daysBetween,
  formatClock,
  formatClockRange,
  isoWeekday,
  shortCode,
  torontoDateOf,
  torontoMinuteOf,
  type MeetingKind,
  type PushPayload,
  type TimetableLocale,
} from '@utmmsc/shared';

/**
 * Timetable push copy. Unlike the other pushes it follows the member's language, since timetable_settings.locale
 * records the app's language. All times are Toronto time.
 * 课表推送的文案。与其他推送不同，它使用成员的语言，因为 timetable_settings.locale 记录了 App 的语言。所有时间都是多伦多时间。
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** An assignment push is kept for an offline phone at most this long. */
/** 离线手机最多为作业推送保留这么久。 */
const ASSIGNMENT_TTL_MAX_MS = 12 * HOUR_MS;
const TITLE_MAX = 70;
const BODY_MAX = 160;
const APP_NAME = 'UTMMSC';

/** One class push per device at a time: a newer one replaces it, and Web Push replaces a queued one with the same topic. */
/** 每台设备同一时间只有一条上课通知：较新的会替换它，Web Push 也会替换排队中的同主题推送。 */
export const TIMETABLE_CLASS_TAG = 'tt:class';

/** tt:due:<id> for one assignment, tt:due when several are merged into one push. */
/** 单项作业为 tt:due:<id>，多项作业合并为一条推送时为 tt:due。 */
export function timetableDueTag(assignmentId?: string | null): string {
  return assignmentId ? `tt:due:${assignmentId}` : 'tt:due';
}

function withSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

/** The week view on the class's date, with the class highlighted. */
/** 打开这节课所在日期的周视图，并突出显示这节课。 */
export function timetableClassUrl(baseUrl: string, onDate: string, meetingId: string): string {
  return `${withSlash(baseUrl)}timetable?date=${encodeURIComponent(onDate)}&focus=${encodeURIComponent(meetingId)}`;
}

/** The assignments tab, with one assignment highlighted when given. */
/** 打开作业页；给出作业时突出显示它。 */
export function timetableDueUrl(baseUrl: string, assignmentId?: string | null): string {
  const url = `${withSlash(baseUrl)}timetable/due`;
  return assignmentId ? `${url}?focus=${encodeURIComponent(assignmentId)}` : url;
}

/** Cuts at max code points with an ellipsis, so a character such as an emoji is never split. */
/** 超过 max 个码点时截断并加省略号，表情符号之类的字符不会被拆开。 */
function capped(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max - 1).join('')}…`;
}

function oneLine(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

const KIND_LABELS: Record<TimetableLocale, Partial<Record<MeetingKind, string>>> = {
  // 'other' says nothing useful on a lock screen, so it is left out.
  // 「其他」在锁屏上没有意义，因此不显示。
  zh: { lec: '讲座', tut: '辅导', pra: '实践', lab: '实验', sem: '研讨' },
  en: { lec: 'Lecture', tut: 'Tutorial', pra: 'Practical', lab: 'Lab', sem: 'Seminar' },
};

const WEEKDAY_NAMES: Record<TimetableLocale, readonly string[]> = {
  zh: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function separator(locale: TimetableLocale): string {
  return locale === 'zh' ? '；' : '; ';
}

/** Whole minutes from now to an instant, at least 1. */
/** 从现在到某一时刻的整分钟数，至少为 1。 */
function minutesUntil(ms: number, nowMs: number): number {
  return Math.max(1, Math.round((ms - nowMs) / MINUTE_MS));
}

function ttlUntil(ms: number, nowMs: number): number {
  return Math.max(0, Math.floor((ms - nowMs) / 1000));
}

export interface ClassReminderItem {
  meetingId: string;
  /** The course code as stored; the push shows its short form (MAT102H5F as MAT102). */
  /** 已存的课程代码；推送显示其简写（MAT102H5F 显示为 MAT102）。 */
  code: string;
  kind: MeetingKind;
  location: string | null;
  startMin: number;
  endMin: number;
  /** The Toronto date of the class. */
  /** 这节课的多伦多日期。 */
  onDate: string;
  /** The start as an instant. */
  /** 开始时刻。 */
  startMs: number;
}

export interface ClassReminderInput {
  /** At least one class, all of one member. */
  /** 至少一节课，均属于同一位成员。 */
  classes: readonly ClassReminderItem[];
  locale: TimetableLocale;
  /** The member's preview switch; off shows no code, room or time. */
  /** 成员的「显示消息内容」开关；关闭时不显示课程代码、教室或时间。 */
  preview: boolean;
  /** When the push goes out; the copy states the real minutes left. */
  /** 推送发出的时间；文案写出真实的剩余分钟数。 */
  nowMs: number;
  baseUrl: string;
}

function byStart(a: ClassReminderItem, b: ClassReminderItem): number {
  return a.startMs - b.startMs || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || (a.meetingId < b.meetingId ? -1 : a.meetingId > b.meetingId ? 1 : 0);
}

function codeOf(item: { code: string }): string {
  return shortCode(oneLine(item.code)).trim() || APP_NAME;
}

/**
 * The push for a member's classes in one run. One class reads `MAT102 · 10 分钟后上课` over its time, room and kind;
 * several starting together read `10 分钟后有 2 节课` over each code and room, and several starting at different
 * times (only after a missed run or a late change) add each start time. Its ttl is the time left before the first
 * class, so a phone that was offline never shows it after class has started.
 * 一次运行中某位成员的上课推送。一节课时标题为「MAT102 · 10 分钟后上课」，正文为时间、教室和类型；同时开始的几节课时标题为
 * 「10 分钟后有 2 节课」，正文列出每节课的代码和教室；开始时间不同的几节课（只在错过运行或临时修改之后出现）还会写出各自的开始时间。
 * 保留时间为距第一节课开始的时间，离线过的手机不会在开课后才显示它。
 */
export function classReminderPayload(input: ClassReminderInput): PushPayload {
  const classes = [...input.classes].sort(byStart);
  const first = classes[0];
  if (!first) throw new RangeError('classReminderPayload needs at least one class');
  const zh = input.locale === 'zh';
  const minutes = minutesUntil(first.startMs, input.nowMs);
  const base = {
    tag: TIMETABLE_CLASS_TAG,
    url: timetableClassUrl(input.baseUrl, first.onDate, first.meetingId),
    kind: 'class' as const,
    ttlSeconds: ttlUntil(first.startMs, input.nowMs),
  };
  if (!input.preview) {
    const body = zh ? `${minutes} 分钟后有课` : classes.length > 1 ? `Classes start in ${minutes} min` : `A class starts in ${minutes} min`;
    return { ...base, title: APP_NAME, body };
  }
  if (classes.length === 1) {
    const kind = KIND_LABELS[input.locale][first.kind];
    const parts = [formatClockRange(first.startMin, first.endMin, input.locale), oneLine(first.location), kind ?? ''].filter(Boolean);
    const title = zh ? `${codeOf(first)} · ${minutes} 分钟后上课` : `${codeOf(first)} · class in ${minutes} min`;
    return { ...base, title: capped(title, TITLE_MAX), body: capped(parts.join(' · '), BODY_MAX) };
  }
  const together = classes.every((item) => item.startMs === first.startMs);
  const count = classes.length;
  const title = together
    ? zh
      ? `${minutes} 分钟后有 ${count} 节课`
      : `${count} classes in ${minutes} min`
    : zh
      ? `${count} 节课快开始了`
      : `${count} classes starting soon`;
  const lines = classes.map((item) => [codeOf(item), together ? '' : formatClock(item.startMin, input.locale), oneLine(item.location)].filter(Boolean).join(' '));
  return { ...base, title: capped(title, TITLE_MAX), body: capped(lines.join(separator(input.locale)), BODY_MAX) };
}

export interface AssignmentReminderItem {
  assignmentId: string;
  title: string;
  /** The course code as stored, or null for an assignment without a course. */
  /** 已存的课程代码；作业不属于任何课程时为 null。 */
  courseCode: string | null;
  dueMs: number;
}

export interface AssignmentReminderInput {
  /** At least one assignment, all of one member. */
  /** 至少一项作业，均属于同一位成员。 */
  assignments: readonly AssignmentReminderItem[];
  locale: TimetableLocale;
  preview: boolean;
  nowMs: number;
  baseUrl: string;
}

/**
 * The due time as the member reads it: 今天 23:59 or just 23:59 inside a list, 明天, 后天, the weekday within the
 * week, and the date further out. English has no word for 后天, so it uses the weekday from the second day.
 * 成员读到的截止时间：今天 23:59（列表中只写 23:59）、明天、后天、一周之内写星期几、更远写日期。英文没有「后天」，从第二天起写星期几。
 */
export function formatDueTime(dueMs: number, nowMs: number, locale: TimetableLocale, inList = false): string {
  const dueDate = torontoDateOf(dueMs);
  const days = daysBetween(torontoDateOf(nowMs), dueDate);
  const clock = formatClock(torontoMinuteOf(dueMs), locale);
  const weekday = WEEKDAY_NAMES[locale][isoWeekday(dueDate) - 1];
  const [, month, day] = dueDate.split('-').map(Number) as [number, number, number];
  if (locale === 'zh') {
    if (days === 0) return inList ? clock : `今天 ${clock}`;
    if (days === 1) return `明天 ${clock}`;
    if (days === 2) return `后天 ${clock}`;
    if (days > 2 && days < 7) return `${weekday} ${clock}`;
    return `${month}月${day}日 ${clock}`;
  }
  if (days === 0) return inList ? clock : `today ${clock}`;
  if (days === 1) return `tomorrow ${clock}`;
  if (days > 1 && days < 7) return `${weekday} ${clock}`;
  return `${MONTHS_EN[month - 1]} ${day}, ${clock}`;
}

/**
 * Time left, rounded: minutes under an hour, hours under 23 hours, then days, so a 1d reminder reads 1 天 even on
 * the 23- and 25-hour days around a daylight-saving change.
 * 剩余时间，取整：不到一小时写分钟，不到 23 小时写小时，再往上写天数，因此夏令时切换前后 23 或 25 小时的「提前 1 天」提醒也写作「1 天」。
 */
export function formatTimeLeft(ms: number, locale: TimetableLocale): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  const zh = locale === 'zh';
  if (minutes < 60) return zh ? `${minutes} 分钟` : `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 23) return zh ? `${hours} 小时` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.max(1, Math.round(minutes / (24 * 60)));
  return zh ? `${days} 天` : `${days} ${days === 1 ? 'day' : 'days'}`;
}

function byDue(a: AssignmentReminderItem, b: AssignmentReminderItem): number {
  return a.dueMs - b.dueMs || (a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0);
}

/**
 * The push for a member's assignments in one run. One reads `作业截止提醒 · PS3` over `MAT102 · 明天 23:59 截止（还有 1 天）`;
 * several read `2 项作业快截止了` over each title and due time. Its ttl is the time left before the first deadline, at
 * most 12 hours.
 * 一次运行中某位成员的作业推送。一项作业时标题为「作业截止提醒 · PS3」，正文为「MAT102 · 明天 23:59 截止（还有 1 天）」；
 * 多项作业时标题为「2 项作业快截止了」，正文列出每项作业的名称和截止时间。保留时间为距第一个截止时间的时间，最多 12 小时。
 */
export function assignmentReminderPayload(input: AssignmentReminderInput): PushPayload {
  const assignments = [...input.assignments].sort(byDue);
  const first = assignments[0];
  if (!first) throw new RangeError('assignmentReminderPayload needs at least one assignment');
  const zh = input.locale === 'zh';
  const single = assignments.length === 1;
  const base = {
    tag: timetableDueTag(single ? first.assignmentId : null),
    url: timetableDueUrl(input.baseUrl, single ? first.assignmentId : null),
    kind: 'assignment' as const,
    ttlSeconds: ttlUntil(Math.min(first.dueMs, input.nowMs + ASSIGNMENT_TTL_MAX_MS), input.nowMs),
  };
  const count = assignments.length;
  if (!input.preview) {
    const body = zh ? (single ? '你有一项作业快截止了' : `你有 ${count} 项作业快截止了`) : single ? 'An assignment is due soon' : `${count} assignments are due soon`;
    return { ...base, title: APP_NAME, body };
  }
  const titleOf = (item: AssignmentReminderItem) => oneLine(item.title) || (zh ? '作业' : 'Assignment');
  if (single) {
    const due = formatDueTime(first.dueMs, input.nowMs, input.locale);
    const left = formatTimeLeft(first.dueMs - input.nowMs, input.locale);
    const when = zh ? `${due} 截止（还有 ${left}）` : `due ${due} (in ${left})`;
    const course = first.courseCode ? codeOf({ code: first.courseCode }) : '';
    const title = zh ? `作业截止提醒 · ${titleOf(first)}` : `Assignment due · ${titleOf(first)}`;
    return { ...base, title: capped(title, TITLE_MAX), body: capped(course ? `${course} · ${when}` : when, BODY_MAX) };
  }
  const lines = assignments.map((item) => `${titleOf(item)} ${formatDueTime(item.dueMs, input.nowMs, input.locale, true)}`);
  const title = zh ? `${count} 项作业快截止了` : `${count} assignments due soon`;
  return { ...base, title, body: capped(lines.join(separator(input.locale)), BODY_MAX) };
}
