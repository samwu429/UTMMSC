import { describe, expect, it } from 'vitest';
import type { TimetableCourse, TimetableData } from '@utmmsc/shared';
import { course, meeting, term, tid, toronto } from './fixtures.testdata';
import { findConflicts, lanes, weekOccurrences } from './week';

const FALL = term();
const MAT = course({
  termId: FALL.id,
  meetings: [meeting({ id: tid('tm', 'mat-mon'), weekday: 1, startMin: 600, endMin: 650 }), meeting({ id: tid('tm', 'mat-wed'), weekday: 3, startMin: 600, endMin: 650, weekRule: 'odd' })],
});
const CSC = course({ id: tid('tc', 'csc108'), code: 'CSC108H5F', color: 'blue', termId: FALL.id, meetings: [meeting({ id: tid('tm', 'csc-mon'), weekday: 1, startMin: 630, endMin: 690 })] });

function data(patch: Partial<TimetableData> = {}): TimetableData {
  return { terms: [FALL], courses: [MAT, CSC], skips: [], ...patch };
}

describe('weekOccurrences', () => {
  it('lists the week by start, with instants in Toronto time and overlaps marked', () => {
    const week = weekOccurrences(data(), '2026-10-19');
    expect(week.map((o) => [o.date, o.meeting.id])).toEqual([
      ['2026-10-19', tid('tm', 'mat-mon')],
      ['2026-10-19', tid('tm', 'csc-mon')],
      ['2026-10-21', tid('tm', 'mat-wed')],
    ]);
    expect(week[0]?.startMs).toBe(toronto('2026-10-19', '10:00'));
    expect(week[0]?.endMs).toBe(toronto('2026-10-19', '10:50'));
    expect(week.map((o) => o.conflict)).toEqual([true, true, false]);
    expect(week.every((o) => !o.skipped)).toBe(true);
  });

  it('follows odd weeks and has nothing in reading week', () => {
    expect(weekOccurrences(data(), '2026-10-12').map((o) => o.meeting.id)).not.toContain(tid('tm', 'mat-wed'));
    expect(weekOccurrences(data(), '2026-10-26')).toEqual([]);
  });

  it('keeps skipped classes, marked, and they cause no overlap', () => {
    const single = weekOccurrences(data({ skips: [{ onDate: '2026-10-19', meetingId: tid('tm', 'mat-mon'), label: null }] }), '2026-10-19');
    expect(single.map((o) => [o.meeting.id, o.skipped, o.conflict])).toEqual([
      [tid('tm', 'mat-mon'), true, false],
      [tid('tm', 'csc-mon'), false, false],
      [tid('tm', 'mat-wed'), false, false],
    ]);
    const holiday = weekOccurrences(data({ skips: [{ onDate: '2026-10-21', meetingId: null, label: null }] }), '2026-10-19');
    expect(holiday.find((o) => o.date === '2026-10-21')?.skipped).toBe(true);
  });

  it('keeps the wall-clock time across the end of daylight saving', () => {
    const free = course({ id: tid('tc', 'free'), meetings: [meeting({ id: tid('tm', 'sun'), weekday: 7, startMin: 1200, endMin: 1250 })] });
    const [sunday] = weekOccurrences({ terms: [], courses: [free], skips: [] }, '2026-10-26');
    expect(sunday?.date).toBe('2026-11-01');
    expect(sunday?.startMs).toBe(Date.parse('2026-11-01T20:00:00-05:00'));
  });
});

describe('lanes', () => {
  it('places lone blocks full width', () => {
    const placed = lanes([
      { key: 'a', startMin: 600, endMin: 660 },
      { key: 'b', startMin: 660, endMin: 720 },
    ]);
    expect(placed.get('a')).toEqual({ lane: 0, lanes: 1 });
    expect(placed.get('b')).toEqual({ lane: 0, lanes: 1 });
  });

  it('shares the width within a cluster and reuses a lane that came free', () => {
    const placed = lanes([
      { key: 'c', startMin: 660, endMin: 720 },
      { key: 'a', startMin: 600, endMin: 660 },
      { key: 'b', startMin: 630, endMin: 690 },
      { key: 'd', startMin: 780, endMin: 840 },
    ]);
    expect(placed.get('a')).toEqual({ lane: 0, lanes: 2 });
    expect(placed.get('b')).toEqual({ lane: 1, lanes: 2 });
    expect(placed.get('c')).toEqual({ lane: 0, lanes: 2 });
    expect(placed.get('d')).toEqual({ lane: 0, lanes: 1 });
  });

  it('gives three blocks at once three lanes, the longest first', () => {
    const placed = lanes([
      { key: 'short', startMin: 600, endMin: 630 },
      { key: 'long', startMin: 600, endMin: 720 },
      { key: 'mid', startMin: 610, endMin: 660 },
    ]);
    expect(placed.get('long')).toEqual({ lane: 0, lanes: 3 });
    expect(placed.get('short')).toEqual({ lane: 1, lanes: 3 });
    expect(placed.get('mid')).toEqual({ lane: 2, lanes: 3 });
  });
});

describe('findConflicts', () => {
  const draft = (patch: Partial<TimetableCourse>) => {
    const c = course({ id: tid('tc', 'draft'), termId: FALL.id, ...patch });
    return { id: c.id, termId: c.termId, meetings: c.meetings };
  };

  it('finds a same-day overlap in the same term', () => {
    const conflicts = findConflicts(draft({ meetings: [meeting({ id: tid('tm', 'd1'), weekday: 1, startMin: 640, endMin: 700 })] }), [MAT, CSC], [FALL]);
    expect(conflicts.map((c) => c.other.meeting.id)).toEqual([tid('tm', 'mat-mon'), tid('tm', 'csc-mon')]);
    expect(conflicts.every((c) => c.meetingId === tid('tm', 'd1'))).toBe(true);
  });

  it('never pits odd weeks against even weeks', () => {
    const even = draft({ meetings: [meeting({ id: tid('tm', 'd1'), weekday: 3, startMin: 600, endMin: 650, weekRule: 'even' })] });
    expect(findConflicts(even, [MAT], [FALL])).toEqual([]);
    const listOdd = draft({ meetings: [meeting({ id: tid('tm', 'd1'), weekday: 3, startMin: 600, endMin: 650, weekRule: 'list', weekList: [2, 4] })] });
    expect(findConflicts(listOdd, [MAT], [FALL])).toEqual([]);
    const listHit = draft({ meetings: [meeting({ id: tid('tm', 'd1'), weekday: 3, startMin: 620, endMin: 700, weekRule: 'list', weekList: [3] })] });
    expect(findConflicts(listHit, [MAT], [FALL])).toHaveLength(1);
  });

  it('ignores terms whose dates do not meet, the course itself and back-to-back classes', () => {
    const winter = term({ id: tid('tt', 'winter'), name: '2027 冬季', startsOn: '2027-01-05', endsOn: '2027-04-07', skipWeeks: [] });
    const inWinter = draft({ termId: winter.id, meetings: [meeting({ id: tid('tm', 'd1'), weekday: 1, startMin: 600, endMin: 650 })] });
    expect(findConflicts(inWinter, [MAT], [FALL, winter])).toEqual([]);
    const self = { id: MAT.id, termId: MAT.termId, meetings: MAT.meetings };
    expect(findConflicts(self, [MAT], [FALL])).toEqual([]);
    const after = draft({ meetings: [meeting({ id: tid('tm', 'd1'), weekday: 1, startMin: 650, endMin: 700 })] });
    expect(findConflicts(after, [MAT], [FALL])).toEqual([]);
  });

  it('lets a course without a term meet every term', () => {
    const anyWeek = { id: tid('tc', 'draft'), termId: null, meetings: [meeting({ id: tid('tm', 'd1'), weekday: 3, startMin: 600, endMin: 650 })] };
    expect(findConflicts(anyWeek, [MAT], [FALL])).toHaveLength(1);
  });
});
