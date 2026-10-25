import { describe, expect, it } from 'vitest';
import { readAssignment, readTerm } from '@utmmsc/shared';
import { newTimetableId } from '../model/ids';
import { course, meeting, term, tid, toronto } from '../model/fixtures.testdata';
import {
  assignmentProblem,
  beforeClass,
  draftFromAssignment,
  draftToBody,
  dueAtOf,
  dueDateBounds,
  dueDateChips,
  newAssignmentDraft,
  offsetLabel,
  toggleOffset,
} from './assignmentDraft';
import {
  copyCourses,
  coursesInTerm,
  defaultTermName,
  holidayDates,
  keepSkipWeeks,
  newTermDraft,
  nextTermDraft,
  skipRoom,
  termProblem,
  termWeeks,
} from './termDraft';

const NOW = toronto('2026-10-21', '18:00'); // Wednesday

describe('assignment drafts', () => {
  it('starts due tomorrow at 23:59 with the default reminders', () => {
    const draft = newAssignmentDraft({ id: tid('ta', 'new'), nowMs: NOW, offsets: ['1d', '1h'], courseId: tid('tc', 'mat') });
    expect(draft).toMatchObject({ dueDate: '2026-10-22', dueMin: 1439, offsets: ['1d', '1h'], courseId: tid('tc', 'mat') });
    expect(dueAtOf(draft)).toBe('2026-10-23T03:59:00.000Z');
  });

  it('reads the date and time back in Toronto time', () => {
    const draft = draftFromAssignment({ id: tid('ta', 'x'), courseId: null, title: 'PS3', notes: null, dueAt: '2026-11-03T04:59:00.000Z', remindOffsets: ['morning'], doneAt: null, updatedAt: '' });
    expect(draft).toMatchObject({ dueDate: '2026-11-02', dueMin: 1439, offsets: ['morning'], isNew: false });
  });

  it('gives the chip dates, with Friday moving on once it has passed', () => {
    expect(dueDateChips('2026-10-21')).toEqual({ today: '2026-10-21', tomorrow: '2026-10-22', friday: '2026-10-23', monday: '2026-10-26' });
    expect(dueDateChips('2026-10-24').friday).toBe('2026-10-30');
    expect(dueDateChips('2026-10-25').monday).toBe('2026-10-26');
  });

  it('finds the next class of the course for 课前', () => {
    const data = { terms: [], skips: [], courses: [course({ meetings: [meeting({ weekday: 3, startMin: 600 }), meeting({ id: tid('tm', 'fri'), weekday: 5, startMin: 840, endMin: 900 })] })] };
    expect(beforeClass(data, course().id, NOW)).toEqual({ date: '2026-10-23', minute: 840 });
    expect(beforeClass(data, course().id, toronto('2026-10-21', '09:00'))).toEqual({ date: '2026-10-21', minute: 600 });
    expect(beforeClass(data, null, NOW)).toBeNull();
    expect(beforeClass(data, tid('tc', 'gone'), NOW)).toBeNull();
  });

  it('allows at most three reminders, kept in the standard order', () => {
    expect(toggleOffset(['1h'], '1d')).toEqual({ offsets: ['1d', '1h'], refused: false });
    expect(toggleOffset(['1d', '1h', '30m'], '1w')).toEqual({ offsets: ['1d', '1h', '30m'], refused: true });
    expect(toggleOffset(['1d', '1h'], '1d')).toEqual({ offsets: ['1h'], refused: false });
    expect(offsetLabel('morning', 'zh')).toBe('当天早上');
    expect(offsetLabel('1w', 'en')).toBe('1 week');
  });

  it('checks the title and the range and makes a body the server accepts', () => {
    const draft = newAssignmentDraft({ id: newTimetableId('ta'), nowMs: NOW, offsets: ['1d'] });
    expect(assignmentProblem(draft, NOW)).toBe('title');
    const titled = { ...draft, title: '  PS3  ', notes: ' ' };
    expect(assignmentProblem(titled, NOW)).toBeNull();
    expect(assignmentProblem({ ...titled, dueDate: '2028-01-01' }, NOW)).toBe('due_range');
    const body = draftToBody(titled);
    expect(body).toMatchObject({ title: 'PS3', notes: null, remindOffsets: ['1d'] });
    expect(readAssignment(body, NOW).ok).toBe(true);
  });

  it('refuses a due date the calendar cannot draw instead of throwing', () => {
    const titled = { ...newAssignmentDraft({ id: newTimetableId('ta'), nowMs: NOW, offsets: [] }), title: 'PS3' };
    // A half-typed year from the date field, a year before 1970, one past 2100, and no date at all.
    // 日期栏中只输入了一半的年份、1970 年之前的年份、2100 年之后的年份，以及没有日期。
    for (const dueDate of ['0002-10-25', '1969-12-31', '2101-01-01', '']) {
      expect(() => assignmentProblem({ ...titled, dueDate }, NOW)).not.toThrow();
      expect(assignmentProblem({ ...titled, dueDate }, NOW)).toBe('due_range');
    }
  });

  it('opens an item whose stored due time cannot be read with the date left empty', () => {
    for (const dueAt of ['0002-10-25T04:00:00.000Z', '1969-12-31T23:00:00.000Z', 'soon']) {
      const draft = draftFromAssignment({ id: tid('ta', 'x'), courseId: null, title: 'PS3', notes: null, dueAt, remindOffsets: [], doneAt: null, updatedAt: '' });
      expect(draft).toMatchObject({ dueDate: '', dueMin: 1439 });
      expect(assignmentProblem(draft, NOW)).toBe('due_range');
    }
  });

  it('bounds the date picker by the window the server accepts', () => {
    expect(dueDateBounds('2026-10-21')).toEqual({ min: '2025-10-21', max: '2027-11-25' });
  });
});

describe('term drafts', () => {
  it('names terms by season and language', () => {
    expect(defaultTermName('2026-10-21', 'zh')).toBe('2026 秋季');
    expect(defaultTermName('2027-02-01', 'zh')).toBe('2027 冬季');
    expect(defaultTermName('2027-06-01', 'en')).toBe('Summer 2027');
  });

  it('starts a 13-week term on Monday of this week that the server accepts', () => {
    const draft = newTermDraft(newTimetableId('tt'), '2026-10-21', 'zh');
    expect(draft).toMatchObject({ startsOn: '2026-10-19', endsOn: '2027-01-17', skipWeeks: [] });
    expect(termWeeks(draft)).toHaveLength(13);
    expect(readTerm(draft).ok).toBe(true);
  });

  it('proposes the next term for 复制到新学期 and copies courses with every week', () => {
    expect(nextTermDraft(tid('tt', 'w'), term(), 'zh')).toMatchObject({ name: '2027 冬季', startsOn: '2026-12-14' });
    expect(nextTermDraft(tid('tt', 's'), term({ endsOn: '2027-04-07' }), 'en').name).toBe('Summer 2027');
    let n = 0;
    const copies = copyCourses(
      [course({ termId: term().id, meetings: [meeting({ weekRule: 'odd' })] }), course({ id: tid('tc', 'other'), termId: null })],
      term().id,
      tid('tt', 'w'),
      () => tid('tc', `copy${(n += 1)}`),
      () => tid('tm', `copy${(n += 1)}`),
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ id: tid('tc', 'copy1'), termId: tid('tt', 'w'), code: 'MAT102H5F' });
    expect(copies[0]?.meetings[0]).toMatchObject({ id: tid('tm', 'copy2'), weekRule: 'all', weekList: null });
  });

  it('checks names, dates, length and the term count', () => {
    const draft = newTermDraft(tid('tt', 'new'), '2026-10-21', 'zh');
    expect(termProblem(draft, [])).toBeNull();
    expect(termProblem({ ...draft, name: ' ' }, [])).toBe('name');
    expect(termProblem({ ...draft, endsOn: '2026-10-01' }, [])).toBe('dates');
    expect(termProblem({ ...draft, endsOn: '2027-09-01' }, [])).toBe('too_long');
    const six = Array.from({ length: 6 }, (_, index) => ({ id: tid('tt', `t${index}`) }));
    expect(termProblem(draft, six)).toBe('too_many');
    expect(termProblem({ ...draft, id: tid('tt', 't0') }, six)).toBeNull();
  });

  it('drops reading weeks past a shortened term and counts its courses', () => {
    const draft = { ...newTermDraft(tid('tt', 'new'), '2026-10-21', 'zh'), skipWeeks: [7, 12] };
    expect(keepSkipWeeks({ ...draft, endsOn: '2026-12-13' }).skipWeeks).toEqual([7]);
    expect(coursesInTerm([course({ termId: tid('tt', 'new') }), course()], tid('tt', 'new'))).toBe(1);
  });
});

describe('holidayDates', () => {
  it('expands a range, skipping marked days and stopping at the limit', () => {
    expect(holidayDates('2026-12-21', '2026-12-25', [{ onDate: '2026-12-23', meetingId: null }, { onDate: '2026-12-24', meetingId: tid('tm', 'x') }], 200)).toEqual([
      '2026-12-21',
      '2026-12-22',
      '2026-12-24',
      '2026-12-25',
    ]);
    expect(holidayDates('2026-12-21', '', [], 200)).toEqual(['2026-12-21']);
    expect(holidayDates('2026-12-21', '2026-12-31', [], 3)).toHaveLength(3);
    expect(holidayDates('2026-12-21', '2026-12-01', [], 200)).toBeNull();
    expect(holidayDates('', '', [], 200)).toBeNull();
    expect(skipRoom(new Array(198))).toBe(2);
  });
});
