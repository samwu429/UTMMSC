/**
 * Owner: T3, timetable web core. Where each block of the week grid goes, kept pure so it is tested: which day
 * columns show, each block's top, height and lane, the label a screen reader hears, and the day groups of the
 * list view. Positions are in hours from 09:00; the grid turns them into lengths with the CSS hour height.
 * 维护者：T3，课表网页核心。周课表中每个方块的位置，保持为纯函数以便测试：显示哪些日期列、每个方块的顶部、高度和分栏、
 * 读屏软件读出的标签，以及列表视图按天的分组。位置以距 09:00 的小时数表示；课表用 CSS 的小时高度把它们换算成长度。
 */
import {
  addDays,
  formatClock,
  formatClockRange,
  shortCode,
  TIMETABLE_DAY_END_MIN,
  TIMETABLE_DAY_START_MIN,
  torontoDateOf,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableLocale,
  type TimetableSettings,
  type Weekday,
} from '@utmmsc/shared';
import { kindLabel, weekdayLong } from '../model/labels';
import { lanes, type WeekOccurrence } from '../model/week';
import { hoursFromTop } from './geometry';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * The weekdays the grid shows: always Monday to Friday, and Saturday or Sunday unless 没课时隐藏 is chosen and no
 * course meets that day. It looks at every course rather than the visible week, so swiping never changes the
 * columns.
 * 课表显示的星期：周一到周五总是显示；周六、周日除非选了「没课时隐藏」且没有任何课程在那天上课，否则也显示。
 * 判断依据是所有课程而不是当前这一周，因此左右滑动时列数不会变化。
 */
export function visibleWeekdays(courses: readonly Pick<TimetableCourse, 'meetings'>[], showWeekend: TimetableSettings['showWeekend']): Weekday[] {
  if (showWeekend === 'always') return [...WEEKDAYS];
  const used = new Set<number>();
  for (const course of courses) for (const meeting of course.meetings) used.add(meeting.weekday);
  return WEEKDAYS.filter((day) => day <= 5 || used.has(day));
}

/** A block's identity in the grid: one meeting on one date. */
/** 方块在课表中的标识：某个上课时间在某一天。 */
export function blockKey(occurrence: Pick<WeekOccurrence, 'meeting' | 'date'>): string {
  return `${occurrence.meeting.id}|${occurrence.date}`;
}

export interface BlockPlacement {
  key: string;
  occurrence: WeekOccurrence;
  /** Hours from 09:00 to the top edge, and the height in hours, both kept inside 09:00-21:00. */
  /** 从 09:00 到上边缘的小时数，以及以小时计的高度，都限制在 09:00-21:00 之内。 */
  top: number;
  height: number;
  lane: number;
  lanes: number;
}

/** One day's blocks with their lanes, so overlapping classes sit side by side. */
/** 某一天的方块及其分栏，使重叠的课并排显示。 */
export function placeDay(occurrences: readonly WeekOccurrence[]): BlockPlacement[] {
  const items = occurrences.map((occurrence) => {
    const start = Math.max(TIMETABLE_DAY_START_MIN, Math.min(TIMETABLE_DAY_END_MIN - 5, occurrence.meeting.startMin));
    const end = Math.max(start + 5, Math.min(TIMETABLE_DAY_END_MIN, occurrence.meeting.endMin));
    return { key: blockKey(occurrence), occurrence, start, end };
  });
  const placed = lanes(items.map((item) => ({ key: item.key, startMin: item.start, endMin: item.end })));
  return items.map((item) => {
    const lane = placed.get(item.key) ?? { lane: 0, lanes: 1 };
    return { key: item.key, occurrence: item.occurrence, top: hoursFromTop(item.start), height: (item.end - item.start) / 60, lane: lane.lane, lanes: lane.lanes };
  });
}

/** The week's blocks by date, for the dates of the given weekdays. */
/** 按日期分组的一周方块，只包括给定星期的日期。 */
export function placeWeek(occurrences: readonly WeekOccurrence[], monday: string, weekdays: readonly Weekday[]): Map<string, BlockPlacement[]> {
  const byDate = new Map<string, WeekOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = byDate.get(occurrence.date) ?? [];
    list.push(occurrence);
    byDate.set(occurrence.date, list);
  }
  const out = new Map<string, BlockPlacement[]>();
  for (const weekday of weekdays) {
    const date = addDays(monday, weekday - 1);
    out.set(date, placeDay(byDate.get(date) ?? []));
  }
  return out;
}

/**
 * What a screen reader hears for a block: MAT102 讲座，周一 10:00 到 10:50，DV 2074, plus ，本次不上 for a skipped
 * class and the overlap.
 * 读屏软件对方块读出的内容：MAT102 讲座，周一 10:00 到 10:50，DV 2074；停课时加上「，本次不上」，重叠时也会说明。
 */
export function blockLabel(occurrence: WeekOccurrence, weekday: Weekday, locale: TimetableLocale): string {
  const { course, meeting } = occurrence;
  const code = shortCode(course.code);
  const kind = kindLabel(meeting.kind, locale);
  const section = meeting.section ? ` ${meeting.section}` : '';
  if (locale === 'en') {
    const parts = [`${code} ${kind}${section}`, `${weekdayLong(weekday, 'en')} ${formatClock(meeting.startMin, 'en')} to ${formatClock(meeting.endMin, 'en')}`];
    if (meeting.location) parts.push(meeting.location);
    if (occurrence.skipped) parts.push('skipped this time');
    else if (occurrence.conflict) parts.push('overlaps another class');
    return parts.join(', ');
  }
  const parts = [`${code} ${kind}${section}`, `${weekdayLong(weekday, 'zh')} ${formatClock(meeting.startMin, 'zh')} 到 ${formatClock(meeting.endMin, 'zh')}`];
  if (meeting.location) parts.push(meeting.location);
  if (occurrence.skipped) parts.push('本次不上');
  else if (occurrence.conflict) parts.push('与其他课时间重叠');
  return parts.join('，');
}

export interface ListDay {
  date: string;
  weekday: Weekday;
  items: WeekOccurrence[];
}

/** The list view (列表视图): every shown day of the week with its classes in start order, empty days included. */
/** 列表视图：一周中每个显示的日期及其按开始时间排列的课，没有课的日期也包括在内。 */
export function listWeek(occurrences: readonly WeekOccurrence[], monday: string, weekdays: readonly Weekday[]): ListDay[] {
  return weekdays.map((weekday) => {
    const date = addDays(monday, weekday - 1);
    return { date, weekday, items: occurrences.filter((occurrence) => occurrence.date === date) };
  });
}

/** One line of the list view: 10:00–10:50 · 讲座 LEC0101 · DV 2074. */
/** 列表视图中的一行：10:00–10:50 · 讲座 LEC0101 · DV 2074。 */
export function listLine(occurrence: WeekOccurrence, locale: TimetableLocale): string {
  const { meeting } = occurrence;
  const parts = [formatClockRange(meeting.startMin, meeting.endMin, locale), meeting.section ? `${kindLabel(meeting.kind, locale)} ${meeting.section}` : kindLabel(meeting.kind, locale)];
  if (meeting.location) parts.push(meeting.location);
  return parts.join(' · ');
}

/** Toronto dates with an open assignment due, for the gold dot over a day. */
/** 有未完成作业截止的多伦多日期，用于日期上方的金色圆点。 */
export function dueDates(assignments: readonly Pick<TimetableAssignment, 'dueAt' | 'doneAt'>[]): Set<string> {
  const dates = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.doneAt !== null) continue;
    const ms = Date.parse(assignment.dueAt);
    if (!Number.isNaN(ms)) dates.add(torontoDateOf(ms));
  }
  return dates;
}
