import { describe, expect, it } from 'vitest';
import { formatEventTimeZh, isoToZonedLocal, morningOf, wallClockAt, wallTimeToUtcMs, zonedLocalToIso } from './schedule';

describe('morningOf', () => {
  it('sends at 09:00 local on the event day for an afternoon event', () => {
    // 2026-10-25 14:00 EDT
    expect(morningOf('2026-10-25T18:00:00.000Z')).toBe('2026-10-25T13:00:00.000Z');
  });

  it('follows the offset on both sides of the March change', () => {
    // 2026-03-07 14:00 EST, the day before clocks go forward.
    expect(morningOf('2026-03-07T19:00:00.000Z')).toBe('2026-03-07T14:00:00.000Z');
    // 2026-03-08 14:00 EDT, the day clocks go forward at 02:00.
    expect(morningOf('2026-03-08T18:00:00.000Z')).toBe('2026-03-08T13:00:00.000Z');
  });

  it('follows the offset on both sides of the November change', () => {
    // 2026-10-31 14:00 EDT.
    expect(morningOf('2026-10-31T18:00:00.000Z')).toBe('2026-10-31T13:00:00.000Z');
    // 2026-11-01 14:00 EST, the day clocks go back at 02:00.
    expect(morningOf('2026-11-01T19:00:00.000Z')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('keeps 09:00 for an event at 10:00 and gives two hours before 10:00', () => {
    expect(morningOf('2026-10-25T14:00:00.000Z')).toBe('2026-10-25T13:00:00.000Z');
    // 09:30 EDT -> 07:30 EDT
    expect(morningOf('2026-10-25T13:30:00.000Z')).toBe('2026-10-25T11:30:00.000Z');
  });

  it('gives an 08:00 event two hours, which is exactly 06:00', () => {
    expect(morningOf('2026-10-25T12:00:00.000Z')).toBe('2026-10-25T10:00:00.000Z');
  });

  it('never goes before 06:00 for an event that starts after 06:00', () => {
    // 07:00 EDT -> 06:00 EDT
    expect(morningOf('2026-10-25T11:00:00.000Z')).toBe('2026-10-25T10:00:00.000Z');
    // 2026-03-08 07:00 EDT: two hours earlier is 05:00 EDT after the jump, so 06:00 EDT.
    expect(morningOf('2026-03-08T11:00:00.000Z')).toBe('2026-03-08T10:00:00.000Z');
    // 2026-11-01 08:00 EST: two hours earlier is 06:00 EST.
    expect(morningOf('2026-11-01T13:00:00.000Z')).toBe('2026-11-01T11:00:00.000Z');
  });

  it('sends at 09:00 the same day for a 23:00 event', () => {
    // 2026-10-25 23:00 EDT is 2026-10-26 03:00 UTC.
    expect(morningOf('2026-10-26T03:00:00.000Z')).toBe('2026-10-25T13:00:00.000Z');
  });

  it('sends at 21:00 the evening before for a midnight event', () => {
    // 2026-10-25 00:00 EDT -> 2026-10-24 21:00 EDT
    expect(morningOf('2026-10-25T04:00:00.000Z')).toBe('2026-10-25T01:00:00.000Z');
    // 2026-03-08 00:00 EST -> 2026-03-07 21:00 EST
    expect(morningOf('2026-03-08T05:00:00.000Z')).toBe('2026-03-08T02:00:00.000Z');
    // 2026-11-01 01:30 EDT, before the change -> 2026-10-31 21:00 EDT
    expect(morningOf('2026-11-01T05:30:00.000Z')).toBe('2026-11-01T01:00:00.000Z');
  });

  it('treats 06:00 as too early for a morning reminder', () => {
    expect(morningOf('2026-10-25T10:00:00.000Z')).toBe('2026-10-25T01:00:00.000Z');
  });

  it('is always before the start', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const start = new Date(wallTimeToUtcMs(2026, 3, 8, hour, 15)).toISOString();
      expect(Date.parse(morningOf(start))).toBeLessThan(Date.parse(start));
    }
  });

  it('rejects a start that is not a date', () => {
    expect(() => morningOf('not a date')).toThrow(RangeError);
  });
});

describe('wall clock conversion', () => {
  it('maps Toronto wall time to UTC in both offsets', () => {
    expect(new Date(wallTimeToUtcMs(2026, 1, 15, 9, 0)).toISOString()).toBe('2026-01-15T14:00:00.000Z');
    expect(new Date(wallTimeToUtcMs(2026, 7, 15, 9, 0)).toISOString()).toBe('2026-07-15T13:00:00.000Z');
  });

  it('rolls day 0 back into the previous month', () => {
    expect(new Date(wallTimeToUtcMs(2026, 11, 0, 21, 0)).toISOString()).toBe('2026-11-01T01:00:00.000Z');
  });

  it('puts a time skipped by the spring change one hour earlier', () => {
    // 02:30 does not exist on 2027-03-14; 06:30Z is 01:30 EST, before the jump.
    expect(new Date(wallTimeToUtcMs(2027, 3, 14, 2, 30)).toISOString()).toBe('2027-03-14T06:30:00.000Z');
    expect(wallClockAt(wallTimeToUtcMs(2027, 3, 14, 2, 30))).toMatchObject({ hour: 1, minute: 30 });
  });

  it('gives the daylight-time instant for a time the autumn change repeats', () => {
    // 01:30 happens twice on 2026-11-01; the first is 05:30Z (EDT), the second 06:30Z (EST).
    expect(new Date(wallTimeToUtcMs(2026, 11, 1, 1, 30)).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('reads midnight as hour 0', () => {
    expect(wallClockAt(Date.parse('2026-10-25T04:00:00Z')).hour).toBe(0);
  });
});

describe('formatEventTimeZh', () => {
  it('shows month, day, weekday and 24-hour time in Toronto', () => {
    expect(formatEventTimeZh('2026-10-24T18:00:00.000Z')).toBe('10月24日 周六 14:00');
    expect(formatEventTimeZh('2026-10-25T04:05:00.000Z')).toBe('10月25日 周日 00:05');
  });
});

describe('datetime-local values', () => {
  it('reads a local value as Toronto time', () => {
    expect(zonedLocalToIso('2026-10-25T14:00')).toBe('2026-10-25T18:00:00.000Z');
    expect(zonedLocalToIso('2026-12-25T14:00')).toBe('2026-12-25T19:00:00.000Z');
  });

  it('rejects values that are not a calendar date and time', () => {
    expect(zonedLocalToIso('2026-02-30T10:00')).toBeNull();
    expect(zonedLocalToIso('2026-10-25 14:00')).toBeNull();
    expect(zonedLocalToIso('2026-10-25T24:00')).toBeNull();
    expect(zonedLocalToIso('')).toBeNull();
  });

  it('round-trips through isoToZonedLocal', () => {
    const iso = '2026-11-01T19:30:00.000Z';
    expect(isoToZonedLocal(iso)).toBe('2026-11-01T14:30');
    expect(zonedLocalToIso(isoToZonedLocal(iso))).toBe(iso);
  });
});
