import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enrollmentCalendarYear,
  TIMETABLE_LIMITS,
  TIMETABLE_MESSAGES,
  type SaveAssignmentBody,
  type SaveCourseBody,
  type SaveTermBody,
  type TimetableMeeting,
  type TimetableResponse,
} from '@utmmsc/shared';
import { issueSessionToken } from '../../../domain/identity/session-token';
import type { Env } from '../../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
import { createApp } from '../../app';
import { homeRoutes } from './index';
import { TIMETABLE_IMPORT_WINDOW_MS, TIMETABLE_IMPORTS_PER_WINDOW, TIMETABLE_WRITES_PER_MINUTE } from './timetable';

/**
 * The /home/timetable routes end to end: the real app, the real session check and every statement on SQLite
 * with all migrations, so ownership guards, limits, reminder plans and the 503 before migration 0017 behave as
 * on D1.
 * 端到端测试 /home/timetable 接口：真实的应用、真实的登录检查，所有语句都运行在执行了全部迁移的 SQLite 上，
 * 因此所有者保护、上限、提醒安排以及迁移 0017 之前的 503 都与 D1 上的行为一致。
 */

const SECRET = 'test-session-secret';
const T0 = Date.parse('2026-10-24T16:00:00.000Z');
const MIN = 60_000;

function tid(prefix: 'tt' | 'tc' | 'tm' | 'ta', n: number): string {
  return `${prefix}_${String(n).padStart(22, '0')}`;
}

function meeting(n: number, patch: Partial<TimetableMeeting> = {}): TimetableMeeting {
  return { id: tid('tm', n), kind: 'lec', section: null, weekday: 1, startMin: 600, endMin: 660, location: 'DV 2074', weekRule: 'all', weekList: null, ...patch };
}

function course(n: number, patch: Partial<SaveCourseBody> = {}): SaveCourseBody {
  return { id: tid('tc', n), termId: null, code: 'MAT102H5F', title: null, color: 'purple', notes: null, remind: true, meetings: [meeting(n)], ...patch };
}

function term(n: number, patch: Partial<SaveTermBody> = {}): SaveTermBody {
  return { id: tid('tt', n), name: '2026 秋季', startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [7], ...patch };
}

/** Due Friday 2026-10-30 23:59 Toronto time (EDT). */
/** 多伦多时间 2026-10-30（周五）23:59（夏令时）截止。 */
const DUE = '2026-10-31T03:59:00.000Z';

function assignment(n: number, patch: Partial<SaveAssignmentBody> = {}): SaveAssignmentBody {
  return { id: tid('ta', n), courseId: null, title: 'PS3', notes: null, dueAt: DUE, remindOffsets: ['1d', '1h'], ...patch };
}

/** Each test signs in fresh members, so the per-member write limit of one test never reaches another. */
/** 每个测试都使用新的成员登录，一个测试的按成员写入限制不会影响另一个测试。 */
let memberSeq = 0;

interface Who {
  id: string;
  token: string;
}

interface World {
  d1: SqliteD1;
  a: Who;
  b: Who;
}

async function signIn(d1: SqliteD1, id: string): Promise<Who> {
  const now = new Date().toISOString();
  d1.rows(
    "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, '张三', 'x', 'active', 'student', 'student', ?, ?, ?)",
    id,
    `${id}@mail.utoronto.ca`,
    enrollmentCalendarYear(),
    now,
    now,
  );
  d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `ses_${id}`, id, new Date(Date.now() + 86_400_000).toISOString(), now);
  return { id, token: await issueSessionToken(SECRET, `ses_${id}`, id, new Date(Date.now() + 3_600_000)) };
}

async function world(to?: number): Promise<World> {
  const d1 = createSqliteD1({ migrate: false });
  d1.migrate(to === undefined ? {} : { to });
  memberSeq += 1;
  return { d1, a: await signIn(d1, `mem_a${memberSeq}`), b: await signIn(d1, `mem_b${memberSeq}`) };
}

interface Answer<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

const app = createApp();

async function call<T = Record<string, unknown>>(d1: SqliteD1, who: Who | null, method: string, path: string, body?: unknown): Promise<Answer<T>> {
  const env = { DB: d1.db, SESSION_SECRET: SECRET, APP_ORIGIN: 'https://utmmsc.com' } as unknown as Env;
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${who.token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await app.request(
    `/home/timetable${path}`,
    { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) },
    env,
    ctx,
  );
  return { status: response.status, body: (await response.json()) as T, headers: response.headers };
}

function refusal(code: keyof typeof TIMETABLE_MESSAGES) {
  return { error: { code, message: TIMETABLE_MESSAGES[code] } };
}

function count(d1: SqliteD1, sql: string, ...params: unknown[]): number {
  return Number(d1.rows<{ n: number }>(sql, ...params)[0]?.n ?? 0);
}

function timetableWrites(d1: SqliteD1): string[] {
  return d1.statements.map((statement) => statement.sql.trim()).filter((sql) => /^(INSERT|UPDATE|DELETE)\b/i.test(sql) && sql.includes('timetable_'));
}

describe('timetable routes', () => {
  it('mounts every route of the design under /home/timetable', () => {
    const paths = new Set(homeRoutes.routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`));
    for (const route of [
      'GET /timetable',
      'POST /timetable/courses',
      'DELETE /timetable/courses/:id',
      'POST /timetable/terms',
      'DELETE /timetable/terms/:id',
      'POST /timetable/assignments',
      'PATCH /timetable/assignments/:id',
      'DELETE /timetable/assignments/:id',
      'POST /timetable/skips',
      'PATCH /timetable/settings',
      'POST /timetable/import',
      'POST /timetable/clear',
    ]) {
      expect(paths).toContain(route);
    }
  });
});

describe.skipIf(!sqlite)('timetable routes on SQLite', () => {
  let w: World;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    w = await world();
  });

  afterEach(() => {
    w.d1.close();
    vi.useRealTimers();
  });

  describe('sessions', () => {
    it('answers 401 without a session, for reads and writes alike', async () => {
      expect((await call(w.d1, null, 'GET', '')).status).toBe(401);
      expect((await call(w.d1, null, 'POST', '/courses', course(1))).status).toBe(401);
      expect((await call(w.d1, null, 'POST', '/clear')).status).toBe(401);
      expect((await call(w.d1, { id: w.a.id, token: 'forged' }, 'GET', '')).status).toBe(401);
      expect(timetableWrites(w.d1)).toEqual([]);
    });
  });

  describe('GET', () => {
    it('returns the defaults and rev 0 for a member who never wrote, and writes nothing', async () => {
      const answer = await call<TimetableResponse>(w.d1, w.a, 'GET', '');
      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        rev: 0,
        remindersAllowed: true,
        settings: { classReminders: false, classLeadMin: 10, assignmentOffsets: ['1d', '1h'], showWeekend: 'always', locale: 'zh' },
        terms: [],
        courses: [],
        skips: [],
        assignments: [],
      });
      expect(answer.headers.get('cache-control')).toBe('private, no-store');
      expect(timetableWrites(w.d1)).toEqual([]);
    });

    it("answers unchanged while ?rev is the member's rev, with the 课表提醒 switch", async () => {
      expect((await call(w.d1, w.a, 'GET', '?rev=0')).body).toEqual({ rev: 0, unchanged: true, remindersAllowed: true });
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      expect((await call<TimetableResponse>(w.d1, w.a, 'GET', '?rev=0')).body.courses).toHaveLength(1);
      expect((await call(w.d1, w.a, 'GET', '?rev=1')).body).toEqual({ rev: 1, unchanged: true, remindersAllowed: true });
      // The switch lives in the notification prefs and does not bump rev, so the unchanged answer carries it.
      // 这个开关在通知设置里，不会让 rev 增加，所以「没有变化」的应答也带上它。
      w.d1.rows("INSERT INTO notification_prefs (member_id, messages, events, preview, moments, timetable, updated_at) VALUES (?, 1, 1, 1, 1, 0, 'x')", w.a.id);
      expect((await call(w.d1, w.a, 'GET', '?rev=1')).body).toEqual({ rev: 1, unchanged: true, remindersAllowed: false });
      expect((await call(w.d1, w.a, 'GET', '?rev=nonsense')).body).toMatchObject({ rev: 1, remindersAllowed: false, courses: [{ id: tid('tc', 1) }] });
      // B has their own rev.
      // B 有自己的 rev。
      expect((await call(w.d1, w.b, 'GET', '?rev=0')).body).toEqual({ rev: 0, unchanged: true, remindersAllowed: true });
    });
  });

  describe('courses', () => {
    it('saves a course with its meetings, cleaned, and returns it with the new rev', async () => {
      const answer = await call(w.d1, w.a, 'POST', '/courses', { ...course(1), code: ' mat102h5f ', title: '  Calculus\u0007 ', meetings: [meeting(2, { weekday: 3 }), meeting(1)] });
      expect(answer.status).toBe(200);
      const item = { ...course(1), title: 'Calculus', meetings: [meeting(1), meeting(2, { weekday: 3 })], updatedAt: new Date(T0).toISOString() };
      expect(answer.body).toEqual({ rev: 1, item });
      expect((await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body.courses).toEqual([item]);
    });

    it('refuses an id another member owns with 409, changing and echoing nothing', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1, { title: 'Secret title', notes: 'secret notes' }));
      const before = w.d1.rows('SELECT * FROM timetable_courses ORDER BY id');
      const meetingsBefore = w.d1.rows('SELECT * FROM timetable_meetings ORDER BY id');

      const takenCourse = await call(w.d1, w.b, 'POST', '/courses', course(1, { code: 'HACK', meetings: [] }));
      expect(takenCourse).toMatchObject({ status: 409, body: refusal('id_taken') });
      const takenMeeting = await call(w.d1, w.b, 'POST', '/courses', course(2, { meetings: [meeting(1, { startMin: 900, endMin: 960 })] }));
      expect(takenMeeting).toMatchObject({ status: 409, body: refusal('id_taken') });
      expect(JSON.stringify(takenCourse.body)).not.toContain('Secret');

      expect(w.d1.rows('SELECT * FROM timetable_courses ORDER BY id')).toEqual(before);
      expect(w.d1.rows('SELECT * FROM timetable_meetings ORDER BY id')).toEqual(meetingsBefore);
      expect((await call(w.d1, w.b, 'GET', '?rev=0')).body).toMatchObject({ rev: 0, unchanged: true });
      // Deleting it as B answers as if it were gone and leaves it.
      // B 删除它时按已不存在回答，并保留原样。
      expect((await call(w.d1, w.b, 'DELETE', `/courses/${tid('tc', 1)}`)).status).toBe(200);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_courses')).toBe(1);
    });

    it('refuses a meeting id the member already uses on another course', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      expect(await call(w.d1, w.a, 'POST', '/courses', course(2, { meetings: [meeting(1)] }))).toMatchObject({ status: 409, body: refusal('id_taken') });
    });

    it("needs the term to be the member's own", async () => {
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { termId: tid('tt', 1) }))).toMatchObject({ status: 404, body: refusal('term_not_found') });
      await call(w.d1, w.b, 'POST', '/terms', term(1));
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { termId: tid('tt', 1) }))).toMatchObject({ status: 404, body: refusal('term_not_found') });
      await call(w.d1, w.a, 'POST', '/terms', term(2));
      expect((await call(w.d1, w.a, 'POST', '/courses', course(1, { termId: tid('tt', 2), meetings: [meeting(1, { weekRule: 'odd' })] }))).status).toBe(200);
    });

    it('refuses odd, even and custom weeks without a term, and bad meeting times', async () => {
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { meetings: [meeting(1, { weekRule: 'even' })] }))).toMatchObject({ status: 400, body: refusal('invalid_weeks') });
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { meetings: [meeting(1, { startMin: 535, endMin: 600 })] }))).toMatchObject({
        status: 400,
        body: refusal('invalid_meeting_time'),
      });
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { meetings: [meeting(1, { startMin: 600, endMin: 605 })] }))).toMatchObject({
        status: 400,
        body: refusal('meeting_too_short'),
      });
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { code: 'X'.repeat(21) }))).toMatchObject({ status: 400, body: refusal('invalid_course_code') });
      expect(await call(w.d1, w.a, 'POST', '/courses', { ...course(1), id: 'tc_1' })).toMatchObject({ status: 400, body: refusal('invalid_id') });
      expect(await call(w.d1, w.a, 'POST', '/courses', '{not json')).toMatchObject({ status: 400, body: { error: { code: 'invalid_json' } } });
      expect(timetableWrites(w.d1)).toEqual([]);
    });

    it('keeps meeting ids, created_at and single skips across an edit', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1, { meetings: [meeting(1), meeting(2, { weekday: 3 })] }));
      await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-26', meetingId: tid('tm', 1), skipped: true });
      vi.setSystemTime(T0 + 5 * MIN);
      const edited = await call<{ rev: number }>(w.d1, w.a, 'POST', '/courses', course(1, { meetings: [meeting(1, { startMin: 610, endMin: 700 })] }));
      expect(edited.body.rev).toBe(3);
      expect(w.d1.rows('SELECT id, start_min, created_at, updated_at FROM timetable_meetings')).toEqual([
        { id: tid('tm', 1), start_min: 610, created_at: new Date(T0).toISOString(), updated_at: new Date(T0 + 5 * MIN).toISOString() },
      ]);
      expect(w.d1.rows('SELECT on_date, meeting_id FROM timetable_skips')).toEqual([{ on_date: '2026-10-26', meeting_id: tid('tm', 1) }]);
    });

    it('stops a new course past the limit and still saves an existing one', async () => {
      const now = new Date(T0).toISOString();
      for (let n = 1; n <= TIMETABLE_LIMITS.courses; n += 1) {
        w.d1.rows("INSERT INTO timetable_courses (id, member_id, code, color, created_at, updated_at) VALUES (?, ?, 'C', 'blue', ?, ?)", tid('tc', n), w.a.id, now, now);
      }
      expect(await call(w.d1, w.a, 'POST', '/courses', course(99))).toMatchObject({ status: 400, body: refusal('too_many_courses') });
      expect((await call(w.d1, w.a, 'POST', '/courses', course(1))).status).toBe(200);
      expect((await call(w.d1, w.b, 'POST', '/courses', course(99))).status).toBe(200);
      const many = Array.from({ length: TIMETABLE_LIMITS.meetingsPerCourse + 1 }, (_, i) => meeting(200 + i));
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1, { meetings: many }))).toMatchObject({ status: 400, body: refusal('too_many_meetings') });
    });

    it('deletes a course idempotently, keeping its assignments without a course', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { courseId: tid('tc', 1) }));
      expect((await call(w.d1, w.a, 'DELETE', `/courses/${tid('tc', 1)}`)).body).toEqual({ rev: 3, item: null });
      expect((await call(w.d1, w.a, 'DELETE', `/courses/${tid('tc', 1)}`)).body).toEqual({ rev: 4, item: null });
      expect(w.d1.rows('SELECT course_id FROM timetable_assignments')).toEqual([{ course_id: null }]);
      expect(await call(w.d1, w.a, 'DELETE', `/courses/${tid('ta', 1)}`)).toMatchObject({ status: 400, body: refusal('invalid_id') });
    });
  });

  describe('terms', () => {
    it("saves a term, refuses another member's id, stops at six, and deletes with its courses", async () => {
      expect((await call(w.d1, w.a, 'POST', '/terms', term(1))).body).toEqual({ rev: 1, item: { ...term(1), updatedAt: new Date(T0).toISOString() } });
      expect(await call(w.d1, w.b, 'POST', '/terms', term(1))).toMatchObject({ status: 409, body: refusal('id_taken') });
      expect(await call(w.d1, w.a, 'POST', '/terms', term(2, { endsOn: '2027-09-03' }))).toMatchObject({ status: 400, body: refusal('invalid_term') });
      for (let n = 2; n <= TIMETABLE_LIMITS.terms; n += 1) expect((await call(w.d1, w.a, 'POST', '/terms', term(n))).status).toBe(200);
      expect(await call(w.d1, w.a, 'POST', '/terms', term(7))).toMatchObject({ status: 400, body: refusal('too_many_terms') });
      expect((await call(w.d1, w.a, 'POST', '/terms', term(1, { name: '2026 Fall' }))).status).toBe(200);

      await call(w.d1, w.a, 'POST', '/courses', course(1, { termId: tid('tt', 1) }));
      await call(w.d1, w.a, 'DELETE', `/terms/${tid('tt', 1)}`);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_courses')).toBe(0);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_terms')).toBe(TIMETABLE_LIMITS.terms - 1);
    });
  });

  describe('assignments', () => {
    function ledger(d1: SqliteD1): string[] {
      return d1
        .rows<{ offset_key: string; send_at: string; status: string }>('SELECT offset_key, send_at, status FROM timetable_reminders ORDER BY send_at, offset_key')
        .map((row) => `${row.offset_key} ${row.send_at} ${row.status}`);
    }

    it('plans the reminders in the save, at the expected times', async () => {
      const answer = await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { remindOffsets: ['1h', 'morning', '1d'] }));
      expect(answer.body).toEqual({
        rev: 1,
        item: { ...assignment(1), remindOffsets: ['1d', 'morning', '1h'], doneAt: null, updatedAt: new Date(T0).toISOString() },
      });
      // 1d keeps 23:59 Toronto the day before, morning is 09:00 that day, 1h is exact.
      // 1d 为前一天多伦多时间 23:59，morning 为当天 09:00，1h 为精确的一小时。
      expect(ledger(w.d1)).toEqual(['1d 2026-10-30T03:59:00.000Z pending', 'morning 2026-10-30T13:00:00.000Z pending', '1h 2026-10-31T02:59:00.000Z pending']);
      expect(w.d1.rows('SELECT DISTINCT member_id, kind, occurs_at, expires_at FROM timetable_reminders')).toEqual([
        { member_id: w.a.id, kind: 'assignment', occurs_at: DUE, expires_at: DUE },
      ]);
    });

    it('drops reminders already past, so a late save never sends at once', async () => {
      vi.setSystemTime(Date.parse('2026-10-30T14:00:00.000Z'));
      // The session from T0 has expired by now, so a member signs in at this time.
      // 此时 T0 的登录已经过期，所以由一位成员在此时登录。
      const late = await signIn(w.d1, `mem_late${memberSeq}`);
      expect((await call(w.d1, late, 'POST', '/assignments', assignment(1, { remindOffsets: ['1d', 'morning', '1h'] }))).status).toBe(200);
      expect(ledger(w.d1)).toEqual(['1h 2026-10-31T02:59:00.000Z pending']);
    });

    it('deletes pending rows when done and plans again when opened, never repeating one already sent', async () => {
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1));
      w.d1.rows("UPDATE timetable_reminders SET status = 'sent', sent_at = 'x' WHERE offset_key = '1d'");
      vi.setSystemTime(T0 + MIN);
      const done = await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: true });
      expect(done.body).toMatchObject({ rev: 2, item: { id: tid('ta', 1), doneAt: new Date(T0 + MIN).toISOString() } });
      expect(ledger(w.d1)).toEqual(['1d 2026-10-30T03:59:00.000Z sent']);
      // Ticking again keeps the first tick.
      // 再次勾选保留第一次勾选的时间。
      vi.setSystemTime(T0 + 2 * MIN);
      expect((await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: true })).body).toMatchObject({ item: { doneAt: new Date(T0 + MIN).toISOString() } });

      const open = await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: false });
      expect(open.body).toMatchObject({ rev: 4, item: { doneAt: null } });
      expect(ledger(w.d1)).toEqual(['1d 2026-10-30T03:59:00.000Z sent', '1h 2026-10-31T02:59:00.000Z pending']);
    });

    it('keeps the done state when a save omits done, and re-plans when the due time moves', async () => {
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1));
      await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: true });
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { title: 'PS3 v2' }))).body).toMatchObject({ item: { title: 'PS3 v2', doneAt: new Date(T0).toISOString() } });
      expect(ledger(w.d1)).toEqual([]);

      const moved = '2026-11-03T04:59:00.000Z';
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { dueAt: moved, done: false }));
      expect(ledger(w.d1)).toEqual(['1d 2026-11-02T04:59:00.000Z pending', '1h 2026-11-03T03:59:00.000Z pending']);
      expect(w.d1.rows('SELECT DISTINCT occurs_at FROM timetable_reminders')).toEqual([{ occurs_at: moved }]);
    });

    it("refuses another member's id or course, bad offsets, and a 301st open item", async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { notes: 'secret' }));
      expect(await call(w.d1, w.b, 'POST', '/assignments', assignment(1))).toMatchObject({ status: 409, body: refusal('id_taken') });
      expect(await call(w.d1, w.b, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: true })).toMatchObject({ status: 404 });
      expect(await call(w.d1, w.b, 'POST', '/assignments', assignment(2, { courseId: tid('tc', 1) }))).toMatchObject({ status: 404, body: refusal('course_not_found') });
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2, { remindOffsets: ['1d', '1h', '3h', '30m'] }))).toMatchObject({ status: 400, body: refusal('too_many_offsets') });
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2, { remindOffsets: ['2h' as never] }))).toMatchObject({ status: 400, body: refusal('invalid_offset') });
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2, { dueAt: '2026-10-31T03:59:30.000Z' }))).toMatchObject({ status: 400, body: refusal('invalid_due_time') });
      expect(await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: 'yes' })).toMatchObject({ status: 400, body: refusal('invalid_body') });
      expect(w.d1.rows('SELECT member_id, notes FROM timetable_assignments')).toEqual([{ member_id: w.a.id, notes: 'secret' }]);

      const now = new Date(T0).toISOString();
      for (let n = 10; n < 10 + TIMETABLE_LIMITS.openAssignments - 1; n += 1) {
        w.d1.rows("INSERT INTO timetable_assignments (id, member_id, title, due_at, created_at, updated_at) VALUES (?, ?, 'x', ?, ?, ?)", tid('ta', n), w.a.id, DUE, now, now);
      }
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2))).toMatchObject({ status: 400, body: refusal('too_many_assignments') });
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(2, { done: true }))).status).toBe(200);
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { title: 'edit' }))).status).toBe(200);
      expect(await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 2)}`, { done: false })).toMatchObject({ status: 400, body: refusal('too_many_assignments') });
    });

    it('deletes idempotently, with its reminder rows', async () => {
      await call(w.d1, w.a, 'POST', '/assignments', assignment(1));
      expect((await call(w.d1, w.a, 'DELETE', `/assignments/${tid('ta', 1)}`)).body).toEqual({ rev: 2, item: null });
      expect((await call(w.d1, w.a, 'DELETE', `/assignments/${tid('ta', 1)}`)).status).toBe(200);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_reminders')).toBe(0);
      expect(await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1)}`, { done: true })).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    });
  });

  describe('skips', () => {
    it('sets and removes a holiday and a single skip, idempotently', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      expect((await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-12', meetingId: null, skipped: true, label: 'Thanksgiving' })).body).toEqual({
        rev: 2,
        item: { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
      });
      expect((await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-12', meetingId: null, skipped: true })).body).toEqual({
        rev: 3,
        item: { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
      });
      await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-19', meetingId: tid('tm', 1), skipped: true });
      expect((await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body.skips).toEqual([
        { onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' },
        { onDate: '2026-10-19', meetingId: tid('tm', 1), label: null },
      ]);
      expect((await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-19', meetingId: tid('tm', 1), skipped: false })).body).toEqual({ rev: 5, item: null });
      expect((await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-19', meetingId: tid('tm', 1), skipped: false })).status).toBe(200);
      expect(w.d1.rows('SELECT on_date FROM timetable_skips')).toEqual([{ on_date: '2026-10-12' }]);
    });

    it('refuses a meeting the member does not own, a bad date, and a 201st date', async () => {
      await call(w.d1, w.a, 'POST', '/courses', course(1));
      expect(await call(w.d1, w.b, 'POST', '/skips', { onDate: '2026-10-19', meetingId: tid('tm', 1), skipped: true })).toMatchObject({ status: 404, body: refusal('course_not_found') });
      expect(await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-02-30', meetingId: null, skipped: true })).toMatchObject({ status: 400, body: refusal('invalid_skip_date') });
      const now = new Date(T0).toISOString();
      for (let day = 0; day < TIMETABLE_LIMITS.skips; day += 1) {
        w.d1.rows("INSERT INTO timetable_skips (member_id, on_date, created_at) VALUES (?, date('2027-01-01', ?), ?)", w.a.id, `+${day} days`, now);
      }
      expect(await call(w.d1, w.a, 'POST', '/skips', { onDate: '2026-10-12', meetingId: null, skipped: true })).toMatchObject({ status: 400, body: refusal('too_many_skips') });
      expect((await call(w.d1, w.a, 'POST', '/skips', { onDate: '2027-01-01', meetingId: null, skipped: true, label: 'New Year' })).status).toBe(200);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_skips WHERE member_id = ?', w.a.id)).toBe(TIMETABLE_LIMITS.skips);
    });
  });

  describe('settings', () => {
    it('changes only the fields sent and refuses values outside the lists', async () => {
      expect((await call(w.d1, w.a, 'PATCH', '/settings', { classReminders: true, classLeadMin: 30, locale: 'en' })).body).toEqual({
        rev: 1,
        item: { classReminders: true, classLeadMin: 30, assignmentOffsets: ['1d', '1h'], showWeekend: 'always', locale: 'en' },
      });
      expect((await call(w.d1, w.a, 'PATCH', '/settings', { assignmentOffsets: [] })).body).toMatchObject({ rev: 2, item: { classLeadMin: 30, assignmentOffsets: [] } });
      expect(await call(w.d1, w.a, 'PATCH', '/settings', { classLeadMin: 25 })).toMatchObject({ status: 400, body: refusal('invalid_settings') });
      expect((await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body.settings).toEqual({
        classReminders: true,
        classLeadMin: 30,
        assignmentOffsets: [],
        showWeekend: 'always',
        locale: 'en',
      });
    });
  });

  describe('import', () => {
    const body = () => ({
      terms: [term(1)],
      courses: [course(1, { termId: tid('tt', 1), meetings: [meeting(1, { weekRule: 'odd' }), meeting(2, { weekday: 3 })] }), course(2, { meetings: [meeting(3)] })],
      assignments: [assignment(1, { courseId: tid('tc', 1) }), assignment(2, { done: true })],
      skips: [{ onDate: '2026-10-12', meetingId: null, label: 'Thanksgiving' }, { onDate: '2026-10-21', meetingId: tid('tm', 2) }],
    });

    it('writes everything in one batch with one rev bump and answers the counts', async () => {
      const answer = await call(w.d1, w.a, 'POST', '/import', body());
      expect(answer.body).toEqual({ rev: 1, item: { terms: 1, courses: 2, assignments: 2, skips: 2 } });
      const timetable = (await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body;
      expect(timetable.courses.map((item) => [item.id, item.meetings.length])).toEqual([
        [tid('tc', 1), 2],
        [tid('tc', 2), 1],
      ]);
      expect(timetable.assignments.map((item) => [item.id, item.doneAt])).toEqual([
        [tid('ta', 1), null],
        [tid('ta', 2), new Date(T0).toISOString()],
      ]);
      expect(timetable.skips).toHaveLength(2);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_reminders WHERE assignment_id = ?', tid('ta', 1))).toBe(2);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_reminders WHERE assignment_id = ?', tid('ta', 2))).toBe(0);
      // A repeat, as after a lost answer, writes the same rows again.
      // 重复发送（例如应答丢失后）只会再次写入相同的行。
      expect((await call(w.d1, w.a, 'POST', '/import', body())).body).toMatchObject({ rev: 2 });
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_meetings')).toBe(3);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_reminders')).toBe(2);
    });

    it("checks in full before writing: another member's ids, missing references and limits after the import", async () => {
      await call(w.d1, w.b, 'POST', '/courses', course(2, { meetings: [meeting(3)] }));
      const writesBefore = timetableWrites(w.d1).length;
      expect(await call(w.d1, w.a, 'POST', '/import', body())).toMatchObject({ status: 409, body: refusal('id_taken') });
      const [first] = body().courses;
      expect(await call(w.d1, w.a, 'POST', '/import', { ...body(), terms: [], courses: [first] })).toMatchObject({ status: 404, body: refusal('term_not_found') });
      expect(await call(w.d1, w.a, 'POST', '/import', { courses: [], assignments: [assignment(1, { courseId: tid('tc', 7) })] })).toMatchObject({
        status: 404,
        body: refusal('course_not_found'),
      });
      expect(await call(w.d1, w.a, 'POST', '/import', { skips: [{ onDate: '2026-10-21', meetingId: tid('tm', 3) }] })).toMatchObject({
        status: 404,
        body: refusal('course_not_found'),
      });
      // Refused imports count against the import limit too, so the rest of the checks run in the next window.
      // 被拒绝的导入同样计入导入次数限制，因此其余的检查在下一个时间窗口中进行。
      vi.setSystemTime(T0 + TIMETABLE_IMPORT_WINDOW_MS);
      const now = new Date(T0).toISOString();
      for (let n = 1; n <= TIMETABLE_LIMITS.terms - 1; n += 1) {
        w.d1.rows("INSERT INTO timetable_terms (id, member_id, name, starts_on, ends_on, created_at, updated_at) VALUES (?, ?, 'T', '2026-01-05', '2026-04-10', ?, ?)", tid('tt', 100 + n), w.a.id, now, now);
      }
      expect(await call(w.d1, w.a, 'POST', '/import', { terms: [term(1), term(2)] })).toMatchObject({ status: 400, body: refusal('too_many_terms') });
      expect(await call(w.d1, w.a, 'POST', '/import', { courses: [course(1), course(1)] })).toMatchObject({ status: 400, body: refusal('invalid_id') });
      // None of the refused imports wrote anything, the rev bump included (the terms above went in directly).
      // 被拒绝的导入都没有写入任何内容，包括 rev 加一（上面的学期是直接插入的）。
      expect(timetableWrites(w.d1)).toHaveLength(writesBefore);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_courses WHERE member_id = ?', w.a.id)).toBe(0);
      expect((await call(w.d1, w.a, 'GET', '?rev=0')).body).toMatchObject({ unchanged: true });
      expect((await call(w.d1, w.a, 'POST', '/import', { terms: [term(1)] })).status).toBe(200);
    });

    it('has its own per-member limit, apart from the other writes and other members', async () => {
      for (let i = 0; i < TIMETABLE_IMPORTS_PER_WINDOW; i += 1) expect((await call(w.d1, w.a, 'POST', '/import', { terms: [term(1)] })).status).toBe(200);
      expect((await call(w.d1, w.a, 'POST', '/import', { terms: [term(1)] })).status).toBe(429);
      expect((await call(w.d1, w.a, 'POST', '/terms', term(2))).status).toBe(200);
      expect((await call(w.d1, w.b, 'POST', '/import', { terms: [term(3)] })).status).toBe(200);
      vi.setSystemTime(T0 + TIMETABLE_IMPORT_WINDOW_MS - 1);
      expect((await call(w.d1, w.a, 'POST', '/import', { terms: [term(1)] })).status).toBe(429);
      vi.setSystemTime(T0 + TIMETABLE_IMPORT_WINDOW_MS);
      expect((await call(w.d1, w.a, 'POST', '/import', { terms: [term(1)] })).status).toBe(200);
    });
  });

  describe('assignment total', () => {
    const DAY = 86_400_000;

    /** n of the member's assignments, ta ids from `from` on, done at doneAt or open when it is null. */
    /** 成员的 n 项作业，ta id 从 `from` 起，doneAt 为完成时间，为 null 时未完成。 */
    function seed(memberId: string, from: number, n: number, doneAt: string | null): void {
      const now = new Date(T0).toISOString();
      w.d1.rows(
        `WITH RECURSIVE k(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM k WHERE i < ?1 + ?2 - 1)
         INSERT INTO timetable_assignments (id, member_id, title, due_at, done_at, created_at, updated_at)
         SELECT printf('ta_%022d', i), ?3, 'x', ?4, ?5, ?6, ?6 FROM k`,
        from,
        n,
        memberId,
        DUE,
        doneAt,
        now,
      );
    }

    it('stops a new assignment, done or not, once the member has 1000 that the app still shows', async () => {
      seed(w.a.id, 1000, 100, null);
      seed(w.a.id, 2000, TIMETABLE_LIMITS.assignments - 101, new Date(T0 - DAY).toISOString());
      // Done more than 30 days ago: GET no longer returns these, so they do not count.
      // 超过 30 天之前完成的：GET 已不再返回，因此不计入。
      seed(w.a.id, 5000, 50, new Date(T0 - 31 * DAY).toISOString());
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { done: true }))).status).toBe(200);
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2, { done: true }))).toMatchObject({ status: 400, body: refusal('too_many_assignments_total') });
      expect(await call(w.d1, w.a, 'POST', '/assignments', assignment(2))).toMatchObject({ status: 400, body: refusal('too_many_assignments_total') });
      expect((await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body.assignments).toHaveLength(TIMETABLE_LIMITS.assignments);
      // What the member has can still be edited, ticked and opened again, an old row included.
      // 已有的作业仍可编辑、勾选和重新打开，旧的行也一样。
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(1, { title: 'edit' }))).status).toBe(200);
      expect((await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1000)}`, { done: true })).status).toBe(200);
      expect((await call(w.d1, w.a, 'PATCH', `/assignments/${tid('ta', 1000)}`, { done: false })).status).toBe(200);
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(5000, { title: 'old' }))).status).toBe(200);
      // Another member is not affected.
      // 另一位成员不受影响。
      expect((await call(w.d1, w.b, 'POST', '/assignments', assignment(2))).status).toBe(200);
      // Clearing the done ones makes room again.
      // 清除已完成的作业后又有了空间。
      w.d1.rows('DELETE FROM timetable_assignments WHERE member_id = ? AND id = ?', w.a.id, tid('ta', 2000));
      expect((await call(w.d1, w.a, 'POST', '/assignments', assignment(3))).status).toBe(200);
    });

    it('counts the new rows of an import, done ones included, and not the ones it only updates', async () => {
      seed(w.a.id, 1000, TIMETABLE_LIMITS.assignments - 1, new Date(T0 - DAY).toISOString());
      const done = (n: number) => assignment(n, { done: true });
      const writesBefore = timetableWrites(w.d1).length;
      expect(await call(w.d1, w.a, 'POST', '/import', { assignments: [done(1), done(2)] })).toMatchObject({ status: 400, body: refusal('too_many_assignments_total') });
      expect(timetableWrites(w.d1)).toHaveLength(writesBefore);
      expect((await call(w.d1, w.a, 'POST', '/import', { assignments: [done(1), done(1000), done(1001)] })).status).toBe(200);
      expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_assignments WHERE member_id = ?', w.a.id)).toBe(TIMETABLE_LIMITS.assignments);
      expect(await call(w.d1, w.a, 'POST', '/import', { assignments: [done(2)] })).toMatchObject({ status: 400, body: refusal('too_many_assignments_total') });
      expect((await call(w.d1, w.a, 'POST', '/import', { assignments: [done(1), done(1002)] })).status).toBe(200);
    });
  });

  it('clears everything but the settings', async () => {
    await call(w.d1, w.a, 'PATCH', '/settings', { classReminders: true });
    await call(w.d1, w.a, 'POST', '/import', {
      terms: [term(1)],
      courses: [course(1, { termId: tid('tt', 1) }), course(2)],
      assignments: [assignment(1)],
      skips: [{ onDate: '2026-10-12', meetingId: null }],
    });
    await call(w.d1, w.b, 'POST', '/courses', course(3));
    expect((await call(w.d1, w.a, 'POST', '/clear')).body).toEqual({ rev: 3, item: null });
    const after = (await call<TimetableResponse>(w.d1, w.a, 'GET', '')).body;
    expect(after).toMatchObject({ rev: 3, terms: [], courses: [], skips: [], assignments: [], settings: { classReminders: true } });
    expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_reminders')).toBe(0);
    expect(count(w.d1, 'SELECT count(*) AS n FROM timetable_courses WHERE member_id = ?', w.b.id)).toBe(1);
  });

  it('limits writes per member and leaves reads and other members alone', async () => {
    for (let i = 0; i < TIMETABLE_WRITES_PER_MINUTE; i += 1) expect((await call(w.d1, w.a, 'PATCH', '/settings', {})).status).toBe(200);
    expect((await call(w.d1, w.a, 'POST', '/clear')).status).toBe(429);
    expect((await call(w.d1, w.a, 'GET', '')).status).toBe(200);
    expect((await call(w.d1, w.b, 'POST', '/clear')).status).toBe(200);
    vi.setSystemTime(T0 + MIN + 1);
    expect((await call(w.d1, w.a, 'POST', '/clear')).status).toBe(200);
  });
});

describe.skipIf(!sqlite)('timetable routes before migration 0017', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers that the timetable is being upgraded, for reads and writes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const w = await world(16);
    try {
      expect(await call(w.d1, w.a, 'GET', '')).toMatchObject({ status: 503, body: refusal('timetable_unavailable') });
      expect(await call(w.d1, w.a, 'POST', '/courses', course(1))).toMatchObject({ status: 503, body: refusal('timetable_unavailable') });
    } finally {
      w.d1.close();
    }
  });

  it('answers the same when the tables are dropped after the migration ran', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const w = await world();
    try {
      for (const table of ['timetable_reminders', 'timetable_skips', 'timetable_assignments', 'timetable_meetings', 'timetable_courses', 'timetable_terms', 'timetable_settings']) {
        w.d1.exec(`DROP TABLE ${table}`);
      }
      for (const [method, path, body] of [
        ['GET', '?rev=0', undefined],
        ['POST', '/terms', term(1)],
        ['POST', '/assignments', assignment(1)],
        ['PATCH', `/assignments/${tid('ta', 1)}`, { done: true }],
        ['POST', '/skips', { onDate: '2026-10-12', meetingId: null, skipped: true }],
        ['PATCH', '/settings', { locale: 'en' }],
        ['POST', '/import', { terms: [term(1)] }],
        ['POST', '/clear', undefined],
        ['DELETE', `/courses/${tid('tc', 1)}`, undefined],
      ] as const) {
        expect(await call(w.d1, w.a, method, path, body)).toMatchObject({ status: 503, body: refusal('timetable_unavailable') });
      }
    } finally {
      w.d1.close();
    }
  });
});
