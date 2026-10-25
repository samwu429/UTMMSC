import { describe, expect, it } from 'vitest';
import {
  cleanTimetableLine,
  cleanTimetableNotes,
  indexSkips,
  isTimetableId,
  meetingTimeProblem,
  normalizeCourseCode,
  occurrencesBetween,
  occursOn,
  readAssignment,
  readCourse,
  readImport,
  readSettingsPatch,
  readSkip,
  readTerm,
  shortCode,
  type TimetableReadResult,
} from './rules';
import { addDays, isoWeekday, weekOfTerm } from './time';
import { TIMETABLE_MESSAGES, type TimetableCourse, type TimetableMeeting, type TimetableSkip, type TimetableTerm } from './types';

const NOW = Date.parse('2026-10-24T16:00:00.000Z');
const BELL = String.fromCharCode(7);
const NUL = String.fromCharCode(0);

/** A valid id of the kind, made from a short tag. */
function id(prefix: 'tt' | 'tc' | 'tm' | 'ta', tag: string): string {
  return `${prefix}_${tag.padEnd(22, 'x').slice(0, 22)}`;
}

function value<T>(result: TimetableReadResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result.value;
}

function code<T>(result: TimetableReadResult<T>): string | null {
  return result.ok ? null : result.code;
}

function meeting(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: id('tm', 'a'), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 650, location: 'DV 2074', weekRule: 'all', weekList: null, ...patch };
}

function course(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: id('tc', 'a'), termId: null, code: 'MAT102H5F', title: 'Intro', color: 'purple', notes: null, remind: true, meetings: [meeting()], ...patch };
}

function term(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: id('tt', 'a'), name: '2026 秋季', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [], ...patch };
}

function assignment(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: id('ta', 'a'), courseId: null, title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d', '1h'], ...patch };
}

describe('ids', () => {
  it('accepts a prefix and 22 base64url characters', () => {
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRSTU-')).toBe(true);
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRST_v', 'tc')).toBe(true);
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRSTUV', 'tm')).toBe(false);
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRSTU')).toBe(false);
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRSTUVW')).toBe(false);
    expect(isTimetableId('tx_ABCDEFGHIJKLMNOPQRSTUV')).toBe(false);
    expect(isTimetableId('tc_ABCDEFGHIJKLMNOPQRST.V')).toBe(false);
    expect(isTimetableId(42)).toBe(false);
  });

  it('refuses an id of the wrong kind in every reader', () => {
    expect(code(readCourse(course({ id: id('tm', 'a') })))).toBe('invalid_id');
    expect(code(readCourse(course({ termId: id('tc', 'a') })))).toBe('invalid_id');
    expect(code(readCourse(course({ meetings: [meeting({ id: 'tm_short' })] })))).toBe('invalid_id');
    expect(code(readTerm(term({ id: id('tc', 'a') })))).toBe('invalid_id');
    expect(code(readAssignment(assignment({ courseId: id('tt', 'a') }), NOW))).toBe('invalid_id');
    expect(code(readSkip({ onDate: '2026-10-26', meetingId: id('tc', 'a'), skipped: true }))).toBe('invalid_id');
  });
});

describe('text', () => {
  it('keeps one line, drops control characters and shrinks spaces', () => {
    expect(cleanTimetableLine(`  DV${BELL}  2074\n\tA ${NUL}`)).toBe('DV 2074 A');
  });

  it('keeps line breaks in notes', () => {
    expect(cleanTimetableNotes(`Bring${BELL} calculator  \r\nRoom\u2028IB\n\n\n\n\nEnd`)).toBe('Bring calculator\nRoom\nIB\n\n\nEnd');
  });

  it('uppercases ASCII letters of a course code only', () => {
    expect(normalizeCourseCode(' mat102h5f ')).toBe('MAT102H5F');
    expect(normalizeCourseCode('数学 abc')).toBe('数学 ABC');
    expect(normalizeCourseCode(`csc${BELL}108`)).toBe('CSC108');
  });
});

describe('readCourse', () => {
  it('cleans and returns a valid course', () => {
    const saved = value(readCourse(course({ code: ' mat102h5f', title: `  Calculus${BELL} I `, notes: 'line 1\r\nline 2', meetings: [meeting({ kind: undefined, location: '  DV   2074 ', section: ' LEC0101 ' })] })));
    expect(saved).toEqual({
      id: id('tc', 'a'),
      termId: null,
      code: 'MAT102H5F',
      title: 'Calculus I',
      color: 'purple',
      notes: 'line 1\nline 2',
      remind: true,
      meetings: [{ id: id('tm', 'a'), kind: 'lec', section: 'LEC0101', weekday: 1, startMin: 600, endMin: 650, location: 'DV 2074', weekRule: 'all', weekList: null }],
    });
  });

  it('turns blank optional text into null and cuts long text to its cap', () => {
    const saved = value(readCourse(course({ title: '   ', notes: 'n'.repeat(1200), meetings: [meeting({ location: 'L'.repeat(70), section: '' })] })));
    expect(saved.title).toBeNull();
    expect(saved.notes).toHaveLength(1000);
    expect(saved.meetings[0]?.location).toHaveLength(60);
    expect(saved.meetings[0]?.section).toBeNull();
    expect(value(readCourse(course({ meetings: [meeting({ section: 'TUT0101-EXTRA-LONG' })] }))).meetings[0]?.section).toBe('TUT0101-EXTR');
  });

  it('counts characters by code point, so an emoji is never split', () => {
    const smile = String.fromCodePoint(0x1f600);
    const saved = value(readCourse(course({ title: smile.repeat(90) })));
    expect(Array.from(saved.title ?? '')).toHaveLength(80);
    expect(saved.title?.endsWith(smile)).toBe(true);
  });

  it('needs a course code of at most 20 characters', () => {
    expect(code(readCourse(course({ code: '   ' })))).toBe('invalid_course_code');
    expect(code(readCourse(course({ code: 'A'.repeat(21) })))).toBe('invalid_course_code');
    expect(code(readCourse(course({ code: 12 })))).toBe('invalid_course_code');
    expect(value(readCourse(course({ code: 'A'.repeat(20) }))).code).toHaveLength(20);
  });

  it('accepts a start from 09:00 to 20:50 and an end by 21:00, on 5-minute steps', () => {
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 540, endMin: 600 })] })))).toBeNull();
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 535, endMin: 600 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 1250, endMin: 1260 })] })))).toBeNull();
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 1255, endMin: 1260 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 1200, endMin: 1265 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 602, endMin: 650 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 600, endMin: 652 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: '600', endMin: 650 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ weekday: 0 })] })))).toBe('invalid_meeting_time');
    expect(code(readCourse(course({ meetings: [meeting({ weekday: 8 })] })))).toBe('invalid_meeting_time');
  });

  it('needs at least 10 minutes', () => {
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 600, endMin: 605 })] })))).toBe('meeting_too_short');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 600, endMin: 590 })] })))).toBe('meeting_too_short');
    expect(code(readCourse(course({ meetings: [meeting({ startMin: 600, endMin: 610 })] })))).toBeNull();
    expect(meetingTimeProblem(600, 600)).toBe('meeting_too_short');
    expect(meetingTimeProblem(540, 1260)).toBeNull();
  });

  it('needs a term for odd, even and custom weeks', () => {
    for (const weekRule of ['odd', 'even'] as const) {
      expect(code(readCourse(course({ meetings: [meeting({ weekRule })] })))).toBe('invalid_weeks');
      expect(value(readCourse(course({ termId: id('tt', 'a'), meetings: [meeting({ weekRule })] }))).meetings[0]?.weekRule).toBe(weekRule);
    }
    expect(code(readCourse(course({ meetings: [meeting({ weekRule: 'list', weekList: [1, 3] })] })))).toBe('invalid_weeks');
    expect(code(readCourse(course({ meetings: [meeting({ weekRule: 'monthly' })] })))).toBe('invalid_body');
  });

  it('keeps a custom week list of distinct weeks 1 to 40, sorted, and drops it for other rules', () => {
    const withTerm = (patch: Record<string, unknown>) => readCourse(course({ termId: id('tt', 'a'), meetings: [meeting(patch)] }));
    expect(value(withTerm({ weekRule: 'list', weekList: [9, 1, 40] })).meetings[0]?.weekList).toEqual([1, 9, 40]);
    expect(code(withTerm({ weekRule: 'list', weekList: [1, 1] }))).toBe('invalid_week_list');
    expect(code(withTerm({ weekRule: 'list', weekList: [0] }))).toBe('invalid_week_list');
    expect(code(withTerm({ weekRule: 'list', weekList: [41] }))).toBe('invalid_week_list');
    expect(code(withTerm({ weekRule: 'list', weekList: [1.5] }))).toBe('invalid_week_list');
    expect(code(withTerm({ weekRule: 'list', weekList: [] }))).toBe('invalid_week_list');
    expect(code(withTerm({ weekRule: 'list', weekList: null }))).toBe('invalid_week_list');
    expect(value(withTerm({ weekRule: 'odd', weekList: [1, 2] })).meetings[0]?.weekList).toBeNull();
  });

  it('allows 10 meetings with distinct ids, not 11', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => meeting({ id: id('tm', `m${i}`), weekday: (i % 7) + 1 }));
    expect(value(readCourse(course({ meetings: many(10) }))).meetings).toHaveLength(10);
    expect(code(readCourse(course({ meetings: many(11) })))).toBe('too_many_meetings');
    expect(code(readCourse(course({ meetings: [meeting(), meeting()] })))).toBe('invalid_id');
    expect(value(readCourse(course({ meetings: [] }))).meetings).toEqual([]);
    expect(code(readCourse(course({ meetings: undefined })))).toBe('invalid_body');
  });

  it('refuses unknown colours and kinds and fields of the wrong type', () => {
    expect(code(readCourse(course({ color: 'black' })))).toBe('invalid_color');
    expect(code(readCourse(course({ meetings: [meeting({ kind: 'exam' })] })))).toBe('invalid_meeting_kind');
    expect(code(readCourse(course({ remind: 'yes' })))).toBe('invalid_body');
    expect(code(readCourse(course({ title: 5 })))).toBe('invalid_body');
    expect(code(readCourse(null))).toBe('invalid_body');
    expect(code(readCourse([course()]))).toBe('invalid_body');
    expect(value(readCourse(course({ remind: undefined }))).remind).toBe(true);
    expect(value(readCourse(course({ remind: false }))).remind).toBe(false);
  });

  it('answers with the Chinese text the API sends', () => {
    expect(readCourse(course({ color: 'black' }))).toEqual({ ok: false, code: 'invalid_color', message: TIMETABLE_MESSAGES.invalid_color });
    expect(TIMETABLE_MESSAGES.invalid_meeting_time).toBe('上课时间需在 09:00\u201321:00 之间，按 5 分钟设置');
  });
});

describe('readTerm', () => {
  it('returns a valid term with its reading week', () => {
    expect(value(readTerm(term({ name: ' 2026 秋季 ', skipWeeks: [9, 8] })))).toEqual({
      id: id('tt', 'a'),
      name: '2026 秋季',
      startsOn: '2026-09-03',
      endsOn: '2026-12-02',
      skipWeeks: [8, 9],
    });
  });

  it('needs real dates in order and at most 40 weeks', () => {
    expect(code(readTerm(term({ startsOn: '2026-12-03' })))).toBe('invalid_term');
    expect(code(readTerm(term({ endsOn: '2026-02-30' })))).toBe('invalid_term');
    // 2026-08-31 is a Monday: 40 weeks end on 2027-06-06, the 41st week starts the next day.
    expect(code(readTerm(term({ startsOn: '2026-08-31', endsOn: '2027-06-06' })))).toBeNull();
    expect(code(readTerm(term({ startsOn: '2026-08-31', endsOn: '2027-06-07' })))).toBe('invalid_term');
    expect(code(readTerm(term({ startsOn: '2026-09-03', endsOn: '2026-09-03' })))).toBeNull();
  });

  it('keeps skip weeks inside the term, without repeats', () => {
    expect(code(readTerm(term({ skipWeeks: [15] })))).toBe('invalid_term');
    expect(code(readTerm(term({ skipWeeks: [14] })))).toBeNull();
    expect(code(readTerm(term({ skipWeeks: [8, 8] })))).toBe('invalid_term');
    expect(code(readTerm(term({ skipWeeks: 'week 8' })))).toBe('invalid_term');
    expect(value(readTerm(term({ skipWeeks: undefined }))).skipWeeks).toEqual([]);
  });

  it('needs a name and cuts it to 30 characters', () => {
    expect(code(readTerm(term({ name: '  ' })))).toBe('invalid_term_name');
    expect(code(readTerm(term({ name: undefined })))).toBe('invalid_term_name');
    expect(value(readTerm(term({ name: '名'.repeat(40) }))).name).toHaveLength(30);
  });
});

describe('readAssignment', () => {
  it('returns a valid assignment with its offsets in the standard order', () => {
    expect(value(readAssignment(assignment({ dueAt: '2026-10-30T23:59:00-04:00', remindOffsets: ['1h', 'morning', '1w'] }), NOW))).toEqual({
      id: id('ta', 'a'),
      courseId: null,
      title: 'PS3',
      notes: null,
      dueAt: '2026-10-31T03:59:00.000Z',
      remindOffsets: ['1w', 'morning', '1h'],
    });
  });

  it('keeps done only when it is sent', () => {
    expect(value(readAssignment(assignment({ done: true }), NOW)).done).toBe(true);
    expect('done' in value(readAssignment(assignment(), NOW))).toBe(false);
    expect(code(readAssignment(assignment({ done: 'yes' }), NOW))).toBe('invalid_body');
  });

  it('needs an ISO time with a zone on a whole minute', () => {
    expect(code(readAssignment(assignment({ dueAt: '2026-10-31T03:59:30.000Z' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: '2026-10-31T03:59:00.001Z' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: '2026-10-31T03:59' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: 'tomorrow' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: '2026-02-30T03:59:00Z' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: '2026-10-31T24:00:00Z' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: '2026-10-31T03:59:00+24:00' }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: Date.parse('2026-10-31T03:59:00Z') }), NOW))).toBe('invalid_due_time');
  });

  it('allows from 365 days before now to 400 days after', () => {
    const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString();
    expect(code(readAssignment(assignment({ dueAt: at(400) }), NOW))).toBeNull();
    expect(code(readAssignment(assignment({ dueAt: at(401) }), NOW))).toBe('invalid_due_time');
    expect(code(readAssignment(assignment({ dueAt: at(-365) }), NOW))).toBeNull();
    expect(code(readAssignment(assignment({ dueAt: at(-366) }), NOW))).toBe('invalid_due_time');
  });

  it('allows up to 3 distinct listed offsets', () => {
    expect(value(readAssignment(assignment({ remindOffsets: [] }), NOW)).remindOffsets).toEqual([]);
    expect(code(readAssignment(assignment({ remindOffsets: ['2h'] }), NOW))).toBe('invalid_offset');
    expect(code(readAssignment(assignment({ remindOffsets: ['1h', '1h'] }), NOW))).toBe('invalid_offset');
    expect(code(readAssignment(assignment({ remindOffsets: ['1w', '2d', '1d', '1h'] }), NOW))).toBe('too_many_offsets');
    expect(code(readAssignment(assignment({ remindOffsets: undefined }), NOW))).toBe('invalid_offset');
  });

  it('needs a title and cuts it to 120 characters', () => {
    expect(code(readAssignment(assignment({ title: '' }), NOW))).toBe('invalid_assignment_title');
    expect(value(readAssignment(assignment({ title: 't'.repeat(130) }), NOW)).title).toHaveLength(120);
  });
});

describe('readSkip and readSettingsPatch', () => {
  it('reads a holiday and a single skipped class', () => {
    expect(value(readSkip({ onDate: '2026-10-26', meetingId: null, skipped: true, label: ' 感恩节 ' }))).toEqual({ onDate: '2026-10-26', meetingId: null, skipped: true, label: '感恩节' });
    expect(value(readSkip({ onDate: '2026-10-26', meetingId: id('tm', 'a'), skipped: false }))).toEqual({ onDate: '2026-10-26', meetingId: id('tm', 'a'), skipped: false, label: null });
    expect(code(readSkip({ onDate: '10/26', meetingId: null, skipped: true }))).toBe('invalid_skip_date');
    expect(code(readSkip({ onDate: '2026-10-26', meetingId: null }))).toBe('invalid_body');
    expect(value(readSkip({ onDate: '2026-10-26', meetingId: null, skipped: true, label: 'L'.repeat(40) })).label).toHaveLength(30);
  });

  it('keeps only the settings sent and checks each', () => {
    expect(value(readSettingsPatch({ classReminders: true, classLeadMin: 15, other: 1 }))).toEqual({ classReminders: true, classLeadMin: 15 });
    expect(value(readSettingsPatch({ assignmentOffsets: ['1h', '1d'], showWeekend: 'auto', locale: 'en' }))).toEqual({ assignmentOffsets: ['1d', '1h'], showWeekend: 'auto', locale: 'en' });
    expect(value(readSettingsPatch({}))).toEqual({});
    expect(code(readSettingsPatch({ classLeadMin: 25 }))).toBe('invalid_settings');
    expect(code(readSettingsPatch({ classReminders: 1 }))).toBe('invalid_settings');
    expect(code(readSettingsPatch({ showWeekend: 'never' }))).toBe('invalid_settings');
    expect(code(readSettingsPatch({ locale: 'fr' }))).toBe('invalid_settings');
    expect(code(readSettingsPatch({ assignmentOffsets: ['1w', '2d', '1d', '3h'] }))).toBe('too_many_offsets');
    expect(code(readSettingsPatch('x'))).toBe('invalid_body');
  });
});

describe('readImport', () => {
  const many = <T>(n: number, make: (i: number) => T) => Array.from({ length: n }, (_, i) => make(i));

  it('reads every part and merges repeated skips', () => {
    const body = value(
      readImport(
        {
          terms: [term()],
          courses: [course({ termId: id('tt', 'a') })],
          assignments: [assignment()],
          skips: [
            { onDate: '2026-10-12', meetingId: null, label: '感恩节' },
            { onDate: '2026-10-12', meetingId: null, label: 'again' },
            { onDate: '2026-10-12', meetingId: id('tm', 'a') },
          ],
        },
        NOW,
      ),
    );
    expect(body.terms).toHaveLength(1);
    expect(body.courses[0]?.termId).toBe(id('tt', 'a'));
    expect(body.assignments).toHaveLength(1);
    expect(body.skips).toEqual([
      { onDate: '2026-10-12', meetingId: null, label: '感恩节' },
      { onDate: '2026-10-12', meetingId: id('tm', 'a'), label: null },
    ]);
    expect(value(readImport({}, NOW))).toEqual({ terms: [], courses: [], assignments: [], skips: [] });
  });

  it('applies every limit to the import itself', () => {
    expect(code(readImport({ terms: many(7, (i) => term({ id: id('tt', `t${i}`) })) }, NOW))).toBe('too_many_terms');
    expect(code(readImport({ courses: many(31, (i) => course({ id: id('tc', `c${i}`), meetings: [] })) }, NOW))).toBe('too_many_courses');
    expect(code(readImport({ skips: many(201, (i) => ({ onDate: addDays('2026-09-01', i), meetingId: null })) }, NOW))).toBe('too_many_skips');
    expect(code(readImport({ assignments: many(1001, (i) => assignment({ id: id('ta', `a${i}`), done: true })) }, NOW))).toBe('too_many_assignments');
    expect(code(readImport({ assignments: many(301, (i) => assignment({ id: id('ta', `a${i}`) })) }, NOW))).toBe('too_many_assignments');
    expect(code(readImport({ assignments: many(300, (i) => assignment({ id: id('ta', `a${i}`) })) }, NOW))).toBeNull();
    expect(code(readImport({ assignments: [...many(300, (i) => assignment({ id: id('ta', `a${i}`) })), assignment({ id: id('ta', 'done'), done: true })] }, NOW))).toBeNull();
  });

  it('refuses repeated ids, meeting ids across courses included', () => {
    expect(code(readImport({ terms: [term(), term()] }, NOW))).toBe('invalid_id');
    expect(code(readImport({ courses: [course(), course({ meetings: [] })] }, NOW))).toBe('invalid_id');
    expect(code(readImport({ courses: [course(), course({ id: id('tc', 'b') })] }, NOW))).toBe('invalid_id');
    expect(code(readImport({ assignments: [assignment(), assignment()] }, NOW))).toBe('invalid_id');
  });

  it('refuses the whole import when one item is wrong', () => {
    expect(code(readImport({ courses: [course(), course({ id: id('tc', 'b'), meetings: [meeting({ id: id('tm', 'b'), startMin: 480 })] })] }, NOW))).toBe('invalid_meeting_time');
    expect(code(readImport({ terms: 'all' }, NOW))).toBe('invalid_body');
  });
});

describe('occursOn', () => {
  const fall: TimetableTerm = { id: id('tt', 'fall'), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [8], updatedAt: '' };
  const monday = (patch: Partial<TimetableMeeting> = {}): TimetableMeeting => ({
    id: id('tm', 'mon'),
    kind: 'lec',
    section: null,
    weekday: 1,
    startMin: 600,
    endMin: 650,
    location: null,
    weekRule: 'all',
    weekList: null,
    ...patch,
  });
  const none = indexSkips([]);

  it('needs the right weekday', () => {
    expect(occursOn(monday(), null, none, '2026-10-26')).toBe(true);
    expect(occursOn(monday(), null, none, '2026-10-27')).toBe(false);
  });

  it('runs a term-less course every week with no end', () => {
    expect(occursOn(monday(), null, none, '2030-01-07')).toBe(true);
  });

  it('keeps a term course inside the term', () => {
    // Week 1 starts on Thursday 2026-09-03, so the first Monday class is 09-07 and the last is 11-30.
    expect(occursOn(monday(), fall, none, '2026-08-31')).toBe(false);
    expect(occursOn(monday(), fall, none, '2026-09-07')).toBe(true);
    expect(occursOn(monday(), fall, none, '2026-11-30')).toBe(true);
    expect(occursOn(monday(), fall, none, '2026-12-07')).toBe(false);
  });

  it('skips a reading week', () => {
    expect(weekOfTerm(fall, '2026-10-19')).toBe(8);
    expect(occursOn(monday(), fall, none, '2026-10-19')).toBe(false);
    expect(occursOn(monday(), fall, none, '2026-10-26')).toBe(true);
  });

  it('follows odd, even and custom weeks', () => {
    // 2026-09-07 is week 2, 2026-09-14 week 3.
    expect(occursOn(monday({ weekRule: 'odd' }), fall, none, '2026-09-07')).toBe(false);
    expect(occursOn(monday({ weekRule: 'odd' }), fall, none, '2026-09-14')).toBe(true);
    expect(occursOn(monday({ weekRule: 'even' }), fall, none, '2026-09-07')).toBe(true);
    expect(occursOn(monday({ weekRule: 'even' }), fall, none, '2026-09-14')).toBe(false);
    expect(occursOn(monday({ weekRule: 'list', weekList: [3, 9] }), fall, none, '2026-09-14')).toBe(true);
    expect(occursOn(monday({ weekRule: 'list', weekList: [3, 9] }), fall, none, '2026-09-07')).toBe(false);
    expect(occursOn(monday({ weekRule: 'list', weekList: [3, 9] }), fall, none, '2026-10-26')).toBe(true);
  });

  it('honours a holiday and a single skipped class', () => {
    const holiday = indexSkips([{ onDate: '2026-10-12', meetingId: null }]);
    expect(occursOn(monday(), fall, holiday, '2026-10-12')).toBe(false);
    expect(occursOn(monday({ id: id('tm', 'other') }), fall, holiday, '2026-10-12')).toBe(false);
    const single = indexSkips([{ onDate: '2026-10-26', meetingId: id('tm', 'mon') }]);
    expect(occursOn(monday(), fall, single, '2026-10-26')).toBe(false);
    expect(occursOn(monday({ id: id('tm', 'other') }), fall, single, '2026-10-26')).toBe(true);
    expect(occursOn(monday(), fall, single, '2026-11-02')).toBe(true);
    expect(occursOn(monday(), null, single, '2026-10-26')).toBe(false);
  });

  it('agrees with a plain restatement of the rules on random timetables', () => {
    let seed = 20261024;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const DAY = 86_400_000;
    const ms = (date: string) => Date.parse(`${date}T00:00:00Z`);
    const mondayMs = (date: string) => ms(date) - ((new Date(ms(date)).getUTCDay() + 6) % 7) * DAY;
    for (let round = 0; round < 40; round += 1) {
      const startsOn = addDays('2026-08-24', Math.floor(rand() * 21));
      const t: TimetableTerm = { id: id('tt', `r${round}`), name: 'T', startsOn, endsOn: addDays(startsOn, 60 + Math.floor(rand() * 60)), skipWeeks: rand() < 0.7 ? [1 + Math.floor(rand() * 10)] : [], updatedAt: '' };
      const rule = (['all', 'odd', 'even', 'list'] as const)[Math.floor(rand() * 4)] ?? 'all';
      const m = monday({ id: id('tm', `r${round}`), weekday: (1 + Math.floor(rand() * 7)) as TimetableMeeting['weekday'], weekRule: rule, weekList: rule === 'list' ? [2, 5, 6, 11].filter(() => rand() < 0.6).concat([3]) : null });
      const skips: TimetableSkip[] = Array.from({ length: 4 }, () => ({ onDate: addDays(startsOn, Math.floor(rand() * 120)), meetingId: rand() < 0.4 ? null : m.id, label: null }));
      const index = indexSkips(skips);
      for (let day = -7; day < 140; day += 1) {
        const date = addDays(startsOn, day);
        const week = Math.floor((ms(date) - mondayMs(t.startsOn)) / (7 * DAY)) + 1;
        const expected =
          ((new Date(ms(date)).getUTCDay() + 6) % 7) + 1 === m.weekday &&
          date >= t.startsOn &&
          date <= t.endsOn &&
          !t.skipWeeks.includes(week) &&
          (m.weekRule === 'all' || (m.weekRule === 'odd' && week % 2 === 1) || (m.weekRule === 'even' && week % 2 === 0) || (m.weekRule === 'list' && (m.weekList ?? []).includes(week))) &&
          !skips.some((s) => s.onDate === date && (s.meetingId === null || s.meetingId === m.id));
        expect(occursOn(m, t, index, date)).toBe(expected);
      }
    }
  });
});

describe('occurrencesBetween', () => {
  const fall: TimetableTerm = { id: id('tt', 'fall'), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [], updatedAt: '' };
  const mk = (cid: string, termId: string | null, meetings: Partial<TimetableMeeting>[]): TimetableCourse => ({
    id: id('tc', cid),
    termId,
    code: cid.toUpperCase(),
    title: null,
    color: 'blue',
    notes: null,
    remind: true,
    updatedAt: '',
    meetings: meetings.map((patch, i) => ({ id: id('tm', `${cid}${i}`), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 650, location: null, weekRule: 'all', weekList: null, ...patch })),
  });

  it('lists every class in the range in start order, with Toronto instants', () => {
    const data = {
      terms: [fall],
      courses: [mk('b', fall.id, [{ weekday: 1, startMin: 660, endMin: 710 }, { weekday: 3, startMin: 540, endMin: 590 }]), mk('a', null, [{ weekday: 1, startMin: 600, endMin: 650 }])],
      skips: [],
    };
    const list = occurrencesBetween(data, '2026-10-26', '2026-11-01');
    expect(list.map((o) => `${o.date} ${o.course.code} ${new Date(o.startMs).toISOString()}`)).toEqual([
      '2026-10-26 A 2026-10-26T14:00:00.000Z',
      '2026-10-26 B 2026-10-26T15:00:00.000Z',
      '2026-10-28 B 2026-10-28T13:00:00.000Z',
    ]);
    expect(list[0]?.endMs).toBe(Date.parse('2026-10-26T14:50:00.000Z'));
    const after = occurrencesBetween(data, '2026-11-02', '2026-11-02');
    expect(after.map((o) => new Date(o.startMs).toISOString())).toEqual(['2026-11-02T15:00:00.000Z', '2026-11-02T16:00:00.000Z']);
  });

  it('gives a course whose term is missing no classes, and an empty range nothing', () => {
    const data = { terms: [], courses: [mk('a', id('tt', 'gone'), [{}])], skips: [] };
    expect(occurrencesBetween(data, '2026-10-26', '2026-11-01')).toEqual([]);
    expect(occurrencesBetween({ terms: [], courses: [mk('a', null, [{}])], skips: [] }, '2026-10-27', '2026-10-26')).toEqual([]);
  });

  it('skips the dates the skips name', () => {
    const data = { terms: [], courses: [mk('a', null, [{}])], skips: [{ onDate: '2026-10-26', meetingId: null, label: null }] };
    expect(occurrencesBetween(data, '2026-10-26', '2026-11-02').map((o) => o.date)).toEqual(['2026-11-02']);
    expect(isoWeekday('2026-11-02')).toBe(1);
  });
});

describe('shortCode', () => {
  it('shortens UofT codes to the six-character course', () => {
    expect(shortCode('MAT102H5F')).toBe('MAT102');
    expect(shortCode('CSC108H5')).toBe('CSC108');
    expect(shortCode('MAT102')).toBe('MAT102');
    expect(shortCode('CSCD03H5S')).toBe('CSCD03');
    expect(shortCode('BIO152Y5Y')).toBe('BIO152');
  });

  it('shows the first 8 characters of anything else', () => {
    expect(shortCode('Physics Lab')).toBe('Physics ');
    expect(shortCode('高等数学（一）')).toBe('高等数学（一）');
    expect(shortCode('MAT102H5FX')).toBe('MAT102H5');
  });
});
