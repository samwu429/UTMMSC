/**
 * Owner: T3, timetable web core. One week of day columns. Each column is a section with a heading for screen
 * readers; a tap on its empty space offers a new class at that half hour. Memoised by week, so after a swipe only
 * the week that came into the track renders; the two that stay are reused as they are.
 * 维护者：T3，课表网页核心。一周的日期列。每一列都是带标题的 section，供读屏软件使用；点按其空白处会在该半点添加新课。按周记忆化，
 * 因此滑动之后只有新进入轨道的那一周会渲染，留下的两周原样复用。
 */
import { memo, useMemo, type MouseEvent } from 'react';
import { addDays, type TimetableData, type TimetableLocale, type Weekday } from '@utmmsc/shared';
import { monthDay, weekdayLong } from '../model/labels';
import { weekOccurrences, type WeekOccurrence } from '../model/week';
import { CourseBlock } from './CourseBlock';
import { slotStartAt } from './geometry';
import { blockKey, placeWeek } from './layout';
import { NowLine } from './NowLine';

export interface WeekPaneProps {
  monday: string;
  data: TimetableData;
  weekdays: readonly Weekday[];
  today: string;
  locale: TimetableLocale;
  pendingIds: ReadonlySet<string>;
  /** blockKey of the block to flash (a deep link), or null. */
  /** 要闪烁的方块的 blockKey（深层链接），或 null。 */
  flashKey: string | null;
  onSlot: (date: string, weekday: Weekday, startMin: number) => void;
  onOpen: (occurrence: WeekOccurrence) => void;
  onMenu: (occurrence: WeekOccurrence) => void;
}

function WeekPaneView({ monday, data, weekdays, today, locale, pendingIds, flashKey, onSlot, onOpen, onMenu }: WeekPaneProps) {
  const placed = useMemo(() => placeWeek(weekOccurrences(data, monday), monday, weekdays), [data, monday, weekdays]);
  return (
    <div className="tt-pane">
      {weekdays.map((weekday) => {
        const date = addDays(monday, weekday - 1);
        const isToday = date === today;
        const blocks = placed.get(date) ?? [];
        const tap = (event: MouseEvent<HTMLElement>) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onSlot(date, weekday, slotStartAt(event.clientY - rect.top, rect.height));
        };
        return (
          <section key={date} className={`tt-day${isToday ? ' is-today' : ''}`} onClick={tap} aria-labelledby={`tt-day-${date}`}>
            <h3 id={`tt-day-${date}`} className="sr-only">
              {`${weekdayLong(weekday, locale)} ${monthDay(date, locale)}`}
            </h3>
            {blocks.map((placement) => (
              <CourseBlock
                key={placement.key}
                placement={placement}
                weekday={weekday}
                locale={locale}
                pending={pendingIds.has(placement.occurrence.meeting.id) || pendingIds.has(placement.occurrence.course.id)}
                flash={flashKey === blockKey(placement.occurrence)}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            ))}
            {isToday ? <NowLine date={date} /> : null}
          </section>
        );
      })}
    </div>
  );
}

export const WeekPane = memo(WeekPaneView);
