import { describe, expect, it } from 'vitest';
import { customTimeIssues, customTimesToIso, formatNoticeTime, MORNING_MERGE_MS, planMorning, suggestCustomTime } from './eventTimes';

// 2026-10-22 12:00 EDT.
const NOW = Date.parse('2026-10-22T16:00:00.000Z');
// 2026-10-25 14:00 EDT.
const START = '2026-10-25T18:00:00.000Z';

describe('custom times as Toronto wall time', () => {
  it('converts datetime-local values on both sides of the November change', () => {
    // The event is 2026-11-01 14:00 EST; the day before is still EDT.
    expect(customTimesToIso(['2026-10-31T14:00', '2026-11-01T08:00'], '2026-11-01T19:00:00.000Z', NOW)).toEqual(['2026-10-31T18:00:00.000Z', '2026-11-01T13:00:00.000Z']);
  });

  it('reads the repeated hour in November as the first, daylight-time one', () => {
    expect(customTimesToIso(['2026-11-01T01:30'], '2026-11-01T19:00:00.000Z', NOW)).toEqual(['2026-11-01T05:30:00.000Z']);
  });

  it('converts values on both sides of the March change', () => {
    const marchNow = Date.parse('2026-03-01T12:00:00.000Z');
    // The event is 2026-03-08 14:00 EDT.
    expect(customTimesToIso(['2026-03-07T20:00', '2026-03-08T09:00'], '2026-03-08T18:00:00.000Z', marchNow)).toEqual(['2026-03-08T01:00:00.000Z', '2026-03-08T13:00:00.000Z']);
  });

  it('still accepts 02:30 on the March change day, a time the clocks skip', () => {
    const marchNow = Date.parse('2026-03-01T12:00:00.000Z');
    const [iso] = customTimesToIso(['2026-03-08T02:30'], '2026-03-08T18:00:00.000Z', marchNow) ?? [];
    // Either side of the one-hour gap is a fair reading; it must not drift further.
    // 一小时空档的两侧都算合理；不能偏得更远。
    expect([Date.parse('2026-03-08T06:30:00.000Z'), Date.parse('2026-03-08T07:30:00.000Z')]).toContain(Date.parse(iso ?? ''));
  });

  it('flags empty, invalid, past, too-late and repeated values', () => {
    expect(customTimeIssues(['', '2026-02-30T10:00', '2026-10-22T11:00', '2026-10-26T14:01', '2026-10-24T14:00', '2026-10-24T14:00'], START, NOW)).toEqual([
      'empty',
      'invalid',
      'past',
      'too-late',
      null,
      'duplicate',
    ]);
  });

  it('allows a time exactly one day after the start, as the server does', () => {
    expect(customTimeIssues(['2026-10-26T14:00'], START, NOW)).toEqual([null]);
  });

  it('only checks the upper bound once the start is known', () => {
    expect(customTimeIssues(['2027-01-01T10:00'], null, NOW)).toEqual([null]);
  });

  it('returns nothing to send while any value has an issue', () => {
    expect(customTimesToIso(['2026-10-24T14:00', ''], START, NOW)).toBeNull();
    expect(customTimesToIso([], START, NOW)).toEqual([]);
  });
});

describe('planMorning', () => {
  it('shows 9:00 on the event day for an afternoon event', () => {
    expect(planMorning(START, NOW, true)).toEqual({ kind: 'scheduled', sendAt: '2026-10-25T13:00:00.000Z', day: 'same', clock: '9:00', early: null });
  });

  it('shows the two-hour fallback for an early event', () => {
    expect(planMorning('2026-10-25T13:30:00.000Z', NOW, true)).toMatchObject({ kind: 'scheduled', day: 'same', clock: '7:30', early: 'two-hours' });
    expect(planMorning('2026-10-25T12:00:00.000Z', NOW, true)).toMatchObject({ kind: 'scheduled', day: 'same', clock: '6:00', early: 'two-hours' });
  });

  it('says when an event before 8:00 gets less than two hours', () => {
    // 07:00 and 06:30 Toronto time: both are told at 06:00.
    // 多伦多时间 07:00 和 06:30：都在 06:00 提醒。
    expect(planMorning('2026-10-25T11:00:00.000Z', NOW, true)).toMatchObject({ kind: 'scheduled', day: 'same', clock: '6:00', early: 'earliest' });
    expect(planMorning('2026-10-25T10:30:00.000Z', NOW, true)).toMatchObject({ kind: 'scheduled', day: 'same', clock: '6:00', early: 'earliest' });
  });

  it('moves a midnight event to 21:00 the evening before', () => {
    expect(planMorning('2026-10-25T04:00:00.000Z', NOW, true)).toEqual({ kind: 'scheduled', sendAt: '2026-10-25T01:00:00.000Z', day: 'before', clock: '21:00', early: null });
  });

  it('merges into the publish notice when due within the hour, like the server', () => {
    const now = Date.parse('2026-10-25T13:00:00.000Z') - MORNING_MERGE_MS + 60_000;
    expect(planMorning(START, now, true)).toMatchObject({ kind: 'merged' });
    expect(planMorning(START, now, false)).toMatchObject({ kind: 'scheduled', clock: '9:00' });
  });

  it('reports a morning time that has passed', () => {
    expect(planMorning(START, Date.parse('2026-10-25T13:30:00.000Z'), false)).toMatchObject({ kind: 'passed' });
  });

  it('gives nothing for a start that is not a date', () => {
    expect(planMorning('soon', NOW, true)).toBeNull();
  });
});

describe('suggestCustomTime', () => {
  it('suggests the same clock time the day before', () => {
    expect(suggestCustomTime(START, [], NOW)).toBe('2026-10-24T14:00');
  });

  it('keeps the clock time across the November change', () => {
    expect(suggestCustomTime('2026-11-01T19:00:00.000Z', [], NOW)).toBe('2026-10-31T14:00');
  });

  it('falls back to an hour before the start when the day before is taken or too close', () => {
    expect(suggestCustomTime(START, ['2026-10-24T14:00'], NOW)).toBe('2026-10-25T13:00');
    expect(suggestCustomTime(START, [], Date.parse('2026-10-25T10:00:00.000Z'))).toBe('2026-10-25T13:00');
  });

  it('leaves the value empty when nothing fits', () => {
    expect(suggestCustomTime(START, [], Date.parse('2026-10-25T17:55:00.000Z'))).toBe('');
    expect(suggestCustomTime(null, [], NOW)).toBe('');
  });
});

describe('formatNoticeTime', () => {
  it('shows Toronto time in Chinese and English', () => {
    expect(formatNoticeTime('2026-10-25T13:00:00.000Z', 'zh')).toBe('10月25日 周日 09:00');
    expect(formatNoticeTime('2026-10-25T13:00:00.000Z', 'en')).toBe('Sun, Oct 25, 09:00');
    expect(formatNoticeTime('2026-12-25T19:00:00.000Z', 'en')).toBe('Fri, Dec 25, 14:00');
    expect(formatNoticeTime('nope', 'zh')).toBe('');
  });
});
