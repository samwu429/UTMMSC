import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS, wallTimeToUtcMs, type PushPayload } from '@utmmsc/shared';
import type { Env } from '../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../d1/testing/sqlite-d1';
import { sendToMembersReport, type MemberPushOutcome } from './send';
import { RETENTION_UTC_MINUTE, runTimetableReminders } from './timetable-reminders';

vi.mock('./send', () => ({ sendToMembersReport: vi.fn() }));

/**
 * One minute's timetable run end to end on real SQLite, with the push itself stubbed: what each member is sent,
 * how each outcome lands in the ledger, retries and their checks, the switches, the statement budget, and the
 * quiet paths (outside the day window, before migration 0017).
 * 在真实 SQLite 上端到端检查每分钟一次的课表运行，推送本身用替身代替：每位成员收到什么、每种结果如何写入提醒记录、
 * 重试及其检查、各级开关、语句数量上限，以及安静的情况（每天的时间窗口之外、迁移 0017 之前）。
 */

const BASE = 'https://utmmsc.com/UTMMSC/';
const NOW = '2026-10-01T12:00:00.000Z';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const toronto = (y: number, m: number, d: number, h: number, min: number) => wallTimeToUtcMs(y, m, d, h, min, 'America/Toronto');

/** Monday 2026-10-26 in Toronto (EDT). */
/** 多伦多时间 2026-10-26 周一（夏令时）。 */
const at = (h: number, min: number, sec = 0) => toronto(2026, 10, 26, h, min) + sec * 1000;
const TEN = at(10, 0);

function tid(prefix: 'tt' | 'tc' | 'tm' | 'ta', n: string): string {
  return `${prefix}_${n.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(0, 22)}`;
}

interface Push {
  memberId: string;
  payload: PushPayload;
}

const send = vi.mocked(sendToMembersReport);
let pushes: Push[] = [];
let calls = 0;
let outcomeFor: (memberId: string, payload: PushPayload) => MemberPushOutcome = () => 'sent';
let previewOff = new Set<string>();

describe.skipIf(!sqlite)('runTimetableReminders', () => {
  let d1: SqliteD1;
  let env: Env;

  function member(id: string, options: { lead?: number; locale?: 'zh' | 'en'; reminders?: boolean } = {}): void {
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, 'A', 'h', 'active', 'student', 'student', 2028, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      NOW,
      NOW,
    );
    d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `s-${id}`, id, '2030-01-01T00:00:00.000Z', NOW);
    d1.rows("INSERT INTO push_devices (id, member_id, kind, endpoint, session_id, created_at, last_seen_at) VALUES (?, ?, 'fcm', ?, ?, ?, ?)", `pd-${id}`, id, `tok-${id}`, `s-${id}`, NOW, NOW);
    d1.rows(
      'INSERT INTO timetable_settings (member_id, class_reminders, class_lead_min, locale, updated_at) VALUES (?, ?, ?, ?, ?)',
      id,
      options.reminders === false ? 0 : 1,
      options.lead ?? 10,
      options.locale ?? 'zh',
      NOW,
    );
  }

  /** A term-less course with one Monday meeting; returns the meeting id. */
  /** 一门不属于学期的课程，带一个周一的上课时间；返回上课时间 id。 */
  function weeklyClass(memberId: string, name: string, startMin = 600, code = 'MAT102H5F', location: string | null = 'DV 2074', weekday = 1): string {
    const course = tid('tc', `${memberId}${name}`);
    const meeting = tid('tm', `${memberId}${name}`);
    d1.rows("INSERT INTO timetable_courses (id, member_id, term_id, code, color, remind, created_at, updated_at) VALUES (?, ?, NULL, ?, 'purple', 1, ?, ?)", course, memberId, code, NOW, NOW);
    d1.rows(
      "INSERT INTO timetable_meetings (id, course_id, member_id, kind, weekday, start_min, end_min, location, created_at, updated_at) VALUES (?, ?, ?, 'lec', ?, ?, ?, ?, ?, ?)",
      meeting,
      course,
      memberId,
      weekday,
      startMin,
      startMin + 50,
      location,
      NOW,
      NOW,
    );
    return meeting;
  }

  /** An assignment and its planned rows, as POST /assignments writes them; returns the assignment id. */
  /** 一项作业及其安排好的提醒，与 POST /assignments 的写法一致；返回作业 id。 */
  function assignment(memberId: string, name: string, dueMs: number, plan: { offset: string; sendAt: number }[], offsets = plan.map((row) => row.offset)): string {
    const id = tid('ta', `${memberId}${name}`);
    d1.rows(
      "INSERT INTO timetable_assignments (id, member_id, course_id, title, due_at, remind_offsets, created_at, updated_at) VALUES (?, ?, NULL, 'PS3', ?, ?, ?, ?)",
      id,
      memberId,
      iso(dueMs),
      JSON.stringify(offsets),
      NOW,
      NOW,
    );
    for (const row of plan) {
      d1.rows(
        "INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, created_at) VALUES (?, 'assignment', ?, ?, ?, ?, ?, ?)",
        memberId,
        id,
        iso(dueMs),
        row.offset,
        iso(row.sendAt),
        iso(dueMs),
        NOW,
      );
    }
    return id;
  }

  const run = (scheduledMs: number, clockMs = scheduledMs) => runTimetableReminders(env, new Date(scheduledMs), { clock: () => clockMs });
  const rows = () => d1.rows<{ kind: string; status: string; attempts: number; offset_key: string; sent_at: string | null }>('SELECT kind, status, attempts, offset_key, sent_at FROM timetable_reminders ORDER BY id');
  const titles = () => pushes.map((push) => push.payload.title);

  beforeEach(() => {
    d1 = createSqliteD1();
    env = { DB: d1.db, APP_BASE_URL: BASE } as unknown as Env;
    pushes = [];
    calls = 0;
    outcomeFor = () => 'sent';
    previewOff = new Set();
    send.mockReset();
    send.mockImplementation(async (_env, memberIds, payloadFor, options) => {
      calls += 1;
      expect(options).toEqual({ relay: 'always' });
      const report = new Map<string, MemberPushOutcome>();
      for (const memberId of memberIds) {
        const payload = payloadFor(memberId, { ...DEFAULT_NOTIFICATION_PREFS, preview: !previewOff.has(memberId) });
        if (payload) pushes.push({ memberId, payload });
        report.set(memberId, payload ? outcomeFor(memberId, payload) : 'none');
      }
      return report;
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    d1.close();
  });

  describe('class reminders', () => {
    beforeEach(() => {
      member('m1');
    });

    it('go out at the lead time, once, and never in the last two minutes', async () => {
      weeklyClass('m1', 'a');
      expect(await run(at(9, 45))).toMatchObject({ scanned: 0, sent: 0 });
      expect(pushes).toEqual([]);
      expect(await run(at(9, 50))).toMatchObject({ scanned: 1, sent: 1 });
      expect(pushes).toEqual([
        {
          memberId: 'm1',
          payload: {
            title: 'MAT102 · 10 分钟后上课',
            body: '10:00–10:50 · DV 2074 · 讲座',
            tag: 'tt:class',
            url: `${BASE}timetable?date=2026-10-26&focus=${tid('tm', 'm1a')}`,
            kind: 'class',
            ttlSeconds: 600,
          },
        },
      ]);
      for (let minute = 51; minute <= 59; minute += 1) await run(at(9, minute));
      expect(pushes).toHaveLength(1);
      expect(rows()).toEqual([{ kind: 'class', status: 'sent', attempts: 1, offset_key: '10m', sent_at: iso(at(9, 50)) }]);
    });

    it('catch up after missed runs and state the real minutes left', async () => {
      weeklyClass('m1', 'a');
      await run(at(9, 52));
      expect(titles()).toEqual(['MAT102 · 8 分钟后上课']);
      expect(pushes[0]?.payload.ttlSeconds).toBe(480);
    });

    it('are not sent in the last two minutes before class', async () => {
      weeklyClass('m1', 'a');
      await run(at(9, 59));
      expect(pushes).toEqual([]);
      expect(rows()).toEqual([]);
    });

    it('honour a lead raised at the last minute', async () => {
      weeklyClass('m1', 'a');
      d1.rows('UPDATE timetable_settings SET class_lead_min = 30');
      await run(at(9, 36));
      expect(titles()).toEqual(['MAT102 · 24 分钟后上课']);
    });

    it('reach a class added a few minutes before it starts', async () => {
      await run(at(9, 55));
      weeklyClass('m1', 'a');
      await run(at(9, 56));
      expect(titles()).toEqual(['MAT102 · 4 分钟后上课']);
    });

    it('merge a member classes into one push', async () => {
      weeklyClass('m1', 'a');
      weeklyClass('m1', 'b', 600, 'CSC108H5F', 'IB 110');
      await run(at(9, 50));
      expect(pushes).toHaveLength(1);
      expect(pushes[0]?.payload).toMatchObject({ title: '10 分钟后有 2 节课', body: 'CSC108 IB 110；MAT102 DV 2074' });
      expect(rows().map((row) => row.status)).toEqual(['sent', 'sent']);
    });

    it('follow each member language and preview switch', async () => {
      member('m2', { locale: 'en' });
      member('m3');
      weeklyClass('m1', 'a');
      weeklyClass('m2', 'a');
      weeklyClass('m3', 'a');
      previewOff = new Set(['m3']);
      await run(at(9, 50));
      expect(Object.fromEntries(pushes.map((push) => [push.memberId, `${push.payload.title} / ${push.payload.body}`]))).toEqual({
        m1: 'MAT102 · 10 分钟后上课 / 10:00–10:50 · DV 2074 · 讲座',
        m2: 'MAT102 · class in 10 min / 10:00–10:50 AM · DV 2074 · Lecture',
        m3: 'UTMMSC / 10 分钟后有课',
      });
      expect(calls).toBe(1);
    });

    it('are right after the November clock change', async () => {
      weeklyClass('m1', 'a');
      await run(toronto(2026, 11, 2, 9, 50));
      expect(titles()).toEqual(['MAT102 · 10 分钟后上课']);
      expect(d1.rows('SELECT occurs_at FROM timetable_reminders')).toEqual([{ occurs_at: '2026-11-02T15:00:00.000Z' }]);
    });

    it('work from the current minute when the run starts more than a minute late', async () => {
      weeklyClass('m1', 'a');
      await run(at(9, 57), at(10, 1, 5));
      expect(pushes).toEqual([]);
      expect(rows()).toEqual([]);
    });
  });

  describe('outcomes', () => {
    beforeEach(() => {
      for (const id of ['ok', 'nodevice', 'refused', 'blip']) {
        member(id);
        weeklyClass(id, 'a');
      }
      outcomeFor = (memberId) => ({ ok: 'sent', nodevice: 'none', refused: 'failed', blip: 'retry' })[memberId] as MemberPushOutcome;
    });

    it('mark each row sent, skipped, failed or pending for a retry', async () => {
      expect(await run(at(9, 50))).toMatchObject({ scanned: 4, sent: 1, skipped: 1, failed: 1, retry: 1 });
      const byMember = Object.fromEntries(
        d1.rows<{ member_id: string; status: string; attempts: number; sent_at: string | null }>('SELECT member_id, status, attempts, sent_at FROM timetable_reminders').map((row) => [row.member_id, [row.status, row.attempts, row.sent_at]]),
      );
      expect(byMember).toEqual({
        ok: ['sent', 1, iso(at(9, 50))],
        nodevice: ['skipped', 1, null],
        refused: ['failed', 1, null],
        blip: ['pending', 1, null],
      });
    });

    it('retry a transient failure each minute, with the minutes left, until the third attempt', async () => {
      await run(at(9, 50));
      pushes = [];
      await run(at(9, 51));
      await run(at(9, 52));
      expect(pushes.map((push) => [push.memberId, push.payload.title])).toEqual([
        ['blip', 'MAT102 · 9 分钟后上课'],
        ['blip', 'MAT102 · 8 分钟后上课'],
      ]);
      expect(d1.rows("SELECT status, attempts FROM timetable_reminders WHERE member_id = 'blip'")).toEqual([{ status: 'failed', attempts: 3 }]);
      await run(at(9, 53));
      expect(pushes).toHaveLength(2);
    });

    it('drop a retry once the class is about to start', async () => {
      d1.rows("DELETE FROM timetable_meetings WHERE member_id != 'blip'");
      await run(at(9, 58));
      expect(d1.rows('SELECT status, attempts FROM timetable_reminders')).toEqual([{ status: 'pending', attempts: 1 }]);
      pushes = [];
      expect(await run(at(9, 59))).toMatchObject({ claimed: 0 });
      expect(pushes).toEqual([]);
      expect(d1.rows('SELECT status FROM timetable_reminders')).toEqual([{ status: 'cancelled' }]);
    });

    it('leave every row of a pass for a retry when the pass fails', async () => {
      send.mockRejectedValueOnce(new Error('relay down'));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await run(at(9, 50))).toMatchObject({ scanned: 4, retry: 4 });
      expect(d1.rows("SELECT DISTINCT status FROM timetable_reminders")).toEqual([{ status: 'pending' }]);
    });
  });

  describe('a retried class', () => {
    let meeting: string;

    beforeEach(async () => {
      member('m1');
      meeting = weeklyClass('m1', 'a');
      outcomeFor = () => 'retry';
      await run(at(9, 50));
      outcomeFor = () => 'sent';
      pushes = [];
    });

    const status = () => d1.rows<{ status: string }>('SELECT status FROM timetable_reminders')[0]?.status;

    it('is sent again when nothing changed', async () => {
      expect(await run(at(9, 51))).toMatchObject({ claimed: 1, sent: 1 });
      expect(titles()).toEqual(['MAT102 · 9 分钟后上课']);
      expect(status()).toBe('sent');
    });

    it('is cancelled after 本次不上 or a holiday', async () => {
      d1.rows("INSERT INTO timetable_skips (member_id, on_date, meeting_id, created_at) VALUES ('m1', '2026-10-26', ?, ?)", meeting, NOW);
      expect(await run(at(9, 51))).toMatchObject({ claimed: 1, cancelled: 1, sent: 0 });
      expect(status()).toBe('cancelled');
    });

    it('is cancelled when the class moved, which the scan then reminds at its new time', async () => {
      d1.rows('UPDATE timetable_meetings SET start_min = 605, end_min = 655');
      expect(await run(at(9, 51))).toMatchObject({ claimed: 1, cancelled: 1, scanned: 0, sent: 0 });
      expect(await run(at(9, 55))).toMatchObject({ claimed: 0, scanned: 1, sent: 1 });
      expect(titles()).toEqual(['MAT102 · 10 分钟后上课']);
      expect(d1.rows('SELECT occurs_at, status FROM timetable_reminders ORDER BY id')).toEqual([
        { occurs_at: '2026-10-26T14:00:00.000Z', status: 'cancelled' },
        { occurs_at: '2026-10-26T14:05:00.000Z', status: 'sent' },
      ]);
    });

    it('is cancelled when class reminders went off', async () => {
      d1.rows('UPDATE timetable_settings SET class_reminders = 0');
      await run(at(9, 51));
      expect(status()).toBe('cancelled');
    });

    it('is cancelled when the course switch went off', async () => {
      d1.rows('UPDATE timetable_courses SET remind = 0');
      await run(at(9, 51));
      expect(status()).toBe('cancelled');
    });

    it('is cancelled when 课表提醒 went off', async () => {
      d1.rows("INSERT INTO notification_prefs (member_id, timetable, updated_at) VALUES ('m1', 0, ?)", NOW);
      await run(at(9, 51));
      expect(status()).toBe('cancelled');
      expect(pushes).toEqual([]);
    });
  });

  describe('assignment reminders', () => {
    // Tuesday 2026-10-27 23:59 EDT.
    const due = toronto(2026, 10, 27, 23, 59);

    beforeEach(() => {
      member('m1');
    });

    it('go out when due, in their own push, and once', async () => {
      weeklyClass('m1', 'a');
      const id = assignment('m1', 'a', TEN + 10 * HOUR, [{ offset: '1h', sendAt: at(9, 50) }]);
      await run(at(9, 50));
      expect(calls).toBe(2);
      expect(pushes.map((push) => push.payload.kind)).toEqual(['class', 'assignment']);
      expect(pushes[1]?.payload).toEqual({
        title: '作业截止提醒 · PS3',
        body: '今天 20:00 截止（还有 10 小时）',
        tag: `tt:due:${id}`,
        url: `${BASE}timetable/due?focus=${id}`,
        kind: 'assignment',
        ttlSeconds: 36600,
      });
      await run(at(9, 51));
      expect(pushes).toHaveLength(2);
    });

    it('are sent late after the cron was down, with the time left', async () => {
      assignment('m1', 'a', due, [{ offset: '1d', sendAt: due - DAY }]);
      await run(due - DAY + 2 * HOUR);
      expect(pushes[0]?.payload.body).toBe('今天 23:59 截止（还有 22 小时）');
    });

    it('collapse several due offsets of one assignment into one line', async () => {
      assignment('m1', 'a', due, [
        { offset: '2d', sendAt: due - 2 * DAY },
        { offset: '1d', sendAt: due - DAY },
      ]);
      expect(await run(due - DAY)).toMatchObject({ claimed: 2, sent: 2 });
      expect(pushes).toHaveLength(1);
      expect(pushes[0]?.payload.title).toBe('作业截止提醒 · PS3');
    });

    it('merge a member assignments into one push', async () => {
      assignment('m1', 'a', due, [{ offset: '1h', sendAt: due - HOUR }]);
      assignment('m1', 'b', due + 17 * HOUR + MIN, [{ offset: '1d', sendAt: due - HOUR }]);
      await run(due - HOUR);
      expect(pushes.map((push) => [push.payload.title, push.payload.body, push.payload.tag])).toEqual([['2 项作业快截止了', 'PS3 23:59；PS3 明天 17:00', 'tt:due']]);
    });

    it('are cancelled when the assignment is done, moved, no longer asks for the offset, or 课表提醒 is off', async () => {
      member('m2');
      const done = assignment('m1', 'done', due, [{ offset: '1h', sendAt: due - HOUR }]);
      const moved = assignment('m1', 'moved', due, [{ offset: '1h', sendAt: due - HOUR }]);
      assignment('m1', 'dropped', due, [{ offset: '1h', sendAt: due - HOUR }], ['1d']);
      assignment('m2', 'off', due, [{ offset: '1h', sendAt: due - HOUR }]);
      const kept = assignment('m1', 'kept', due, [{ offset: '1h', sendAt: due - HOUR }]);
      d1.rows('UPDATE timetable_assignments SET done_at = ? WHERE id = ?', NOW, done);
      d1.rows('UPDATE timetable_assignments SET due_at = ? WHERE id = ?', iso(due + DAY), moved);
      d1.rows("INSERT INTO notification_prefs (member_id, timetable, updated_at) VALUES ('m2', 0, ?)", NOW);
      expect(await run(due - HOUR)).toMatchObject({ claimed: 5, cancelled: 4, sent: 1 });
      expect(pushes.map((push) => push.payload.tag)).toEqual([`tt:due:${kept}`]);
    });

    it('drop a row that would arrive within a minute of the deadline', async () => {
      const soonDue = at(9, 51, 30);
      assignment('m1', 'a', soonDue, [{ offset: '30m', sendAt: soonDue - 30 * MIN }]);
      expect(await run(at(9, 50), at(9, 50, 40))).toMatchObject({ claimed: 1, cancelled: 1, sent: 0 });
      expect(pushes).toEqual([]);
    });
  });

  describe('budget and quiet paths', () => {
    it('is one batch outside the day window with nothing due', async () => {
      member('m1');
      weeklyClass('m1', 'a');
      const batch = vi.spyOn(d1.db, 'batch');
      d1.statements.length = 0;
      expect(await run(toronto(2026, 10, 26, 3, 0))).toEqual({ claimed: 0, scanned: 0, sent: 0, retry: 0, failed: 0, skipped: 0, cancelled: 0, abandoned: 0, expired: 0, pruned: 0 });
      expect(batch).toHaveBeenCalledTimes(1);
      expect(d1.statements).toHaveLength(3);
      expect(send).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });

    it('stays within 30 statements on a busy run, and leaves the rest for the next minute', async () => {
      const due = TEN + 5 * HOUR;
      for (let i = 0; i < 40; i += 1) {
        member(`c${i}`, { locale: i % 2 === 0 ? 'zh' : 'en' });
        weeklyClass(`c${i}`, 'a');
        weeklyClass(`c${i}`, 'b', 600, 'CSC108H5F');
      }
      for (let i = 0; i < 30; i += 1) {
        member(`a${i}`);
        assignment(`a${i}`, 'x', due, [{ offset: '1h', sendAt: at(9, 40) }]);
        assignment(`a${i}`, 'y', due, [{ offset: '3h', sendAt: at(9, 45) }]);
      }
      d1.statements.length = 0;
      expect(await run(at(9, 50))).toMatchObject({ claimed: 60, scanned: 60, sent: 120 });
      expect(d1.statements.length).toBeLessThanOrEqual(30);
      expect(d1.statements.every((statement) => statement.params.length <= 100)).toBe(true);
      expect(await run(at(9, 51))).toMatchObject({ claimed: 0, scanned: 20, sent: 20 });
      expect(d1.rows("SELECT count(*) AS n FROM timetable_reminders WHERE status = 'sent'")).toEqual([{ n: 140 }]);
    });

    it('logs one line of counts and lag, without course names', async () => {
      member('m1');
      weeklyClass('m1', 'a');
      await runTimetableReminders(env, new Date(at(9, 50)), { clock: () => at(9, 50, 2) });
      expect(console.log).toHaveBeenCalledTimes(1);
      const line = String(vi.mocked(console.log).mock.calls[0]?.[0]);
      expect(line).toBe('timetable: reminders claimed=0 scanned=1 sent=1 retry=0 failed=0 skipped=0 cancelled=0 abandoned=0 expired=0 pruned=0 lag=2000ms');
      expect(line).not.toContain('MAT102');
    });

    it('counts rows a dead run left in sending and rows that expired unsent, and logs them', async () => {
      member('m1');
      const T = at(9, 50);
      const stuck = assignment('m1', 'stuck', T + 5 * HOUR, [{ offset: '1h', sendAt: T - 10 * MIN }]);
      d1.rows("UPDATE timetable_reminders SET status = 'sending', attempts = 1, claimed_at = ? WHERE assignment_id = ?", iso(T - 4 * MIN), stuck);
      assignment('m1', 'late', T + 30_000, [{ offset: '30m', sendAt: T - 30 * MIN }]);
      expect(await run(T)).toMatchObject({ claimed: 1, sent: 1, abandoned: 1, expired: 1 });
      expect(d1.rows('SELECT status, attempts FROM timetable_reminders ORDER BY id')).toEqual([
        { status: 'sent', attempts: 2 },
        { status: 'cancelled', attempts: 0 },
      ]);
      expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toContain('abandoned=1 expired=1');
    });

    it('logs a run that only expired rows', async () => {
      member('m1');
      const T = toronto(2026, 10, 26, 3, 0);
      assignment('m1', 'late', T + 30_000, [{ offset: '30m', sendAt: T - 30 * MIN }]);
      expect(await run(T)).toMatchObject({ claimed: 0, expired: 1 });
      expect(console.log).toHaveBeenCalledTimes(1);
    });

    it(`deletes old finished rows at UTC minute ${RETENTION_UTC_MINUTE} only`, async () => {
      member('m1');
      const old = at(9, 0) - 20 * DAY;
      const id = assignment('m1', 'old', old + HOUR, []);
      d1.rows("INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, status, created_at) VALUES ('m1', 'assignment', ?, ?, '1h', ?, ?, 'sent', ?)", id, iso(old + HOUR), iso(old), iso(old + HOUR), NOW);
      const minute = (m: number) => Date.UTC(2026, 9, 26, 6, m);
      expect(await run(minute(RETENTION_UTC_MINUTE + 1))).toMatchObject({ pruned: 0 });
      expect(await run(minute(RETENTION_UTC_MINUTE))).toMatchObject({ pruned: 1 });
      expect(rows()).toEqual([]);
    });

    it('does nothing and logs nothing before migration 0017', async () => {
      d1.close();
      d1 = createSqliteD1({ migrate: false });
      d1.migrate({ to: 16 });
      env = { DB: d1.db, APP_BASE_URL: BASE } as unknown as Env;
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(await run(at(9, 50))).toMatchObject({ claimed: 0, scanned: 0, sent: 0 });
      expect(error).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    });

    it('logs and swallows any other database failure', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(d1.db, 'batch').mockRejectedValueOnce(new Error('D1_ERROR: network connection lost'));
      await expect(run(at(9, 50))).resolves.toMatchObject({ claimed: 0 });
      expect(error).toHaveBeenCalledWith('timetable: reminder run failed', 'D1_ERROR: network connection lost');
    });

    it('still sends the scanned classes when checking the claimed rows fails, and tries those rows next minute', async () => {
      member('m1');
      weeklyClass('m1', 'a');
      const id = assignment('m1', 'a', TEN + 10 * HOUR, [{ offset: '1h', sendAt: at(9, 50) }]);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const original = d1.db.batch.bind(d1.db);
      let batches = 0;
      vi.spyOn(d1.db, 'batch').mockImplementation((async (statements: D1PreparedStatement[]) => {
        batches += 1;
        // The first batch is the claim; the second loads what checking the claimed rows needs.
        // 第一个批次是领取；第二个读取检查已领取行所需的数据。
        if (batches === 2) throw new Error('D1_ERROR: network connection lost');
        return original(statements);
      }) as typeof d1.db.batch);
      expect(await run(at(9, 50))).toMatchObject({ claimed: 1, scanned: 1, sent: 1, retry: 1 });
      expect(error).toHaveBeenCalledWith('timetable: checking claimed rows failed', 'D1_ERROR: network connection lost');
      expect(pushes.map((push) => push.payload.kind)).toEqual(['class']);
      expect(d1.rows("SELECT status, attempts FROM timetable_reminders WHERE kind = 'assignment'")).toEqual([{ status: 'pending', attempts: 1 }]);
      expect(await run(at(9, 51))).toMatchObject({ claimed: 1, sent: 1 });
      expect(pushes.map((push) => push.payload.tag)).toEqual(['tt:class', `tt:due:${id}`]);
    });

    it('writes the outcomes again when the first write fails, so a sent class is not pushed twice', async () => {
      member('m1');
      weeklyClass('m1', 'a');
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const original = d1.db.batch.bind(d1.db);
      let batches = 0;
      vi.spyOn(d1.db, 'batch').mockImplementation((async (statements: D1PreparedStatement[]) => {
        batches += 1;
        // The first batch is the claim; the second is the first try at recording the outcomes.
        // 第一个批次是领取；第二个是第一次尝试记录结果。
        if (batches === 2) throw new Error('D1_ERROR: network connection lost');
        return original(statements);
      }) as typeof d1.db.batch);
      expect(await run(at(9, 50))).toMatchObject({ scanned: 1, sent: 1 });
      expect(error).toHaveBeenCalledWith('timetable: recording outcomes failed, trying again', 'D1_ERROR: network connection lost');
      expect(rows()).toEqual([{ kind: 'class', status: 'sent', attempts: 1, offset_key: '10m', sent_at: iso(at(9, 50)) }]);
      for (let minute = 51; minute <= 58; minute += 1) await run(at(9, minute));
      expect(pushes).toHaveLength(1);
    });
  });
});
