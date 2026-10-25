/**
 * Owner: T3, timetable web core. One week's day heads: weekday and date, today in brand-800 with white text, and
 * a gold dot over a day with an assignment due. They move with the grid's track while swiping.
 * 维护者：T3，课表网页核心。一周的日期行：星期和日期；今天为 brand-800 底色配白字；有作业截止的日期上方有金色圆点。滑动时随课表轨道一起移动。
 */
import { memo } from 'react';
import { addDays, type TimetableLocale, type Weekday } from '@utmmsc/shared';
import { dayOfMonth, weekdayChar } from '../model/labels';

export interface DayHeadsProps {
  monday: string;
  weekdays: readonly Weekday[];
  today: string;
  dueDates: ReadonlySet<string>;
  locale: TimetableLocale;
}

function DayHeadsView({ monday, weekdays, today, dueDates, locale }: DayHeadsProps) {
  return (
    <div className="tt-pane h-9" aria-hidden>
      {weekdays.map((weekday) => {
        const date = addDays(monday, weekday - 1);
        const isToday = date === today;
        return (
          <div key={date} className={`relative flex min-w-0 flex-1 flex-col items-center justify-center leading-none ${isToday ? 'bg-brand-800 text-white' : 'text-wx-ink'}`}>
            <span className={`text-[11px] ${isToday ? 'text-white/85' : 'text-wx-meta'}`}>{weekdayChar(weekday, locale)}</span>
            <span className="mt-[3px] text-[13px] font-semibold tabular-nums">{dayOfMonth(date)}</span>
            {dueDates.has(date) ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export const DayHeads = memo(DayHeadsView);
