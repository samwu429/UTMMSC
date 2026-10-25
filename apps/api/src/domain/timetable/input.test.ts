import { describe, expect, it } from 'vitest';
import {
  planAssignmentReminders,
  readCourse,
  readImport,
  TIMETABLE_LIMITS,
  TIMETABLE_MESSAGES,
  type ImportTimetableBody,
  type SaveCourseBody,
  type SaveTermBody,
} from '@utmmsc/shared';
import {
  assignmentPlan,
  assignmentSaveProblem,
  courseSaveProblem,
  doneAtFor,
  emptyTimetableFacts,
  importDoneAts,
  importNames,
  importProblem,
  readDoneBody,
  readRevQuery,
  readTimetablePathId,
  refuseTimetable,
  skipLabelGiven,
  skipSaveProblem,
  termSaveProblem,
  TimetableInputError,
  unwrapTimetableInput,
  type TimetableFacts,
} from './input';

const ME = 'mem_me';
const OTHER = 'mem_other';
const NOW = Date.parse('2026-10-24T16:00:00.000Z');
const NOW_ISO = new Date(NOW).toISOString();

/** A valid timetable id of the given kind; n tells ids apart. */
/** 指定类型的有效课表 id；n 用来区分不同的 id。 */
function tid(prefix: 'tt' | 'tc' | 'tm' | 'ta', n: number): string {
  return `${prefix}_${String(n).padStart(22, '0')}`;
}

function facts(patch: Partial<TimetableFacts> = {}): TimetableFacts {
  return { ...emptyTimetableFacts(), ...patch };
}

function thrown(fn: () => unknown): TimetableInputError | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (err instanceof TimetableInputError) return err;
    throw err;
  }
}

const course = (patch: Partial<SaveCourseBody> = {}): SaveCourseBody => ({
  id: tid('tc', 1),
  termId: null,
  code: 'MAT102H5F',
  title: null,
  color: 'purple',
  notes: null,
  remind: true,
  meetings: [{ id: tid('tm', 1), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 660, location: null, weekRule: 'all', weekList: null }],
  ...patch,
});

const term = (patch: Partial<SaveTermBody> = {}): SaveTermBody => ({ id: tid('tt', 1), name: '2026 秋季', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [], ...patch });

describe('TimetableInputError and the reader answers', () => {
  it('carries the code with the text of TIMETABLE_MESSAGES', () => {
    const err = new TimetableInputError('id_taken');
    expect(err.code).toBe('id_taken');
    expect(err.message).toBe(TIMETABLE_MESSAGES.id_taken);
  });

  it('unwraps an accepted body and throws a refusal as it is', () => {
    expect(unwrapTimetableInput({ ok: true, value: 7 })).toBe(7);
    const err = thrown(() => unwrapTimetableInput(readCourse({ ...course(), code: '   ' })));
    expect(err?.code).toBe('invalid_course_code');
    expect(err?.message).toBe(TIMETABLE_MESSAGES.invalid_course_code);
  });

  it('throws only when there is a problem', () => {
    expect(() => refuseTimetable(null)).not.toThrow();
    expect(thrown(() => refuseTimetable('too_many_terms'))?.code).toBe('too_many_terms');
  });
});

describe('readTimetablePathId', () => {
  it('accepts an id of the kind the route names', () => {
    expect(readTimetablePathId(tid('tc', 3), 'tc')).toBe(tid('tc', 3));
  });

  it('refuses another kind, a malformed id and a missing one', () => {
    for (const raw of [tid('ta', 3), 'tc_short', `${tid('tc', 3)}x`, 'tc_00000000000000000000/.', undefined]) {
      expect(thrown(() => readTimetablePathId(raw, 'tc'))?.code).toBe('invalid_id');
    }
  });
});

describe('readRevQuery', () => {
  it('reads whole numbers from 0 up', () => {
    expect(readRevQuery('0')).toBe(0);
    expect(readRevQuery('42')).toBe(42);
  });

  it('reads anything else as absent, so the whole timetable is sent', () => {
    for (const raw of [undefined, '', '-1', '1.5', 'abc', '1e3', ' 3', '99999999999999999']) expect(readRevQuery(raw)).toBeNull();
  });
});

describe('readDoneBody', () => {
  it('takes done true or false and refuses anything else', () => {
    expect(readDoneBody({ done: true })).toBe(true);
    expect(readDoneBody({ done: false })).toBe(false);
    for (const value of [{}, { done: 'yes' }, { done: 1 }, null, [], 'done']) expect(thrown(() => readDoneBody(value))?.code).toBe('invalid_body');
  });
});

describe('skipLabelGiven', () => {
  it('is true when the body names a label, null included', () => {
    expect(skipLabelGiven({ label: '感恩节' })).toBe(true);
    expect(skipLabelGiven({ label: null })).toBe(true);
    expect(skipLabelGiven({})).toBe(false);
    expect(skipLabelGiven({ label: undefined })).toBe(false);
    expect(skipLabelGiven(null)).toBe(false);
  });
});

describe('doneAtFor', () => {
  it('keeps the stored state when done is omitted', () => {
    expect(doneAtFor(undefined, undefined, NOW_ISO)).toBeNull();
    expect(doneAtFor(null, undefined, NOW_ISO)).toBeNull();
    expect(doneAtFor('2026-10-01T00:00:00.000Z', undefined, NOW_ISO)).toBe('2026-10-01T00:00:00.000Z');
  });

  it('keeps an earlier tick, ticks now, or clears', () => {
    expect(doneAtFor('2026-10-01T00:00:00.000Z', true, NOW_ISO)).toBe('2026-10-01T00:00:00.000Z');
    expect(doneAtFor(null, true, NOW_ISO)).toBe(NOW_ISO);
    expect(doneAtFor('2026-10-01T00:00:00.000Z', false, NOW_ISO)).toBeNull();
  });
});

describe('assignmentPlan', () => {
  it('plans an open assignment like planAssignmentReminders and nothing once it is done', () => {
    const body = { dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d', '1h'] as const };
    expect(assignmentPlan({ ...body, remindOffsets: [...body.remindOffsets] }, null, NOW)).toEqual(planAssignmentReminders(body.dueAt, [...body.remindOffsets], NOW));
    expect(assignmentPlan({ ...body, remindOffsets: [...body.remindOffsets] }, null, NOW)).toHaveLength(2);
    expect(assignmentPlan({ ...body, remindOffsets: [...body.remindOffsets] }, NOW_ISO, NOW)).toEqual([]);
  });
});

describe('courseSaveProblem', () => {
  it('allows a new course and an update of one the member owns', () => {
    expect(courseSaveProblem(ME, course(), facts())).toBeNull();
    const own = facts({ courses: new Map([[tid('tc', 1), ME]]), meetings: new Map([[tid('tm', 1), { memberId: ME, courseId: tid('tc', 1) }]]) });
    expect(courseSaveProblem(ME, course(), own)).toBeNull();
  });

  it('refuses a course or meeting id another member owns, and a meeting of another course', () => {
    expect(courseSaveProblem(ME, course(), facts({ courses: new Map([[tid('tc', 1), OTHER]]) }))).toBe('id_taken');
    expect(courseSaveProblem(ME, course(), facts({ meetings: new Map([[tid('tm', 1), { memberId: OTHER, courseId: tid('tc', 9) }]]) }))).toBe('id_taken');
    expect(courseSaveProblem(ME, course(), facts({ meetings: new Map([[tid('tm', 1), { memberId: ME, courseId: tid('tc', 2) }]]) }))).toBe('id_taken');
  });

  it('needs the term to belong to the member', () => {
    const withTerm = course({ termId: tid('tt', 1) });
    expect(courseSaveProblem(ME, withTerm, facts())).toBe('term_not_found');
    expect(courseSaveProblem(ME, withTerm, facts({ terms: new Map([[tid('tt', 1), OTHER]]) }))).toBe('term_not_found');
    expect(courseSaveProblem(ME, withTerm, facts({ terms: new Map([[tid('tt', 1), ME]]) }))).toBeNull();
  });

  it('counts only a new course against the limit', () => {
    const full = { ...emptyTimetableFacts().counts, courses: TIMETABLE_LIMITS.courses };
    expect(courseSaveProblem(ME, course(), facts({ counts: full }))).toBe('too_many_courses');
    expect(courseSaveProblem(ME, course(), facts({ counts: full, courses: new Map([[tid('tc', 1), ME]]) }))).toBeNull();
    expect(courseSaveProblem(ME, course(), facts({ counts: { ...full, courses: TIMETABLE_LIMITS.courses - 1 } }))).toBeNull();
  });
});

describe('termSaveProblem', () => {
  it('refuses an id another member owns and a new term past the limit', () => {
    expect(termSaveProblem(ME, term(), facts())).toBeNull();
    expect(termSaveProblem(ME, term(), facts({ terms: new Map([[tid('tt', 1), OTHER]]) }))).toBe('id_taken');
    const full = { ...emptyTimetableFacts().counts, terms: TIMETABLE_LIMITS.terms };
    expect(termSaveProblem(ME, term(), facts({ counts: full }))).toBe('too_many_terms');
    expect(termSaveProblem(ME, term(), facts({ counts: full, terms: new Map([[tid('tt', 1), ME]]) }))).toBeNull();
  });
});

describe('assignmentSaveProblem', () => {
  const id = tid('ta', 1);
  const open = (n: number) => ({ ...emptyTimetableFacts().counts, openAssignments: n });

  it('refuses an id another member owns and a course the member does not own', () => {
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ assignments: new Map([[id, { memberId: OTHER, doneAt: null }]]) }))).toBe('id_taken');
    expect(assignmentSaveProblem(ME, { id, courseId: tid('tc', 1) }, null, facts())).toBe('course_not_found');
    expect(assignmentSaveProblem(ME, { id, courseId: tid('tc', 1) }, null, facts({ courses: new Map([[tid('tc', 1), OTHER]]) }))).toBe('course_not_found');
    expect(assignmentSaveProblem(ME, { id, courseId: tid('tc', 1) }, null, facts({ courses: new Map([[tid('tc', 1), ME]]) }))).toBeNull();
  });

  it('refuses only a save that adds an open item past the limit', () => {
    const max = TIMETABLE_LIMITS.openAssignments;
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: open(max) }))).toBe('too_many_assignments');
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: open(max - 1) }))).toBeNull();
    // A new item saved as done, an edit of an open item, and a tick at the limit or past it are all allowed.
    // 以已完成状态新建、编辑未完成的作业、在达到或超过上限时勾选完成，都是允许的。
    expect(assignmentSaveProblem(ME, { id, courseId: null }, NOW_ISO, facts({ counts: open(max) }))).toBeNull();
    const stored = new Map([[id, { memberId: ME, doneAt: null }]]);
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: open(max), assignments: stored }))).toBeNull();
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: open(max + 5), assignments: stored }))).toBeNull();
    // Opening a done item again counts as adding one.
    // 重新打开已完成的作业算作新增一项。
    const done = new Map([[id, { memberId: ME, doneAt: NOW_ISO }]]);
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: open(max), assignments: done }))).toBe('too_many_assignments');
  });

  it('refuses a new assignment past the total, done or not, and still saves one already stored', () => {
    const total = (n: number) => ({ ...emptyTimetableFacts().counts, assignments: n });
    const max = TIMETABLE_LIMITS.assignments;
    expect(assignmentSaveProblem(ME, { id, courseId: null }, NOW_ISO, facts({ counts: total(max) }))).toBe('too_many_assignments_total');
    expect(assignmentSaveProblem(ME, { id, courseId: null }, null, facts({ counts: total(max) }))).toBe('too_many_assignments_total');
    expect(assignmentSaveProblem(ME, { id, courseId: null }, NOW_ISO, facts({ counts: total(max - 1) }))).toBeNull();
    // An edit, a tick or a reopen of a stored item adds no row.
    // 编辑、勾选或重新打开已有的作业不会增加行。
    for (const doneAt of [null, NOW_ISO]) {
      for (const storedDoneAt of [null, NOW_ISO]) {
        const stored = new Map([[id, { memberId: ME, doneAt: storedDoneAt }]]);
        expect(assignmentSaveProblem(ME, { id, courseId: null }, doneAt, facts({ counts: total(max + 3), assignments: stored }))).toBeNull();
      }
    }
  });

  it('has its own message for the total', () => {
    expect(new TimetableInputError('too_many_assignments_total').message).toBe('作业最多 1000 项，请先清除已完成的作业');
    expect(TIMETABLE_MESSAGES.too_many_assignments_total).not.toBe(TIMETABLE_MESSAGES.too_many_assignments);
  });
});

describe('skipSaveProblem', () => {
  const meetingId = tid('tm', 1);

  it('needs the meeting to belong to the member', () => {
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId: null }, facts())).toBeNull();
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId }, facts())).toBe('course_not_found');
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId }, facts({ meetings: new Map([[meetingId, { memberId: OTHER, courseId: tid('tc', 1) }]]) }))).toBe(
      'course_not_found',
    );
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId }, facts({ meetings: new Map([[meetingId, { memberId: ME, courseId: tid('tc', 1) }]]) }))).toBeNull();
  });

  it('counts only a new date against the limit', () => {
    const full = { ...emptyTimetableFacts().counts, skips: TIMETABLE_LIMITS.skips };
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId: null }, facts({ counts: full }))).toBe('too_many_skips');
    expect(skipSaveProblem(ME, { onDate: '2026-10-12', meetingId: null }, facts({ counts: full, skips: new Set(['2026-10-12|*']) }))).toBeNull();
  });
});

describe('import checks', () => {
  function importBody(raw: unknown): ImportTimetableBody {
    return unwrapTimetableInput(readImport(raw, NOW));
  }

  const body = importBody({
    terms: [term()],
    courses: [
      course({ termId: tid('tt', 1) }),
      course({ id: tid('tc', 2), termId: tid('tt', 7), meetings: [{ ...course().meetings[0]!, id: tid('tm', 2) }] }),
    ],
    assignments: [
      { id: tid('ta', 1), courseId: tid('tc', 1), title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d'] },
      { id: tid('ta', 2), courseId: tid('tc', 8), title: 'Lab 4', notes: null, dueAt: '2026-11-02T22:00:00.000Z', remindOffsets: [], done: true },
    ],
    skips: [
      { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
      { onDate: '2026-10-19', meetingId: tid('tm', 9) },
    ],
  });
  const mine: TimetableFacts = facts({
    terms: new Map([[tid('tt', 7), ME]]),
    courses: new Map([[tid('tc', 8), ME]]),
    meetings: new Map([[tid('tm', 9), { memberId: ME, courseId: tid('tc', 8) }]]),
  });

  it('names its own ids and every term, course and meeting it points at, once each', () => {
    expect(importNames(body)).toEqual({
      termIds: [tid('tt', 1), tid('tt', 7)],
      courseIds: [tid('tc', 1), tid('tc', 2), tid('tc', 8)],
      meetingIds: [tid('tm', 1), tid('tm', 2), tid('tm', 9)],
      assignmentIds: [tid('ta', 1), tid('ta', 2)],
    });
  });

  it('works out done_at as a single save would', () => {
    const doneAts = importDoneAts(body, facts({ assignments: new Map([[tid('ta', 1), { memberId: ME, doneAt: '2026-10-01T00:00:00.000Z' }]]) }), NOW_ISO);
    expect(doneAts.get(tid('ta', 1))).toBe('2026-10-01T00:00:00.000Z');
    expect(doneAts.get(tid('ta', 2))).toBe(NOW_ISO);
  });

  it('accepts an import whose references are in it or belong to the member', () => {
    expect(importProblem(ME, body, importDoneAts(body, mine, NOW_ISO), mine)).toBeNull();
  });

  it('refuses any id another member owns, or a meeting of another course', () => {
    const check = (patch: Partial<TimetableFacts>) => importProblem(ME, body, importDoneAts(body, mine, NOW_ISO), { ...mine, ...patch });
    expect(check({ terms: new Map([...mine.terms, [tid('tt', 1), OTHER]]) })).toBe('id_taken');
    expect(check({ courses: new Map([...mine.courses, [tid('tc', 2), OTHER]]) })).toBe('id_taken');
    expect(check({ meetings: new Map([...mine.meetings, [tid('tm', 2), { memberId: OTHER, courseId: tid('tc', 2) }]]) })).toBe('id_taken');
    expect(check({ meetings: new Map([...mine.meetings, [tid('tm', 2), { memberId: ME, courseId: tid('tc', 8) }]]) })).toBe('id_taken');
    expect(check({ assignments: new Map([[tid('ta', 2), { memberId: OTHER, doneAt: null }]]) })).toBe('id_taken');
  });

  it('refuses a term, course or meeting that the import lacks and the member does not own', () => {
    const check = (patch: Partial<TimetableFacts>) => importProblem(ME, body, importDoneAts(body, mine, NOW_ISO), { ...mine, ...patch });
    expect(check({ terms: new Map([[tid('tt', 7), OTHER]]) })).toBe('term_not_found');
    expect(check({ courses: new Map() })).toBe('course_not_found');
    expect(check({ meetings: new Map([[tid('tm', 9), { memberId: OTHER, courseId: tid('tc', 8) }]]) })).toBe('course_not_found');
  });

  it('counts each limit with what the member has, and an updated row once', () => {
    const check = (counts: Partial<TimetableFacts['counts']>, patch: Partial<TimetableFacts> = {}) => {
      const all = { ...mine, ...patch, counts: { ...mine.counts, ...counts } };
      return importProblem(ME, body, importDoneAts(body, all, NOW_ISO), all);
    };
    expect(check({ terms: TIMETABLE_LIMITS.terms - 1 })).toBeNull();
    expect(check({ terms: TIMETABLE_LIMITS.terms })).toBe('too_many_terms');
    expect(check({ terms: TIMETABLE_LIMITS.terms }, { terms: new Map([...mine.terms, [tid('tt', 1), ME]]) })).toBeNull();
    expect(check({ courses: TIMETABLE_LIMITS.courses - 2 })).toBeNull();
    expect(check({ courses: TIMETABLE_LIMITS.courses - 1 })).toBe('too_many_courses');
    // One of the two assignments is open.
    // 两项作业中有一项未完成。
    expect(check({ openAssignments: TIMETABLE_LIMITS.openAssignments - 1 })).toBeNull();
    expect(check({ openAssignments: TIMETABLE_LIMITS.openAssignments })).toBe('too_many_assignments');
    expect(check({ skips: TIMETABLE_LIMITS.skips - 2 })).toBeNull();
    expect(check({ skips: TIMETABLE_LIMITS.skips - 1 })).toBe('too_many_skips');
    expect(check({ skips: TIMETABLE_LIMITS.skips - 1 }, { skips: new Set(['2026-10-12|*']) })).toBeNull();
  });

  it('counts every new assignment against the total, done ones included, and an updated one not at all', () => {
    const check = (assignments: number, patch: Partial<TimetableFacts> = {}) => {
      const all = { ...mine, ...patch, counts: { ...mine.counts, assignments } };
      return importProblem(ME, body, importDoneAts(body, all, NOW_ISO), all);
    };
    // Both assignments are new; one of them is done.
    // 两项作业都是新的；其中一项已完成。
    expect(check(TIMETABLE_LIMITS.assignments - 2)).toBeNull();
    expect(check(TIMETABLE_LIMITS.assignments - 1)).toBe('too_many_assignments_total');
    const storedDone = new Map<string, { memberId: string; doneAt: string | null }>([[tid('ta', 2), { memberId: ME, doneAt: NOW_ISO }]]);
    expect(check(TIMETABLE_LIMITS.assignments - 1, { assignments: storedDone })).toBeNull();
    const bothStored = new Map([...storedDone, [tid('ta', 1), { memberId: ME, doneAt: null }]]);
    expect(check(TIMETABLE_LIMITS.assignments + 5, { assignments: bothStored })).toBeNull();
  });

  it('refuses a thousand new done items once the member is at the total', () => {
    const done = importBody({
      assignments: Array.from({ length: TIMETABLE_LIMITS.assignments }, (_, i) => ({
        id: tid('ta', 100 + i),
        courseId: null,
        title: `Item ${i}`,
        notes: null,
        dueAt: '2026-10-31T03:59:00.000Z',
        remindOffsets: [],
        done: true,
      })),
    });
    const full = facts({ counts: { ...emptyTimetableFacts().counts, assignments: TIMETABLE_LIMITS.assignments } });
    expect(importProblem(ME, done, importDoneAts(done, full, NOW_ISO), full)).toBe('too_many_assignments_total');
    expect(importProblem(ME, done, importDoneAts(done, facts(), NOW_ISO), facts())).toBeNull();
  });
});
