/**
 * Owner: T4, timetable home card. What the 今日课表 card says (timetable-final.md section 8), worked out from the
 * timetable, the instant and this device's notification state, kept apart from the card so it can be tested: the
 * title row, the main line by state, the rest of today's classes, the 作业 row and the bell chip.
 * 维护者：T4，课表首页卡片。「今日课表」卡片显示的内容（timetable-final.md 第 8 节），由课表、当前时刻和这台设备的通知状态得出，
 * 与卡片分开以便测试：标题行、按状态显示的主行、今天其余的课、「作业」行和提醒标签。
 */
import {
  daysBetween,
  formatClock,
  formatClockRange,
  isoWeekday,
  mondayOf,
  nextClassReminder,
  shortCode,
  torontoDateOf,
  torontoMinuteOf,
  type ClassLead,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableOccurrence,
  type TimetableSettings,
  type TimetableSkip,
  type TimetableTerm,
} from '@utmmsc/shared';
import type { DeviceState, PushCapability } from '../../notifications/capability';
import { formatDue } from '../model/formatDue';
import { monthDay, weekTitle, weekdayShort } from '../model/labels';
import { nextUp, type NextUp } from '../model/nextUp';

const HOUR_MS = 3_600_000;
const SOON_MS = 48 * HOUR_MS;
/** Up to this many more of today's classes are listed under the main line. */
/** 主行下方最多再列出今天的这么多节课。 */
export const TODAY_MORE_CLASSES = 2;
export const NOTIFICATION_SETTINGS_PATH = '/settings?tab=settings&screen=notifications';

/** Where a class opens in the week view, flashing its block. */
/** 在周课表中打开某节课并让其方块闪烁的链接。 */
export function classLink(occurrence: Pick<TimetableOccurrence, 'date' | 'meeting'>): string {
  return `/timetable?date=${occurrence.date}&focus=${encodeURIComponent(occurrence.meeting.id)}`;
}

export function assignmentLink(id: string): string {
  return `/timetable/due?focus=${encodeURIComponent(id)}`;
}

/** 周一 · 第9周, or 周一 alone outside a term. */
/** 周一 · 第9周；学期外只有「周一」。 */
export function headerText(terms: readonly TimetableTerm[], today: string, locale: TimetableLocale): string {
  const weekday = weekdayShort(isoWeekday(today), locale);
  const week = weekTitle(terms, mondayOf(today), locale);
  return week.term ? `${weekday} · ${week.text}` : weekday;
}

/** 明天, 周三, or 11月3日 周二 for a later date; the day of a coming class or reminder. */
/** 明天、周三，或更远日期的「11月3日 周二」；用于之后的课或提醒的日期。 */
export function dayLabel(date: string, today: string, locale: TimetableLocale): string {
  const days = daysBetween(today, date);
  const en = locale === 'en';
  if (days === 0) return en ? 'Today' : '今天';
  if (days === 1) return en ? 'Tomorrow' : '明天';
  const weekday = weekdayShort(isoWeekday(date), locale);
  if (days > 1 && days < 7) return weekday;
  return en ? `${weekday}, ${monthDay(date, 'en')}` : `${monthDay(date, 'zh')} ${weekday}`;
}

/** 35 分钟后, 1 小时 5 分钟后, 2 小时后. */
export function startsIn(minutes: number, locale: TimetableLocale): string {
  const en = locale === 'en';
  if (minutes < 60) return en ? `in ${minutes} min` : `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (en) return rest ? `in ${hours} h ${rest} min` : `in ${hours} h`;
  return rest ? `${hours} 小时 ${rest} 分钟后` : `${hours} 小时后`;
}

function code(course: Pick<TimetableCourse, 'code'>): string {
  return shortCode(course.code);
}

/** 10:00–10:50 · MAT102 · DV 2074. */
export function classLine(occurrence: TimetableOccurrence, locale: TimetableLocale): string {
  const { meeting, course } = occurrence;
  return [formatClockRange(meeting.startMin, meeting.endMin, locale), code(course), meeting.location].filter(Boolean).join(' · ');
}

/** 明天 09:00 MAT102: a class on a later day, for the 都上完了 and 没有课 lines. */
/** 明天 09:00 MAT102：之后某天的课，用于「都上完了」和「没有课」两行。 */
function laterClass(occurrence: TimetableOccurrence, today: string, locale: TimetableLocale): string {
  return `${dayLabel(occurrence.date, today, locale)} ${formatClock(occurrence.meeting.startMin, locale)} ${code(occurrence.course)}`;
}

export type MainLine =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'in_class'; label: string; text: string; progress: number; link: string }
  | { kind: 'next'; label: string; text: string; pill: string; link: string }
  | { kind: 'quiet'; text: string; link: string | null };

export interface LaterLine {
  key: string;
  text: string;
  link: string;
}

/**
 * The main line and the rest of today's classes. A day off for a holiday says so with its label; reading week
 * says 阅读周.
 * 主行和今天其余的课。因假日停课时显示假日名称；阅读周显示「阅读周」。
 */
export function mainLine(
  data: { loaded: boolean; terms: readonly TimetableTerm[]; courses: readonly TimetableCourse[]; skips: readonly TimetableSkip[] },
  nowMs: number,
  locale: TimetableLocale,
): { main: MainLine; later: LaterLine[] } {
  if (!data.loaded) return { main: { kind: 'loading' }, later: [] };
  const en = locale === 'en';
  const today = torontoDateOf(nowMs);
  const up: NextUp = nextUp(data, nowMs);
  const laterOf = (list: TimetableOccurrence[]): LaterLine[] =>
    list.slice(0, TODAY_MORE_CLASSES).map((occurrence) => ({ key: `${occurrence.meeting.id}|${occurrence.date}`, text: classLine(occurrence, locale), link: classLink(occurrence) }));
  switch (up.state) {
    case 'empty':
      return { main: { kind: 'empty' }, later: [] };
    case 'in_class': {
      const { current } = up;
      return {
        main: {
          kind: 'in_class',
          label: en ? `In class · ${up.minutesLeft} min left` : `正在上课 · 还剩 ${up.minutesLeft} 分钟`,
          text: [code(current.course), current.meeting.location].filter(Boolean).join(' · '),
          progress: up.progress,
          link: classLink(current),
        },
        later: laterOf(up.laterToday),
      };
    }
    case 'next':
      return {
        main: { kind: 'next', label: en ? 'Next' : '下一节', text: classLine(up.next, locale), pill: startsIn(up.minutesUntil, locale), link: classLink(up.next) },
        later: laterOf(up.laterToday),
      };
    case 'done_today': {
      const head = en ? 'Done for today' : '今天的课都上完了';
      const text = up.next ? `${head} · ${laterClass(up.next, today, locale)}` : head;
      return { main: { kind: 'quiet', text, link: up.next ? classLink(up.next) : null }, later: [] };
    }
    case 'skip_week':
      return { main: { kind: 'quiet', text: en ? 'Reading week · no classes' : '阅读周 · 不上课', link: up.next ? classLink(up.next) : null }, later: [] };
    case 'no_class_today': {
      const holiday = data.skips.find((skip) => skip.onDate === today && skip.meetingId === null);
      if (holiday) {
        const name = holiday.label ?? (en ? 'Holiday' : '假日');
        return { main: { kind: 'quiet', text: en ? `${name} · no classes` : `${name} · 不上课`, link: up.next ? classLink(up.next) : null }, later: [] };
      }
      const head = en ? 'No classes today' : '今天没有课';
      const text = up.next ? `${head} · ${en ? 'Next:' : '下一节'} ${laterClass(up.next, today, locale)}` : head;
      return { main: { kind: 'quiet', text, link: up.next ? classLink(up.next) : null }, later: [] };
    }
  }
}

export interface AssignmentRow {
  overdue: number;
  soon: number;
  /** 1 项已逾期 · 2 项 48 小时内截止; empty when nothing is overdue or close. */
  /** 1 项已逾期 · 2 项 48 小时内截止；没有逾期或临近截止的作业时为空。 */
  overdueText: string | null;
  soonText: string | null;
  first: {
    id: string;
    title: string;
    /** MAT102 · 周五 23:59. */
    meta: string;
    /** 还剩 5 小时 / 逾期 2 天. */
    relative: string;
    overdue: boolean;
    course: TimetableCourse | null;
  };
}

/** The 作业 row: counts, and the open assignment due first. Null when nothing is open. */
/** 「作业」行：数量，以及最先截止的未完成作业。没有未完成作业时为 null。 */
export function assignmentRow(
  assignments: readonly TimetableAssignment[],
  courses: readonly TimetableCourse[],
  nowMs: number,
  locale: TimetableLocale,
): AssignmentRow | null {
  const en = locale === 'en';
  const open = assignments
    .filter((assignment) => assignment.doneAt === null && !Number.isNaN(Date.parse(assignment.dueAt)))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || (a.id < b.id ? -1 : 1));
  const head = open[0];
  if (!head) return null;
  let overdue = 0;
  let soon = 0;
  for (const assignment of open) {
    const due = Date.parse(assignment.dueAt);
    if (due < nowMs) overdue += 1;
    else if (due - nowMs <= SOON_MS) soon += 1;
  }
  const course = head.courseId ? (courses.find((item) => item.id === head.courseId) ?? null) : null;
  const due = formatDue(head.dueAt, nowMs, locale);
  return {
    overdue,
    soon,
    overdueText: overdue ? (en ? `${overdue} overdue` : `${overdue} 项已逾期`) : null,
    soonText: soon ? (en ? `${soon} due within 48 h` : `${soon} 项 48 小时内截止`) : null,
    first: {
      id: head.id,
      title: head.title,
      meta: course ? `${code(course)} · ${due.when}` : due.when,
      relative: due.relative,
      overdue: due.overdue,
      course,
    },
  };
}

export type BellChip =
  | { kind: 'master_off'; text: string; link: string }
  | { kind: 'ios_install'; text: string; link: string }
  | { kind: 'off'; text: string }
  | { kind: 'device_blocked'; text: string; link: string }
  | { kind: 'enable_device'; text: string }
  | { kind: 'on'; text: string };

export interface BellInput {
  remindersAllowed: boolean;
  settings: Pick<TimetableSettings, 'classReminders' | 'classLeadMin'>;
  /** When the next class reminder goes out, or null when none is planned. */
  /** 下一次上课提醒的发送时间；没有计划时为 null。 */
  nextSendAtMs: number | null;
  capability: PushCapability | null;
  device: DeviceState;
  serverReady: boolean | null;
  nowMs: number;
}

/** Whether a tap on this device can turn its notifications on. */
/** 在这台设备上点一下能否开启通知。 */
export function canEnableHere(capability: PushCapability | null, device: DeviceState, serverReady: boolean | null): boolean {
  if (device !== 'off') return false;
  return capability === 'native' || (capability === 'webpush' && serverReady === true);
}

/** 09:50, 明天 09:50, 周一 09:50: when the next reminder goes out. */
/** 09:50、明天 09:50、周一 09:50：下一次提醒的发送时间。 */
export function reminderWhen(sendAtMs: number, nowMs: number, locale: TimetableLocale): string {
  const today = torontoDateOf(nowMs);
  const date = torontoDateOf(sendAtMs);
  const clock = formatClock(torontoMinuteOf(sendAtMs), locale);
  return date === today ? clock : `${dayLabel(date, today, locale)} ${clock}`;
}

export function bellChip(input: BellInput, locale: TimetableLocale): BellChip {
  const en = locale === 'en';
  if (!input.remindersAllowed) {
    return { kind: 'master_off', text: en ? 'Timetable reminders are off in Settings' : '已在设置中关闭课表提醒', link: NOTIFICATION_SETTINGS_PATH };
  }
  if (input.capability === 'ios-install') {
    return { kind: 'ios_install', text: en ? 'Add to Home Screen to get class reminders' : 'iPhone 添加到主屏幕后才能收到上课提醒', link: NOTIFICATION_SETTINGS_PATH };
  }
  if (!input.settings.classReminders) return { kind: 'off', text: en ? 'Turn on class reminders' : '开启上课提醒' };
  if (input.device === 'denied') {
    return {
      kind: 'device_blocked',
      text: en ? 'Class reminders are on · notifications are blocked here' : '上课提醒已开启 · 这台设备的通知被拦截了',
      link: NOTIFICATION_SETTINGS_PATH,
    };
  }
  if (canEnableHere(input.capability, input.device, input.serverReady)) {
    return { kind: 'enable_device', text: en ? 'Class reminders are on · get them on this device' : '上课提醒已开启 · 在这台设备上接收' };
  }
  const lead: ClassLead = input.settings.classLeadMin;
  const head = en ? `Class reminders · ${lead} min before` : `上课提醒 · 提前 ${lead} 分钟`;
  if (input.nextSendAtMs === null) return { kind: 'on', text: head };
  const when = reminderWhen(input.nextSendAtMs, input.nowMs, locale);
  return { kind: 'on', text: en ? `${head} · next ${when}` : `${head} · 下次 ${when}` };
}

/** The send time of the next class reminder, by the server's own rules. */
/** 按服务器自己的规则算出的下一次上课提醒发送时间。 */
export function nextReminderAt(
  data: { terms: readonly TimetableTerm[]; courses: readonly TimetableCourse[]; skips: readonly TimetableSkip[] },
  settings: Pick<TimetableSettings, 'classReminders' | 'classLeadMin'>,
  remindersAllowed: boolean,
  nowMs: number,
): number | null {
  return nextClassReminder(data, settings, remindersAllowed, nowMs)?.sendAtMs ?? null;
}
