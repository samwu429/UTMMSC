/**
 * Owner: T3, timetable web core. 复制到其他天: choose weekdays and the class is added on each at the same time and
 * place, as new meetings of the same course.
 * 维护者：T3，课表网页核心。「复制到其他天」：选择星期，这节课就以同样的时间和地点加到每一天，作为同一门课新的上课时间。
 */
import { useState } from 'react';
import { formatClockRange, shortCode, type TimetableCourse, type TimetableLocale, type TimetableMeeting, type Weekday } from '@utmmsc/shared';
import { newTimetableId } from '../model/ids';
import { weekdayChar, weekdayLong, weekdayShort } from '../model/labels';
import { saveCourse } from '../state/timetableStore';
import { Chip, ChipRow } from '../ui/Chip';
import { HalfSheet } from '../ui/Sheet';
import { copyMeetingToDays } from './courseDraft';

const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export function CopyDaysSheet({ course, meeting, locale, onClose }: { course: TimetableCourse; meeting: TimetableMeeting; locale: TimetableLocale; onClose: () => void }) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const [days, setDays] = useState<Weekday[]>([]);
  const body = days.length > 0 ? copyMeetingToDays(course, meeting, days, () => newTimetableId('tm')) : null;
  const tooMany = days.length > 0 && body === null;
  const code = shortCode(course.code);

  function copy() {
    if (!body) return;
    saveCourse(body);
    onClose();
  }

  return (
    <HalfSheet label={tr('复制到其他天', 'Copy to other days')} onClose={onClose}>
      <div className="bg-white px-4 pb-2 pt-1">
        <h2 className="text-[17px] font-semibold text-wx-ink">{tr('复制到其他天', 'Copy to other days')}</h2>
        <p className="mt-1 text-[14px] text-wx-meta">{`${code} · ${weekdayShort(meeting.weekday, locale)} ${formatClockRange(meeting.startMin, meeting.endMin, locale)}${meeting.location ? ` · ${meeting.location}` : ''}`}</p>
      </div>
      <div className="bg-white px-3 pb-2">
        <ChipRow className="justify-between">
          {WEEKDAYS.map((day) => (
            <Chip
              key={day}
              round
              label={weekdayLong(day, locale)}
              disabled={day === meeting.weekday}
              selected={days.includes(day)}
              onClick={() => setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]))}
            >
              {weekdayChar(day, locale)}
            </Chip>
          ))}
        </ChipRow>
        {tooMany ? (
          <p role="alert" className="pt-1 text-[13px] text-wx-red">
            {tr('每门课最多 10 个上课时间', 'A course can have at most 10 class times')}
          </p>
        ) : null}
      </div>
      <div className="bg-white px-4 pb-3 pt-1">
        <button
          type="button"
          onClick={copy}
          disabled={!body}
          className="flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-800 text-[16px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300"
        >
          {tr('复制', 'Copy')}
        </button>
      </div>
    </HalfSheet>
  );
}
