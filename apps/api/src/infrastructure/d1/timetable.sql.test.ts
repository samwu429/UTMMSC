import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { planAssignmentReminders, type SaveCourseBody, type TimetableMeeting } from '@utmmsc/shared';
import { compoundTerms, createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';
import {
  clearTimetable,
  deleteTimetableAssignment,
  deleteTimetableCourse,
  deleteTimetableSkip,
  deleteTimetableTerm,
  DONE_ASSIGNMENT_KEEP_MS,
  findTimetableAssignment,
  loadTimetable,
  readTimetableFacts,
  readTimetableHead,
  writeTimetableAssignment,
  writeTimetableCourse,
  writeTimetableImport,
  writeTimetableSettings,
  writeTimetableSkip,
  writeTimetableTerm,
} from './timetable';

/**
 * The timetable store on real SQLite with every migration: the rev bump, owner-guarded upserts, the meeting diff
 * that keeps ids and created_at, the json_each import and assignment plans, the pre-check facts, clear, and the
 * query plans the design relies on.
 * 在执行了全部迁移的真实 SQLite 上测试课表存储：rev 加一、带所有者保护的 upsert、保留 id 和 created_at 的上课时间差异更新、
 * json_each 导入与作业提醒安排、预检查事实、清空，以及设计所依赖的查询计划。
 */

const T0 = Date.parse('2026-10-24T16:00:00.000Z');
const MIN = 60_000;
const A = 'mem_a';
const B = 'mem_b';

function tid(prefix: 'tt' | 'tc' | 'tm' | 'ta', n: number): string {
  return `${prefix}_${String(n).padStart(22, '0')}`;
}

function meeting(n: number, patch: Partial<TimetableMeeting> = {}): TimetableMeeting {
  return { id: tid('tm', n), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 660, location: 'DV 2074', weekRule: 'all', weekList: null, ...patch };
}

function course(n: number, patch: Partial<SaveCourseBody> = {}): SaveCourseBody {
  return { id: tid('tc', n), termId: null, code: 'MAT102H5F', title: 'Calculus', color: 'purple', notes: null, remind: true, meetings: [meeting(n)], ...patch };
}

function addMember(d1: SqliteD1, id: string): void {
  d1.rows(
    "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, 'M', 'h', 'active', 'student', 'student', 2027, ?, ?)",
    id,
    `${id}@mail.utoronto.ca`,
    new Date(T0).toISOString(),
    new Date(T0).toISOString(),
  );
}

function count(d1: SqliteD1, sql: string, ...params: unknown[]): number {
  return Number(d1.rows<{ n: number }>(sql, ...params)[0]?.n ?? 0);
}

describe.skipIf(!sqlite)('timetable store', () => {
  let d1: SqliteD1;

  beforeEach(() => {
    d1 = createSqliteD1();
    addMember(d1, A);
    addMember(d1, B);
  });

  afterEach(() => {
    d1.close();
  });

  describe('head and rev', () => {
    it('reads the defaults and rev 0 for a member who never wrote, and the 课表提醒 switch', async () => {
      expect(await readTimetableHead(d1.db, A)).toEqual({
        rev: 0,
        remindersAllowed: true,
        settings: { classReminders: false, classLeadMin: 10, assignmentOffsets: ['1d', '1h'], showWeekend: 'always', locale: 'zh' },
      });
      d1.rows("INSERT INTO notification_prefs (member_id, messages, events, preview, moments, timetable, updated_at) VALUES (?, 1, 1, 1, 1, 0, 'x')", A);
      expect((await readTimetableHead(d1.db, A)).remindersAllowed).toBe(false);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_settings')).toBe(0);
    });

    it('bumps rev by one on every write, creating the settings row with its defaults', async () => {
      expect((await writeTimetableCourse(d1.db, A, course(1), T0)).rev).toBe(1);
      expect(d1.rows('SELECT rev, class_reminders, class_lead_min, assignment_offsets FROM timetable_settings WHERE member_id = ?', A)).toEqual([
        { rev: 1, class_reminders: 0, class_lead_min: 10, assignment_offsets: '["1d","1h"]' },
      ]);
      expect(await deleteTimetableCourse(d1.db, A, tid('tc', 9), T0 + MIN)).toBe(2);
      expect((await writeTimetableSettings(d1.db, A, { classReminders: true }, T0 + 2 * MIN)).rev).toBe(3);
      expect(await clearTimetable(d1.db, A, T0 + 3 * MIN)).toBe(4);
      expect((await readTimetableHead(d1.db, A)).rev).toBe(4);
      expect((await readTimetableHead(d1.db, B)).rev).toBe(0);
      // Every write batch ends with the bump.
      // 每个写入批次都以 rev 加一结束。
      expect(d1.statements.filter((statement) => statement.sql.includes('INSERT INTO timetable_settings')).length).toBe(4);
    });
  });

  describe('courses and meetings', () => {
    it('stores a course with its meetings and reads it back as the API shape', async () => {
      const saved = await writeTimetableCourse(
        d1.db,
        A,
        course(1, { meetings: [meeting(2, { weekday: 3, kind: 'tut', section: 'TUT0103' }), meeting(1, { weekRule: 'all' })] }),
        T0,
      );
      expect(saved.item.meetings.map((m) => m.id)).toEqual([tid('tm', 1), tid('tm', 2)]);
      const content = await loadTimetable(d1.db, A, T0);
      expect(content.courses).toEqual([saved.item]);
      expect(d1.rows("SELECT typeof(weekday) AS w, typeof(start_min) AS s, week_list FROM timetable_meetings WHERE id = ?", tid('tm', 2))).toEqual([
        { w: 'integer', s: 'integer', week_list: null },
      ]);
    });

    it('keeps meeting ids and created_at across an edit, drops the meetings no longer listed, and keeps their skips', async () => {
      await writeTimetableTerm(d1.db, A, { id: tid('tt', 1), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [7] }, T0);
      await writeTimetableCourse(d1.db, A, course(1, { termId: tid('tt', 1), meetings: [meeting(1), meeting(2, { weekday: 3 })] }), T0);
      await writeTimetableSkip(d1.db, A, { onDate: '2026-10-26', meetingId: tid('tm', 1), label: null }, false, T0);
      const created = d1.rows<{ created_at: string }>('SELECT created_at FROM timetable_meetings WHERE id = ?', tid('tm', 1))[0]?.created_at;

      const edited = course(1, {
        termId: tid('tt', 1),
        code: 'MAT102H5S',
        meetings: [meeting(1, { startMin: 610, endMin: 700, weekRule: 'list', weekList: [1, 3, 5] }), meeting(3, { weekday: 5 })],
      });
      await writeTimetableCourse(d1.db, A, edited, T0 + 10 * MIN);
      expect(d1.rows('SELECT id, start_min, week_rule, week_list, created_at, updated_at FROM timetable_meetings ORDER BY id')).toEqual([
        { id: tid('tm', 1), start_min: 610, week_rule: 'list', week_list: '[1,3,5]', created_at: created, updated_at: new Date(T0 + 10 * MIN).toISOString() },
        { id: tid('tm', 3), start_min: 600, week_rule: 'all', week_list: null, created_at: new Date(T0 + 10 * MIN).toISOString(), updated_at: new Date(T0 + 10 * MIN).toISOString() },
      ]);
      expect(d1.rows('SELECT on_date, meeting_id FROM timetable_skips')).toEqual([{ on_date: '2026-10-26', meeting_id: tid('tm', 1) }]);
      expect(d1.rows('SELECT code, created_at FROM timetable_courses')).toEqual([{ code: 'MAT102H5S', created_at: new Date(T0).toISOString() }]);
    });

    it('never overwrites a course or meeting another member owns, even without the pre-check', async () => {
      await writeTimetableCourse(d1.db, A, course(1), T0);
      // B names A's course id with a new meeting, and A's meeting id on a course of B's own.
      // B 使用 A 的课程 id 并带上新的上课时间，又在 B 自己的课程上使用 A 的上课时间 id。
      await writeTimetableCourse(d1.db, B, course(1, { code: 'HACK', meetings: [meeting(5)] }), T0 + MIN);
      await writeTimetableCourse(d1.db, B, course(2, { meetings: [meeting(1, { startMin: 900, endMin: 960 })] }), T0 + MIN);
      expect(d1.rows('SELECT id, member_id, code FROM timetable_courses ORDER BY id')).toEqual([
        { id: tid('tc', 1), member_id: A, code: 'MAT102H5F' },
        { id: tid('tc', 2), member_id: B, code: 'MAT102H5F' },
      ]);
      expect(d1.rows('SELECT id, course_id, member_id, start_min FROM timetable_meetings ORDER BY id')).toEqual([
        { id: tid('tm', 1), course_id: tid('tc', 1), member_id: A, start_min: 600 },
      ]);
      // B deleting A's course changes nothing.
      // B 删除 A 的课程不会改变任何内容。
      await deleteTimetableCourse(d1.db, B, tid('tc', 1), T0 + 2 * MIN);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_courses WHERE member_id = ?', A)).toBe(1);
    });

    it('cascades a course delete to meetings, single skips and class reminders, and keeps assignments', async () => {
      await writeTimetableCourse(d1.db, A, course(1), T0);
      await writeTimetableSkip(d1.db, A, { onDate: '2026-10-26', meetingId: tid('tm', 1), label: null }, false, T0);
      await writeTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' }, true, T0);
      const assignment = { id: tid('ta', 1), courseId: tid('tc', 1), title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d' as const] };
      await writeTimetableAssignment(d1.db, A, assignment, null, planAssignmentReminders(assignment.dueAt, assignment.remindOffsets, T0), T0);
      d1.rows(
        "INSERT INTO timetable_reminders (member_id, kind, meeting_id, occurs_at, offset_key, send_at, expires_at, status, created_at) VALUES (?, 'class', ?, '2026-10-26T14:00:00.000Z', '10m', '2026-10-26T13:50:00.000Z', '2026-10-26T14:00:00.000Z', 'sent', 'x')",
        A,
        tid('tm', 1),
      );
      await deleteTimetableCourse(d1.db, A, tid('tc', 1), T0 + MIN);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_meetings')).toBe(0);
      expect(d1.rows('SELECT on_date, meeting_id FROM timetable_skips')).toEqual([{ on_date: '2026-10-12', meeting_id: null }]);
      expect(d1.rows('SELECT kind FROM timetable_reminders')).toEqual([{ kind: 'assignment' }]);
      expect(d1.rows('SELECT course_id FROM timetable_assignments')).toEqual([{ course_id: null }]);
    });

    it('deletes a term with its courses', async () => {
      await writeTimetableTerm(d1.db, A, { id: tid('tt', 1), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [] }, T0);
      await writeTimetableCourse(d1.db, A, course(1, { termId: tid('tt', 1) }), T0);
      await writeTimetableCourse(d1.db, A, course(2), T0);
      await deleteTimetableTerm(d1.db, B, tid('tt', 1), T0);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_terms')).toBe(1);
      await deleteTimetableTerm(d1.db, A, tid('tt', 1), T0);
      expect(d1.rows('SELECT id FROM timetable_courses')).toEqual([{ id: tid('tc', 2) }]);
    });
  });

  describe('assignments and their reminders', () => {
    const base = { id: tid('ta', 1), courseId: null, title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: ['1d' as const, '1h' as const] };

    function ledger(): { offset_key: string; send_at: string; occurs_at: string; expires_at: string; status: string }[] {
      return d1.rows('SELECT offset_key, send_at, occurs_at, expires_at, status FROM timetable_reminders ORDER BY send_at');
    }

    it('plans one pending row per offset, expiring at the due time', async () => {
      const saved = await writeTimetableAssignment(d1.db, A, base, null, planAssignmentReminders(base.dueAt, base.remindOffsets, T0), T0);
      expect(saved.item).toEqual({ ...base, doneAt: null, updatedAt: new Date(T0).toISOString() });
      expect(ledger()).toEqual([
        { offset_key: '1d', send_at: '2026-10-30T03:59:00.000Z', occurs_at: base.dueAt, expires_at: base.dueAt, status: 'pending' },
        { offset_key: '1h', send_at: '2026-10-31T02:59:00.000Z', occurs_at: base.dueAt, expires_at: base.dueAt, status: 'pending' },
      ]);
    });

    it('replaces pending rows on a re-save, never repeats one already sent, and plans a new due time afresh', async () => {
      await writeTimetableAssignment(d1.db, A, base, null, planAssignmentReminders(base.dueAt, base.remindOffsets, T0), T0);
      d1.rows("UPDATE timetable_reminders SET status = 'sent' WHERE offset_key = '1d'");
      await writeTimetableAssignment(d1.db, A, base, null, planAssignmentReminders(base.dueAt, base.remindOffsets, T0), T0 + MIN);
      expect(ledger().map((row) => `${row.offset_key}:${row.status}`)).toEqual(['1d:sent', '1h:pending']);

      const moved = { ...base, dueAt: '2026-11-02T04:59:00.000Z' };
      await writeTimetableAssignment(d1.db, A, moved, null, planAssignmentReminders(moved.dueAt, moved.remindOffsets, T0), T0 + 2 * MIN);
      expect(ledger().map((row) => `${row.offset_key}:${row.occurs_at}:${row.status}`)).toEqual([
        `1d:${base.dueAt}:sent`,
        `1d:${moved.dueAt}:pending`,
        `1h:${moved.dueAt}:pending`,
      ]);
    });

    it('deletes the pending rows once done, keeps them deleted while done, and finds the assignment with the open count', async () => {
      await writeTimetableAssignment(d1.db, A, base, null, planAssignmentReminders(base.dueAt, base.remindOffsets, T0), T0);
      const done = new Date(T0 + MIN).toISOString();
      await writeTimetableAssignment(d1.db, A, base, done, [], T0 + MIN);
      expect(ledger()).toEqual([]);
      expect(await findTimetableAssignment(d1.db, A, base.id)).toEqual({
        assignment: { ...base, doneAt: done, updatedAt: done },
        openAssignments: 0,
      });
      expect(await findTimetableAssignment(d1.db, B, base.id)).toBeNull();
    });

    it('never writes an assignment another member owns or plans reminders for it', async () => {
      await writeTimetableAssignment(d1.db, A, base, null, [], T0);
      await writeTimetableAssignment(d1.db, B, { ...base, title: 'HACK' }, null, planAssignmentReminders(base.dueAt, base.remindOffsets, T0), T0);
      expect(d1.rows('SELECT member_id, title FROM timetable_assignments')).toEqual([{ member_id: A, title: 'PS3' }]);
      expect(ledger()).toEqual([]);
      await deleteTimetableAssignment(d1.db, B, base.id, T0);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_assignments')).toBe(1);
    });

    it('links only a course of the member, so a course deleted after the pre-check leaves the assignment without one', async () => {
      await writeTimetableCourse(d1.db, A, course(1), T0);
      await writeTimetableCourse(d1.db, B, course(2), T0);
      await writeTimetableAssignment(d1.db, A, { ...base, courseId: tid('tc', 1) }, null, [], T0);
      await writeTimetableAssignment(d1.db, A, { ...base, id: tid('ta', 2), courseId: tid('tc', 9) }, null, [], T0);
      await writeTimetableAssignment(d1.db, A, { ...base, id: tid('ta', 3), courseId: tid('tc', 2) }, null, [], T0);
      await writeTimetableImport(
        d1.db,
        A,
        { terms: [], courses: [course(4)], skips: [] },
        [tid('tc', 4), tid('tc', 8), tid('tc', 2)].map((courseId, i) => ({ assignment: { ...base, id: tid('ta', 10 + i), courseId }, doneAt: null, plan: [] })),
        T0,
      );
      expect(d1.rows('SELECT id, course_id FROM timetable_assignments ORDER BY id')).toEqual([
        { id: tid('ta', 1), course_id: tid('tc', 1) },
        { id: tid('ta', 2), course_id: null },
        { id: tid('ta', 3), course_id: null },
        { id: tid('ta', 10), course_id: tid('tc', 4) },
        { id: tid('ta', 11), course_id: null },
        { id: tid('ta', 12), course_id: null },
      ]);
    });

    it('lists open assignments and those done in the last 30 days, by due time', async () => {
      const at = (n: number, dueAt: string, doneAt: string | null) =>
        writeTimetableAssignment(d1.db, A, { ...base, id: tid('ta', n), dueAt, remindOffsets: [] }, doneAt, [], T0);
      await at(1, '2026-11-05T04:59:00.000Z', null);
      await at(2, '2026-10-20T04:59:00.000Z', new Date(T0 - DONE_ASSIGNMENT_KEEP_MS + MIN).toISOString());
      await at(3, '2026-09-20T04:59:00.000Z', new Date(T0 - DONE_ASSIGNMENT_KEEP_MS - MIN).toISOString());
      expect((await loadTimetable(d1.db, A, T0)).assignments.map((item) => item.id)).toEqual([tid('ta', 2), tid('ta', 1)]);
    });
  });

  describe('skips', () => {
    beforeEach(async () => {
      await writeTimetableCourse(d1.db, A, course(1), T0);
    });

    it('keeps one row per date and meeting, changing the label only when one is given', async () => {
      const holiday = { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' };
      expect((await writeTimetableSkip(d1.db, A, holiday, true, T0)).item).toEqual(holiday);
      expect((await writeTimetableSkip(d1.db, A, { ...holiday, label: null }, false, T0)).item).toEqual(holiday);
      expect((await writeTimetableSkip(d1.db, A, { ...holiday, label: '感恩节' }, true, T0)).item).toEqual({ ...holiday, label: '感恩节' });
      expect((await writeTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: tid('tm', 1), label: null }, false, T0)).item).toEqual({
        onDate: '2026-10-12',
        meetingId: tid('tm', 1),
        label: null,
      });
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_skips')).toBe(2);

      await deleteTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: null }, T0);
      expect(d1.rows('SELECT meeting_id FROM timetable_skips')).toEqual([{ meeting_id: tid('tm', 1) }]);
      await deleteTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: tid('tm', 1) }, T0);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_skips')).toBe(0);
    });

    it('writes nothing for a meeting another member owns', async () => {
      const saved = await writeTimetableSkip(d1.db, B, { onDate: '2026-10-19', meetingId: tid('tm', 1), label: null }, false, T0);
      expect(saved.item).toBeNull();
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_skips')).toBe(0);
    });
  });

  describe('settings', () => {
    it('changes only the fields present and keeps the rest', async () => {
      expect((await writeTimetableSettings(d1.db, A, { classReminders: true, classLeadMin: 15 }, T0)).item).toEqual({
        classReminders: true,
        classLeadMin: 15,
        assignmentOffsets: ['1d', '1h'],
        showWeekend: 'always',
        locale: 'zh',
      });
      const saved = await writeTimetableSettings(d1.db, A, { assignmentOffsets: [], showWeekend: 'auto', locale: 'en' }, T0 + MIN);
      expect(saved).toEqual({ rev: 2, item: { classReminders: true, classLeadMin: 15, assignmentOffsets: [], showWeekend: 'auto', locale: 'en' } });
      expect((await readTimetableHead(d1.db, A)).settings).toEqual(saved.item);
    });
  });

  describe('pre-check facts', () => {
    it('reads the owner of every named id, the meeting courses, the skips the member has and the counts asked for', async () => {
      await writeTimetableTerm(d1.db, A, { id: tid('tt', 1), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [] }, T0);
      await writeTimetableCourse(d1.db, A, course(1, { termId: tid('tt', 1) }), T0);
      await writeTimetableCourse(d1.db, B, course(2), T0);
      await writeTimetableAssignment(d1.db, A, { id: tid('ta', 1), courseId: null, title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: [] }, null, [], T0);
      await writeTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: null, label: null }, false, T0);
      await writeTimetableSkip(d1.db, A, { onDate: '2026-10-19', meetingId: tid('tm', 1), label: null }, false, T0);
      await writeTimetableSkip(d1.db, B, { onDate: '2026-10-26', meetingId: null, label: null }, false, T0);

      const facts = await readTimetableFacts(d1.db, A, {
        termIds: [tid('tt', 1), tid('tt', 9)],
        courseIds: [tid('tc', 1), tid('tc', 2)],
        meetingIds: [tid('tm', 1), tid('tm', 2), tid('tm', 9)],
        assignmentIds: [tid('ta', 1)],
        skips: [
          { onDate: '2026-10-12', meetingId: null },
          { onDate: '2026-10-19', meetingId: tid('tm', 1) },
          { onDate: '2026-10-19', meetingId: null },
          { onDate: '2026-10-26', meetingId: null },
        ],
        counts: ['terms', 'courses', 'openAssignments', 'assignments', 'skips'],
        nowMs: T0,
      });
      expect(facts.terms).toEqual(new Map([[tid('tt', 1), A]]));
      expect(facts.courses).toEqual(new Map([[tid('tc', 1), A], [tid('tc', 2), B]]));
      expect(facts.meetings).toEqual(
        new Map([
          [tid('tm', 1), { memberId: A, courseId: tid('tc', 1) }],
          [tid('tm', 2), { memberId: B, courseId: tid('tc', 2) }],
        ]),
      );
      expect(facts.assignments).toEqual(new Map([[tid('ta', 1), { memberId: A, doneAt: null }]]));
      expect(facts.skips).toEqual(new Set(['2026-10-12|*', `2026-10-19|${tid('tm', 1)}`]));
      expect(facts.counts).toEqual({ terms: 1, courses: 1, openAssignments: 1, assignments: 1, skips: 2 });

      // An import names every kind and asks every count: still at most five terms per compound SELECT, as D1 allows,
      // in one batch of two statements. Nothing at all is read when nothing is asked.
      // 导入会涉及每一类 id 并询问全部数量：每个复合 SELECT 仍最多五项（D1 的上限），一次批量两条语句。什么都不问时完全不查询。
      const wide = d1.statements.slice(-2);
      expect(wide.map((s) => compoundTerms(s.sql))).toEqual([5, 1]);
      const before = d1.statements.length;
      await readTimetableFacts(d1.db, A, { courseIds: [tid('tc', 1)], counts: ['courses'] });
      expect(d1.statements.length).toBe(before + 2);
      await readTimetableFacts(d1.db, A, { courseIds: [tid('tc', 1)] });
      expect(d1.statements.length).toBe(before + 3);
      await readTimetableFacts(d1.db, A, { courseIds: [], meetingIds: [] });
      expect(d1.statements.length).toBe(before + 3);
    });

    it('counts the assignments GET returns: open ones and those done in the last 30 days, of this member only', async () => {
      const at = (memberId: string, n: number, doneAt: string | null) =>
        writeTimetableAssignment(d1.db, memberId, { id: tid('ta', n), courseId: null, title: 'PS3', notes: null, dueAt: '2026-10-31T03:59:00.000Z', remindOffsets: [] }, doneAt, [], T0);
      await at(A, 1, null);
      await at(A, 2, new Date(T0 - DONE_ASSIGNMENT_KEEP_MS + MIN).toISOString());
      await at(A, 3, new Date(T0 - DONE_ASSIGNMENT_KEEP_MS - MIN).toISOString());
      await at(B, 4, null);
      const facts = await readTimetableFacts(d1.db, A, { assignmentIds: [tid('ta', 3)], counts: ['assignments', 'openAssignments'], nowMs: T0 });
      expect(facts.counts).toMatchObject({ assignments: 2, openAssignments: 1 });
      expect((await loadTimetable(d1.db, A, T0)).assignments).toHaveLength(facts.counts.assignments);
      // The stored row past the window is still found by id, so saving it again is an update, not a new row.
      // 超出窗口的已存行仍能按 id 找到，因此再次保存它是更新，而不是新的行。
      expect(facts.assignments.get(tid('ta', 3))?.memberId).toBe(A);
      // A day later, the item done 30 days less a minute ago has left the window too.
      // 一天之后，30 天减一分钟之前完成的作业也离开了窗口。
      expect((await readTimetableFacts(d1.db, A, { counts: ['assignments'], nowMs: T0 + 86_400_000 })).counts.assignments).toBe(1);
    });
  });

  describe('import', () => {
    it('writes every kind through json_each with the stored types, and plans the open assignments', async () => {
      const due = '2026-11-06T04:59:00.000Z';
      await writeTimetableImport(
        d1.db,
        A,
        {
          terms: [{ id: tid('tt', 1), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [7] }],
          courses: [
            course(1, { termId: tid('tt', 1), meetings: [meeting(1, { weekRule: 'odd' }), meeting(2, { weekday: 3, weekRule: 'list', weekList: [2, 4] })] }),
            course(2, { remind: false, meetings: [] }),
          ],
          skips: [
            { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
            { onDate: '2026-10-21', meetingId: tid('tm', 2) },
          ],
        },
        [
          {
            assignment: { id: tid('ta', 1), courseId: tid('tc', 1), title: 'PS3', notes: '第一行\n第二行', dueAt: due, remindOffsets: ['1d', '1h'] },
            doneAt: null,
            plan: planAssignmentReminders(due, ['1d', '1h'], T0),
          },
          {
            assignment: { id: tid('ta', 2), courseId: null, title: 'Lab', notes: null, dueAt: due, remindOffsets: ['1h'] },
            doneAt: new Date(T0).toISOString(),
            plan: [],
          },
        ],
        T0,
      );
      expect(d1.rows('SELECT id, skip_weeks FROM timetable_terms')).toEqual([{ id: tid('tt', 1), skip_weeks: '[7]' }]);
      expect(d1.rows('SELECT id, term_id, remind, typeof(remind) AS t FROM timetable_courses ORDER BY id')).toEqual([
        { id: tid('tc', 1), term_id: tid('tt', 1), remind: 1, t: 'integer' },
        { id: tid('tc', 2), term_id: null, remind: 0, t: 'integer' },
      ]);
      expect(d1.rows('SELECT id, course_id, weekday, typeof(weekday) AS t, week_rule, week_list, section FROM timetable_meetings ORDER BY id')).toEqual([
        { id: tid('tm', 1), course_id: tid('tc', 1), weekday: 1, t: 'integer', week_rule: 'odd', week_list: null, section: null },
        { id: tid('tm', 2), course_id: tid('tc', 1), weekday: 3, t: 'integer', week_rule: 'list', week_list: '[2,4]', section: null },
      ]);
      expect(d1.rows('SELECT on_date, meeting_id, label FROM timetable_skips ORDER BY on_date')).toEqual([
        { on_date: '2026-10-12', meeting_id: null, label: 'Thanksgiving' },
        { on_date: '2026-10-21', meeting_id: tid('tm', 2), label: null },
      ]);
      expect(d1.rows('SELECT id, notes, remind_offsets, done_at FROM timetable_assignments ORDER BY id')).toEqual([
        { id: tid('ta', 1), notes: '第一行\n第二行', remind_offsets: '["1d","1h"]', done_at: null },
        { id: tid('ta', 2), notes: null, remind_offsets: '["1h"]', done_at: new Date(T0).toISOString() },
      ]);
      expect(d1.rows('SELECT assignment_id, offset_key, send_at FROM timetable_reminders ORDER BY send_at')).toEqual([
        { assignment_id: tid('ta', 1), offset_key: '1d', send_at: '2026-11-05T04:59:00.000Z' },
        { assignment_id: tid('ta', 1), offset_key: '1h', send_at: '2026-11-06T03:59:00.000Z' },
      ]);
      const content = await loadTimetable(d1.db, A, T0);
      expect(content.courses[0]?.meetings[1]).toEqual(meeting(2, { weekday: 3, weekRule: 'list', weekList: [2, 4] }));
      expect(content.terms[0]?.skipWeeks).toEqual([7]);
    });

    it('updates a course it names again as a save would, and leaves the rows of another member alone', async () => {
      await writeTimetableCourse(d1.db, A, course(1, { meetings: [meeting(1), meeting(2)] }), T0);
      await writeTimetableCourse(d1.db, B, course(5), T0);
      await writeTimetableImport(
        d1.db,
        A,
        { terms: [], courses: [course(1, { meetings: [meeting(2, { startMin: 900, endMin: 960 })] }), course(5, { code: 'HACK', meetings: [meeting(8)] })], skips: [] },
        [],
        T0 + MIN,
      );
      expect(d1.rows('SELECT id, member_id, start_min FROM timetable_meetings ORDER BY id')).toEqual([
        { id: tid('tm', 2), member_id: A, start_min: 900 },
        { id: tid('tm', 5), member_id: B, start_min: 600 },
      ]);
      expect(d1.rows('SELECT member_id, code FROM timetable_courses WHERE id = ?', tid('tc', 5))).toEqual([{ member_id: B, code: 'MAT102H5F' }]);
    });

    it('writes a thousand assignments in slices of one batch', async () => {
      const assignments = Array.from({ length: 1000 }, (_, i) => ({
        assignment: { id: tid('ta', i + 1), courseId: null, title: `Item ${i}`, notes: null, dueAt: '2026-11-06T04:59:00.000Z', remindOffsets: [] },
        doneAt: new Date(T0).toISOString(),
        plan: [],
      }));
      const before = d1.statements.length;
      await writeTimetableImport(d1.db, A, { terms: [], courses: [], skips: [] }, assignments, T0);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_assignments')).toBe(1000);
      expect(d1.statements.length - before).toBeLessThanOrEqual(9);
    });
  });

  it('clears everything but the settings', async () => {
    await writeTimetableSettings(d1.db, A, { classReminders: true }, T0);
    await writeTimetableTerm(d1.db, A, { id: tid('tt', 1), name: 'Fall', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [] }, T0);
    await writeTimetableCourse(d1.db, A, course(1, { termId: tid('tt', 1) }), T0);
    await writeTimetableCourse(d1.db, A, course(2), T0);
    await writeTimetableCourse(d1.db, B, course(3), T0);
    const due = '2026-11-06T04:59:00.000Z';
    await writeTimetableAssignment(d1.db, A, { id: tid('ta', 1), courseId: tid('tc', 1), title: 'PS3', notes: null, dueAt: due, remindOffsets: ['1d'] }, null, planAssignmentReminders(due, ['1d'], T0), T0);
    await writeTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: null, label: null }, false, T0);
    await clearTimetable(d1.db, A, T0 + MIN);
    for (const table of ['timetable_terms', 'timetable_courses', 'timetable_meetings', 'timetable_skips', 'timetable_assignments', 'timetable_reminders']) {
      expect(count(d1, `SELECT count(*) AS n FROM ${table} WHERE member_id = ?`, A)).toBe(0);
    }
    expect(count(d1, 'SELECT count(*) AS n FROM timetable_courses WHERE member_id = ?', B)).toBe(1);
    expect((await readTimetableHead(d1.db, A)).settings.classReminders).toBe(true);
  });

  it('uses the indexes the design names', async () => {
    await writeTimetableCourse(d1.db, A, course(1), T0);
    const due = '2026-11-06T04:59:00.000Z';
    await writeTimetableAssignment(d1.db, A, { id: tid('ta', 1), courseId: null, title: 'PS3', notes: null, dueAt: due, remindOffsets: ['1d'] }, null, planAssignmentReminders(due, ['1d'], T0), T0);
    await deleteTimetableSkip(d1.db, A, { onDate: '2026-10-12', meetingId: null }, T0);
    await readTimetableFacts(d1.db, A, { skips: [{ onDate: '2026-10-12', meetingId: null }] });
    await loadTimetable(d1.db, A, T0);
    const plan = (fragment: string) => {
      const statement = d1.statements.find((item) => item.sql.includes(fragment));
      if (!statement) throw new Error(`no statement with ${fragment}`);
      return d1.explain(statement).join('\n');
    };
    expect(plan("DELETE FROM timetable_reminders WHERE assignment_id = ?1")).toMatch(/USING INDEX timetable_reminders_assignment/);
    expect(plan('DELETE FROM timetable_skips')).toMatch(/USING INDEX timetable_skips_key/);
    expect(plan("SELECT 'skip' AS kind")).toMatch(/timetable_skips_key/);
    expect(plan('FROM timetable_assignments\n')).toMatch(/USING INDEX timetable_assignments_member/);
    expect(plan('FROM timetable_meetings WHERE member_id')).toMatch(/USING INDEX timetable_meetings_member/);
  });
});
