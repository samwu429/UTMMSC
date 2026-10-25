import { describe, expect, it } from 'vitest';
import type { TimetableResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { assignment, course, meeting, snapshot, term, tid } from '../model/fixtures.testdata';
import { enqueue, isPermanentFailure, mutationKey, pendingIdsOf, retryDelayMs } from './outbox';
import type { TimetableMutation, TimetableOutboxItem } from './types';

let seq = 0;

function add(outbox: readonly TimetableOutboxItem[], mutation: TimetableMutation, before: TimetableResponse = snapshot(), sendingId: string | null = null) {
  seq += 1;
  return enqueue(outbox, mutation, { id: `local-${seq}`, queuedAt: 1000 + seq, sendingId, before });
}

const kinds = (outbox: readonly TimetableOutboxItem[]) => outbox.map((item) => item.mutation.kind);

describe('enqueue', () => {
  it('replaces a queued save of the same item in place', () => {
    let outbox = add([], { kind: 'saveCourse', body: course({ title: 'One' }) });
    outbox = add(outbox, { kind: 'saveTerm', body: term() });
    outbox = add(outbox, { kind: 'saveCourse', body: course({ title: 'Two' }) });
    expect(kinds(outbox)).toEqual(['saveCourse', 'saveTerm']);
    const first = outbox[0];
    expect(first?.mutation.kind === 'saveCourse' && first.mutation.body.title).toBe('Two');
    expect(first?.fresh).toBe(true);
  });

  it('never touches the item being sent', () => {
    const outbox = add([], { kind: 'saveCourse', body: course({ title: 'One' }) });
    const sending = outbox[0]?.id ?? null;
    const next = add(outbox, { kind: 'saveCourse', body: course({ title: 'Two' }) }, snapshot(), sending);
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(outbox[0]);
  });

  it('keeps both saves when the item now refers to something queued after it', () => {
    let outbox = add([], { kind: 'saveCourse', body: course() });
    outbox = add(outbox, { kind: 'saveTerm', body: term() });
    outbox = add(outbox, { kind: 'saveCourse', body: course({ termId: term().id }) });
    expect(kinds(outbox)).toEqual(['saveCourse', 'saveTerm', 'saveCourse']);
  });

  it('cancels a create and its delete together, fixing what referred to it', () => {
    const m = meeting();
    let outbox = add([], { kind: 'saveCourse', body: course({ meetings: [m] }) });
    outbox = add(outbox, { kind: 'saveAssignment', body: { ...assignment(), courseId: course().id } });
    outbox = add(outbox, { kind: 'setSkip', body: { onDate: '2026-10-19', meetingId: m.id, skipped: true } });
    outbox = add(outbox, { kind: 'deleteCourse', id: course().id });
    expect(kinds(outbox)).toEqual(['saveAssignment']);
    const only = outbox[0];
    expect(only?.mutation.kind === 'saveAssignment' && only.mutation.body.courseId).toBeNull();
  });

  it('sends a delete of a synced item after the writes that still refer to it', () => {
    const before = snapshot({ courses: [course()] });
    let outbox = add([], { kind: 'saveCourse', body: course({ title: 'Edited' }) }, before);
    expect(outbox[0]?.fresh).toBe(false);
    outbox = add(outbox, { kind: 'saveAssignment', body: { ...assignment(), courseId: course().id } }, before);
    outbox = add(outbox, { kind: 'deleteCourse', id: course().id }, before);
    expect(kinds(outbox)).toEqual(['saveAssignment', 'deleteCourse']);
  });

  it('keeps a new term that queued courses still need, and deletes it after them', () => {
    let outbox = add([], { kind: 'saveTerm', body: term() });
    outbox = add(outbox, { kind: 'saveCourse', body: course({ termId: term().id }) });
    outbox = add(outbox, { kind: 'deleteTerm', id: term().id });
    expect(kinds(outbox)).toEqual(['saveTerm', 'saveCourse', 'deleteTerm']);
  });

  it('folds done into a queued save and settings patches into one', () => {
    let outbox = add([], { kind: 'saveAssignment', body: assignment() });
    outbox = add(outbox, { kind: 'setAssignmentDone', id: assignment().id, done: true });
    expect(outbox).toHaveLength(1);
    const save = outbox[0];
    expect(save?.mutation.kind === 'saveAssignment' && save.mutation.body.done).toBe(true);

    let settings = add([], { kind: 'updateSettings', patch: { classReminders: true } });
    settings = add(settings, { kind: 'updateSettings', patch: { classLeadMin: 15 } });
    expect(settings).toHaveLength(1);
    expect(settings[0]?.mutation).toEqual({ kind: 'updateSettings', patch: { classReminders: true, classLeadMin: 15 } });
  });

  it('keeps a queued done when the assignment is saved again without one', () => {
    const before = snapshot({ assignments: [assignment()] });
    let outbox = add([], { kind: 'setAssignmentDone', id: assignment().id, done: true }, before);
    outbox = add(outbox, { kind: 'saveAssignment', body: { ...assignment(), title: 'PS3 v2' } }, before);
    expect(outbox).toHaveLength(1);
    const save = outbox[0];
    expect(save?.mutation.kind === 'saveAssignment' && save.mutation.body).toMatchObject({ title: 'PS3 v2', done: true });
  });

  it('cancels a single skip that was never sent', () => {
    let outbox = add([], { kind: 'setSkip', body: { onDate: '2026-10-19', meetingId: null, skipped: true } });
    outbox = add(outbox, { kind: 'setSkip', body: { onDate: '2026-10-19', meetingId: null, skipped: false } });
    expect(outbox).toEqual([]);
  });

  it('lets a clear drop everything queued but the settings', () => {
    let outbox = add([], { kind: 'saveCourse', body: course() });
    outbox = add(outbox, { kind: 'updateSettings', patch: { locale: 'en' } });
    outbox = add(outbox, { kind: 'clear' });
    expect(kinds(outbox)).toEqual(['updateSettings', 'clear']);
  });
});

describe('pendingIdsOf', () => {
  it('lists the items with queued writes, meetings included', () => {
    const m = meeting();
    const ids = pendingIdsOf([
      { key: mutationKey({ kind: 'saveCourse', body: course({ meetings: [m] }) }), mutation: { kind: 'saveCourse', body: course({ meetings: [m] }) }, attempts: 0, queuedAt: 0 },
      { key: 'assignment', mutation: { kind: 'setAssignmentDone', id: tid('ta', 'x'), done: true }, attempts: 0, queuedAt: 0 },
      { key: 'skip', mutation: { kind: 'setSkip', body: { onDate: '2026-10-19', meetingId: tid('tm', 'y'), skipped: true } }, attempts: 0, queuedAt: 0 },
      { key: 'settings', mutation: { kind: 'updateSettings', patch: {} }, attempts: 0, queuedAt: 0 },
    ]);
    expect([...ids].sort()).toEqual([course().id, m.id, tid('ta', 'x'), tid('tm', 'y')].sort());
  });
});

describe('retries', () => {
  it('backs off 2 s, 5 s, 15 s, then every minute', () => {
    expect([1, 2, 3, 4, 9].map(retryDelayMs)).toEqual([2000, 5000, 15000, 60000, 60000]);
  });

  it('drops a write only for a refusal, never for the network or the server', () => {
    expect(isPermanentFailure(new ApiClientError(400, 'invalid_course_code', 'x'))).toBe(true);
    expect(isPermanentFailure(new ApiClientError(409, 'id_taken', 'x'))).toBe(true);
    expect(isPermanentFailure(new ApiClientError(429, 'rate_limited', 'x'))).toBe(false);
    expect(isPermanentFailure(new ApiClientError(503, 'timetable_unavailable', 'x'))).toBe(false);
    expect(isPermanentFailure(new TypeError('Failed to fetch'))).toBe(false);
  });
});
