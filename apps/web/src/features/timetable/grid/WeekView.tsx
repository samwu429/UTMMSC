/**
 * Owner: T3, timetable web core. The 课表 tab: the day heads, then the hours with the time column on the left.
 * Three weeks sit in each track (the one on screen and its neighbours), so a swipe shows the next week at once.
 * The hours fit the screen through the CSS hour height; when they cannot (a short window), they scroll under the
 * sticky day heads, starting at the now line or the week's first class.
 * 维护者：T3，课表网页核心。「课表」标签：日期行，下面是小时区域，左侧是时间列。每条轨道中有三周（屏幕上的一周及其前后两周），
 * 因此滑动时立即就能看到下一周。小时区域通过 CSS 小时高度放进屏幕；放不下时（窗口较矮）在吸顶的日期行下方滚动，起点为当前时间线或本周的第一节课。
 */
import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import {
  addDays,
  mondayOf,
  TIMETABLE_DAY_START_MIN,
  torontoDateOf,
  torontoMinuteOf,
  type TimetableData,
  type TimetableLocale,
  type Weekday,
} from '@utmmsc/shared';
import { monthLabel } from '../model/labels';
import { weekOccurrences, type WeekOccurrence } from '../model/week';
import { DayHeads } from './DayHeads';
import { TimeColumn } from './TimeColumn';
import { useWeekSwipe, type WeekStep, type WeekSwipeHandle } from './useWeekSwipe';
import { WeekPane } from './WeekPane';

export interface WeekViewProps {
  monday: string;
  data: TimetableData;
  weekdays: readonly Weekday[];
  today: string;
  dueDates: ReadonlySet<string>;
  locale: TimetableLocale;
  pendingIds: ReadonlySet<string>;
  flashKey: string | null;
  /** A quiet line over the empty grid, such as how to add the first class or 阅读周 · 不上课. */
  /** 空课表上方的一行浅色提示，例如如何添加第一节课，或「阅读周 · 不上课」。 */
  hint: string | null;
  /** Runs inside flushSync when a swipe or the ‹ › buttons change the week. */
  /** 滑动或 ‹ › 按钮切换周时，在 flushSync 中运行。 */
  onStep: (step: WeekStep) => void;
  onSlot: (date: string, weekday: Weekday, startMin: number) => void;
  onOpen: (occurrence: WeekOccurrence) => void;
  onMenu: (occurrence: WeekOccurrence) => void;
}

/** Brings a row of the hours into view when the grid scrolls: the deep-linked block, the now line or the week's first class. */
/** 课表可以滚动时，让小时区域的某一行进入视野：深层链接的方块、当前时间线或第一节课。 */
function useInitialScroll(scroller: RefObject<HTMLElement>, body: RefObject<HTMLElement>, props: Pick<WeekViewProps, 'monday' | 'data' | 'today' | 'flashKey'>) {
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const box = scroller.current;
    const hours = body.current;
    if (!box || !hours) return;
    // Once on opening and again for each deep link; a swipe keeps the scroll where the member left it.
    // 打开时滚动一次，每个深层链接再滚动一次；滑动时保持成员停留的位置。
    const key = props.flashKey ?? '';
    if (scrolledFor.current === key || (scrolledFor.current !== null && key === '')) return;
    scrolledFor.current = key;
    if (box.scrollHeight <= box.clientHeight + 2) return;
    const hourPx = hours.getBoundingClientRect().height / 12;
    let target: number | null = null;
    if (props.flashKey) {
      const block = hours.querySelector<HTMLElement>(`[data-block="${props.flashKey}"]`);
      if (block) target = block.getBoundingClientRect().top - hours.getBoundingClientRect().top;
    }
    if (target === null && mondayOf(props.today) === props.monday) {
      const now = Date.now();
      if (torontoDateOf(now) === props.today) target = ((torontoMinuteOf(now) - TIMETABLE_DAY_START_MIN) / 60) * hourPx;
    }
    if (target === null) {
      const first = weekOccurrences(props.data, props.monday).reduce<number | null>((min, o) => (min === null || o.meeting.startMin < min ? o.meeting.startMin : min), null);
      if (first !== null) target = ((first - TIMETABLE_DAY_START_MIN) / 60) * hourPx;
    }
    if (target === null) return;
    // The day heads stick over the top of the scroller, so the target goes a quarter of the way down the hours left in view under them.
    // 日期行吸附在滚动区域顶部，因此目标放在日期行下方可见小时区域的四分之一处。
    const heads = hours.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, target - (box.clientHeight - heads) * 0.25);
  }, [scroller, body, props.monday, props.data, props.today, props.flashKey]);
}

export const WeekView = forwardRef<WeekSwipeHandle, WeekViewProps>(function WeekView(props, ref) {
  const { monday, data, weekdays, today, dueDates, locale, pendingIds, flashKey, hint, onStep, onSlot, onOpen, onMenu } = props;
  const headTrack = useRef<HTMLDivElement>(null);
  const bodyTrack = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tracks = useMemo(() => [headTrack, bodyTrack] as const, []);
  const swipe = useWeekSwipe({ tracks, viewport, onStep, enabled: true });
  useImperativeHandle(ref, () => ({ go: swipe.go }), [swipe.go]);
  useInitialScroll(scroller, bodyTrack, { monday, data, today, flashKey });

  const weeks = useMemo(() => [addDays(monday, -7), monday, addDays(monday, 7)], [monday]);

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ touchAction: 'pan-y' }} {...swipe.handlers}>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-white">
        {/* The day heads stick to the top inside the scroller, so a scrollbar that takes width takes it from them and from the columns alike. */}
        {/* 日期行在滚动区域内吸顶，占宽度的滚动条因此从日期行和各列同样扣除宽度，两者始终对齐。 */}
        <div className="sticky top-0 z-[5] flex h-9 border-b-[0.5px] border-wx-line bg-white">
          <div className="flex w-[28px] shrink-0 items-center justify-center text-[10px] leading-none text-wx-meta" aria-hidden>
            {monthLabel(addDays(monday, 3), locale)}
          </div>
          <div className="tt-viewport min-w-0 flex-1">
            <div ref={headTrack} className="tt-track">
              {weeks.map((week) => (
                <DayHeads key={week} monday={week} weekdays={weekdays} today={today} dueDates={dueDates} locale={locale} />
              ))}
            </div>
          </div>
        </div>
        {hint ? (
          <p className="pointer-events-none absolute inset-x-8 top-[38%] z-[4] text-center" role="note">
            <span className="inline-block rounded-full bg-white/90 px-3 py-1.5 text-[13px] leading-5 text-wx-meta shadow-sm ring-[0.5px] ring-wx-line">{hint}</span>
          </p>
        ) : null}
        <div className="flex">
          <TimeColumn />
          <div ref={viewport} className="tt-viewport min-w-0 flex-1">
            <div ref={bodyTrack} className="tt-track">
              {weeks.map((week) => (
                <WeekPane
                  key={week}
                  monday={week}
                  data={data}
                  weekdays={weekdays}
                  today={today}
                  locale={locale}
                  pendingIds={pendingIds}
                  flashKey={week === monday ? flashKey : null}
                  onSlot={onSlot}
                  onOpen={onOpen}
                  onMenu={onMenu}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
