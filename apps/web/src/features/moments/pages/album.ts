import type { MomentMedia } from '@utmmsc/shared';
import type { Locale } from '../../../shared/i18n/locale';

/**
 * The WeChat album timeline as plain data: posts grouped by local calendar day, newest first, with 今天 and 昨天,
 * a year heading where the timeline reaches an earlier year, and what each row shows on its left. Pure, so it
 * is tested in Node; the time and the language are passed in.
 * 以普通数据表示的微信式相册时间线：按本地日历日分组，最新的在前，带「今天」「昨天」，时间线进入更早的年份时加上年份标题，
 * 以及每一行左侧显示的内容。均为纯函数，可在 Node 中测试；时间和语言由调用方传入。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EN_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface AlbumDay<T> {
  /** The local calendar day, YYYY-MM-DD. */
  /** 本地日历日，格式为 YYYY-MM-DD。 */
  key: string;
  year: number;
  /** 1 to 12. */
  /** 1 到 12。 */
  month: number;
  day: number;
  relative: 'today' | 'yesterday' | null;
  /**
   * Set on the first day of each earlier year, so 2025年 is written once above the days of that year. The
   * current year has no heading, as in WeChat.
   * 在每个更早年份的第一天上设置，使「2025年」在该年的日期上方只出现一次。当年没有标题，与微信一致。
   */
  yearHeading: number | null;
  /** In the order given, newest first. */
  /** 保持传入的顺序，最新的在前。 */
  items: T[];
}

export interface GroupAlbumOptions {
  nowMs: number;
  /**
   * The own album: the timeline always starts with 今天, which holds the camera tile even on a day with no
   * post yet.
   * 自己的相册：时间线总是以「今天」开头，即使当天还没有动态，也在这里放相机格子。
   */
  startWithToday?: boolean;
}

interface LocalDay {
  key: string;
  year: number;
  month: number;
  day: number;
}

function localDay(date: Date): LocalDay {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return { key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, year, month, day };
}

/** Whole calendar days from `date` to `now` in local time; negative when `date` is a later day. */
/** 按本地日历计算从 `date` 到 `now` 相隔的整天数；`date` 在之后的日子时为负数。 */
function calendarDaysBetween(date: Date, now: Date): number {
  const from = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((to - from) / DAY_MS);
}

/**
 * Groups items, newest first, by the local day they were created. A time on a later day than now (a clock that
 * runs behind the server's) counts as today, and a time that cannot be read joins the day before it, so every
 * item is shown exactly once and the order never changes.
 * 把按最新在前排列的项目按创建时的本地日期分组。晚于今天的时间（本机时钟比服务器慢）算作今天；无法解析的时间并入它前面的那一天。
 * 因此每个项目都恰好显示一次，顺序也不会改变。
 */
export function groupAlbumDays<T>(items: readonly T[], createdAt: (item: T) => string, options: GroupAlbumOptions): AlbumDay<T>[] {
  const now = new Date(options.nowMs);
  const today = localDay(now);
  const days: AlbumDay<T>[] = [];

  const dayFor = (date: Date): AlbumDay<T> => {
    const distance = calendarDaysBetween(date, now);
    const parts = distance <= 0 ? today : localDay(date);
    const relative = distance <= 0 ? 'today' : distance === 1 ? 'yesterday' : null;
    return { ...parts, relative, yearHeading: null, items: [] };
  };

  for (const item of items) {
    const date = new Date(createdAt(item));
    const last = days[days.length - 1];
    if (Number.isNaN(date.getTime())) {
      if (last) last.items.push(item);
      else days.push({ ...dayFor(now), items: [item] });
      continue;
    }
    const next = dayFor(date);
    if (last && last.key === next.key) last.items.push(item);
    else days.push({ ...next, items: [item] });
  }

  if (options.startWithToday && days[0]?.key !== today.key) days.unshift({ ...dayFor(now), items: [] });

  let previousYear = today.year;
  for (const day of days) {
    if (day.year !== previousYear && day.year !== today.year) day.yearHeading = day.year;
    previousYear = day.year;
  }
  return days;
}

export interface AlbumDayLabel {
  /** 今天, 昨天, or the day of the month, written large. */
  /** 「今天」「昨天」或当月的日期，用大字显示。 */
  primary: string;
  /** The month written small after the day; null for 今天 and 昨天. */
  /** 日期后面的小字月份；「今天」「昨天」为 null。 */
  secondary: string | null;
}

export function albumDayLabel(day: Pick<AlbumDay<unknown>, 'relative' | 'month' | 'day'>, locale: Locale): AlbumDayLabel {
  const english = locale === 'en';
  if (day.relative === 'today') return { primary: english ? 'Today' : '今天', secondary: null };
  if (day.relative === 'yesterday') return { primary: english ? 'Yesterday' : '昨天', secondary: null };
  return { primary: String(day.day), secondary: english ? (EN_MONTHS_SHORT[day.month - 1] ?? '') : `${day.month}月` };
}

/** The spoken form of a day, such as 10月24日 or Oct 24, 2025. */
/** 日期的朗读形式，例如「10月24日」或「Oct 24, 2025」。 */
export function albumDaySpoken(day: Pick<AlbumDay<unknown>, 'relative' | 'year' | 'month' | 'day'>, locale: Locale, nowMs: number): string {
  const english = locale === 'en';
  if (day.relative) return albumDayLabel(day, locale).primary;
  const sameYear = day.year === new Date(nowMs).getFullYear();
  if (english) return `${EN_MONTHS_SHORT[day.month - 1] ?? ''} ${day.day}${sameYear ? '' : `, ${day.year}`}`;
  return `${sameYear ? '' : `${day.year}年`}${day.month}月${day.day}日`;
}

export function albumYearLabel(year: number, locale: Locale): string {
  return locale === 'en' ? String(year) : `${year}年`;
}

/**
 * What a row shows on its left. image: the first photo's preview, or the photo itself for media posted before
 * previews existed, with the number of photos. video: the first frame, or a dark tile when there is none (a
 * video file is never put in an <img>). text: no media, so the text sits in a grey box.
 * 一行左侧显示的内容。image：第一张照片的预览图（预览图出现之前发布的媒体用照片本身），以及照片张数。video：第一帧，
 * 没有时为深色格子（从不把视频文件放进 <img>）。text：没有媒体，正文放在灰色框里。
 */
export type AlbumThumb =
  | { kind: 'image'; key: string; count: number }
  | { kind: 'video'; key: string | null; durationMs: number | null }
  | { kind: 'text' };

export function albumThumb(media: readonly Pick<MomentMedia, 'kind' | 'key' | 'previewKey' | 'durationMs'>[]): AlbumThumb {
  const first = media[0];
  if (!first) return { kind: 'text' };
  if (first.kind === 'video') return { kind: 'video', key: first.previewKey ?? null, durationMs: first.durationMs ?? null };
  const count = media.filter((item) => item.kind === 'image').length;
  return { kind: 'image', key: first.previewKey ?? first.key, count };
}

/** 共N张 under the text; nothing for a single photo. */
/** 正文下方的「共N张」；只有一张照片时不显示。 */
export function albumCountLabel(thumb: AlbumThumb, locale: Locale): string | null {
  if (thumb.kind !== 'image' || thumb.count < 2) return null;
  return locale === 'en' ? `${thumb.count} photos` : `共${thumb.count}张`;
}
