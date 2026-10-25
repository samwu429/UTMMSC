import { describe, expect, it } from 'vitest';
import { isTimetableId, readCourse } from '@utmmsc/shared';
import { newTimetableId } from '../model/ids';
import { course, meeting, term, tid } from '../model/fixtures.testdata';
import { findConflicts } from '../model/week';
import {
  TIME_TEMPLATES,
  addToCourse,
  bodyOfCourse,
  conflictNotices,
  copyMeetingToDays,
  copyRow,
  draftFromCourse,
  draftProblems,
  draftToBody,
  endAtHour,
  endHours,
  endMinutes,
  kindOfSection,
  newCourseDraft,
  nextRow,
  recentLocations,
  rowAt,
  selectableWeeks,
  startHours,
  startMinutes,
  toggleDay,
  withDuration,
  withSection,
  withStart,
  withTemplate,
} from './courseDraft';

let keys = 0;
const newKey = () => `k${(keys += 1)}`;
const newMeetingId = () => newTimetableId('tm');
const FALL = term();

describe('drafts from courses', () => {
  it('puts meetings that differ only by day in one row and keeps their ids', () => {
    const c = course({
      meetings: [
        meeting({ id: tid('tm', 'mon'), weekday: 1 }),
        meeting({ id: tid('tm', 'wed'), weekday: 3 }),
        meeting({ id: tid('tm', 'tut'), weekday: 3, startMin: 900, endMin: 960, kind: 'tut', section: 'TUT0103' }),
      ],
    });
    const draft = draftFromCourse(c, newKey);
    expect(draft.rows.map((row) => row.days)).toEqual([[1, 3], [3]]);
    expect(draft.rows[0]?.ids).toEqual({ 1: tid('tm', 'mon'), 3: tid('tm', 'wed') });
    const body = draftToBody(draft, newMeetingId, false);
    expect(body.meetings.map((m) => m.id)).toEqual([tid('tm', 'mon'), tid('tm', 'wed'), tid('tm', 'tut')]);
    expect(readCourse(body).ok).toBe(true);
  });

  it('keeps the id of a day that stays and makes new ids for new days', () => {
    const c = course({ meetings: [meeting({ id: tid('tm', 'mon'), weekday: 1 }), meeting({ id: tid('tm', 'wed'), weekday: 3 })] });
    const draft = draftFromCourse(c, newKey);
    const row = draft.rows[0];
    if (!row) throw new Error('no row');
    const edited = { ...draft, rows: [withStart(toggleDay(toggleDay(row, 3), 5), 660)] };
    const body = draftToBody(edited, newMeetingId, false);
    expect(body.meetings.map((m) => m.weekday)).toEqual([1, 5]);
    expect(body.meetings[0]?.id).toBe(tid('tm', 'mon'));
    expect(body.meetings[0]?.startMin).toBe(660);
    expect(body.meetings[0]?.endMin).toBe(710);
    expect(isTimetableId(body.meetings[1]?.id, 'tm')).toBe(true);
    expect(body.meetings[1]?.id).not.toBe(tid('tm', 'wed'));
  });

  it('starts a new course on the tapped slot with the next colour and the term of the date', () => {
    const draft = newCourseDraft({ id: tid('tc', 'new'), courses: [course()], terms: [FALL], date: '2026-10-20', at: { weekday: 2, startMin: 630 }, durationMin: 90, rowKey: 'r' });
    expect(draft).toMatchObject({ isNew: true, color: 'gold', termId: FALL.id, remind: true });
    expect(draft.rows[0]).toMatchObject({ days: [2], startMin: 630, endMin: 720 });
    expect(newCourseDraft({ id: tid('tc', 'new'), courses: [], terms: [FALL], date: '2027-01-20', at: { weekday: 2, startMin: 630 }, durationMin: 60, rowKey: 'r' }).termId).toBeNull();
  });

  it('adds a row on the slot to an existing course', () => {
    const draft = addToCourse(course(), { weekday: 4, startMin: 1230 }, 60, newKey);
    expect(draft.isNew).toBe(false);
    expect(draft.rows.map((row) => [row.days, row.startMin, row.endMin])).toEqual([
      [[1], 600, 650],
      [[4], 1230, 1260],
    ]);
  });
});

describe('rows', () => {
  const base = rowAt('r', { weekday: 1, startMin: 600 }, 60);

  it('copies the previous time and location for + 添加上课时间, with no day yet', () => {
    const row = nextRow({ ...base, location: 'DV 2074', ids: { 1: tid('tm', 'x') } }, 'n');
    expect(row).toMatchObject({ key: 'n', days: [], ids: {}, startMin: 600, endMin: 660, location: 'DV 2074' });
    expect(copyRow({ ...base, ids: { 1: tid('tm', 'x') } }, 'c')).toMatchObject({ key: 'c', days: [1], ids: {} });
  });

  it('keeps the duration when the start moves, never past 21:00', () => {
    expect(withStart(base, 690)).toMatchObject({ startMin: 690, endMin: 750 });
    expect(withStart(withDuration(base, 120), 1200)).toMatchObject({ startMin: 1200, endMin: 1260 });
  });

  it('applies the time templates', () => {
    const [mwf, tth, once2] = TIME_TEMPLATES;
    if (!mwf || !tth || !once2) throw new Error('templates');
    expect(withTemplate(base, mwf)).toMatchObject({ days: [1, 3, 5], endMin: 660 });
    expect(withTemplate(base, tth)).toMatchObject({ days: [2, 4], endMin: 690 });
    expect(withTemplate({ ...base, days: [3, 5] }, once2)).toMatchObject({ days: [3], endMin: 720 });
  });

  it('reads the kind from a section such as TUT0103', () => {
    expect(kindOfSection('TUT0103')).toBe('tut');
    expect(kindOfSection('pra0102')).toBe('pra');
    expect(kindOfSection('0101')).toBeNull();
    expect(withSection(base, 'tut0103')).toMatchObject({ section: 'TUT0103', kind: 'tut' });
    expect(withSection({ ...base, kind: 'lab' }, '0101').kind).toBe('lab');
  });

  it('offers only times the server accepts', () => {
    expect(startHours()).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(startMinutes(20)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
    expect(startMinutes(9)).toHaveLength(12);
    expect(endHours(1250)).toEqual([21]);
    expect(endMinutes(1250, 21)).toEqual([0]);
    expect(endHours(600)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(endMinutes(600, 10)[0]).toBe(10);
    expect(endMinutes(600, 21)).toEqual([0]);
    expect(endAtHour({ ...base, endMin: 650 }, 11)).toBe(710);
    expect(endAtHour({ ...base, endMin: 650 }, 21)).toBe(1260);
  });

  it('lists custom weeks of the chosen term', () => {
    expect(selectableWeeks(FALL)).toHaveLength(14);
    expect(selectableWeeks(null)).toHaveLength(40);
  });
});

describe('draftProblems', () => {
  const ok = () => newCourseDraft({ id: tid('tc', 'new'), courses: [], terms: [], date: '2026-10-20', at: { weekday: 2, startMin: 630 }, durationMin: 60, rowKey: 'r' });

  it('passes a sound draft that the server accepts', () => {
    const draft = { ...ok(), code: ' mat102h5f ' };
    expect(draftProblems(draft, false).any).toBe(false);
    const body = draftToBody(draft, newMeetingId, false);
    expect(body.code).toBe('MAT102H5F');
    expect(readCourse(body).ok).toBe(true);
  });

  it('asks for a code of at most 20 characters', () => {
    expect(draftProblems(ok(), false).code).toBe('code');
    expect(draftProblems({ ...ok(), code: 'X'.repeat(21) }, false).code).toBe('code');
  });

  it('finds row problems in the order the form shows them', () => {
    const draft = { ...ok(), code: 'MAT102' };
    const row = draft.rows[0];
    if (!row) throw new Error('no row');
    const check = (patch: Partial<typeof row>, hasTerm = false) => draftProblems({ ...draft, rows: [{ ...row, ...patch }] }, hasTerm).rows.r;
    expect(check({ days: [] })).toBe('no_day');
    expect(check({ startMin: 535 })).toBe('time');
    expect(check({ startMin: 1255, endMin: 1260 })).toBe('time');
    expect(check({ startMin: 600, endMin: 605 })).toBe('too_short');
    expect(check({ weekRule: 'odd' })).toBe('weeks_need_term');
    expect(check({ weekRule: 'odd' }, true)).toBeUndefined();
    expect(check({ weekRule: 'list', weekList: [] }, true)).toBe('no_weeks');
  });

  it('allows at most 10 meetings', () => {
    const draft = { ...ok(), code: 'MAT102' };
    const rows = Array.from({ length: 4 }, (_, index) => ({ ...rowAt(`r${index}`, { weekday: 1, startMin: 600 + index * 60 }, 60), days: [1, 2, 3] as (1 | 2 | 3)[] }));
    expect(draftProblems({ ...draft, rows }, false).tooMany).toBe(true);
    expect(draftProblems({ ...draft, rows: rows.slice(0, 3) }, false).tooMany).toBe(false);
  });

  it('drops week rules from a course without a term when saving', () => {
    const draft = { ...ok(), code: 'MAT102' };
    const row = draft.rows[0];
    if (!row) throw new Error('no row');
    const body = draftToBody({ ...draft, rows: [{ ...row, weekRule: 'list', weekList: [3, 1] }] }, newMeetingId, false);
    expect(body.meetings[0]).toMatchObject({ weekRule: 'all', weekList: null });
    const termed = draftToBody({ ...draft, termId: FALL.id, rows: [{ ...row, weekRule: 'list', weekList: [3, 1] }] }, newMeetingId, true);
    expect(termed.meetings[0]).toMatchObject({ weekRule: 'list', weekList: [1, 3] });
  });
});

describe('conflictNotices', () => {
  it('names each other class once, in day order', () => {
    const csc = course({ id: tid('tc', 'csc'), code: 'CSC108H5F', meetings: [meeting({ id: tid('tm', 'csc-wed'), weekday: 3, startMin: 600, endMin: 660 }), meeting({ id: tid('tm', 'csc-mon'), weekday: 1, startMin: 600, endMin: 660 })] });
    const draft = draftFromCourse(course({ id: tid('tc', 'draft'), meetings: [meeting({ id: tid('tm', 'd-mon'), weekday: 1, startMin: 630, endMin: 690 }), meeting({ id: tid('tm', 'd-wed'), weekday: 3, startMin: 630, endMin: 690 })] }), newKey);
    const body = draftToBody(draft, newMeetingId, false);
    const conflicts = findConflicts(body, [csc], []);
    expect(conflictNotices(conflicts, 'zh')).toEqual(['与 CSC108 周一 10:00–11:00 时间重叠', '与 CSC108 周三 10:00–11:00 时间重叠']);
    expect(conflictNotices(conflicts, 'en')[0]).toBe('Overlaps CSC108 Mon 10:00–11:00 AM');
  });
});

describe('recentLocations', () => {
  it('lists distinct locations of the most recently changed courses first', () => {
    const older = course({ id: tid('tc', 'old'), updatedAt: '2026-09-01T00:00:00.000Z', meetings: [meeting({ location: 'IB 110' }), meeting({ id: tid('tm', 'x'), location: 'DV 2074' })] });
    const newer = course({ id: tid('tc', 'new'), updatedAt: '2026-10-01T00:00:00.000Z', meetings: [meeting({ id: tid('tm', 'y'), location: ' DV 2074 ' }), meeting({ id: tid('tm', 'z'), location: null })] });
    expect(recentLocations([older, newer])).toEqual(['DV 2074', 'IB 110']);
  });
});

describe('copyMeetingToDays', () => {
  it('adds the class on the chosen days, once, keeping the stored course', () => {
    const c = course({ meetings: [meeting({ id: tid('tm', 'mon'), weekday: 1 }), meeting({ id: tid('tm', 'wed'), weekday: 3 })] });
    let n = 0;
    const body = copyMeetingToDays(c, c.meetings[0] ?? meeting(), [1, 3, 5], () => tid('tm', `new${(n += 1)}`));
    expect(body?.meetings.map((m) => [m.weekday, m.id])).toEqual([
      [1, tid('tm', 'mon')],
      [3, tid('tm', 'wed')],
      [5, tid('tm', 'new1')],
    ]);
    expect(body && 'updatedAt' in body).toBe(false);
    expect(bodyOfCourse(c).meetings).toEqual(c.meetings);
  });

  it('refuses to pass 10 meetings', () => {
    const many = course({ meetings: Array.from({ length: 9 }, (_, index) => meeting({ id: tid('tm', `m${index}`), weekday: 1, startMin: 540 + index * 60, endMin: 590 + index * 60 })) });
    expect(copyMeetingToDays(many, many.meetings[0] ?? meeting(), [2, 3], newMeetingId)).toBeNull();
    expect(copyMeetingToDays(many, many.meetings[0] ?? meeting(), [2], newMeetingId)?.meetings).toHaveLength(10);
  });
});
