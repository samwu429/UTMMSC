import type { Experience } from '@utmmsc/shared';
import { tr } from '../../shared/i18n/locale';

export function experiencePeriod(item: Pick<Experience, 'startYear' | 'endYear' | 'current'>): string {
  const start = item.startYear ? String(item.startYear) : '';
  const end = item.current ? tr('至今', 'Present') : item.endYear ? String(item.endYear) : '';
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/** Relative time in the style of a moments feed: Just now, 3 min ago, Yesterday, Oct 11. */
/** 朋友圈式的相对时间：刚刚、3分钟前、昨天、10月11日。 */
export function formatPostTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const delta = now.getTime() - date.getTime();
  if (delta < 60_000) return tr('刚刚', 'Just now');
  if (delta < 3_600_000) {
    const minutes = Math.max(1, Math.floor(delta / 60_000));
    return tr(`${minutes}分钟前`, `${minutes} min ago`);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) {
    const hours = Math.max(1, Math.floor(delta / 3_600_000));
    return tr(`${hours}小时前`, `${hours} hr ago`);
  }
  if (date.toDateString() === yesterday.toDateString()) return tr('昨天', 'Yesterday');
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthName = date.toLocaleString('en-CA', { month: 'short' });
  if (date.getFullYear() === now.getFullYear()) return tr(`${month}月${day}日`, `${monthName} ${day}`);
  return tr(`${date.getFullYear()}年${month}月${day}日`, `${monthName} ${day}, ${date.getFullYear()}`);
}
