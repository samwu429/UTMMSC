import { describe, expect, it } from 'vitest';
import { buildTimetableIcs } from './build';
import { parseIcs } from './parse';
import { NOW, fixture } from './fixtures.testdata';
import { FLOATING_ICS, GOOGLE_ICS, OUTLOOK_ICS, QUERCUS_ICS, UTC_ICS } from './samples.testdata';

describe('parseIcs', () => {
  it('reads a Google export: rules, EXDATEs, a moved class, statuses, escaped text', () => {
    const { events, zones } = parseIcs(GOOGLE_ICS);
    expect(zones.get('America/Toronto')).toBe('America/Toronto');
    expect(events).toHaveLength(9);
    const lecture = events[0]!;
    expect(lecture.uid).toBe('lecture-mat102@google.com');
    expect(lecture.summary).toBe('MAT102H5 F LEC0101');
    expect(lecture.location).toBe('DV 2074, Deerfield Hall');
    expect(lecture.status).toBe('CONFIRMED');
    expect(lecture.start).toEqual({ date: '2026-09-08', minute: 600, second: 0, utc: false, tzid: 'America/Toronto' });
    expect(lecture.rule).toEqual({ freq: 'WEEKLY', interval: 1, byDay: ['TU', 'TH'], until: { date: '2026-12-02', minute: 299, second: 59, utc: true, tzid: null }, count: null });
    expect(lecture.exdates.map((value) => value.date)).toEqual(['2026-10-13', '2026-10-15']);
    // The alarm's DESCRIPTION belongs to the alarm, not to the event.
    // 提醒中的 DESCRIPTION 属于提醒，不属于事件。
    expect(lecture.description).toBe('');
    const moved = events[1]!;
    expect(moved.recurrenceId?.date).toBe('2026-11-03');
    expect(events[2]!.rule?.interval).toBe(2);
    expect(events.find((event) => event.uid === 'cancelled@google.com')?.status).toBe('CANCELLED');
    expect(events.find((event) => event.uid === 'orientation@google.com')?.start.minute).toBeNull();
  });

  it('reads Outlook zones from their VTIMEZONE blocks, quoted or not', () => {
    const { events, zones } = parseIcs(OUTLOOK_ICS);
    expect(zones.get('Eastern Standard Time')).toBe('America/Toronto');
    // An unknown name is placed by its offsets.
    // 无法识别的名称按偏移量确定时区。
    expect(zones.get('Customized Time Zone')).toBe('America/Toronto');
    expect(events[0]!.start.tzid).toBe('Eastern Standard Time');
    expect(events[0]!.description).toBe('Bring a laptop\nRoom changes are posted on Quercus');
    expect(events[0]!.rule?.count).toBe(12);
    expect(events[1]!.start.tzid).toBe('Customized Time Zone');
    expect(events[1]!.summary).toBe('CSC108 PRA0105');
  });

  it('reads Z times, durations and LF line ends', () => {
    const { events } = parseIcs(UTC_ICS);
    expect(events).toHaveLength(2);
    expect(events[0]!.start.utc).toBe(true);
    expect(events[1]!.end).toBeNull();
    expect(events[1]!.durationMs).toBe(50 * 60_000);
  });

  it('reads floating times and all-day values', () => {
    expect(parseIcs(FLOATING_ICS).events[0]!.start).toEqual({ date: '2026-09-10', minute: 1140, second: 0, utc: false, tzid: null });
    expect(parseIcs(QUERCUS_ICS).events[1]!.start).toEqual({ date: '2026-11-06', minute: null, second: 0, utc: false, tzid: null });
  });

  it('keeps this app’s own properties', () => {
    const { events } = parseIcs(buildTimetableIcs(fixture, { nowMs: NOW, locale: 'zh' }));
    expect(events).toHaveLength(5);
    expect(events[0]!.extras).toMatchObject({ ITEM: 'class', CODE: 'MAT102H5F', KIND: 'lec', COLOR: 'blue', WEEKS: 'all', 'TERM-DATES': '20260903/20261203', 'TERM-SKIP': '7' });
    expect(events[4]!.extras).toMatchObject({ ITEM: 'assignment', TITLE: 'PS3', OFFSETS: '1d morning 1h' });
    expect(events[0]!.description).toBe('Intro to Mathematical Proofs\n\nBring; notes, please');
  });

  it('marks repeats it cannot read and skips broken events without throwing', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:no-start',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:rdate',
      'DTSTART:20261101T100000',
      'RDATE:20261108T100000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:bad-rule',
      'DTSTART:20261101T100000',
      'RRULE:FREQ=WEEKLY;INTERVAL=0',
      'END:VEVENT',
      'garbage without a colon',
      'END:VCALENDAR',
    ].join('\r\n');
    const { events } = parseIcs(text);
    expect(events.map((event) => [event.uid, event.unreadableRepeat])).toEqual([
      ['rdate', true],
      ['bad-rule', true],
    ]);
    expect(parseIcs('').events).toEqual([]);
    expect(parseIcs('not a calendar at all').events).toEqual([]);
  });
});
