import { describe, expect, it } from 'vitest';
import { assignment, course, meeting, snapshot, term, tid } from '../model/fixtures.testdata';
import { applyMutation, applyOutbox, emptySnapshot, mergeServerItem } from './applyMutation';
import type { TimetableOutboxItem } from './types';

const AT = Date.parse('2026-10-20T15:00:00.000Z');
const AT_ISO = '2026-10-20T15:00:00.000Z';

describe('applyMutation', () => {
  it('adds and replaces a course, stamping the queue time', () => {
    const base = snapshot();
    const added = applyMutation(base, { kind: 'saveCourse', body: { ...course(), meetings: [meeting()] } }, AT);
    expect(added.courses).toHaveLength(1);
    expect(added.courses[0]?.updatedAt).toBe(AT_ISO);
    const renamed = applyMutation(added, { kind: 'saveCourse', body: { ...course({ title: 'Calculus' }) } }, AT + 1000);
    expect(renamed.courses).toHaveLength(1);
    expect(renamed.courses[0]?.title).toBe('Calculus');
    expect(base.courses).toHaveLength(0);
  });

  it('drops the skips of meetings a course edit removes, and keeps the others', () => {
    const m1 = meeting({ id: tid('tm', 'a') });
    const m2 = meeting({ id: tid('tm', 'b'), weekday: 3 });
    const base = snapshot({
      courses: [course({ meetings: [m1, m2] })],
      skips: [
        { onDate: '2026-10-19', meetingId: m1.id, label: null },
        { onDate: '2026-10-21', meetingId: m2.id, label: null },
        { onDate: '2026-11-11', meetingId: null, label: 'Holiday' },
      ],
    });
    const next = applyMutation(base, { kind: 'saveCourse', body: course({ meetings: [m2] }) }, AT);
    expect(next.skips.map((skip) => skip.meetingId)).toEqual([m2.id, null]);
  });

  it('deletes a course the way the database cascades', () => {
    const m1 = meeting();
    const base = snapshot({
      courses: [course({ meetings: [m1] })],
      skips: [
        { onDate: '2026-10-19', meetingId: m1.id, label: null },
        { onDate: '2026-11-11', meetingId: null, label: null },
      ],
      assignments: [assignment({ courseId: course().id })],
    });
    const next = applyMutation(base, { kind: 'deleteCourse', id: course().id }, AT);
    expect(next.courses).toEqual([]);
    expect(next.skips).toEqual([{ onDate: '2026-11-11', meetingId: null, label: null }]);
    expect(next.assignments[0]?.courseId).toBeNull();
  });

  it('deletes a term with its courses', () => {
    const fall = term();
    const inTerm = course({ termId: fall.id });
    const free = course({ id: tid('tc', 'free'), meetings: [meeting({ id: tid('tm', 'free') })] });
    const next = applyMutation(snapshot({ terms: [fall], courses: [inTerm, free] }), { kind: 'deleteTerm', id: fall.id }, AT);
    expect(next.terms).toEqual([]);
    expect(next.courses.map((c) => c.id)).toEqual([free.id]);
  });

  it('keeps assignments in due order and keeps done when done is omitted', () => {
    const late = assignment({ id: tid('ta', 'late'), dueAt: '2026-11-30T04:59:00.000Z', doneAt: '2026-10-01T00:00:00.000Z' });
    const base = snapshot({ assignments: [late] });
    const early = applyMutation(base, { kind: 'saveAssignment', body: { id: tid('ta', 'early'), courseId: null, title: 'Lab 4', notes: null, dueAt: '2026-10-25T21:00:00.000Z', remindOffsets: ['1h'] } }, AT);
    expect(early.assignments.map((a) => a.id)).toEqual([tid('ta', 'early'), late.id]);
    expect(early.assignments[0]?.doneAt).toBeNull();
    const edited = applyMutation(early, { kind: 'saveAssignment', body: { ...late, title: 'Final', remindOffsets: [] } }, AT);
    expect(edited.assignments[1]?.doneAt).toBe(late.doneAt);
    const undone = applyMutation(edited, { kind: 'saveAssignment', body: { ...late, done: false } }, AT);
    expect(undone.assignments[1]?.doneAt).toBeNull();
  });

  it('ticks an assignment done once and leaves the time of the first tick', () => {
    const base = snapshot({ assignments: [assignment()] });
    const done = applyMutation(base, { kind: 'setAssignmentDone', id: assignment().id, done: true }, AT);
    expect(done.assignments[0]?.doneAt).toBe(AT_ISO);
    expect(applyMutation(done, { kind: 'setAssignmentDone', id: assignment().id, done: true }, AT + 5000)).toBe(done);
    expect(applyMutation(done, { kind: 'setAssignmentDone', id: assignment().id, done: false }, AT).assignments[0]?.doneAt).toBeNull();
    expect(applyMutation(base, { kind: 'setAssignmentDone', id: tid('ta', 'missing'), done: true }, AT)).toBe(base);
  });

  it('sets and clears skips, keeping a label when none is sent', () => {
    const base = snapshot();
    const holiday = applyMutation(base, { kind: 'setSkip', body: { onDate: '2026-11-11', meetingId: null, skipped: true, label: 'Remembrance' } }, AT);
    const single = applyMutation(holiday, { kind: 'setSkip', body: { onDate: '2026-10-19', meetingId: meeting().id, skipped: true } }, AT);
    expect(single.skips.map((skip) => skip.onDate)).toEqual(['2026-10-19', '2026-11-11']);
    const again = applyMutation(single, { kind: 'setSkip', body: { onDate: '2026-11-11', meetingId: null, skipped: true } }, AT);
    expect(again.skips.find((skip) => skip.onDate === '2026-11-11')?.label).toBe('Remembrance');
    const cleared = applyMutation(again, { kind: 'setSkip', body: { onDate: '2026-11-11', meetingId: null, skipped: false } }, AT);
    expect(cleared.skips).toHaveLength(1);
    expect(applyMutation(cleared, { kind: 'setSkip', body: { onDate: '2027-01-01', meetingId: null, skipped: false } }, AT)).toBe(cleared);
  });

  it('patches settings and clears everything but the settings', () => {
    const base = snapshot({ courses: [course()], terms: [term()], assignments: [assignment()], skips: [{ onDate: '2026-11-11', meetingId: null, label: null }] });
    const patched = applyMutation(base, { kind: 'updateSettings', patch: { classReminders: true, classLeadMin: undefined } }, AT);
    expect(patched.settings.classReminders).toBe(true);
    expect(patched.settings.classLeadMin).toBe(10);
    const cleared = applyMutation(patched, { kind: 'clear' }, AT);
    expect(cleared).toMatchObject({ terms: [], courses: [], skips: [], assignments: [] });
    expect(cleared.settings.classReminders).toBe(true);
  });

  it('replays an outbox to the same result every time', () => {
    const outbox: TimetableOutboxItem[] = [
      { key: 'course:a', mutation: { kind: 'saveCourse', body: course() }, attempts: 0, queuedAt: AT },
      { key: 'assignment:b', mutation: { kind: 'saveAssignment', body: { ...assignment(), courseId: course().id } }, attempts: 0, queuedAt: AT + 1 },
    ];
    const first = applyOutbox(emptySnapshot(), outbox);
    const second = applyOutbox(emptySnapshot(), outbox);
    expect(second).toEqual(first);
    expect(first.courses[0]?.updatedAt).toBe(AT_ISO);
  });
});

describe('mergeServerItem', () => {
  it('puts the stored course in place of the optimistic one', () => {
    const optimistic = applyMutation(snapshot(), { kind: 'saveCourse', body: course({ code: 'mat102' }) }, AT);
    const stored = course({ code: 'MAT102', updatedAt: '2026-10-20T15:00:01.000Z' });
    const merged = mergeServerItem(optimistic, { kind: 'saveCourse', body: course({ code: 'mat102' }) }, stored);
    expect(merged.courses).toEqual([stored]);
  });

  it('ignores answers that do not match the write', () => {
    const base = snapshot({ courses: [course()] });
    expect(mergeServerItem(base, { kind: 'saveCourse', body: course() }, null)).toBe(base);
    expect(mergeServerItem(base, { kind: 'saveCourse', body: course() }, { id: tid('tc', 'other'), meetings: [] })).toBe(base);
    expect(mergeServerItem(base, { kind: 'deleteCourse', id: course().id }, null)).toBe(base);
  });

  it('merges an assignment from a done patch and the settings', () => {
    const base = snapshot({ assignments: [assignment()] });
    const stored = assignment({ doneAt: AT_ISO });
    expect(mergeServerItem(base, { kind: 'setAssignmentDone', id: stored.id, done: true }, stored).assignments).toEqual([stored]);
    const settings = mergeServerItem(base, { kind: 'updateSettings', patch: { locale: 'en' } }, { ...base.settings, locale: 'en' });
    expect(settings.settings.locale).toBe('en');
  });
});
