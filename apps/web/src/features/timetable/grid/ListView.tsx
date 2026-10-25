/**
 * Owner: T3, timetable web core. 列表视图: the visible week day by day, each class a full-width button. It is the
 * path for screen readers and very small screens; the choice is remembered on the device.
 * 维护者：T3，课表网页核心。列表视图：按天列出当前这一周，每节课都是一个通栏按钮。这是读屏软件和很小屏幕的使用方式；选择会保存在这台设备上。
 */
import { memo, useMemo } from 'react';
import { shortCode, type TimetableData, type TimetableLocale, type Weekday } from '@utmmsc/shared';
import { courseColor } from '../model/colors';
import { monthDay, weekdayLong } from '../model/labels';
import { weekOccurrences, type WeekOccurrence } from '../model/week';
import { blockKey, listLine, listWeek } from './layout';

export interface ListViewProps {
  monday: string;
  data: TimetableData;
  weekdays: readonly Weekday[];
  today: string;
  locale: TimetableLocale;
  pendingIds: ReadonlySet<string>;
  flashKey: string | null;
  onOpen: (occurrence: WeekOccurrence) => void;
}

function ListViewInner({ monday, data, weekdays, today, locale, pendingIds, flashKey, onOpen }: ListViewProps) {
  const days = useMemo(() => listWeek(weekOccurrences(data, monday), monday, weekdays), [data, monday, weekdays]);
  const en = locale === 'en';
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-wx-canvas" style={{ paddingBottom: 'calc(var(--safe-bottom) + 2rem)' }}>
      {days.map((day) => (
        <section key={day.date} aria-labelledby={`tt-list-${day.date}`}>
          <h3 id={`tt-list-${day.date}`} className="flex items-center gap-2 px-4 pb-1.5 pt-4 text-[13px] leading-5 text-wx-meta">
            <span className={day.date === today ? 'font-semibold text-brand-800' : ''}>{`${weekdayLong(day.weekday, locale)} · ${monthDay(day.date, locale)}`}</span>
            {day.date === today ? <span className="rounded bg-brand-800 px-1.5 text-[11px] leading-4 text-white">{en ? 'Today' : '今天'}</span> : null}
          </h3>
          {day.items.length === 0 ? (
            <p className="bg-white px-4 py-3 text-[15px] text-wx-meta">{en ? 'No classes' : '没有课'}</p>
          ) : (
            <ul className="bg-white">
              {day.items.map((occurrence, index) => {
                const { fill, ink } = courseColor(occurrence.course.color);
                const pending = pendingIds.has(occurrence.meeting.id) || pendingIds.has(occurrence.course.id);
                return (
                  <li key={blockKey(occurrence)}>
                    {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
                    <button
                      type="button"
                      onClick={() => onOpen(occurrence)}
                      className={`flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-wx-pressed ${flashKey === blockKey(occurrence) ? 'wx-flash' : ''}`}
                    >
                      <span aria-hidden className="h-9 w-1 shrink-0 rounded-full" style={{ background: ink }} />
                      <span className="min-w-0 flex-1">
                        <span className={`flex items-center gap-2 text-[16px] font-medium text-wx-ink ${occurrence.skipped ? 'line-through opacity-60' : ''}`}>
                          {shortCode(occurrence.course.code)}
                          {occurrence.course.title ? <span className="truncate text-[14px] font-normal text-wx-meta">{occurrence.course.title}</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-wx-meta">{listLine(occurrence, locale)}</span>
                      </span>
                      {occurrence.skipped ? (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[12px]" style={{ background: fill, color: ink }}>
                          {en ? 'Skipped' : '已停课'}
                        </span>
                      ) : occurrence.conflict ? (
                        <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[12px] text-wx-red">{en ? 'Overlaps' : '时间重叠'}</span>
                      ) : null}
                      {pending ? <span className="shrink-0 text-[12px] text-wx-meta">{en ? 'Not synced' : '待同步'}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export const ListView = memo(ListViewInner);
