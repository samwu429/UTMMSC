import type { Experience } from '@utmmsc/shared';

export function experiencePeriod(item: Pick<Experience, 'startYear' | 'endYear' | 'current'>): string {
  const start = item.startYear ? String(item.startYear) : '';
  const end = item.current ? '至今' : item.endYear ? String(item.endYear) : '';
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

/** Relative time in the style of a moments feed: 刚刚, 3分钟前, 昨天, 10月11日. */
/** 朋友圈式的相对时间：刚刚、3分钟前、昨天、10月11日。 */
export function formatPostTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const delta = now.getTime() - date.getTime();
  if (delta < 60_000) return '刚刚';
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}分钟前`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return `${Math.max(1, Math.floor(delta / 3_600_000))}小时前`;
  if (date.toDateString() === yesterday.toDateString()) return '昨天';
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
