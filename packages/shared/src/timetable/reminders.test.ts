import { describe, expect, it } from 'vitest';
import { morningOf, wallTimeToUtcMs } from '../notifications/schedule';
import { classSlots, nextClassReminder, offsetSendAt, planAssignmentReminders } from './reminders';
import { isoWeekday, torontoDateOf, torontoMinuteOf } from './time';
import { CLASS_LEADS, type TimetableCourse, type TimetableMeeting, type TimetableSettings, type TimetableTerm } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const toronto = (y: number, m: number, d: number, h: number, min: number) => wallTimeToUtcMs(y, m, d, h, min);

describe('classSlots', () => {
  it('never gives more than 16 slots, and each is a scannable start inside its lead', () => {
    let max = 0;
    for (const [y, m, d] of [
      [2026, 10, 26],
      [2026, 11, 1],
      [2027, 3, 14],
    ] as const) {
      // Every third minute meets every position between two 5-minute marks.
      for (let t = toronto(y, m, d, 8, 0); t <= toronto(y, m, d, 21, 30); t += 3 * MIN) {
        const slots = classSlots(t);
        max = Math.max(max, slots.length);
        for (const slot of slots) {
          const start = Date.parse(slot.occursAt);
          expect(start - t).toBeGreaterThanOrEqual(2 * MIN);
          expect(start - t).toBeLessThanOrEqual(slot.lead * MIN);
          expect(slot.startMin % 5).toBe(0);
          expect(slot.startMin).toBeGreaterThanOrEqual(540);
          expect(slot.startMin).toBeLessThanOrEqual(1250);
          expect(torontoDateOf(start)).toBe(slot.onDate);
          expect(torontoMinuteOf(start)).toBe(slot.startMin);
          expect(isoWeekday(slot.onDate)).toBe(slot.weekday);
        }
      }
    }
    expect(max).toBe(16);
  });

  it('gives the right date, weekday and instant on the days the clocks change', () => {
    // Sunday 2026-11-01, 08:50 EST: the 09:00 EST class is at 14:00Z.
    expect(classSlots(Date.parse('2026-11-01T13:50:00Z')).filter((s) => s.lead === 10)).toEqual([
      { lead: 10, weekday: 7, startMin: 540, onDate: '2026-11-01', occursAt: '2026-11-01T14:00:00.000Z' },
    ]);
    // Sunday 2027-03-14, 08:50 EDT: the 09:00 EDT class is at 13:00Z.
    expect(classSlots(Date.parse('2027-03-14T12:50:00Z')).filter((s) => s.lead === 10)).toEqual([
      { lead: 10, weekday: 7, startMin: 540, onDate: '2027-03-14', occursAt: '2027-03-14T13:00:00.000Z' },
    ]);
    // Monday 2026-11-02, 09:50 EST.
    expect(classSlots(Date.parse('2026-11-02T14:50:00Z')).filter((s) => s.lead === 10).map((s) => [s.weekday, s.startMin, s.occursAt])).toEqual([
      [1, 595, '2026-11-02T14:55:00.000Z'],
      [1, 600, '2026-11-02T15:00:00.000Z'],
    ]);
  });

  it('lets the runs from 09:50 to 09:58 catch a 10:00 class with a 10-minute lead, and not 09:59', () => {
    const seen: number[] = [];
    for (let minute = 45; minute <= 59; minute += 1) {
      const slots = classSlots(toronto(2026, 10, 26, 9, minute));
      if (slots.some((s) => s.lead === 10 && s.startMin === 600 && s.onDate === '2026-10-26')) seen.push(minute);
    }
    expect(seen).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58]);
  });

  it('is empty before 08:30 and after 20:48', () => {
    expect(classSlots(toronto(2026, 10, 26, 8, 28))).toEqual([]);
    expect(classSlots(toronto(2026, 10, 26, 8, 29))).toEqual([]);
    expect(classSlots(toronto(2026, 10, 26, 8, 30))).toEqual([{ lead: 30, weekday: 1, startMin: 540, onDate: '2026-10-26', occursAt: '2026-10-26T13:00:00.000Z' }]);
    expect(classSlots(toronto(2026, 10, 26, 20, 48)).map((s) => [s.lead, s.startMin])).toEqual(
      CLASS_LEADS.map((lead) => [lead, 1250]),
    );
    expect(classSlots(toronto(2026, 10, 26, 20, 49))).toEqual([]);
    expect(classSlots(toronto(2026, 10, 26, 3, 0))).toEqual([]);
  });

  it('works from a run time that is not on a whole minute', () => {
    const slots = classSlots(toronto(2026, 10, 26, 9, 50) + 30_000).filter((s) => s.lead === 10);
    expect(slots.map((s) => s.startMin)).toEqual([595, 600]);
  });
});

describe('offsetSendAt', () => {
  // Friday 2026-10-30 23:59 EDT.
  const due = '2026-10-31T03:59:00.000Z';

  it('takes exact durations for minutes and hours', () => {
    expect(offsetSendAt(due, '30m')).toBe('2026-10-31T03:29:00.000Z');
    expect(offsetSendAt(due, '1h')).toBe('2026-10-31T02:59:00.000Z');
    expect(offsetSendAt(due, '3h')).toBe('2026-10-31T00:59:00.000Z');
  });

  it('keeps the wall time for days and weeks', () => {
    expect(offsetSendAt(due, '1d')).toBe('2026-10-30T03:59:00.000Z');
    expect(offsetSendAt(due, '2d')).toBe('2026-10-29T03:59:00.000Z');
    expect(offsetSendAt(due, '1w')).toBe('2026-10-24T03:59:00.000Z');
  });

  it('is 25 hours for one day across the November change and 23 across the March change', () => {
    const november = iso(toronto(2026, 11, 1, 23, 59));
    expect(november).toBe('2026-11-02T04:59:00.000Z');
    expect(offsetSendAt(november, '1d')).toBe('2026-11-01T03:59:00.000Z');
    expect(Date.parse(november) - Date.parse(offsetSendAt(november, '1d'))).toBe(25 * HOUR);
    const march = iso(toronto(2027, 3, 14, 12, 0));
    expect(Date.parse(march) - Date.parse(offsetSendAt(march, '1d'))).toBe(23 * HOUR);
    expect(offsetSendAt(iso(toronto(2027, 3, 15, 9, 0)), '2d')).toBe(iso(toronto(2027, 3, 13, 9, 0)));
  });

  it('uses morningOf for the morning of', () => {
    for (const [h, m] of [
      [23, 59],
      [17, 0],
      [9, 30],
      [8, 0],
      [0, 30],
    ] as const) {
      const at = iso(toronto(2026, 11, 2, h, m));
      expect(offsetSendAt(at, 'morning')).toBe(morningOf(at));
    }
  });

  it('refuses a deadline that is not a time', () => {
    expect(() => offsetSendAt('soon', '1h')).toThrow(RangeError);
  });
});

describe('planAssignmentReminders', () => {
  const due = '2026-10-31T03:59:00.000Z';
  const now = Date.parse('2026-10-24T16:00:00.000Z');

  it('plans each offset, earliest first', () => {
    expect(planAssignmentReminders(due, ['1h', '1d'], now)).toEqual([
      { offset: '1d', sendAt: '2026-10-30T03:59:00.000Z' },
      { offset: '1h', sendAt: '2026-10-31T02:59:00.000Z' },
    ]);
    expect(planAssignmentReminders(due, ['30m', '2d'], now).map((r) => r.offset)).toEqual(['2d', '30m']);
    expect(planAssignmentReminders(due, [], now)).toEqual([]);
  });

  it('drops times already past or within a minute of now', () => {
    expect(planAssignmentReminders(due, ['1h', '1d'], Date.parse('2026-10-30T12:00:00.000Z')).map((r) => r.offset)).toEqual(['1h']);
    expect(planAssignmentReminders(due, ['1h'], Date.parse('2026-10-31T02:58:00.000Z'))).toEqual([]);
    expect(planAssignmentReminders(due, ['1h'], Date.parse('2026-10-31T02:57:59.000Z'))).toEqual([{ offset: '1h', sendAt: '2026-10-31T02:59:00.000Z' }]);
    expect(planAssignmentReminders(due, ['1h', '1d', '1w'], Date.parse('2026-10-31T04:00:00.000Z'))).toEqual([]);
  });

  it('collapses offsets that land on the same instant into the first listed', () => {
    // Due Monday 12:00 EDT: the morning of is 09:00, the same instant as 3 hours before.
    const noon = iso(toronto(2026, 10, 26, 12, 0));
    expect(planAssignmentReminders(noon, ['3h', 'morning'], now)).toEqual([{ offset: 'morning', sendAt: iso(toronto(2026, 10, 26, 9, 0)) }]);
    expect(planAssignmentReminders(noon, ['morning', '3h', '1h'], now)).toEqual([
      { offset: 'morning', sendAt: iso(toronto(2026, 10, 26, 9, 0)) },
      { offset: '1h', sendAt: iso(toronto(2026, 10, 26, 11, 0)) },
    ]);
  });

  it('keeps the 25-hour day across the November change', () => {
    const november = iso(toronto(2026, 11, 1, 23, 59));
    expect(planAssignmentReminders(november, ['1d'], now)).toEqual([{ offset: '1d', sendAt: '2026-11-01T03:59:00.000Z' }]);
  });
});

describe('nextClassReminder', () => {
  const meeting = (tag: string, patch: Partial<TimetableMeeting>): TimetableMeeting => ({
    id: `tm_${tag.padEnd(22, 'x')}`,
    kind: 'lec',
    section: null,
    weekday: 1,
    startMin: 600,
    endMin: 650,
    location: null,
    weekRule: 'all',
    weekList: null,
    ...patch,
  });
  const course = (tag: string, meetings: TimetableMeeting[], patch: Partial<TimetableCourse> = {}): TimetableCourse => ({
    id: `tc_${tag.padEnd(22, 'x')}`,
    termId: null,
    code: tag.toUpperCase(),
    title: null,
    color: 'purple',
    notes: null,
    remind: true,
    meetings,
    updatedAt: '',
    ...patch,
  });
  const on: Pick<TimetableSettings, 'classReminders' | 'classLeadMin'> = { classReminders: true, classLeadMin: 10 };
  const mat = course('mat', [meeting('mon', { weekday: 1, startMin: 600 }), meeting('wed', { weekday: 3, startMin: 540 })]);
  const data = { terms: [] as TimetableTerm[], courses: [mat], skips: [] as { onDate: string; meetingId: string | null; label: string | null }[] };

  it('gives the next class whose reminder time has not passed', () => {
    const next = nextClassReminder(data, on, true, toronto(2026, 10, 26, 9, 0));
    expect(next && iso(next.sendAtMs)).toBe(iso(toronto(2026, 10, 26, 9, 50)));
    expect(next?.occurrence.date).toBe('2026-10-26');
    expect(next?.occurrence.meeting.id).toBe(mat.meetings[0]?.id);
    expect(next && iso(next.occurrence.startMs)).toBe(iso(toronto(2026, 10, 26, 10, 0)));
    const later = nextClassReminder(data, on, true, toronto(2026, 10, 26, 9, 51));
    expect(later?.occurrence.date).toBe('2026-10-28');
    expect(later && iso(later.sendAtMs)).toBe(iso(toronto(2026, 10, 28, 8, 50)));
  });

  it('uses the lead time and steps over skipped days', () => {
    expect(iso(nextClassReminder(data, { classReminders: true, classLeadMin: 30 }, true, toronto(2026, 10, 26, 9, 0))?.sendAtMs ?? 0)).toBe(iso(toronto(2026, 10, 26, 9, 30)));
    const skipped = { ...data, skips: [{ onDate: '2026-10-28', meetingId: null, label: null }] };
    const next = nextClassReminder(skipped, on, true, toronto(2026, 10, 26, 9, 51));
    expect(next?.occurrence.date).toBe('2026-11-02');
    expect(next && iso(next.sendAtMs)).toBe('2026-11-02T14:50:00.000Z');
  });

  it('is null when any switch is off or nothing is reminded', () => {
    const now = toronto(2026, 10, 26, 9, 0);
    expect(nextClassReminder(data, on, false, now)).toBeNull();
    expect(nextClassReminder(data, { classReminders: false, classLeadMin: 10 }, true, now)).toBeNull();
    expect(nextClassReminder({ ...data, courses: [{ ...mat, remind: false }] }, on, true, now)).toBeNull();
    expect(nextClassReminder({ ...data, courses: [] }, on, true, now)).toBeNull();
    expect(nextClassReminder({ ...data, courses: [{ ...mat, termId: 'tt_missingxxxxxxxxxxxxxxx' }] }, on, true, now)).toBeNull();
  });

  it('finds the first class of a term that starts months later', () => {
    const winter: TimetableTerm = { id: 'tt_winterxxxxxxxxxxxxxxxx', name: 'Winter', startsOn: '2027-01-05', endsOn: '2027-04-30', skipWeeks: [], updatedAt: '' };
    const next = nextClassReminder({ terms: [winter], courses: [{ ...mat, termId: winter.id }], skips: [] }, on, true, toronto(2026, 10, 26, 9, 0));
    expect(next?.occurrence.date).toBe('2027-01-06');
    expect(next && iso(next.sendAtMs)).toBe(iso(toronto(2027, 1, 6, 8, 50)));
  });

  it('breaks a tie between classes at the same time by meeting id', () => {
    const csc = course('csc', [meeting('aaa', { weekday: 1, startMin: 600 })]);
    const next = nextClassReminder({ ...data, courses: [mat, csc] }, on, true, toronto(2026, 10, 26, 9, 0));
    expect(next?.occurrence.course.id).toBe(csc.id);
  });
});
