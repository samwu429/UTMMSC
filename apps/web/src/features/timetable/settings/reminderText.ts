/**
 * Owner: T3, timetable web core. How the settings sheet words the next class reminder: 下次提醒：周一 09:50 · MAT102,
 * or 明天 / 今天 when near.
 * 维护者：T3，课表网页核心。设置面板中下一次上课提醒的写法：「下次提醒：周一 09:50 · MAT102」，临近时写「明天 / 今天」。
 */
import { daysBetween, formatClock, isoWeekday, shortCode, torontoDateOf, torontoMinuteOf, type NextClassReminder, type TimetableLocale } from '@utmmsc/shared';
import { monthDay, weekdayShort } from '../model/labels';

export function nextReminderText(next: NextClassReminder, nowMs: number, locale: TimetableLocale): string {
  const date = torontoDateOf(next.sendAtMs);
  const clock = formatClock(torontoMinuteOf(next.sendAtMs), locale);
  const code = shortCode(next.occurrence.course.code);
  const days = daysBetween(torontoDateOf(nowMs), date);
  const en = locale === 'en';
  let day: string;
  if (days === 0) day = en ? 'Today' : '今天';
  else if (days === 1) day = en ? 'Tomorrow' : '明天';
  else if (days < 7) day = weekdayShort(isoWeekday(date), locale);
  else day = en ? `${weekdayShort(isoWeekday(date), 'en')}, ${monthDay(date, 'en')}` : `${monthDay(date, 'zh')} ${weekdayShort(isoWeekday(date), 'zh')}`;
  return en ? `Next reminder: ${day} ${clock} · ${code}` : `下次提醒：${day} ${clock} · ${code}`;
}
