/**
 * Owner: T3, timetable web core. 假日: dates with no class at all, each with a label, added one by one or as a
 * range that expands into single dates; below them, the single classes marked 本次不上, each with 恢复上课.
 * 维护者：T3，课表网页核心。「假日」：完全不上课的日期，各带一个标签，可以逐个添加，也可以按范围添加并展开为单个日期；下面是标记为
 * 「本次不上」的单节课，各有「恢复上课」。
 */
import { useId, useMemo, useState } from 'react';
import { isoWeekday, shortCode, torontoDateOf, type TimetableLocale } from '@utmmsc/shared';
import { toast } from '../../../shared/ui/toast';
import { monthDay, weekdayShort } from '../model/labels';
import { setSkip, type TimetableView } from '../state/timetableStore';
import { Caption, Group, ROW_INPUT } from '../ui/Cells';
import { CloseIcon } from '../ui/icons';
import { FullSheet } from '../ui/Sheet';
import { holidayDates, skipRoom } from './termDraft';

export function HolidaysSheet({ view, locale, onClose }: { view: TimetableView; locale: TimetableLocale; onClose: () => void }) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const today = torontoDateOf(Date.now());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState('');
  const [label, setLabel] = useState('');
  const fromId = useId();
  const toId = useId();
  const labelId = useId();
  const holidays = useMemo(() => view.skips.filter((skip) => skip.meetingId === null).sort((a, b) => (a.onDate < b.onDate ? -1 : 1)), [view.skips]);
  const singles = useMemo(() => {
    const meetings = new Map<string, { code: string }>();
    for (const course of view.courses) for (const meeting of course.meetings) meetings.set(meeting.id, { code: shortCode(course.code) });
    return view.skips
      .filter((skip) => skip.meetingId !== null)
      .map((skip) => ({ skip, meeting: skip.meetingId ? meetings.get(skip.meetingId) : undefined }))
      .filter((item) => item.meeting !== undefined)
      .sort((a, b) => (a.skip.onDate < b.skip.onDate ? -1 : 1));
  }, [view.skips, view.courses]);

  const dayText = (date: string) => `${monthDay(date, locale)} ${weekdayShort(isoWeekday(date), locale)}`;

  function add() {
    const room = skipRoom(view.skips);
    const dates = holidayDates(from, to, view.skips, room);
    if (dates === null) {
      toast(tr('日期不对', 'Those dates are not valid'));
      return;
    }
    if (dates.length === 0) {
      toast(room === 0 ? tr('停课日期最多 200 个', 'At most 200 dates with no class') : tr('这些日期已经添加过了', 'Those dates are already added'));
      return;
    }
    const text = label.trim() === '' ? null : label.trim();
    for (const onDate of dates) setSkip({ onDate, meetingId: null, skipped: true, label: text });
    setTo('');
    setLabel('');
  }

  return (
    <FullSheet title={tr('假日', 'Holidays')} onClose={onClose} closeLabel={tr('完成', 'Done')}>
      <Group caption={tr('添加不上课的日期', 'Add days with no classes')} footer={tr('填写结束日期可一次添加一段日期。', 'Fill in an end date to add a whole range.')}>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={fromId} className="w-16 shrink-0 text-[16px] text-wx-ink">
            {tr('日期', 'Date')}
          </label>
          <input id={fromId} type="date" className={`${ROW_INPUT} text-right`} value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={toId} className="w-16 shrink-0 text-[16px] text-wx-ink">
            {tr('至', 'Until')}
          </label>
          <input id={toId} type="date" className={`${ROW_INPUT} text-right`} value={to} min={from} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="flex min-h-14 items-center gap-3 px-4">
          <label htmlFor={labelId} className="w-16 shrink-0 text-[16px] text-wx-ink">
            {tr('名称', 'Name')}
          </label>
          <input id={labelId} className={ROW_INPUT} value={label} maxLength={30} placeholder={tr('可选，例如 感恩节', 'Optional, e.g. Thanksgiving')} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <button type="button" onClick={add} className="flex min-h-14 w-full items-center justify-center text-[16px] font-medium text-wx-link active:bg-wx-pressed">
          {tr('+ 添加日期', '+ Add dates')}
        </button>
      </Group>

      <Caption>{tr('假日', 'Holidays')}</Caption>
      {holidays.length === 0 ? (
        <p className="bg-white px-4 py-4 text-[15px] text-wx-meta">{tr('还没有假日', 'No holidays yet')}</p>
      ) : (
        <ul className="bg-white">
          {holidays.map((skip, index) => (
            <li key={skip.onDate}>
              {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
              <div className="flex min-h-12 items-center gap-3 pl-4">
                <span className="w-28 shrink-0 text-[15px] tabular-nums text-wx-ink">{dayText(skip.onDate)}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-wx-meta">{skip.label ?? ''}</span>
                <button
                  type="button"
                  aria-label={tr(`移除 ${dayText(skip.onDate)}`, `Remove ${dayText(skip.onDate)}`)}
                  onClick={() => setSkip({ onDate: skip.onDate, meetingId: null, skipped: false })}
                  className="flex min-h-12 min-w-12 items-center justify-center text-stone-400 active:text-wx-ink"
                >
                  <CloseIcon />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {singles.length > 0 ? (
        <>
          <Caption>{tr('本次不上', 'Skipped classes')}</Caption>
          <ul className="bg-white">
            {singles.map(({ skip, meeting }, index) => (
              <li key={`${skip.onDate}|${skip.meetingId}`}>
                {index > 0 ? <div aria-hidden className="ml-4 h-[0.5px] bg-wx-line" /> : null}
                <div className="flex min-h-12 items-center gap-3 pl-4">
                  <span className="w-28 shrink-0 text-[15px] tabular-nums text-wx-ink">{dayText(skip.onDate)}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-wx-ink">{meeting?.code}</span>
                  <button
                    type="button"
                    onClick={() => setSkip({ onDate: skip.onDate, meetingId: skip.meetingId, skipped: false })}
                    className="min-h-12 px-4 text-[15px] text-wx-link active:opacity-60"
                  >
                    {tr('恢复上课', 'Restore')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </FullSheet>
  );
}
