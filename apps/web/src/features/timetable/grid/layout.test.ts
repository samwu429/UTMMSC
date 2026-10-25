import { describe, expect, it } from 'vitest';
import { assignment, course, meeting, term, tid } from '../model/fixtures.testdata';
import { weekOccurrences } from '../model/week';
import { blockKey, blockLabel, dueDates, listLine, listWeek, placeDay, placeWeek, visibleWeekdays } from './layout';

const FALL = term();
const MAT = course({
  termId: FALL.id,
  meetings: [
    meeting({ id: tid('tm', 'mon'), weekday: 1, startMin: 600, endMin: 650, section: 'LEC0101' }),
    meeting({ id: tid('tm', 'mon-tut'), weekday: 1, startMin: 630, endMin: 690, kind: 'tut', location: null }),
    meeting({ id: tid('tm', 'sat'), weekday: 6, startMin: 1200, endMin: 1260 }),
  ],
});
const DATA = { terms: [FALL], courses: [MAT], skips: [] };

describe('visibleWeekdays', () => {
  it('always shows the weekend unless asked to hide empty days', () => {
    expect(visibleWeekdays([MAT], 'always')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(visibleWeekdays([MAT], 'auto')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(visibleWeekdays([], 'auto')).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('placeDay', () => {
  it('turns times into hours from 09:00 and shares the width of overlaps', () => {
    const week = weekOccurrences(DATA, '2026-10-19');
    const monday = placeDay(week.filter((o) => o.date === '2026-10-19'));
    expect(monday.map((b) => [b.top, b.height, b.lane, b.lanes])).toEqual([
      [1, 50 / 60, 0, 2],
      [1.5, 1, 1, 2],
    ]);
    const saturday = placeDay(week.filter((o) => o.date === '2026-10-24'));
    expect(saturday[0]?.top).toBe(11);
    expect(saturday[0]?.height).toBe(1);
  });

  it('keeps imported times outside the window on the grid', () => {
    const early = course({ meetings: [meeting({ id: tid('tm', 'early'), weekday: 2, startMin: 480, endMin: 570 })] });
    const [block] = placeDay(weekOccurrences({ terms: [], courses: [early], skips: [] }, '2026-10-19'));
    expect(block?.top).toBe(0);
    expect(block?.height).toBe(0.5);
  });
});

describe('placeWeek and listWeek', () => {
  it('has an entry for every shown day, empty ones included', () => {
    const week = weekOccurrences(DATA, '2026-10-19');
    const placed = placeWeek(week, '2026-10-19', [1, 2, 3, 4, 5]);
    expect([...placed.keys()]).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
    expect(placed.get('2026-10-19')).toHaveLength(2);
    expect(placed.get('2026-10-20')).toEqual([]);
    const list = listWeek(week, '2026-10-19', [1, 2, 3, 4, 5, 6, 7]);
    expect(list.map((day) => day.items.length)).toEqual([2, 0, 0, 0, 0, 1, 0]);
    expect(list[5]?.weekday).toBe(6);
  });
});

describe('labels', () => {
  it('reads a block in full for screen readers', () => {
    const week = weekOccurrences({ ...DATA, skips: [{ onDate: '2026-10-19', meetingId: tid('tm', 'mon-tut'), label: null }] }, '2026-10-19');
    const [lecture, tutorial] = week;
    if (!lecture || !tutorial) throw new Error('missing classes');
    expect(blockLabel(lecture, 1, 'zh')).toBe('MAT102 讲座 LEC0101，周一 10:00 到 10:50，DV 2074');
    expect(blockLabel(tutorial, 1, 'zh')).toBe('MAT102 辅导，周一 10:30 到 11:30，本次不上');
    expect(blockLabel(lecture, 1, 'en')).toBe('MAT102 Lecture LEC0101, Monday 10:00 AM to 10:50 AM, DV 2074');
  });

  it('names overlaps', () => {
    const [lecture] = weekOccurrences(DATA, '2026-10-19');
    if (!lecture) throw new Error('missing class');
    expect(blockLabel(lecture, 1, 'zh').endsWith('与其他课时间重叠')).toBe(true);
    expect(listLine(lecture, 'zh')).toBe('10:00–10:50 · 讲座 LEC0101 · DV 2074');
    expect(listLine(lecture, 'en')).toBe('10:00–10:50 AM · Lecture LEC0101 · DV 2074');
    expect(blockKey(lecture)).toBe(`${tid('tm', 'mon')}|2026-10-19`);
  });
});

describe('dueDates', () => {
  it('marks the Toronto dates with open assignments', () => {
    const dates = dueDates([
      assignment({ dueAt: '2026-10-24T03:59:00.000Z' }),
      assignment({ dueAt: '2026-10-25T16:00:00.000Z', doneAt: '2026-10-20T00:00:00.000Z' }),
    ]);
    expect([...dates]).toEqual(['2026-10-23']);
  });
});
