import { describe, expect, it } from 'vitest';
import { addDays, occurrencesBetween, type TimetableData } from '@utmmsc/shared';
import { course, meeting, term, tid } from './fixtures.testdata';
import { firstDayWithClasses, indexTimetable, occurrencesOn } from './occurrences';

const FALL = term();
const DATA: TimetableData = {
  terms: [FALL],
  courses: [
    course({
      termId: FALL.id,
      meetings: [
        meeting({ id: tid('tm', 'a'), weekday: 1, startMin: 540, endMin: 600 }),
        meeting({ id: tid('tm', 'b'), weekday: 7, startMin: 1200, endMin: 1260, weekRule: 'even' }),
        meeting({ id: tid('tm', 'c'), weekday: 3, startMin: 900, endMin: 1000, weekRule: 'list', weekList: [2, 9, 13] }),
      ],
    }),
    course({ id: tid('tc', 'free'), meetings: [meeting({ id: tid('tm', 'free'), weekday: 7, startMin: 600, endMin: 700 })] }),
    course({ id: tid('tc', 'orphan'), termId: tid('tt', 'gone'), meetings: [meeting({ id: tid('tm', 'orphan'), weekday: 1 })] }),
  ],
  skips: [
    { onDate: '2026-11-02', meetingId: tid('tm', 'a'), label: null },
    { onDate: '2026-11-15', meetingId: null, label: 'Holiday' },
  ],
};

describe('occurrencesOn', () => {
  it('agrees with the shared occurrencesBetween on every day of the term, daylight saving included', () => {
    const index = indexTimetable(DATA);
    const from = '2026-09-01';
    const to = '2026-12-31';
    const expected = occurrencesBetween(DATA, from, to);
    const actual = [];
    for (let date = from; date <= to; date = addDays(date, 1)) actual.push(...occurrencesOn(index, date));
    expect(actual.map((o) => [o.date, o.meeting.id, o.startMs, o.endMs])).toEqual(expected.map((o) => [o.date, o.meeting.id, o.startMs, o.endMs]));
  });

  it('returns skipped classes only when asked, marked', () => {
    const index = indexTimetable(DATA);
    expect(occurrencesOn(index, '2026-11-02')).toEqual([]);
    expect(occurrencesOn(index, '2026-11-02', true).map((o) => [o.meeting.id, o.skipped])).toEqual([[tid('tm', 'a'), true]]);
    expect(occurrencesOn(index, '2026-11-15', true).every((o) => o.skipped)).toBe(true);
  });

  it('never runs a course whose term is gone', () => {
    const index = indexTimetable(DATA);
    expect(occurrencesOn(index, '2026-10-19').map((o) => o.meeting.id)).toEqual([tid('tm', 'a')]);
  });
});

describe('firstDayWithClasses', () => {
  it('finds the next day with a class that has not ended', () => {
    const index = indexTimetable(DATA);
    const day = firstDayWithClasses(index, '2026-10-20', 30, Date.parse('2026-10-20T12:00:00Z'));
    expect(day?.[0]?.date).toBe('2026-10-25');
    expect(firstDayWithClasses(indexTimetable({ terms: [], courses: [], skips: [] }), '2026-10-20', 30, 0)).toBeNull();
  });
});
