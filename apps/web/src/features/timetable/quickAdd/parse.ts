/**
 * Owner: T4, timetable quick add. Reads one line such as "PS3 MAT102 周五 23:59" into an assignment
 * (timetable-final.md section 14). Deterministic: the same text, courses and instant always give the same answer.
 * It knows the member's own course codes (short form, any case), 今天 / 明天 / 后天, 周一-周日 and 下周一-下周日 and
 * their English forms, M/D, M月D日 and Oct 31, and times such as 23:59, 11:59pm, 11pm, 晚上11点 and 下午5点半.
 * Everything else is the title. All dates and times are Toronto time.
 * 维护者：T4，课表快速添加。把一行文字（例如「PS3 MAT102 周五 23:59」）读成一项作业（timetable-final.md 第 14 节）。结果是确定的：
 * 相同的文字、课程和时刻总是得到相同的结果。它认识成员自己的课程代码（简写，不分大小写）、今天 / 明天 / 后天、周一至周日和下周一至下周日
 * 及其英文写法、M/D、M月D日 和 Oct 31，以及 23:59、11:59pm、11pm、晚上11点、下午5点半 这样的时间。其余文字都作为标题。
 * 所有日期和时间都按多伦多时间。
 */
import {
  TIMETABLE_LIMITS,
  addDays,
  cleanTimetableLine,
  instantAt,
  isTimetableDate,
  isoWeekday,
  mondayOf,
  shortCode,
  termFor,
  torontoDateOf,
  type TimetableCourse,
  type TimetableTerm,
  type Weekday,
} from '@utmmsc/shared';

/** A deadline with no time is due at the end of its day. */
/** 没有写时间的截止时间定在当天结束。 */
export const QUICK_ADD_DEFAULT_MINUTE = 23 * 60 + 59;
/** M/D more than this many days ago means next year: 1/15 typed in December. */
/** M/D 早于今天超过这么多天时表示明年：例如十二月输入 1/15。 */
const PAST_DATE_GRACE_DAYS = 30;

export interface QuickAddContext {
  courses: readonly Pick<TimetableCourse, 'id' | 'code' | 'termId'>[];
  terms: readonly Pick<TimetableTerm, 'id' | 'startsOn' | 'endsOn'>[];
  nowMs: number;
}

export interface QuickAddParse {
  /** What is left once the course, date and time are taken out; empty means nothing can be added yet. */
  /** 去掉课程、日期和时间之后剩下的文字；为空表示还不能添加。 */
  title: string;
  courseId: string | null;
  /** The short code shown in the preview chip. */
  /** 预览标签中显示的课程简码。 */
  courseCode: string | null;
  /** Whether the text named a date and a time; when not, the defaults below were used. */
  /** 文字中是否写了日期和时间；没有写时使用下面的默认值。 */
  hasDate: boolean;
  hasTime: boolean;
  /** Toronto date and minute of the deadline. */
  /** 截止时间的多伦多日期和分钟。 */
  dueDate: string;
  dueMinute: number;
  /** The deadline as SaveAssignmentBody.dueAt wants it. */
  /** SaveAssignmentBody.dueAt 所需格式的截止时间。 */
  dueAt: string;
}

interface Span {
  start: number;
  end: number;
}

type DateWord = { kind: 'date'; date: string } | { kind: 'weekday'; weekday: Weekday; nextWeek: boolean };

const WEEKDAY_CHARS: Readonly<Record<string, Weekday>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 };
const WEEKDAY_WORDS: readonly [RegExp, Weekday][] = [
  [/^mon(?:day)?$/i, 1],
  [/^tue(?:s|sday)?$/i, 2],
  [/^wed(?:s|nesday)?$/i, 3],
  [/^thu(?:r|rs|rsday)?$/i, 4],
  [/^fri(?:day)?$/i, 5],
  [/^sat(?:urday)?$/i, 6],
  [/^sun(?:day)?$/i, 7],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_WORDS: Readonly<Record<string, number>> = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 后天: 2, 後天: 2, 大后天: 3, 大後天: 3 };
const CHINESE_DIGITS: Readonly<Record<string, number>> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

// No lookbehind anywhere: Safari before 16.4 cannot parse it, and this chunk must load there.
// 不使用后行断言：16.4 之前的 Safari 无法解析，而这个代码块必须能在那里加载。
const EDGE = '(^|[^A-Za-z0-9])';
const END = '(?![A-Za-z0-9])';

/** 一 to 十二 (and 两), or digits, as a number; NaN otherwise. */
/** 一到十二（以及「两」）或阿拉伯数字，转成数字；否则为 NaN。 */
function readHourNumber(text: string): number {
  if (/^\d{1,2}$/.test(text)) return Number(text);
  if (text in CHINESE_DIGITS) return CHINESE_DIGITS[text] ?? Number.NaN;
  const tens = /^([一二两兩]?)十([一二三四五六七八九]?)$/.exec(text);
  if (tens) return (tens[1] ? (CHINESE_DIGITS[tens[1]] ?? 1) : 1) * 10 + (tens[2] ? (CHINESE_DIGITS[tens[2]] ?? 0) : 0);
  return Number.NaN;
}

function toMinute(hour: number, minute: number): number | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** 12-hour clock to 24-hour: 12am is 0, 12pm is 12. */
/** 12 小时制换成 24 小时制：12am 为 0，12pm 为 12。 */
function meridiem(hour: number, half: string): number {
  if (hour < 1 || hour > 12) return Number.NaN;
  const pm = half.toLowerCase().startsWith('p');
  return (hour % 12) + (pm ? 12 : 0);
}

/** 下午 5 点 is 17:00, 晚上 12 点 midnight is 0:00 of the next day and is read as 23:59, 中午 1 点 is 13:00. */
/** 下午 5 点为 17:00，晚上 12 点（午夜）按 23:59 处理，中午 1 点为 13:00。 */
function chinesePeriod(hour: number, period: string): number {
  if (hour > 12 && period) return Number.NaN;
  switch (period) {
    case '下午':
    case '晚上':
    case '今晚':
    case '傍晚':
      return hour === 12 ? Number.NaN : hour + 12;
    case '中午':
      return hour === 12 ? 12 : hour <= 3 ? hour + 12 : Number.NaN;
    case '凌晨':
    case '早上':
    case '上午':
      return hour === 12 ? 0 : hour;
    default:
      return hour;
  }
}

interface Found<T> {
  span: Span;
  value: T;
}

function firstMatch<T>(text: string, pattern: RegExp, read: (match: RegExpExecArray) => T | null): Found<T> | null {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (let match = global.exec(text); match; match = global.exec(text)) {
    const value = read(match);
    if (value !== null) {
      // The first group is the edge before a word, which stays in the title.
      // 第一组是单词前的边界字符，留在标题中。
      const lead = match[1] ?? '';
      return { span: { start: match.index + lead.length, end: match.index + match[0].length }, value };
    }
    if (match[0].length === 0) global.lastIndex += 1;
  }
  return null;
}

/** The time in the text, and a date word it implied (今晚 is today). */
/** 文字中的时间，以及它隐含的日期（今晚即今天）。 */
function findTime(text: string): Found<{ minute: number; today: boolean }> | null {
  const finders: (() => Found<{ minute: number; today: boolean }> | null)[] = [
    // 23:59, 11:59pm, 11:59 p.m., 23：59
    () =>
      firstMatch(text, new RegExp(`${EDGE}(\\d{1,2})[:：](\\d{2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)?${END}`, 'i'), (m) => {
        const hour = m[4] ? meridiem(Number(m[2]), m[4]) : Number(m[2]);
        const minute = toMinute(hour, Number(m[3]));
        return minute === null ? null : { minute, today: false };
      }),
    // 晚上11点, 下午5点半, 11点59分, 晚上十一点. A Chinese numeral needs the period word: 快一点 is "a bit faster".
    // 晚上11点、下午5点半、11点59分、晚上十一点。汉字数字必须带时段词：「快一点」不是时间。
    () =>
      firstMatch(text, /(^|[^0-9])(早上|上午|中午|下午|傍晚|晚上|今晚|凌晨)?\s*(\d{1,2}|[一二两兩三四五六七八九十]{1,3})\s*[点點](?:\s*(半|一刻|三刻|\d{1,2})\s*分?)?/, (m) => {
        const period = m[2] ?? '';
        if (!period && !/^\d+$/.test(m[3] ?? '')) return null;
        const base = readHourNumber(m[3] ?? '');
        const extra = m[4] ?? '';
        const minutes = extra === '半' ? 30 : extra === '一刻' ? 15 : extra === '三刻' ? 45 : extra ? Number(extra) : 0;
        const hour = chinesePeriod(base, period);
        // 晚上12点 is the end of that day.
        // 晚上12点 即当天结束。
        if ((period === '晚上' || period === '今晚') && base === 12 && minutes === 0) return { minute: QUICK_ADD_DEFAULT_MINUTE, today: period === '今晚' };
        const minute = toMinute(hour, minutes);
        return minute === null ? null : { minute, today: period === '今晚' };
      }),
    // 11pm, 9 am
    () =>
      firstMatch(text, new RegExp(`${EDGE}(\\d{1,2})\\s*(am|pm|a\\.m\\.|p\\.m\\.)${END}`, 'i'), (m) => {
        const minute = toMinute(meridiem(Number(m[2]), m[3] ?? ''), 0);
        return minute === null ? null : { minute, today: false };
      }),
    // noon, midnight and 午夜 (the end of that day)
    // noon、midnight 和午夜（当天结束）
    () =>
      firstMatch(text, new RegExp(`${EDGE}(noon|midnight)${END}`, 'i'), (m) => ({
        minute: (m[2] ?? '').toLowerCase() === 'noon' ? 720 : QUICK_ADD_DEFAULT_MINUTE,
        today: false,
      })),
    () => firstMatch(text, /()(午夜)/, () => ({ minute: QUICK_ADD_DEFAULT_MINUTE, today: false })),
  ];
  for (const find of finders) {
    const found = find();
    if (found) return found;
  }
  return null;
}

function findDate(text: string, today: string): Found<DateWord> | null {
  const year = Number(today.slice(0, 4));
  const pickYear = (month: number, day: number): DateWord | null => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const thisYear = `${year}-${pad(month)}-${pad(day)}`;
    if (!isTimetableDate(thisYear)) {
      // 2/29 only exists in some years.
      // 2/29 只在部分年份存在。
      const nextYear = `${year + 1}-${pad(month)}-${pad(day)}`;
      return isTimetableDate(nextYear) ? { kind: 'date', date: nextYear } : null;
    }
    if (thisYear >= addDays(today, -PAST_DATE_GRACE_DAYS)) return { kind: 'date', date: thisYear };
    const nextYear = `${year + 1}-${pad(month)}-${pad(day)}`;
    return isTimetableDate(nextYear) ? { kind: 'date', date: nextYear } : null;
  };
  const finders: (() => Found<DateWord> | null)[] = [
    // 今晚 alone is today; with a time the time finder has already taken it.
    // 单独的「今晚」表示今天；带时间时已由时间部分处理。
    () => firstMatch(text, /()(大后天|大後天|后天|後天|明天|明日|今天|今日|今晚)/, (m) => ({ kind: 'date', date: addDays(today, DAY_WORDS[m[2] ?? ''] ?? 0) })),
    () =>
      firstMatch(text, new RegExp(`${EDGE}(today|tonight|tdy|tomorrow|tmrw?|tmw|tmr)${END}`, 'i'), (m) => ({
        kind: 'date',
        date: addDays(today, /^to(day|night)$|^tdy$/i.test(m[2] ?? '') ? 0 : 1),
      })),
    () =>
      firstMatch(text, /()(下下|下|本|这|這)?(?:周|週|星期|礼拜|禮拜)([一二三四五六日天七])/, (m) => {
        const weekday = WEEKDAY_CHARS[m[3] ?? ''];
        if (!weekday) return null;
        if (m[2] === '下下') return { kind: 'date', date: addDays(mondayOf(today), 14 + weekday - 1) };
        return { kind: 'weekday', weekday, nextWeek: m[2] === '下' };
      }),
    () =>
      firstMatch(text, new RegExp(`${EDGE}(next\\s+|this\\s+)?(mon(?:day)?|tues?(?:day)?|tue|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\\.?${END}`, 'i'), (m) => {
        const word = m[3] ?? '';
        const weekday = WEEKDAY_WORDS.find(([pattern]) => pattern.test(word))?.[1];
        if (!weekday) return null;
        return { kind: 'weekday', weekday, nextWeek: /^next/i.test(m[2] ?? '') };
      }),
    // 10月31日, 10月31号, 10月31
    // 10月31日、10月31号、10月31
    () =>
      firstMatch(text, /(^|[^0-9])(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]?/, (m) => {
        const month = Number(m[2]);
        const day = Number(m[3]);
        return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? pickYear(month, day) : null;
      }),
    // 10/31
    () =>
      firstMatch(text, /(^|[^0-9/])(\d{1,2})\/(\d{1,2})(?![0-9/])/, (m) => {
        const month = Number(m[2]);
        const day = Number(m[3]);
        return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? pickYear(month, day) : null;
      }),
    // Oct 31, October 31st
    () =>
      firstMatch(text, new RegExp(`${EDGE}(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${END}`, 'i'), (m) => {
        const month = MONTHS.indexOf((m[2] ?? '').slice(0, 3).toLowerCase()) + 1;
        const day = Number(m[3]);
        return month >= 1 && day >= 1 && day <= 31 ? pickYear(month, day) : null;
      }),
  ];
  for (const find of finders) {
    const found = find();
    if (found) return found;
  }
  return null;
}

const UOFT_CODE = /^[A-Z]{3}[A-D0-9][0-9]{2}(?:[HY][0-9])?[FSY]?$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The member's course named in the text. A UofT code matches in its short form with or without weight and session
 * (mat102, MAT102H5, MAT102H5F); any other code matches as written, ignoring case. The longest match wins.
 * 文字中提到的成员自己的课程。多伦多大学课程代码可按简写匹配，带不带学分和学期后缀都可以（mat102、MAT102H5、MAT102H5F）；
 * 其他代码按原样匹配，不分大小写。取最长的匹配。
 */
function findCourse(text: string, context: QuickAddContext, dueDateFor: () => string): Found<{ id: string; code: string }> | null {
  let best: Found<{ id: string; code: string; short: string }> | null = null;
  const seen = new Set<string>();
  for (const course of context.courses) {
    const short = shortCode(course.code);
    if (seen.has(short)) continue;
    seen.add(short);
    const body = UOFT_CODE.test(course.code) ? `${escapeRegExp(short)}(?:\\s?[HYhy]\\d)?(?:\\s?[FSYfsy])?` : escapeRegExp(course.code);
    const found = firstMatch(text, new RegExp(`${EDGE}(${body})${END}`, 'i'), () => ({ id: course.id, code: short, short }));
    if (found && (!best || found.span.end - found.span.start > best.span.end - best.span.start)) best = found;
  }
  if (!best) return null;
  // Two courses with one code (the same course in two terms): the one whose term holds the deadline.
  // 两门课程代码相同（同一门课在两个学期）：取学期包含截止日期的那一门。
  const same = context.courses.filter((course) => shortCode(course.code) === best?.value.short);
  if (same.length > 1) {
    const date = dueDateFor();
    const term = termFor(context.terms, date);
    const inTerm = same.find((course) => course.termId !== null && course.termId === term?.id) ?? same.find((course) => course.termId === null);
    if (inTerm) return { span: best.span, value: { id: inTerm.id, code: best.value.code } };
  }
  return { span: best.span, value: { id: best.value.id, code: best.value.code } };
}

function cut(text: string, span: Span): string {
  return `${text.slice(0, span.start)} ${text.slice(span.end)}`;
}

/** The title: what is left, on one line, without separators at its ends, at most 120 characters. */
/** 标题：剩下的文字，单行，去掉首尾的分隔符，最多 120 个字符。 */
function tidyTitle(text: string): string {
  const line = cleanTimetableLine(text.replace(/[[(（【]\s*[\])）】]/g, ' '))
    .replace(/^[\s\-–—·|:：,，、;；/@]+|[\s\-–—·|:：,，、;；/@]+$/g, '')
    .replace(/\s+([,，、])/g, '$1')
    .trim();
  return Array.from(line).slice(0, TIMETABLE_LIMITS.assignmentTitle).join('').trim();
}

/** Resolves a weekday to a date: this week's or the next one still ahead, or next week's for 下周. */
/** 把星期几换成日期：本周或之后最近一个尚未过去的那天；「下周」则为下一周的那天。 */
function weekdayDate(word: Extract<DateWord, { kind: 'weekday' }>, today: string, minute: number, nowMs: number): string {
  if (word.nextWeek) return addDays(mondayOf(today), 7 + word.weekday - 1);
  let date = addDays(today, (word.weekday - isoWeekday(today) + 7) % 7);
  if (date === today && instantAt(date, minute) <= nowMs) date = addDays(date, 7);
  return date;
}

export function parseQuickAdd(input: string, context: QuickAddContext): QuickAddParse {
  const today = torontoDateOf(context.nowMs);
  let text = input;

  const time = findTime(text);
  if (time) text = cut(text, time.span);
  const dateWord = findDate(text, today);
  if (dateWord) text = cut(text, dateWord.span);

  const hasTime = time !== null;
  const minute = time?.value.minute ?? QUICK_ADD_DEFAULT_MINUTE;
  let date: string;
  if (dateWord?.value.kind === 'date') date = dateWord.value.date;
  else if (dateWord?.value.kind === 'weekday') date = weekdayDate(dateWord.value, today, minute, context.nowMs);
  else if (time?.value.today) date = today;
  // No date: today while the time is still ahead, else tomorrow.
  // 没有日期：时间还没到就是今天，否则是明天。
  else date = instantAt(today, minute) > context.nowMs ? today : addDays(today, 1);

  const course = findCourse(text, context, () => date);
  if (course) text = cut(text, course.span);

  return {
    title: tidyTitle(text),
    courseId: course?.value.id ?? null,
    courseCode: course?.value.code ?? null,
    hasDate: dateWord !== null || Boolean(time?.value.today),
    hasTime,
    dueDate: date,
    dueMinute: minute,
    dueAt: new Date(instantAt(date, minute)).toISOString(),
  };
}
