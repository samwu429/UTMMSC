import { describe, expect, it } from 'vitest';
import { occurrencesBetween, readImport, type TimetableCourse, type TimetableData, type TimetableIdPrefix, type TimetableTerm } from '@utmmsc/shared';
import { buildTimetableIcs } from './build';
import { parseIcs } from './parse';
import {
  buildImportBody,
  defaultChoices,
  findCourseCode,
  importedData,
  planImport,
  suggestMeetingTime,
  suggestTermName,
  type ImportContext,
  type ImportPlan,
} from './plan';
import { NOW, fall, fixture } from './fixtures.testdata';
import { FLOATING_ICS, GOOGLE_ICS, OUTLOOK_ICS, QUERCUS_ICS, UTC_ICS } from './samples.testdata';

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  let n = 0;
  return {
    terms: [],
    courses: [],
    skips: [],
    assignments: [],
    settings: { assignmentOffsets: ['1d', '1h'] },
    nowMs: NOW,
    locale: 'zh',
    newId: (prefix: TimetableIdPrefix) => `${prefix}_${String((n += 1)).padStart(22, '0')}`,
    ...overrides,
  };
}

function plan(text: string, ctx: ImportContext = context()): ImportPlan {
  return planImport(parseIcs(text), ctx);
}

function meetingsOf(result: ImportPlan, code: string) {
  return result.courses.find((course) => course.code === code)?.meetings ?? [];
}

/** Each class as one comparable line: date, Toronto start and end, code, kind, section, place. */
/** 每节课写成一行便于比较：日期、多伦多开始和结束时间、代码、类型、班级、地点。 */
function classLines(data: TimetableData, from: string, to: string): string[] {
  return occurrencesBetween(data, from, to).map(
    ({ course, meeting, date, startMs, endMs }) => `${date} ${startMs} ${endMs} ${course.code} ${meeting.kind} ${meeting.section ?? '-'} ${meeting.location ?? '-'}`,
  );
}

describe('planImport: Google Calendar', () => {
  const result = plan(GOOGLE_ICS);

  it('suggests one term from the classes, with reading week as a skip week', () => {
    expect(result.terms).toEqual([{ id: 'tt_0000000000000000000001', name: '2026 秋季', startsOn: '2026-09-08', endsOn: '2026-12-01', skipWeeks: [6] }]);
  });

  it('groups a lecture and a tutorial into one course by code, one meeting per BYDAY day', () => {
    const course = result.courses.find((item) => item.code === 'MAT102H5F');
    expect(course).toMatchObject({ termId: 'tt_0000000000000000000001', title: null, recognized: true, duplicateOf: null });
    expect(course?.meetings.map((m) => [m.weekday, m.startMin, m.endMin, m.kind, m.section, m.location, m.weekRule, m.problem])).toEqual([
      [2, 600, 660, 'lec', 'LEC0101', 'DV 2074, Deerfield Hall', 'all', null],
      [4, 600, 660, 'lec', 'LEC0101', 'DV 2074, Deerfield Hall', 'all', null],
      [5, 840, 900, 'tut', null, 'IB 110', 'odd', null],
    ]);
  });

  it('turns a moved class into a single skip and leaves reading week to the term', () => {
    const [tuesday, thursday] = meetingsOf(result, 'MAT102H5F');
    expect(tuesday?.skipDates).toEqual(['2026-11-03']);
    expect(thursday?.skipDates).toEqual([]);
  });

  it('offers other weekly events unticked, and deadlines unticked as assignments', () => {
    const gym = result.courses.find((item) => item.code === 'GYM');
    expect(gym).toMatchObject({ termId: null, title: 'Gym', recognized: false });
    expect(gym?.meetings[0]).toMatchObject({ weekday: 1, startMin: 1080, endMin: 1140, kind: 'other', weekRule: 'all' });
    const choices = defaultChoices(result);
    expect(choices.courses[gym!.id]?.include).toBe(false);
    expect(result.assignments).toEqual([
      expect.objectContaining({ title: 'PS3', dueAt: '2026-10-31T03:59:00.000Z', courseCode: 'MAT102', remindOffsets: ['1d', '1h'], fromApp: false, duplicate: false }),
    ]);
    expect(result.assignments[0]!.courseId).toBe(result.courses.find((item) => item.code === 'MAT102H5F')?.id);
    expect(choices.assignments[result.assignments[0]!.id]).toBe(false);
  });

  it('counts what it cannot import: daily repeats, past events; cancelled ones vanish', () => {
    expect(result.ignored).toEqual({ repeating: 1, allDay: 0, noEnd: 0, past: 2 });
    expect(result.courses.some((course) => course.code.startsWith('CSC148'))).toBe(false);
  });

  it('builds a body the server accepts', () => {
    const built = buildImportBody(result, defaultChoices(result), context());
    expect(built.problems).toEqual([]);
    expect(built.counts).toEqual({ courses: 1, assignments: 0 });
    const read = readImport(built.body, NOW);
    expect(read.ok).toBe(true);
    expect(built.body.skips).toEqual([{ onDate: '2026-11-03', meetingId: meetingsOf(result, 'MAT102H5F')[0]!.id, label: null }]);
  });
});

describe('planImport: into an existing term', () => {
  it('reuses a term that starts a few days earlier, with a single skip rather than a week list', () => {
    // The member's Fall term starts on Thursday Sep 3; the file's Thursday lectures start a week later.
    // 成员的秋季学期从 9 月 3 日周四开始；文件中的周四讲座晚一周开始。
    const result = plan(GOOGLE_ICS, context({ terms: [fall] }));
    expect(result.terms).toEqual([]);
    const [tuesday, thursday, friday] = meetingsOf(result, 'MAT102H5F');
    expect(tuesday).toMatchObject({ weekRule: 'all', weekList: null, skipDates: ['2026-11-03'] });
    // The term's first Thursday and its last one (Dec 3, after the file's last class) become single skips.
    // 学期的第一个周四和最后一个周四（12 月 3 日，在文件最后一节课之后）成为单次停课。
    expect(thursday).toMatchObject({ weekRule: 'all', weekList: null, skipDates: ['2026-09-03', '2026-12-03'] });
    // Odd weeks of the file are even weeks of a term that started a week earlier.
    // 文件中的单周在早一周开始的学期里是双周。
    expect(friday).toMatchObject({ weekRule: 'even', weekList: null });
  });

  it('keeps a week list for a series no simple rule fits', () => {
    const everyThirdWeek = GOOGLE_ICS.replace('RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261202T045959Z;BYDAY=TU,TH', 'RRULE:FREQ=WEEKLY;INTERVAL=3;UNTIL=20261202T045959Z;BYDAY=TU');
    const [tuesday] = meetingsOf(plan(everyThirdWeek, context({ terms: [fall] })), 'MAT102H5F');
    expect(tuesday).toMatchObject({ weekRule: 'list', weekList: [2, 5, 8, 11, 14] });
  });
});

describe('planImport: other calendar apps', () => {
  it('reads Outlook Windows zones and COUNT, and finds even weeks', () => {
    const result = plan(OUTLOOK_ICS);
    expect(result.terms.map((term) => [term.startsOn, term.endsOn, term.skipWeeks])).toEqual([['2026-09-09', '2026-11-25', []]]);
    expect(meetingsOf(result, 'CSC108H5').map((m) => [m.weekday, m.startMin, m.endMin, m.kind, m.section, m.weekRule])).toEqual([
      [3, 900, 960, 'lec', null, 'all'],
      [1, 990, 1050, 'pra', 'PRA0105', 'even'],
    ]);
  });

  it('puts a UTC evening class on its Toronto weekday', () => {
    const result = plan(UTC_ICS);
    expect(meetingsOf(result, 'ECO100Y5').map((m) => [m.weekday, m.startMin, m.endMin, m.kind, m.section])).toEqual([
      [2, 600, 650, 'lec', 'LEC0101'],
      [3, 1200, 1250, 'tut', 'TUT0201'],
    ]);
  });

  it('flags floating times outside 09:00-21:00, unticked with the nearest allowed time', () => {
    const result = plan(FLOATING_ICS);
    const [lab, lecture] = meetingsOf(result, 'PHY136');
    expect(lab).toMatchObject({ weekday: 4, startMin: 1140, endMin: 1320, kind: 'lab', problem: 'invalid_meeting_time', suggestedStart: 1140, suggestedEnd: 1260 });
    expect(lecture).toMatchObject({ weekday: 5, startMin: 540, endMin: 600, problem: null });
    const choices = defaultChoices(result);
    expect(choices.meetings[lab!.id]).toEqual({ include: false, startMin: 1140, endMin: 1260 });
    // Ticked with the fixed time, it imports; with the file's time, it cannot.
    // 勾选并使用修改后的时间即可导入；使用文件中的时间则不行。
    choices.meetings[lab!.id] = { ...choices.meetings[lab!.id]!, include: true };
    expect(buildImportBody(result, choices, context()).problems).toEqual([]);
    choices.meetings[lab!.id] = { include: true, startMin: 1140, endMin: 1320 };
    expect(buildImportBody(result, choices, context()).problems).toEqual([{ kind: 'meeting_time', code: 'PHY136' }]);
  });

  it('reads a Quercus feed as deadlines linked to existing courses by code', () => {
    const mat: TimetableCourse = { ...fixture.courses[0]!, id: 'tc_EXISTINGEXISTINGEXISTS' };
    const result = plan(QUERCUS_ICS, context({ courses: [mat] }));
    expect(result.courses).toEqual([]);
    expect(result.ignored.past).toBe(1);
    expect(result.assignments.map((a) => [a.title, a.dueAt, a.courseId, a.courseCode])).toEqual([
      ['PS3', '2026-10-31T03:59:00.000Z', mat.id, 'MAT102'],
      ['Reading response 4', '2026-11-07T04:59:00.000Z', null, 'CSC108'],
    ]);
    const choices = defaultChoices(result);
    for (const assignment of result.assignments) choices.assignments[assignment.id] = true;
    const built = buildImportBody(result, choices, context({ courses: [mat] }));
    expect(built.counts).toEqual({ courses: 0, assignments: 2 });
    expect(readImport(built.body, NOW).ok).toBe(true);
  });
});

describe('round trip through this app’s own export', () => {
  const text = buildTimetableIcs(fixture, { nowMs: NOW, locale: 'zh' });

  it('gives back the same classes, term and assignment', () => {
    const result = plan(text);
    expect(result.terms).toEqual([{ id: expect.any(String), name: '2026 秋季', startsOn: '2026-09-03', endsOn: '2026-12-03', skipWeeks: [7] }]);
    const choices = defaultChoices(result);
    const built = buildImportBody(result, choices, context());
    expect(built.problems).toEqual([]);
    expect(readImport(built.body, NOW).ok).toBe(true);
    expect(built.counts).toEqual({ courses: 2, assignments: 1 });

    const imported = importedData(built.body);
    expect(classLines(imported, '2026-10-24', '2027-01-31')).toEqual(classLines(fixture, '2026-10-24', '2027-01-31'));
    // Inside the term every past class matches too.
    // 学期之内，过去的每节课也都一致。
    const termOnly = { ...fixture, courses: fixture.courses.filter((course) => course.termId) };
    const importedTermOnly = { ...imported, courses: imported.courses.filter((course) => course.termId) };
    expect(classLines(importedTermOnly, '2026-08-31', '2026-12-31')).toEqual(classLines(termOnly, '2026-08-31', '2026-12-31'));

    const mat = built.body.courses.find((course) => course.code === 'MAT102H5F');
    expect(mat).toMatchObject({ title: 'Intro to Mathematical Proofs', notes: 'Bring; notes, please', color: 'blue', remind: true });
    // Meetings come in the order of their first class: Thursday Sep 3, Monday Sep 7, Wednesday Sep 9.
    // 上课时间按第一节课的先后排列：9 月 3 日周四、9 月 7 日周一、9 月 9 日周三。
    expect(mat?.meetings.map((m) => [m.weekday, m.kind, m.section, m.weekRule, m.weekList])).toEqual([
      [4, 'tut', 'TUT0103', 'odd', null],
      [1, 'lec', 'LEC0101', 'all', null],
      [3, 'pra', null, 'list', [2, 5, 9]],
    ]);
    expect(built.body.courses.find((course) => course.code === '合唱团')).toMatchObject({ termId: null, color: 'gold', remind: false, title: null });
    expect(built.body.assignments).toEqual([
      { id: expect.any(String), courseId: mat?.id, title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d', 'morning', '1h'] },
    ]);
  });

  it('into the same account: reuses the term and leaves courses and assignments already there unticked', () => {
    const result = plan(text, context({ terms: fixture.terms, courses: fixture.courses, skips: fixture.skips, assignments: fixture.assignments }));
    expect(result.terms).toEqual([]);
    expect(result.courses.map((course) => [course.code, course.termId, course.duplicateOf])).toEqual([
      ['MAT102H5F', fixture.terms[0]!.id, 'MAT102H5F'],
      ['合唱团', null, '合唱团'],
    ]);
    expect(result.assignments[0]?.duplicate).toBe(true);
    const built = buildImportBody(result, defaultChoices(result), context({ terms: fixture.terms, courses: fixture.courses }));
    expect(built.counts).toEqual({ courses: 0, assignments: 0 });
  });
});

describe('buildImportBody problems', () => {
  const result = plan(GOOGLE_ICS);
  const mat = result.courses.find((course) => course.code === 'MAT102H5F')!;

  it('refuses an empty or over-long code and an empty term name', () => {
    const choices = defaultChoices(result);
    choices.courses[mat.id] = { include: true, code: '   ' };
    choices.terms[result.terms[0]!.id] = ' ';
    expect(buildImportBody(result, choices, context()).problems).toEqual([{ kind: 'course_code', code: '   ' }, { kind: 'term_name' }]);
    choices.courses[mat.id] = { include: true, code: 'x'.repeat(21) };
    expect(buildImportBody(result, choices, context()).problems[0]).toEqual({ kind: 'course_code', code: 'x'.repeat(21) });
  });

  it('uppercases an edited code', () => {
    const choices = defaultChoices(result);
    choices.courses[mat.id] = { include: true, code: 'mat102h5f' };
    expect(buildImportBody(result, choices, context()).body.courses[0]?.code).toBe('MAT102H5F');
  });

  it('counts the limits with what the member already has', () => {
    const existing: TimetableCourse[] = Array.from({ length: 30 }, (_, i) => ({ ...fixture.courses[1]!, id: `tc_${String(i).padStart(22, 'X')}` }));
    const terms: TimetableTerm[] = Array.from({ length: 6 }, (_, i) => ({ ...fixture.terms[0]!, id: `tt_${String(i).padStart(22, 'X')}` }));
    const problems = buildImportBody(result, defaultChoices(result), { terms, courses: existing, skips: [], assignments: [] }).problems;
    expect(problems).toEqual(expect.arrayContaining([{ kind: 'too_many_courses', max: 30 }, { kind: 'too_many_terms', max: 6 }]));
  });

  it('drops an unticked course’s meetings, skips and new term', () => {
    const choices = defaultChoices(result);
    choices.courses[mat.id] = { include: false, code: mat.code };
    const built = buildImportBody(result, choices, context());
    expect(built.body).toEqual({ terms: [], courses: [], assignments: [], skips: [] });
  });

  it('moves an assignment of an unticked course to an existing course with the same code', () => {
    const existing: TimetableCourse = { ...fixture.courses[0]!, id: 'tc_EXISTINGEXISTINGEXISTS' };
    const choices = defaultChoices(result);
    choices.courses[mat.id] = { include: false, code: mat.code };
    choices.assignments[result.assignments[0]!.id] = true;
    const built = buildImportBody(result, choices, { terms: [], courses: [existing], skips: [], assignments: [] });
    expect(built.body.assignments[0]?.courseId).toBe(existing.id);
  });
});

describe('helpers', () => {
  it('finds UofT course codes with or without weight and session', () => {
    expect(findCourseCode('MAT102H5 F LEC0101')?.code).toBe('MAT102H5F');
    expect(findCourseCode('lecture csc108')?.code).toBe('CSC108');
    expect(findCourseCode('[ECO100Y5Y]')?.code).toBe('ECO100Y5Y');
    expect(findCourseCode('ABC12')).toBeNull();
    expect(findCourseCode('XMAT102')).toBeNull();
  });

  it('names terms by the month they start', () => {
    expect(suggestTermName('2026-09-08', '2026-12-01', 'zh')).toBe('2026 秋季');
    expect(suggestTermName('2027-01-05', '2027-04-05', 'en')).toBe('Winter 2027');
    expect(suggestTermName('2027-05-03', '2027-08-01', 'zh')).toBe('2027 夏季');
    expect(suggestTermName('2026-09-08', '2027-04-05', 'en')).toBe('2026–2027 full year');
  });

  it('suggests the nearest allowed meeting time', () => {
    expect(suggestMeetingTime(1140, 1320)).toEqual({ start: 1140, end: 1260 });
    expect(suggestMeetingTime(480, 540)).toEqual({ start: 540, end: 550 });
    expect(suggestMeetingTime(603, 652)).toEqual({ start: 605, end: 650 });
    expect(suggestMeetingTime(1270, 1300)).toEqual({ start: 1250, end: 1260 });
    expect(suggestMeetingTime(600, 600)).toEqual({ start: 600, end: 660 });
  });
});
