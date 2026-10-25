/**
 * Owner: T3, timetable web core. The red now line in today's column, 09:00-21:00 Toronto time. It keeps its own
 * minute state, so only this line re-renders every minute, never the grid.
 * 维护者：T3，课表网页核心。今天这一列中的红色当前时间线，按多伦多时间 09:00-21:00 显示。它自己保存每分钟的状态，
 * 因此每分钟只有这条线重新渲染，课表不会。
 */
import { TIMETABLE_DAY_END_MIN, TIMETABLE_DAY_START_MIN, torontoDateOf, torontoMinuteOf } from '@utmmsc/shared';
import { useTorontoNow } from '../model/useTorontoNow';
import { hoursFromTop } from './geometry';

export function NowLine({ date }: { date: string }) {
  const now = useTorontoNow();
  if (torontoDateOf(now) !== date) return null;
  const minute = torontoMinuteOf(now);
  if (minute < TIMETABLE_DAY_START_MIN || minute > TIMETABLE_DAY_END_MIN) return null;
  return <div className="tt-now" style={{ top: `calc(var(--tt-hour) * ${hoursFromTop(minute)})` }} aria-hidden />;
}
