/**
 * Owner: T3, timetable web core. The page's pure decisions: which tab a path is, what a deep link asks for
 * (?date=…&focus=tm_… on the grid, ?focus=ta_… on 作业, ?add=course or ?add=assignment for a new item), the week the
 * page opens on, and where + puts a new class.
 * 维护者：T3，课表网页核心。页面中的纯函数判断：路径对应哪个标签、深层链接要求什么（课表上为 ?date=…&focus=tm_…，作业上为 ?focus=ta_…，
 * 新建条目为 ?add=course 或 ?add=assignment）、页面打开时显示哪一周，以及 + 把新课放在哪里。
 */
import {
  isoWeekday,
  isTimetableDate,
  isTimetableId,
  mondayOf,
  TIMETABLE_DAY_START_MIN,
  torontoMinuteOf,
  type Weekday,
} from '@utmmsc/shared';
import { LATEST_TAP_START_MIN } from '../grid/geometry';

export type TimetableTabKey = 'week' | 'due';

export function tabOfPath(pathname: string): TimetableTabKey {
  return pathname.replace(/\/+$/, '').endsWith('/due') ? 'due' : 'week';
}

export interface DeepLink {
  /** The week to show, as its Monday. */
  /** 要显示的那一周（以周一表示）。 */
  monday: string | null;
  /** The block to flash on the grid: meeting id and date. */
  /** 课表上要闪烁的方块：上课时间 id 与日期。 */
  block: { meetingId: string; date: string } | null;
  /** The assignment to scroll to and flash on 作业. */
  /** 作业标签中要滚动到并闪烁的作业。 */
  assignmentId: string | null;
  /** The form to open: ?add=course (the home card's 手动添加 and 添加课程) or ?add=assignment. */
  /** 要打开的表单：?add=course（首页卡片的「手动添加」和「添加课程」）或 ?add=assignment。 */
  add: 'course' | 'assignment' | null;
}

/** What a link's query asks for; anything malformed is ignored. Null when it asks for nothing. */
/** 链接的查询参数要求的内容；格式不对的部分被忽略。没有任何要求时为 null。 */
export function readDeepLink(search: string): DeepLink | null {
  const params = new URLSearchParams(search);
  const date = params.get('date');
  const focus = params.get('focus');
  const add = params.get('add');
  if (date === null && focus === null && add === null) return null;
  const validDate = date !== null && isTimetableDate(date) ? date : null;
  return {
    monday: validDate ? mondayOf(validDate) : null,
    block: validDate && focus && isTimetableId(focus, 'tm') ? { meetingId: focus, date: validDate } : null,
    assignmentId: focus && isTimetableId(focus, 'ta') ? focus : null,
    add: add === 'course' || add === 'assignment' ? add : null,
  };
}

/**
 * The form a deep link opens: 添加课程 at the slot + would pick in the week the page shows (the linked week when
 * the link names one), or 添加作业. Null when the link asks for no form.
 * 深层链接要打开的表单：在页面显示的那一周（链接指定了周时为该周）中、按 + 会选的时间打开「添加课程」，或打开「添加作业」。
 * 链接没有要求打开表单时为 null。
 */
export function linkedForm(
  link: DeepLink,
  today: string,
  monday: string,
  nowMs: number,
): { kind: 'course'; date: string; at: { weekday: Weekday; startMin: number } } | { kind: 'assignment' } | null {
  if (link.add === 'assignment') return { kind: 'assignment' };
  if (link.add !== 'course') return null;
  const slot = defaultSlot(today, link.monday ?? monday, nowMs);
  return { kind: 'course', date: slot.date, at: slot.at };
}

export function initialMonday(search: string, today: string): string {
  return readDeepLink(search)?.monday ?? mondayOf(today);
}

/**
 * Where + puts a new class: today at the next half hour when the visible week is this week and that half hour
 * still fits (no later than 20:30), otherwise 10:00, on the visible week's Monday when it is another week.
 * + 添加新课的位置：如果当前显示的是本周，且下一个半点仍在范围内（不晚于 20:30），则为今天的下一个半点；否则为 10:00；
 * 显示的是其他周时放在那一周的周一。
 */
export function defaultSlot(today: string, monday: string, nowMs: number): { date: string; at: { weekday: Weekday; startMin: number } } {
  const thisWeek = mondayOf(today) === monday;
  const date = thisWeek ? today : monday;
  let startMin = 600;
  if (thisWeek) {
    const next = Math.floor(torontoMinuteOf(nowMs) / 30) * 30 + 30;
    if (next >= TIMETABLE_DAY_START_MIN && next <= LATEST_TAP_START_MIN) startMin = next;
  }
  return { date, at: { weekday: isoWeekday(date), startMin } };
}
