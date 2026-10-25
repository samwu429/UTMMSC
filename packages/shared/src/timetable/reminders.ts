/**
 * When timetable reminders go out. The minute cron asks classSlots which class starts each lead time can still
 * remind, assignment saves plan their reminders with planAssignmentReminders, and the app shows 下次提醒 from
 * nextClassReminder with the server's exact rules.
 * 课表提醒的发送时间。每分钟的定时任务用 classSlots 找出每种提前时间仍能提醒的上课时刻，保存作业时用 planAssignmentReminders
 * 安排提醒，App 用 nextClassReminder 按服务器完全相同的规则显示「下次提醒」。
 */
import { morningOf, wallClockAt, wallTimeToUtcMs } from '../notifications/schedule';
import { indexSkips, occursOn, courseTerm, type TimetableData, type TimetableOccurrence } from './rules';
import { addDays, instantAt, isoWeekday, TIMETABLE_TIME_ZONE, torontoDateOf } from './time';
import {
  ASSIGNMENT_OFFSETS,
  CLASS_LEADS,
  CLASS_SCAN_MIN_NOTICE_MS,
  TIMETABLE_DAY_START_MIN,
  TIMETABLE_LAST_START_MIN,
  TIMETABLE_STEP_MIN,
  type AssignmentOffset,
  type ClassLead,
  type TimetableCourse,
  type TimetableMeeting,
  type TimetableSettings,
  type TimetableTerm,
  type Weekday,
} from './types';

const MINUTE_MS = 60_000;
const STEP_MS = TIMETABLE_STEP_MIN * MINUTE_MS;
const HOUR_MS = 60 * MINUTE_MS;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** One class start a run can remind for one lead time. occursAt is the start as an ISO instant. */
/** 某次运行能为某种提前时间提醒的一个上课时刻。occursAt 为开始时间的 ISO 表示。 */
export interface ClassSlot {
  lead: ClassLead;
  weekday: Weekday;
  startMin: number;
  onDate: string;
  occursAt: string;
}

/**
 * For each lead L, every 5-minute mark S with T + 2 min <= S <= T + L whose Toronto start lies between 09:00 and
 * 20:50. A class missed by one run is still caught by the next ones until two minutes before it starts, and a
 * longer lead set at the last minute is honoured at once. At most 16 slots per run. Toronto's offsets are whole
 * hours, so 5-minute marks in UTC are 5-minute marks on the wall clock.
 * 对每种提前时间 L，找出满足 T + 2 分钟 <= S <= T + L、且多伦多开始时间在 09:00 到 20:50 之间的每个 5 分钟整点 S。
 * 某次运行错过的课，在开课前两分钟之前仍会被后续运行补上；临时调长的提前时间会立即生效。每次运行最多 16 个时刻。
 * 多伦多与 UTC 的时差都是整小时，因此 UTC 的 5 分钟整点也是本地的 5 分钟整点。
 */
export function classSlots(runMs: number): ClassSlot[] {
  const out: ClassSlot[] = [];
  const first = Math.ceil((runMs + CLASS_SCAN_MIN_NOTICE_MS) / STEP_MS) * STEP_MS;
  for (const lead of CLASS_LEADS) {
    const last = Math.floor((runMs + lead * MINUTE_MS) / STEP_MS) * STEP_MS;
    for (let start = first; start <= last; start += STEP_MS) {
      const w = wallClockAt(start, TIMETABLE_TIME_ZONE);
      const startMin = w.hour * 60 + w.minute;
      if (startMin < TIMETABLE_DAY_START_MIN || startMin > TIMETABLE_LAST_START_MIN) continue;
      out.push({
        lead,
        weekday: (w.weekday === 0 ? 7 : w.weekday) as Weekday,
        startMin,
        onDate: `${w.year}-${pad(w.month)}-${pad(w.day)}`,
        occursAt: new Date(start).toISOString(),
      });
    }
  }
  return out;
}

/** The same Toronto wall time `days` days earlier, so a day keeps its clock time across daylight saving. */
/** 提前 `days` 天的同一多伦多本地时刻，跨过夏令时切换时钟面时间不变。 */
function wallDaysBefore(ms: number, days: number): number {
  const w = wallClockAt(ms, TIMETABLE_TIME_ZONE);
  return wallTimeToUtcMs(w.year, w.month, w.day - days, w.hour, w.minute, TIMETABLE_TIME_ZONE);
}

/**
 * When one reminder of an assignment goes out, as an ISO instant. 30m, 1h and 3h are exact durations; 1d, 2d and
 * 1w keep the deadline's Toronto wall time on an earlier date (a 23:59 deadline the day after the November change
 * is reminded 25 hours before); morning is morningOf the deadline.
 * 作业某个提醒的发送时间（ISO）。30m、1h、3h 是精确时长；1d、2d、1w 在更早的日期保持截止时间的多伦多本地时刻
 * （十一月切换次日 23:59 截止的作业会提前 25 小时提醒）；morning 为截止时间的 morningOf。
 */
export function offsetSendAt(dueAt: string, token: AssignmentOffset): string {
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) throw new RangeError(`invalid due time: ${dueAt}`);
  switch (token) {
    case '30m':
      return new Date(due - 30 * MINUTE_MS).toISOString();
    case '1h':
      return new Date(due - HOUR_MS).toISOString();
    case '3h':
      return new Date(due - 3 * HOUR_MS).toISOString();
    case '1d':
      return new Date(wallDaysBefore(due, 1)).toISOString();
    case '2d':
      return new Date(wallDaysBefore(due, 2)).toISOString();
    case '1w':
      return new Date(wallDaysBefore(due, 7)).toISOString();
    case 'morning':
      return morningOf(new Date(due).toISOString(), TIMETABLE_TIME_ZONE);
  }
}

/** Planned reminders are never closer to now than this, so a save never sends at once. */
/** 安排的提醒与现在至少相隔这么久，保存作业时不会立即发送。 */
const PLAN_MIN_AHEAD_MS = 60_000;

export interface PlannedAssignmentReminder {
  offset: AssignmentOffset;
  /** ISO instant. */
  /** ISO 时间。 */
  sendAt: string;
}

/**
 * The reminders to plan for an assignment, earliest first. Times at or before now + 60 s and at or after the
 * deadline are dropped, and offsets landing on the same instant collapse into the one listed first in
 * ASSIGNMENT_OFFSETS, so the member is never told twice at once.
 * 需要为作业安排的提醒，按时间先后排列。早于或等于现在 + 60 秒、以及晚于或等于截止时间的提醒会被去掉；落在同一时刻的提醒
 * 合并为在 ASSIGNMENT_OFFSETS 中排在前面的那一个，成员不会在同一时刻收到两次提醒。
 */
export function planAssignmentReminders(dueAt: string, offsets: readonly AssignmentOffset[], nowMs: number): PlannedAssignmentReminder[] {
  const due = Date.parse(dueAt);
  if (Number.isNaN(due)) throw new RangeError(`invalid due time: ${dueAt}`);
  const wanted = new Set(offsets);
  const byInstant = new Map<string, AssignmentOffset>();
  for (const offset of ASSIGNMENT_OFFSETS) {
    if (!wanted.has(offset)) continue;
    const sendAt = offsetSendAt(dueAt, offset);
    const ms = Date.parse(sendAt);
    if (ms <= nowMs + PLAN_MIN_AHEAD_MS || ms >= due) continue;
    if (!byInstant.has(sendAt)) byInstant.set(sendAt, offset);
  }
  return [...byInstant]
    .map(([sendAt, offset]) => ({ offset, sendAt }))
    .sort((a, b) => Date.parse(a.sendAt) - Date.parse(b.sendAt));
}

/** How far ahead nextClassReminder looks, so a term starting months away still shows its first reminder. */
/** nextClassReminder 向前查找的天数，几个月后才开学的学期也能显示第一次提醒。 */
export const NEXT_REMINDER_HORIZON_DAYS = 400;

export interface NextClassReminder {
  sendAtMs: number;
  occurrence: TimetableOccurrence;
}

/** A start the scan can ever claim: on a 5-minute mark between 09:00 and 20:50. */
/** 扫描能够领取的开始时间：09:00 到 20:50 之间的 5 分钟整点。 */
function scannable(meeting: TimetableMeeting): boolean {
  return meeting.startMin % TIMETABLE_STEP_MIN === 0 && meeting.startMin >= TIMETABLE_DAY_START_MIN && meeting.startMin <= TIMETABLE_LAST_START_MIN;
}

/**
 * The next class reminder the server will send, for 下次提醒: null when the 课表提醒 switch or class reminders
 * are off, or no class with its course switch on falls in the horizon. It is the first class whose start minus
 * the lead is not yet past; whether this device can receive pushes is shown separately.
 * 服务器将发送的下一次上课提醒，用于「下次提醒」。「课表提醒」或上课提醒关闭、或在查找范围内没有开启提醒的课程时为 null。
 * 结果是开始时间减去提前时间尚未过去的第一节课；这台设备能否收到推送另行显示。
 */
export function nextClassReminder(
  data: TimetableData,
  settings: Pick<TimetableSettings, 'classReminders' | 'classLeadMin'>,
  remindersAllowed: boolean,
  nowMs: number,
): NextClassReminder | null {
  if (!remindersAllowed || !settings.classReminders) return null;
  const leadMs = settings.classLeadMin * MINUTE_MS;
  const terms = new Map(data.terms.map((term) => [term.id, term]));
  const skipIndex = indexSkips(data.skips);
  const byWeekday = new Map<Weekday, { course: TimetableCourse; meeting: TimetableMeeting; term: TimetableTerm | null }[]>();
  for (const course of data.courses) {
    if (!course.remind) continue;
    const term = courseTerm(course, terms);
    if (term === undefined) continue;
    for (const meeting of course.meetings) {
      if (!scannable(meeting)) continue;
      const entries = byWeekday.get(meeting.weekday) ?? [];
      entries.push({ course, meeting, term });
      byWeekday.set(meeting.weekday, entries);
    }
  }
  if (byWeekday.size === 0) return null;
  const today = torontoDateOf(nowMs);
  for (let offset = 0; offset <= NEXT_REMINDER_HORIZON_DAYS; offset += 1) {
    const date = addDays(today, offset);
    let best: NextClassReminder | null = null;
    for (const { course, meeting, term } of byWeekday.get(isoWeekday(date)) ?? []) {
      if (!occursOn(meeting, term, skipIndex, date)) continue;
      const startMs = instantAt(date, meeting.startMin);
      const sendAtMs = startMs - leadMs;
      if (sendAtMs < nowMs) continue;
      if (best && (best.sendAtMs < sendAtMs || (best.sendAtMs === sendAtMs && best.occurrence.meeting.id <= meeting.id))) continue;
      best = { sendAtMs, occurrence: { course, meeting, date, startMs, endMs: instantAt(date, meeting.endMin) } };
    }
    if (best) return best;
  }
  return null;
}
