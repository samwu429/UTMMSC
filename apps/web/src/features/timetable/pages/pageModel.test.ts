import { describe, expect, it } from 'vitest';
import { tid, toronto } from '../model/fixtures.testdata';
import { defaultSlot, initialMonday, linkedForm, readDeepLink, tabOfPath } from './pageModel';

describe('tabOfPath', () => {
  it('knows the 作业 route', () => {
    expect(tabOfPath('/timetable')).toBe('week');
    expect(tabOfPath('/timetable/')).toBe('week');
    expect(tabOfPath('/timetable/due')).toBe('due');
    expect(tabOfPath('/timetable/due/')).toBe('due');
  });
});

describe('readDeepLink', () => {
  it('reads the week and the block a class reminder points at', () => {
    expect(readDeepLink(`?date=2026-10-21&focus=${tid('tm', 'mon')}`)).toEqual({ monday: '2026-10-19', block: { meetingId: tid('tm', 'mon'), date: '2026-10-21' }, assignmentId: null, add: null });
  });

  it('reads the assignment a due reminder points at', () => {
    expect(readDeepLink(`?focus=${tid('ta', 'ps3')}`)).toEqual({ monday: null, block: null, assignmentId: tid('ta', 'ps3'), add: null });
  });

  it('ignores what is malformed and is null for a plain link', () => {
    expect(readDeepLink('?date=2026-02-30&focus=tm_bad')).toEqual({ monday: null, block: null, assignmentId: null, add: null });
    expect(readDeepLink('?add=lesson')).toEqual({ monday: null, block: null, assignmentId: null, add: null });
    expect(readDeepLink('')).toBeNull();
    expect(readDeepLink('?tab=x')).toBeNull();
  });

  it('reads the form the home card links to, so the query is read and then cleared', () => {
    expect(readDeepLink('?add=course')).toEqual({ monday: null, block: null, assignmentId: null, add: 'course' });
    expect(readDeepLink('?add=assignment')).toEqual({ monday: null, block: null, assignmentId: null, add: 'assignment' });
    expect(readDeepLink('?date=2026-11-04&add=course')).toMatchObject({ monday: '2026-11-02', add: 'course' });
  });

  it('opens on the linked week or this week', () => {
    expect(initialMonday('?date=2026-11-04', '2026-10-21')).toBe('2026-11-02');
    expect(initialMonday('', '2026-10-21')).toBe('2026-10-19');
  });
});

describe('defaultSlot', () => {
  it('offers the next half hour today in this week', () => {
    expect(defaultSlot('2026-10-21', '2026-10-19', toronto('2026-10-21', '13:10'))).toEqual({ date: '2026-10-21', at: { weekday: 3, startMin: 13 * 60 + 30 } });
    expect(defaultSlot('2026-10-21', '2026-10-19', toronto('2026-10-21', '13:30'))).toEqual({ date: '2026-10-21', at: { weekday: 3, startMin: 14 * 60 } });
  });

  it('falls back to 10:00 late in the day and on other weeks', () => {
    expect(defaultSlot('2026-10-21', '2026-10-19', toronto('2026-10-21', '20:40')).at.startMin).toBe(600);
    expect(defaultSlot('2026-10-21', '2026-10-19', toronto('2026-10-21', '07:00')).at.startMin).toBe(600);
    expect(defaultSlot('2026-10-21', '2026-10-26', toronto('2026-10-21', '13:10'))).toEqual({ date: '2026-10-26', at: { weekday: 1, startMin: 600 } });
  });
});

describe('linkedForm', () => {
  const now = toronto('2026-10-21', '13:10');

  it('opens 添加课程 where + would put a new class', () => {
    const link = readDeepLink('?add=course');
    expect(link && linkedForm(link, '2026-10-21', '2026-10-19', now)).toEqual({ kind: 'course', date: '2026-10-21', at: { weekday: 3, startMin: 13 * 60 + 30 } });
  });

  it('uses the linked week when the link names one', () => {
    const link = readDeepLink('?date=2026-11-04&add=course');
    expect(link && linkedForm(link, '2026-10-21', '2026-10-19', now)).toEqual({ kind: 'course', date: '2026-11-02', at: { weekday: 1, startMin: 600 } });
  });

  it('opens 添加作业, and nothing for a link that asks for no form', () => {
    const assignment = readDeepLink('?add=assignment');
    expect(assignment && linkedForm(assignment, '2026-10-21', '2026-10-19', now)).toEqual({ kind: 'assignment' });
    const flash = readDeepLink(`?focus=${tid('ta', 'ps3')}`);
    expect(flash && linkedForm(flash, '2026-10-21', '2026-10-19', now)).toBeNull();
  });
});
