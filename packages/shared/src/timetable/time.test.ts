import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatClock,
  formatClockRange,
  instantAt,
  isTimetableDate,
  isoWeekday,
  mondayOf,
  termContains,
  termFor,
  termWeekCount,
  torontoDateOf,
  torontoMinuteOf,
  weekOfTerm,
} from './time';

describe('Toronto date and minute', () => {
  it('keeps the Toronto date at 23:30 EST, when UTC is already the next day', () => {
    // 2026-01-15 23:30 EST is 2026-01-16 04:30 UTC.
    expect(torontoDateOf(Date.parse('2026-01-16T04:30:00Z'))).toBe('2026-01-15');
    expect(torontoMinuteOf(Date.parse('2026-01-16T04:30:00Z'))).toBe(23 * 60 + 30);
  });

  it('follows daylight time in summer', () => {
    // 2026-07-01 00:10 EDT is 04:10 UTC.
    expect(torontoDateOf(Date.parse('2026-07-01T04:10:00Z'))).toBe('2026-07-01');
    expect(torontoMinuteOf(Date.parse('2026-07-01T04:10:00Z'))).toBe(10);
    expect(torontoDateOf(Date.parse('2026-07-01T03:50:00Z'))).toBe('2026-06-30');
  });
});

describe('calendar arithmetic', () => {
  it('numbers weekdays from Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-10-31')).toBe(6);
    expect(isoWeekday('2026-11-01')).toBe(7);
  });

  it('adds days across months, years and the clock changes', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-03-13', 2)).toBe('2027-03-15');
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-11-02', '2026-10-26')).toBe(-7);
  });

  it('finds the Monday of a Monday-to-Sunday week', () => {
    expect(mondayOf('2026-10-26')).toBe('2026-10-26');
    expect(mondayOf('2026-10-29')).toBe('2026-10-26');
    expect(mondayOf('2026-11-01')).toBe('2026-10-26');
    expect(mondayOf('2027-01-02')).toBe('2026-12-28');
  });

  it('accepts only real calendar dates', () => {
    expect(isTimetableDate('2026-02-28')).toBe(true);
    expect(isTimetableDate('2028-02-29')).toBe(true);
    expect(isTimetableDate('2026-02-29')).toBe(false);
    expect(isTimetableDate('2026-13-01')).toBe(false);
    expect(isTimetableDate('2026-1-01')).toBe(false);
    expect(isTimetableDate('0099-01-01')).toBe(false);
    expect(isTimetableDate(20260101)).toBe(false);
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('term weeks', () => {
  const thursday = { id: 'tt_a', startsOn: '2026-09-03', endsOn: '2026-12-02' };

  it('counts a Thursday start as a short week 1', () => {
    expect(weekOfTerm(thursday, '2026-09-03')).toBe(1);
    expect(weekOfTerm(thursday, '2026-09-06')).toBe(1);
    expect(weekOfTerm(thursday, '2026-09-07')).toBe(2);
    expect(weekOfTerm(thursday, '2026-10-26')).toBe(9);
    expect(weekOfTerm(thursday, '2026-11-01')).toBe(9);
  });

  it('counts a Sunday start as a one-day week 1', () => {
    const sunday = { startsOn: '2026-09-06' };
    expect(weekOfTerm(sunday, '2026-09-06')).toBe(1);
    expect(weekOfTerm(sunday, '2026-09-07')).toBe(2);
  });

  it('gives 0 or less before the week of the start', () => {
    expect(weekOfTerm(thursday, '2026-08-31')).toBe(1);
    expect(weekOfTerm(thursday, '2026-08-30')).toBe(0);
    expect(weekOfTerm(thursday, '2026-08-23')).toBe(-1);
  });

  it('counts the weeks a term spans', () => {
    expect(termWeekCount(thursday)).toBe(14);
    expect(termWeekCount({ startsOn: '2026-09-07', endsOn: '2026-09-13' })).toBe(1);
    expect(termWeekCount({ startsOn: '2026-09-07', endsOn: '2026-09-14' })).toBe(2);
    expect(termContains(thursday, '2026-12-02')).toBe(true);
    expect(termContains(thursday, '2026-12-03')).toBe(false);
  });

  it('picks the shortest term holding the date, whatever the list order', () => {
    const fall = { id: 'tt_fall', startsOn: '2026-09-03', endsOn: '2026-12-22' };
    const year = { id: 'tt_year', startsOn: '2026-09-03', endsOn: '2027-04-30' };
    const winter = { id: 'tt_winter', startsOn: '2027-01-05', endsOn: '2027-04-30' };
    expect(termFor([year, fall, winter], '2026-10-01')?.id).toBe('tt_fall');
    expect(termFor([fall, winter, year], '2026-10-01')?.id).toBe('tt_fall');
    expect(termFor([year, fall, winter], '2026-12-28')?.id).toBe('tt_year');
    expect(termFor([fall, winter], '2026-12-28')).toBeNull();
    const twinA = { id: 'tt_b', startsOn: '2026-09-01', endsOn: '2026-09-30' };
    const twinB = { id: 'tt_a', startsOn: '2026-09-01', endsOn: '2026-09-30' };
    expect(termFor([twinA, twinB], '2026-09-15')?.id).toBe('tt_a');
    const later = { id: 'tt_z', startsOn: '2026-09-02', endsOn: '2026-10-01' };
    expect(termFor([twinB, later], '2026-09-15')?.id).toBe('tt_z');
  });
});

describe('instantAt', () => {
  it('reads Toronto wall time on both sides of each change', () => {
    expect(new Date(instantAt('2026-10-31', 540)).toISOString()).toBe('2026-10-31T13:00:00.000Z');
    expect(new Date(instantAt('2026-11-01', 540)).toISOString()).toBe('2026-11-01T14:00:00.000Z');
    expect(new Date(instantAt('2027-03-13', 600)).toISOString()).toBe('2027-03-13T15:00:00.000Z');
    expect(new Date(instantAt('2027-03-14', 600)).toISOString()).toBe('2027-03-14T14:00:00.000Z');
    expect(new Date(instantAt('2026-10-26', 1260)).toISOString()).toBe('2026-10-27T01:00:00.000Z');
  });
});

describe('clock text', () => {
  it('writes 24-hour time in Chinese and 12-hour time in English', () => {
    expect(formatClock(850, 'zh')).toBe('14:10');
    expect(formatClock(540, 'zh')).toBe('09:00');
    expect(formatClock(850, 'en')).toBe('2:10 PM');
    expect(formatClock(540, 'en')).toBe('9:00 AM');
    expect(formatClock(720, 'en')).toBe('12:00 PM');
    expect(formatClock(0, 'en')).toBe('12:00 AM');
    expect(formatClock(1439, 'zh')).toBe('23:59');
    expect(formatClock(1439, 'en')).toBe('11:59 PM');
  });

  it('writes a range with one suffix when both ends share it', () => {
    expect(formatClockRange(850, 900, 'zh')).toBe('14:10\u201315:00');
    expect(formatClockRange(850, 900, 'en')).toBe('2:10\u20133:00 PM');
    expect(formatClockRange(600, 650, 'en')).toBe('10:00\u201310:50 AM');
    expect(formatClockRange(690, 740, 'en')).toBe('11:30 AM\u201312:20 PM');
  });
});
