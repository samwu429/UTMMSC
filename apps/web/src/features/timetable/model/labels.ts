/**
 * Owner: T3, timetable web core. Words the timetable shows in both languages, written out here instead of through
 * Intl so they read the same on every device and in tests: weekdays, dates, kinds of class, week rules and the
 * week title (第9周 / 阅读周 / 10/26–11/1).
 * 维护者：T3，课表网页核心。课表以两种语言显示的文字，在这里直接写出而不经过 Intl，因此在每台设备和测试中都一致：星期、日期、
 * 上课类型、周次规则和周标题（第9周 / 阅读周 / 10/26–11/1）。
 */
import {
  addDays,
  termFor,
  weekOfTerm,
  type MeetingKind,
  type TimetableLocale,
  type TimetableMeeting,
  type TimetableTerm,
  type Weekday,
} from '@utmmsc/shared';

const WEEKDAY_ZH = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAY_EN_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_EN_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** 一 / Mon: the day chips and the grid's column heads. */
/** 一 / Mon：星期选择和课表列头。 */
export function weekdayChar(weekday: Weekday, locale: TimetableLocale): string {
  return (locale === 'en' ? WEEKDAY_EN_SHORT : WEEKDAY_ZH)[weekday - 1] ?? '';
}

/** 周一 / Mon. */
export function weekdayShort(weekday: Weekday, locale: TimetableLocale): string {
  return locale === 'en' ? (WEEKDAY_EN_SHORT[weekday - 1] ?? '') : `周${WEEKDAY_ZH[weekday - 1] ?? ''}`;
}

/** 周一 / Monday, for screen readers. */
/** 周一 / Monday，供读屏使用。 */
export function weekdayLong(weekday: Weekday, locale: TimetableLocale): string {
  return locale === 'en' ? (WEEKDAY_EN_LONG[weekday - 1] ?? '') : `周${WEEKDAY_ZH[weekday - 1] ?? ''}`;
}

function parts(date: string): { month: number; day: number } {
  return { month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)) };
}

/** 11月3日 / Nov 3. */
export function monthDay(date: string, locale: TimetableLocale): string {
  const { month, day } = parts(date);
  return locale === 'en' ? `${MONTH_EN[month - 1] ?? ''} ${day}` : `${month}月${day}日`;
}

/** 10月 / Oct, for the grid's corner. */
/** 10月 / Oct，用于课表左上角。 */
export function monthLabel(date: string, locale: TimetableLocale): string {
  const { month } = parts(date);
  return locale === 'en' ? (MONTH_EN[month - 1] ?? '') : `${month}月`;
}

/** The day of the month as a number. */
/** 当月的第几天。 */
export function dayOfMonth(date: string): number {
  return parts(date).day;
}

/** 10/26–11/1 in Chinese, Oct 26–Nov 1 (or Oct 5–11) in English. */
/** 中文为 10/26–11/1，英文为 Oct 26–Nov 1（同月时为 Oct 5–11）。 */
export function dateRange(from: string, to: string, locale: TimetableLocale): string {
  const a = parts(from);
  const b = parts(to);
  if (locale !== 'en') return `${a.month}/${a.day}–${b.month}/${b.day}`;
  if (a.month === b.month) return `${MONTH_EN[a.month - 1] ?? ''} ${a.day}–${b.day}`;
  return `${MONTH_EN[a.month - 1] ?? ''} ${a.day}–${MONTH_EN[b.month - 1] ?? ''} ${b.day}`;
}

const KIND_ZH: Record<MeetingKind, string> = { lec: '讲座', tut: '辅导', pra: '实践', lab: '实验', sem: '研讨', other: '其他' };
const KIND_EN: Record<MeetingKind, string> = { lec: 'Lecture', tut: 'Tutorial', pra: 'Practical', lab: 'Lab', sem: 'Seminar', other: 'Other' };

export function kindLabel(kind: MeetingKind, locale: TimetableLocale): string {
  return (locale === 'en' ? KIND_EN : KIND_ZH)[kind];
}

/** 每周 / 单周 / 双周 / 第 1、3、6 周. */
export function weekRuleText(meeting: Pick<TimetableMeeting, 'weekRule' | 'weekList'>, locale: TimetableLocale): string {
  const en = locale === 'en';
  switch (meeting.weekRule) {
    case 'all':
      return en ? 'Every week' : '每周';
    case 'odd':
      return en ? 'Odd weeks' : '单周';
    case 'even':
      return en ? 'Even weeks' : '双周';
    case 'list': {
      const weeks = meeting.weekList ?? [];
      return en ? `Weeks ${weeks.join(', ')}` : `第 ${weeks.join('、')} 周`;
    }
  }
}

/** The term a week belongs to: the shortest term holding one of its seven days, Monday first. */
/** 一周所属的学期：包含其七天之一的最短学期，从周一开始查找。 */
export function termOfWeek(terms: readonly TimetableTerm[], monday: string): TimetableTerm | null {
  for (let day = 0; day < 7; day += 1) {
    const term = termFor(terms, addDays(monday, day));
    if (term) return term;
  }
  return null;
}

export interface WeekTitle {
  /** 第9周, 阅读周, or the date range outside a term. */
  /** 第9周、阅读周，学期外为日期范围。 */
  text: string;
  term: TimetableTerm | null;
  /** The term week, or null outside a term. */
  /** 学期周次；学期外为 null。 */
  week: number | null;
  readingWeek: boolean;
}

export function weekTitle(terms: readonly TimetableTerm[], monday: string, locale: TimetableLocale): WeekTitle {
  const term = termOfWeek(terms, monday);
  if (!term) return { text: dateRange(monday, addDays(monday, 6), locale), term: null, week: null, readingWeek: false };
  const week = weekOfTerm(term, monday);
  if (term.skipWeeks.includes(week)) return { text: locale === 'en' ? 'Reading week' : '阅读周', term, week, readingWeek: true };
  return { text: locale === 'en' ? `Week ${week}` : `第${week}周`, term, week, readingWeek: false };
}
