/**
 * Owner: T3, timetable web core. What the home card's main line says, in Toronto time.
 * 维护者：T3，课表网页核心。首页卡片主行显示的内容，按多伦多时间计算。
 */
import { addDays, termFor, torontoDateOf, weekOfTerm, type TimetableData, type TimetableOccurrence, type TimetableTerm } from '@utmmsc/shared';
import { firstDayWithClasses, indexTimetable, occurrencesOn, type DayOccurrence } from './occurrences';

/**
 * empty: no courses at all. in_class: 正在上课 with minutes left and progress 0-1. next: 下一节 today. done_today:
 * 今天的课都上完了, with the next class on a later day. no_class_today: 今天没有课, with the next class. skip_week:
 * a term week with no classes, such as 阅读周. laterToday holds the classes after the main one today.
 * empty：没有任何课程。in_class：正在上课，附剩余分钟数和 0-1 的进度。next：今天的下一节课。done_today：今天的课都上完了，附之后某天的下一节课。
 * no_class_today：今天没有课，附下一节课。skip_week：学期中不上课的一周，例如阅读周。laterToday 为今天主行那节课之后的课。
 */
export type NextUp =
  | { state: 'empty' }
  | { state: 'in_class'; current: TimetableOccurrence; minutesLeft: number; progress: number; laterToday: TimetableOccurrence[] }
  | { state: 'next'; next: TimetableOccurrence; minutesUntil: number; laterToday: TimetableOccurrence[] }
  | { state: 'done_today'; next: TimetableOccurrence | null }
  | { state: 'no_class_today'; next: TimetableOccurrence | null }
  | { state: 'skip_week'; term: TimetableTerm; next: TimetableOccurrence | null };

const MINUTE_MS = 60_000;
/** How far ahead "the next class" is looked for: past a long summer break, as the reminder preview does. */
/** 向前查找「下一节课」的天数：足以跨过漫长的暑假，与提醒预览一致。 */
export const NEXT_CLASS_HORIZON_DAYS = 400;

function plain(occurrence: DayOccurrence): TimetableOccurrence {
  return { course: occurrence.course, meeting: occurrence.meeting, date: occurrence.date, startMs: occurrence.startMs, endMs: occurrence.endMs };
}

export function nextUp(data: TimetableData, nowMs: number): NextUp {
  if (data.courses.length === 0) return { state: 'empty' };
  const index = indexTimetable(data);
  const today = torontoDateOf(nowMs);
  const classes = occurrencesOn(index, today);

  const running = classes.filter((occurrence) => occurrence.startMs <= nowMs && nowMs < occurrence.endMs);
  const upcoming = classes.filter((occurrence) => occurrence.startMs > nowMs);
  if (running.length > 0) {
    // Of two classes at once, the one ending first is the one to watch.
    // 同时有两节课时，先结束的那节最值得关注。
    const current = running.reduce((best, occurrence) => (occurrence.endMs < best.endMs ? occurrence : best));
    const length = current.endMs - current.startMs;
    return {
      state: 'in_class',
      current: plain(current),
      minutesLeft: Math.max(1, Math.ceil((current.endMs - nowMs) / MINUTE_MS)),
      progress: length > 0 ? Math.min(1, Math.max(0, (nowMs - current.startMs) / length)) : 0,
      laterToday: upcoming.map(plain),
    };
  }
  const [next, ...later] = upcoming;
  if (next) return { state: 'next', next: plain(next), minutesUntil: Math.max(1, Math.ceil((next.startMs - nowMs) / MINUTE_MS)), laterToday: later.map(plain) };

  const ahead = firstDayWithClasses(index, addDays(today, 1), NEXT_CLASS_HORIZON_DAYS, nowMs);
  const following = ahead?.[0] ? plain(ahead[0]) : null;
  if (classes.length > 0) return { state: 'done_today', next: following };
  const term = termFor(data.terms, today);
  if (term && term.skipWeeks.includes(weekOfTerm(term, today))) return { state: 'skip_week', term, next: following };
  return { state: 'no_class_today', next: following };
}
