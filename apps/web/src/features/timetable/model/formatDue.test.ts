import { describe, expect, it } from 'vitest';
import { toronto } from './fixtures.testdata';
import { dueMsOf, dueWhen, formatDue, isDueDate, spanText } from './formatDue';

const NOW = toronto('2026-10-21', '18:00'); // Wednesday

describe('dueWhen', () => {
  it('names near days, then weekdays within the week, then the date', () => {
    expect(dueWhen(toronto('2026-10-21', '23:59'), NOW, 'zh')).toBe('今天 23:59');
    expect(dueWhen(toronto('2026-10-22', '17:00'), NOW, 'zh')).toBe('明天 17:00');
    expect(dueWhen(toronto('2026-10-20', '09:00'), NOW, 'zh')).toBe('昨天 09:00');
    expect(dueWhen(toronto('2026-10-23', '23:59'), NOW, 'zh')).toBe('周五 23:59');
    expect(dueWhen(toronto('2026-11-03', '23:59'), NOW, 'zh')).toBe('11月3日 周二 23:59');
  });

  it('reads the same in English', () => {
    expect(dueWhen(toronto('2026-10-21', '23:59'), NOW, 'en')).toBe('Today 11:59 PM');
    expect(dueWhen(toronto('2026-10-23', '09:05'), NOW, 'en')).toBe('Fri 9:05 AM');
    expect(dueWhen(toronto('2026-11-03', '23:59'), NOW, 'en')).toBe('Tue, Nov 3, 11:59 PM');
  });

  it('uses Toronto time whatever the device zone', () => {
    // 03:59Z on the 24th is still the evening of the 23rd in Toronto.
    // 24 日 03:59Z 在多伦多仍是 23 日晚上。
    expect(dueWhen(Date.parse('2026-10-24T03:59:00Z'), NOW, 'zh')).toBe('周五 23:59');
  });
});

describe('spanText', () => {
  it('rounds down to minutes, hours or days, never below one', () => {
    expect(spanText(10_000, 'zh')).toBe('1 分钟');
    expect(spanText(59 * 60_000, 'zh')).toBe('59 分钟');
    expect(spanText(5.9 * 3_600_000, 'zh')).toBe('5 小时');
    expect(spanText(2.5 * 86_400_000, 'zh')).toBe('2 天');
    expect(spanText(86_400_000, 'en')).toBe('1 day');
    expect(spanText(3 * 86_400_000, 'en')).toBe('3 days');
  });
});

describe('formatDue', () => {
  it('says how long is left and whether it is due soon', () => {
    expect(formatDue(new Date(toronto('2026-10-21', '23:00')).toISOString(), NOW, 'zh')).toEqual({ when: '今天 23:00', relative: '还剩 5 小时', overdue: false, dueSoon: true });
    expect(formatDue(new Date(toronto('2026-10-26', '23:00')).toISOString(), NOW, 'en').dueSoon).toBe(false);
  });

  it('says how long ago an overdue item was due', () => {
    const due = formatDue(new Date(toronto('2026-10-19', '17:00')).toISOString(), NOW, 'zh');
    expect(due).toMatchObject({ relative: '逾期 2 天', overdue: true, dueSoon: false });
    expect(formatDue(new Date(toronto('2026-10-21', '16:00')).toISOString(), NOW, 'en').relative).toBe('2 h overdue');
  });

  it('shows nothing for a broken time', () => {
    expect(formatDue('soon', NOW, 'zh')).toEqual({ when: '', relative: '', overdue: false, dueSoon: false });
  });

  it('shows nothing, and does not throw, for a time outside 2000-2100', () => {
    for (const dueAt of ['0002-10-25T04:00:00.000Z', '1969-12-31T23:00:00.000Z', '+010000-01-01T00:00:00.000Z']) {
      expect(formatDue(dueAt, NOW, 'zh')).toEqual({ when: '', relative: '', overdue: false, dueSoon: false });
      expect(dueWhen(Date.parse(dueAt), NOW, 'en')).toBe('');
    }
  });
});

describe('the deadline window', () => {
  it('takes real dates from 2000 to 2100 only', () => {
    expect(isDueDate('2026-10-25')).toBe(true);
    expect(isDueDate('2000-01-01')).toBe(true);
    expect(isDueDate('2100-12-31')).toBe(true);
    expect(isDueDate('1999-12-31')).toBe(false);
    expect(isDueDate('2101-01-01')).toBe(false);
    expect(isDueDate('0002-10-25')).toBe(false);
    expect(isDueDate('2026-02-30')).toBe(false);
    expect(isDueDate('')).toBe(false);
  });

  it('reads a stored dueAt only inside the window', () => {
    expect(dueMsOf('2026-10-24T03:59:00.000Z')).toBe(Date.parse('2026-10-24T03:59:00.000Z'));
    expect(dueMsOf('1969-12-31T23:00:00.000Z')).toBeNull();
    expect(dueMsOf('2101-01-01T00:00:00.000Z')).toBeNull();
    expect(dueMsOf('soon')).toBeNull();
  });
});
