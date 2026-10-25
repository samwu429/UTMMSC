import { describe, expect, it } from 'vitest';
import { assignment, course, meeting, snapshot, term } from '../model/fixtures.testdata';
import { cleanPersisted, cleanSnapshot } from './persisted';

describe('cleanSnapshot', () => {
  it('keeps a sound snapshot as it is', () => {
    const good = snapshot({ terms: [term()], courses: [course()], assignments: [assignment()], skips: [{ onDate: '2026-11-11', meetingId: null, label: null }] });
    expect(cleanSnapshot(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });

  it('drops broken items one by one and fills in broken settings', () => {
    const value = {
      rev: 4,
      remindersAllowed: false,
      settings: { classReminders: 'yes', classLeadMin: 7, assignmentOffsets: ['2h'], showWeekend: 'auto', locale: 'fr' },
      terms: [term(), { id: 1 }],
      courses: [course(), course({ color: 'mauve' as never }), course({ meetings: [meeting({ weekday: 9 as never })] })],
      skips: [{ onDate: '2026-11-11', meetingId: null, label: null }, { onDate: 5 }],
      assignments: [assignment(), assignment({ dueAt: 'soon' }), assignment({ remindOffsets: ['2h' as never] })],
    };
    const clean = cleanSnapshot(value);
    expect(clean?.rev).toBe(4);
    expect(clean?.remindersAllowed).toBe(false);
    expect(clean?.settings).toEqual({ classReminders: false, classLeadMin: 10, assignmentOffsets: ['1d', '1h'], showWeekend: 'auto', locale: 'zh' });
    expect(clean?.terms).toHaveLength(1);
    expect(clean?.courses).toHaveLength(1);
    expect(clean?.skips).toHaveLength(1);
    expect(clean?.assignments).toHaveLength(1);
  });

  it('drops assignments due outside 2000-2100, which no screen can draw', () => {
    const clean = cleanSnapshot(snapshot({ assignments: [assignment(), assignment({ dueAt: '0002-10-25T04:00:00.000Z' }), assignment({ dueAt: '1969-12-31T23:00:00.000Z' })] }));
    expect(clean?.assignments).toEqual([assignment()]);
  });

  it('drops terms and skips whose dates are not real, which the week grid cannot read', () => {
    const clean = cleanSnapshot(
      snapshot({
        terms: [term(), term({ startsOn: '2026-02-30' }), term({ endsOn: '' })],
        skips: [{ onDate: '2026-11-11', meetingId: null, label: null }, { onDate: '0002-11-11', meetingId: null, label: null }],
      }),
    );
    expect(clean?.terms).toEqual([term()]);
    expect(clean?.skips).toEqual([{ onDate: '2026-11-11', meetingId: null, label: null }]);
  });

  it('is null for anything that is not a snapshot', () => {
    expect(cleanSnapshot(null)).toBeNull();
    expect(cleanSnapshot({ rev: -1 })).toBeNull();
    expect(cleanSnapshot('{"rev":1}')).toBeNull();
  });
});

describe('cleanPersisted', () => {
  it('keeps sound queued writes and drops the rest', () => {
    const clean = cleanPersisted({
      memberId: 'm1',
      snapshot: snapshot(),
      dismissedEmpty: true,
      outbox: [
        { key: 'course:x', mutation: { kind: 'saveCourse', body: course() }, attempts: 2, queuedAt: 10, id: 'a', fresh: true },
        { key: 'course:y', mutation: { kind: 'saveCourse', body: { id: 'x', meetings: [{ id: 'bad' }] } }, attempts: 0, queuedAt: 0 },
        { key: 'z', mutation: { kind: 'launch' } },
        { key: 'clear', mutation: { kind: 'clear' }, attempts: -3, queuedAt: 'now' },
      ],
    });
    expect(clean.memberId).toBe('m1');
    expect(clean.dismissedEmpty).toBe(true);
    expect(clean.outbox.map((item) => item.key)).toEqual(['course:x', 'clear']);
    expect(clean.outbox[0]).toMatchObject({ attempts: 2, queuedAt: 10, id: 'a', fresh: true });
    expect(clean.outbox[1]).toMatchObject({ attempts: 0, queuedAt: 0 });
  });

  it('drops queued writes whose dates no screen can read', () => {
    const save = (dueAt: string) => ({ kind: 'saveAssignment', body: { id: 'ta_x', courseId: null, title: 'PS3', notes: null, dueAt, remindOffsets: [] } });
    const skip = (onDate: string) => ({ kind: 'setSkip', body: { onDate, meetingId: null, skipped: true } });
    const clean = cleanPersisted({
      memberId: 'm1',
      snapshot: snapshot(),
      outbox: [
        { key: 'assignment:a', mutation: save('2026-10-24T03:59:00.000Z'), attempts: 0, queuedAt: 0 },
        { key: 'assignment:b', mutation: save('0002-10-25T04:00:00.000Z'), attempts: 0, queuedAt: 0 },
        { key: 'term:a', mutation: { kind: 'saveTerm', body: { ...term(), startsOn: '2026-02-30' } }, attempts: 0, queuedAt: 0 },
        { key: 'skip:a', mutation: skip('2026-11-11'), attempts: 0, queuedAt: 0 },
        { key: 'skip:b', mutation: skip('11/11'), attempts: 0, queuedAt: 0 },
      ],
    });
    expect(clean.outbox.map((item) => item.key)).toEqual(['assignment:a', 'skip:a']);
  });

  it('starts empty from damaged storage', () => {
    expect(cleanPersisted(undefined)).toEqual({ memberId: null, snapshot: null, outbox: [], dismissedEmpty: false });
  });
});
