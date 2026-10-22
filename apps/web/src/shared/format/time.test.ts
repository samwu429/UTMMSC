import { describe, expect, it } from 'vitest';
import { formatChatListTime, formatDividerTime } from './time';

/**
 * Dates are built from local components so the tests pass in any time zone.
 * 2026-10-22 is a Thursday.
 * 日期由本地时间分量构造，因此在任何时区都能通过。2026-10-22 是星期四。
 */
function local(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

const iso = (date: Date) => date.toISOString();
const NOW = local(2026, 10, 22, 14, 32).getTime();

describe('formatDividerTime', () => {
  it('formats each range in Chinese', () => {
    expect(formatDividerTime(iso(local(2026, 10, 22, 14, 32)), NOW, 'zh')).toBe('14:32');
    expect(formatDividerTime(iso(local(2026, 10, 22, 9, 5)), NOW, 'zh')).toBe('09:05');
    expect(formatDividerTime(iso(local(2026, 10, 21, 14, 32)), NOW, 'zh')).toBe('昨天 14:32');
    expect(formatDividerTime(iso(local(2026, 10, 19, 14, 32)), NOW, 'zh')).toBe('星期一 14:32');
    expect(formatDividerTime(iso(local(2026, 10, 8, 14, 32)), NOW, 'zh')).toBe('10月8日 14:32');
    expect(formatDividerTime(iso(local(2025, 10, 8, 14, 32)), NOW, 'zh')).toBe('2025年10月8日 14:32');
  });

  it('formats each range in English', () => {
    expect(formatDividerTime(iso(local(2026, 10, 22, 14, 32)), NOW, 'en')).toBe('14:32');
    expect(formatDividerTime(iso(local(2026, 10, 21, 14, 32)), NOW, 'en')).toBe('Yesterday 14:32');
    expect(formatDividerTime(iso(local(2026, 10, 19, 14, 32)), NOW, 'en')).toBe('Monday 14:32');
    expect(formatDividerTime(iso(local(2026, 10, 8, 14, 32)), NOW, 'en')).toBe('Oct 8 14:32');
    expect(formatDividerTime(iso(local(2025, 10, 8, 14, 32)), NOW, 'en')).toBe('Oct 8, 2025 14:32');
  });

  it('compares calendar days, not 24-hour windows', () => {
    const justAfterMidnight = local(2026, 10, 22, 0, 1).getTime();
    expect(formatDividerTime(iso(local(2026, 10, 21, 23, 59)), justAfterMidnight, 'zh')).toBe('昨天 23:59');
    const justBeforeMidnight = local(2026, 10, 22, 23, 59).getTime();
    expect(formatDividerTime(iso(local(2026, 10, 22, 0, 1)), justBeforeMidnight, 'zh')).toBe('00:01');
    expect(formatDividerTime(iso(local(2026, 10, 21, 0, 0)), justBeforeMidnight, 'en')).toBe('Yesterday 00:00');
  });

  it('switches to weekdays at 2 days and to dates after 6 days', () => {
    const late = local(2026, 10, 22, 23, 59).getTime();
    expect(formatDividerTime(iso(local(2026, 10, 20, 0, 0)), late, 'zh')).toBe('星期二 00:00');
    expect(formatDividerTime(iso(local(2026, 10, 16, 0, 0)), late, 'zh')).toBe('星期五 00:00');
    expect(formatDividerTime(iso(local(2026, 10, 16, 0, 0)), late, 'en')).toBe('Friday 00:00');
    expect(formatDividerTime(iso(local(2026, 10, 15, 23, 59)), late, 'zh')).toBe('10月15日 23:59');
    expect(formatDividerTime(iso(local(2026, 10, 15, 23, 59)), late, 'en')).toBe('Oct 15 23:59');
  });

  it('handles the year boundary', () => {
    const newYear = local(2026, 1, 1, 0, 1).getTime();
    expect(formatDividerTime(iso(local(2025, 12, 31, 23, 59)), newYear, 'zh')).toBe('昨天 23:59');
    expect(formatDividerTime(iso(local(2025, 12, 26, 8, 0)), newYear, 'zh')).toBe('星期五 08:00');
    expect(formatDividerTime(iso(local(2025, 12, 25, 8, 0)), newYear, 'zh')).toBe('2025年12月25日 08:00');
    expect(formatDividerTime(iso(local(2025, 12, 25, 8, 0)), newYear, 'en')).toBe('Dec 25, 2025 08:00');
  });

  it('shows a date for a later day and nothing for an invalid value', () => {
    expect(formatDividerTime(iso(local(2026, 10, 23, 9, 0)), NOW, 'zh')).toBe('10月23日 09:00');
    expect(formatDividerTime('not a date', NOW, 'zh')).toBe('');
  });
});

describe('formatChatListTime', () => {
  it('formats each range in Chinese', () => {
    expect(formatChatListTime(iso(local(2026, 10, 22, 14, 32)), NOW, 'zh')).toBe('14:32');
    expect(formatChatListTime(iso(local(2026, 10, 21, 8, 0)), NOW, 'zh')).toBe('昨天');
    expect(formatChatListTime(iso(local(2026, 10, 19, 8, 0)), NOW, 'zh')).toBe('星期一');
    expect(formatChatListTime(iso(local(2026, 10, 8, 8, 0)), NOW, 'zh')).toBe('26/10/8');
    expect(formatChatListTime(iso(local(2025, 10, 8, 8, 0)), NOW, 'zh')).toBe('25/10/8');
  });

  it('formats each range in English', () => {
    expect(formatChatListTime(iso(local(2026, 10, 22, 14, 32)), NOW, 'en')).toBe('14:32');
    expect(formatChatListTime(iso(local(2026, 10, 21, 8, 0)), NOW, 'en')).toBe('Yesterday');
    expect(formatChatListTime(iso(local(2026, 10, 19, 8, 0)), NOW, 'en')).toBe('Mon');
    expect(formatChatListTime(iso(local(2025, 10, 8, 8, 0)), NOW, 'en')).toBe('10/8/25');
  });

  it('uses calendar days and the 2- and 6-day boundaries', () => {
    const justAfterMidnight = local(2026, 10, 22, 0, 1).getTime();
    expect(formatChatListTime(iso(local(2026, 10, 21, 23, 59)), justAfterMidnight, 'zh')).toBe('昨天');
    const late = local(2026, 10, 22, 23, 59).getTime();
    expect(formatChatListTime(iso(local(2026, 10, 22, 0, 1)), late, 'zh')).toBe('00:01');
    expect(formatChatListTime(iso(local(2026, 10, 20, 0, 0)), late, 'en')).toBe('Tue');
    expect(formatChatListTime(iso(local(2026, 10, 16, 0, 0)), late, 'zh')).toBe('星期五');
    expect(formatChatListTime(iso(local(2026, 10, 15, 23, 59)), late, 'zh')).toBe('26/10/15');
  });

  it('handles the year boundary', () => {
    const newYear = local(2026, 1, 1, 0, 1).getTime();
    expect(formatChatListTime(iso(local(2025, 12, 31, 23, 59)), newYear, 'en')).toBe('Yesterday');
    expect(formatChatListTime(iso(local(2025, 12, 25, 8, 0)), newYear, 'zh')).toBe('25/12/25');
    expect(formatChatListTime(iso(local(2025, 12, 25, 8, 0)), newYear, 'en')).toBe('12/25/25');
  });
});
