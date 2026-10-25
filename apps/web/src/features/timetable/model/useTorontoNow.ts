/**
 * Owner: T3, timetable web core. The current instant for countdowns and the now line: a minute ticker aligned to
 * :00 that pauses while the page is hidden. "Today", the now line and week boundaries come from this instant
 * through the shared Toronto helpers, never from local Date fields.
 * 维护者：T3，课表网页核心。供倒计时和当前时间线使用的当前时刻：在整分钟跳动、页面隐藏时暂停的计时器。
 * 「今天」、当前时间线和周的起止都由这个时刻经共享的多伦多时间工具得出，从不使用本地 Date 字段。
 */
import { useSyncExternalStore } from 'react';
import { torontoDateOf } from '@utmmsc/shared';
import { createMinuteClock } from './minuteClock';

const clock = createMinuteClock({
  now: () => Date.now(),
  setTimer: (task, ms) => setTimeout(task, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  onVisibility: (listener) => {
    if (typeof document === 'undefined') return () => undefined;
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
});

let todayFor = { minute: Number.NaN, date: '' };

/** Today's Toronto date for the clock's instant, worked out once a minute. */
/** 计时器时刻对应的多伦多今天日期，每分钟只计算一次。 */
function todaySnapshot(): string {
  const now = clock.getSnapshot();
  const minute = Math.floor(now / 60_000);
  if (minute !== todayFor.minute) todayFor = { minute, date: torontoDateOf(now) };
  return todayFor.date;
}

/** The current instant in ms, updated once a minute. */
/** 当前时刻（毫秒），每分钟更新一次。 */
export function useTorontoNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}

/** Today's Toronto date (YYYY-MM-DD); the calling component re-renders only when the date changes. */
/** 多伦多今天的日期（YYYY-MM-DD）；调用它的组件只在日期变化时重新渲染。 */
export function useTorontoToday(): string {
  return useSyncExternalStore(clock.subscribe, todaySnapshot, todaySnapshot);
}
