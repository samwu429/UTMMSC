import type { Experience } from '@utmmsc/shared';

export function experiencePeriod(item: Pick<Experience, 'startYear' | 'endYear' | 'current'>): string {
  const start = item.startYear ? String(item.startYear) : '';
  const end = item.current ? '至今' : item.endYear ? String(item.endYear) : '';
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

export function formatPostTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return clock;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${clock}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
