import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addDays,
  classSlots,
  indexSkips,
  instantAt,
  isoWeekday,
  occursOn,
  wallTimeToUtcMs,
  type ClassSlot,
  type TimetableMeeting,
  type TimetableSkip,
  type TimetableTerm,
  type WeekRule,
} from '@utmmsc/shared';
import {
  CLASS_SCAN_LIMIT,
  REMINDER_CLAIM_BATCH,
  REMINDER_PRUNE_BATCH,
  claimClassReminders,
  claimDueReminders,
  finishReminders,
  loadReminderDetails,
  pruneReminders,
  scanClassReminders,
} from './timetable-reminders';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/**
 * The reminder ledger's SQL on real SQLite with every migration: the class scan equals the shared occursOn on
 * random data, each switch hides a class, claims never hand one row out twice, and the housekeeping, finish and
 * retention statements move rows as section 6.2 says, on the indexes it names.
 * 提醒记录的 SQL 在执行了全部迁移的真实 SQLite 上的检查：上课提醒扫描在随机数据上与共享的 occursOn 一致，每个开关都能让课不被扫描到，
 * 领取不会把同一行交出两次，整理、结束和清理语句按第 6.2 节移动各行，并使用其中所写的索引。
 */

const NOW = '2026-10-01T12:00:00.000Z';
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const iso = (ms: number) => new Date(ms).toISOString();
const toronto = (y: number, m: number, d: number, h: number, min: number) => wallTimeToUtcMs(y, m, d, h, min, 'America/Toronto');

/** A timetable id with the prefix and a 22-character body made from `n`. */
/** 由前缀和 `n` 生成 22 个字符主体的课表 id。 */
function tid(prefix: 'tt' | 'tc' | 'tm' | 'ta', n: string): string {
  return `${prefix}_${n.replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(0, 22)}`;
}

class Seed {
  constructor(private readonly d1: SqliteD1) {}

  member(id: string, options: { status?: string; device?: boolean; reminders?: boolean; lead?: number; locale?: string; settings?: boolean } = {}): void {
    this.d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, 'A', 'h', ?, 'student', 'student', 2028, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      options.status ?? 'active',
      NOW,
      NOW,
    );
    if (options.device !== false) {
      this.d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `s-${id}`, id, '2030-01-01T00:00:00.000Z', NOW);
      this.d1.rows(
        "INSERT INTO push_devices (id, member_id, kind, endpoint, session_id, created_at, last_seen_at) VALUES (?, ?, 'fcm', ?, ?, ?, ?)",
        `pd-${id}`,
        id,
        `tok-${id}`,
        `s-${id}`,
        NOW,
        NOW,
      );
    }
    if (options.settings !== false) {
      this.d1.rows(
        'INSERT INTO timetable_settings (member_id, class_reminders, class_lead_min, locale, updated_at) VALUES (?, ?, ?, ?, ?)',
        id,
        options.reminders === false ? 0 : 1,
        options.lead ?? 10,
        options.locale ?? 'zh',
        NOW,
      );
    }
  }

  term(id: string, memberId: string, startsOn: string, endsOn: string, skipWeeks: number[] = []): void {
    this.d1.rows(
      "INSERT INTO timetable_terms (id, member_id, name, starts_on, ends_on, skip_weeks, created_at, updated_at) VALUES (?, ?, 'Fall', ?, ?, ?, ?, ?)",
      id,
      memberId,
      startsOn,
      endsOn,
      JSON.stringify(skipWeeks),
      NOW,
      NOW,
    );
  }

  course(id: string, memberId: string, termId: string | null, code = 'MAT102H5F', remind = true): void {
    this.d1.rows(
      "INSERT INTO timetable_courses (id, member_id, term_id, code, color, remind, created_at, updated_at) VALUES (?, ?, ?, ?, 'purple', ?, ?, ?)",
      id,
      memberId,
      termId,
      code,
      remind ? 1 : 0,
      NOW,
      NOW,
    );
  }

  meeting(id: string, courseId: string, memberId: string, weekday: number, startMin: number, endMin = startMin + 50, rule: WeekRule = 'all', list: number[] | null = null): void {
    this.d1.rows(
      "INSERT INTO timetable_meetings (id, course_id, member_id, kind, weekday, start_min, end_min, location, week_rule, week_list, created_at, updated_at) VALUES (?, ?, ?, 'lec', ?, ?, ?, 'DV 2074', ?, ?, ?, ?)",
      id,
      courseId,
      memberId,
      weekday,
      startMin,
      endMin,
      rule,
      list ? JSON.stringify(list) : null,
      NOW,
      NOW,
    );
  }

  skip(memberId: string, onDate: string, meetingId: string | null): boolean {
    const before = this.d1.rows<{ n: number }>('SELECT count(*) AS n FROM timetable_skips')[0]?.n ?? 0;
    this.d1.rows('INSERT INTO timetable_skips (member_id, on_date, meeting_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', memberId, onDate, meetingId, NOW);
    return (this.d1.rows<{ n: number }>('SELECT count(*) AS n FROM timetable_skips')[0]?.n ?? 0) > before;
  }

  assignment(id: string, memberId: string, courseId: string | null, dueAt: string, offsets: string[] = ['1d', '1h'], doneAt: string | null = null): void {
    this.d1.rows(
      "INSERT INTO timetable_assignments (id, member_id, course_id, title, due_at, remind_offsets, done_at, created_at, updated_at) VALUES (?, ?, ?, 'PS3', ?, ?, ?, ?, ?)",
      id,
      memberId,
      courseId,
      dueAt,
      JSON.stringify(offsets),
      doneAt,
      NOW,
      NOW,
    );
  }

  /** A ledger row; returns its id. */
  /** 一条提醒记录；返回其 id。 */
  reminder(row: {
    memberId: string;
    kind?: 'class' | 'assignment';
    meetingId?: string | null;
    assignmentId?: string | null;
    occursAt: string;
    offsetKey?: string;
    sendAt: string;
    expiresAt?: string;
    status?: string;
    attempts?: number;
    claimedAt?: string | null;
  }): number {
    const kind = row.kind ?? 'assignment';
    const result = this.d1.rows<{ id: number }>(
      `INSERT INTO timetable_reminders (member_id, kind, meeting_id, assignment_id, occurs_at, offset_key, send_at, expires_at, status, attempts, claimed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      row.memberId,
      kind,
      kind === 'class' ? (row.meetingId ?? null) : null,
      kind === 'assignment' ? (row.assignmentId ?? null) : null,
      row.occursAt,
      row.offsetKey ?? (kind === 'class' ? '10m' : '1h'),
      row.sendAt,
      row.expiresAt ?? row.occursAt,
      row.status ?? 'pending',
      row.attempts ?? 0,
      row.claimedAt ?? null,
      NOW,
    );
    return Number(result[0]?.id);
  }
}

function ledger(d1: SqliteD1): { id: number; status: string; attempts: number; claimed_at: string | null; sent_at: string | null }[] {
  return d1.rows('SELECT id, status, attempts, claimed_at, sent_at FROM timetable_reminders ORDER BY id');
}

/** One slot as classSlots would give it, for a lead, a Toronto date and a start. */
/** 与 classSlots 给出的一致的一个时刻：提前时间、多伦多日期和开始时间。 */
function slot(lead: 5 | 10 | 15 | 20 | 30, onDate: string, startMin: number): ClassSlot {
  return { lead, weekday: isoWeekday(onDate), startMin, onDate, occursAt: iso(instantAt(onDate, startMin)) };
}

describe.skipIf(!sqlite)('timetable reminder ledger SQL', () => {
  let d1: SqliteD1;
  let db: D1Database;
  let seed: Seed;

  beforeEach(() => {
    d1 = createSqliteD1();
    db = d1.db;
    seed = new Seed(d1);
  });

  afterEach(() => {
    d1.close();
  });

  describe('class scan', () => {
    it('equals the shared occursOn on random data', async () => {
      let state = 7;
      const rand = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
      const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
      const terms = new Map<string, TimetableTerm>();
      const meetings: { meeting: TimetableMeeting; memberId: string; termId: string | null }[] = [];
      const skips = new Map<string, TimetableSkip[]>();
      for (let i = 0; i < 10; i += 1) {
        const memberId = `m${i}`;
        seed.member(memberId);
        const startsOn = addDays('2026-09-01', Math.floor(rand() * 14));
        const term: TimetableTerm = {
          id: tid('tt', `t${i}`),
          name: 'Fall',
          startsOn,
          endsOn: addDays(startsOn, 70 + Math.floor(rand() * 40)),
          skipWeeks: rand() < 0.7 ? [Math.floor(rand() * 8) + 4] : [],
          updatedAt: NOW,
        };
        seed.term(term.id, memberId, term.startsOn, term.endsOn, term.skipWeeks);
        terms.set(term.id, term);
        const mine: TimetableMeeting[] = [];
        for (let c = 0; c < 4; c += 1) {
          const termId = rand() < 0.75 ? term.id : null;
          const courseId = tid('tc', `c${i}x${c}`);
          seed.course(courseId, memberId, termId);
          for (let k = 0; k < 3; k += 1) {
            // Term-less courses keep their rule, which the scan and occursOn both ignore without a term.
            // 不属于学期的课程也保留其周次规则；没有学期时扫描和 occursOn 都忽略它。
            const weekRule = pick<WeekRule>(['all', 'all', 'odd', 'even', 'list']);
            let weekList: number[] | null = weekRule === 'list' ? [1, 2, 5, 9, 11].filter(() => rand() < 0.6) : null;
            if (weekList && weekList.length === 0) weekList = [3];
            const startMin = 540 + 30 * Math.floor(rand() * 24);
            const meeting: TimetableMeeting = {
              id: tid('tm', `m${i}x${c}x${k}`),
              kind: 'lec',
              section: null,
              weekday: (1 + Math.floor(rand() * 7)) as TimetableMeeting['weekday'],
              startMin,
              endMin: startMin + 50,
              location: null,
              weekRule,
              weekList,
            };
            seed.meeting(meeting.id, courseId, memberId, meeting.weekday, meeting.startMin, meeting.endMin, meeting.weekRule, meeting.weekList);
            meetings.push({ meeting, memberId, termId });
            mine.push(meeting);
          }
        }
        const list: TimetableSkip[] = [];
        for (let s = 0; s < 6; s += 1) {
          const onDate = addDays('2026-09-01', Math.floor(rand() * 110));
          const meetingId = rand() < 0.3 ? null : pick(mine).id;
          if (seed.skip(memberId, onDate, meetingId)) list.push({ onDate, meetingId, label: null });
        }
        skips.set(memberId, list);
      }
      const skipIndexes = new Map([...skips].map(([memberId, list]) => [memberId, indexSkips(list)]));

      const starts = Array.from({ length: 24 }, (_, i) => 540 + 30 * i);
      let scans = 0;
      let hits = 0;
      for (let onDate = '2026-09-01'; onDate <= '2026-12-31'; onDate = addDays(onDate, 1)) {
        for (let i = 0; i < starts.length; i += 16) {
          const part = starts.slice(i, i + 16);
          const found = await scanClassReminders(db, part.map((startMin) => slot(10, onDate, startMin)));
          expect(found.length).toBeLessThan(CLASS_SCAN_LIMIT);
          const got = found.map((row) => `${row.meetingId}@${row.onDate}@${row.startMin}@${row.occursAt}`).sort();
          const want = meetings
            .filter(({ meeting, memberId, termId }) => part.includes(meeting.startMin) && occursOn(meeting, termId ? (terms.get(termId) ?? null) : null, skipIndexes.get(memberId) ?? new Set(), onDate))
            .map(({ meeting }) => `${meeting.id}@${onDate}@${meeting.startMin}@${iso(instantAt(onDate, meeting.startMin))}`)
            .sort();
          expect(got).toEqual(want);
          scans += 1;
          hits += want.length;
        }
      }
      expect(scans).toBe(244);
      expect(hits).toBeGreaterThan(500);
    });

    it('returns what the push needs, with the lead and the member language', async () => {
      seed.member('m1', { locale: 'en', lead: 15 });
      seed.course(tid('tc', 'a'), 'm1', null, 'CSC108H5F');
      seed.meeting(tid('tm', 'a'), tid('tc', 'a'), 'm1', 1, 600, 650);
      expect(await scanClassReminders(db, [slot(15, '2026-10-26', 600)])).toEqual([
        {
          meetingId: tid('tm', 'a'),
          memberId: 'm1',
          courseId: tid('tc', 'a'),
          kind: 'lec',
          section: null,
          startMin: 600,
          endMin: 650,
          location: 'DV 2074',
          code: 'CSC108H5F',
          title: null,
          onDate: '2026-10-26',
          occursAt: '2026-10-26T14:00:00.000Z',
          lead: 15,
          locale: 'en',
        },
      ]);
      expect(await scanClassReminders(db, [])).toEqual([]);
    });

    describe('switches', () => {
      const course = tid('tc', 'probe');
      const meeting = tid('tm', 'probe');
      const probe = async () => (await scanClassReminders(db, [slot(10, '2026-10-26', 600)])).length;

      beforeEach(() => {
        seed.member('m1');
        seed.course(course, 'm1', null);
        seed.meeting(meeting, course, 'm1', 1, 600);
      });

      it('finds the class with every switch on', async () => {
        expect(await probe()).toBe(1);
      });

      it('hides it when the course switch is off', async () => {
        d1.rows('UPDATE timetable_courses SET remind = 0');
        expect(await probe()).toBe(0);
      });

      it('hides it when class reminders are off, or the member never saved settings', async () => {
        d1.rows('UPDATE timetable_settings SET class_reminders = 0');
        expect(await probe()).toBe(0);
        d1.rows('DELETE FROM timetable_settings');
        expect(await probe()).toBe(0);
      });

      it('matches only the member lead', async () => {
        d1.rows('UPDATE timetable_settings SET class_lead_min = 30');
        expect(await probe()).toBe(0);
        expect((await scanClassReminders(db, [slot(30, '2026-10-26', 600)])).length).toBe(1);
      });

      it('hides it when 课表提醒 is off, and keeps it with a row that leaves it on', async () => {
        d1.rows("INSERT INTO notification_prefs (member_id, timetable, updated_at) VALUES ('m1', 1, ?)", NOW);
        expect(await probe()).toBe(1);
        d1.rows('UPDATE notification_prefs SET timetable = 0');
        expect(await probe()).toBe(0);
      });

      it('hides it for a member who is not active', async () => {
        d1.rows("UPDATE members SET status = 'disabled'");
        expect(await probe()).toBe(0);
      });

      it('hides it for a member without a device', async () => {
        d1.rows('DELETE FROM push_devices');
        expect(await probe()).toBe(0);
      });

      it('hides it on a holiday or a single skip, and not on another class skip', async () => {
        seed.skip('m1', '2026-10-26', null);
        expect(await probe()).toBe(0);
        d1.rows('DELETE FROM timetable_skips');
        seed.meeting(tid('tm', 'second'), course, 'm1', 1, 700);
        seed.skip('m1', '2026-10-26', tid('tm', 'second'));
        expect(await probe()).toBe(1);
        seed.skip('m1', '2026-10-26', meeting);
        expect(await probe()).toBe(0);
      });

      it('hides an occurrence already in the ledger, and finds the class again at a new time', async () => {
        const claimed = await claimClassReminders(db, [{ memberId: 'm1', meetingId: meeting, occursAt: '2026-10-26T14:00:00.000Z', lead: 10 }], Date.parse('2026-10-26T13:50:00Z'));
        expect(claimed).toHaveLength(1);
        expect(await probe()).toBe(0);
        d1.rows('UPDATE timetable_meetings SET start_min = 630, end_min = 680');
        expect((await scanClassReminders(db, [slot(10, '2026-10-26', 630)])).length).toBe(1);
      });
    });

    it('takes the term range, reading week and week rules into account', async () => {
      seed.member('m1');
      // Term starts Thursday 2026-09-03: week 1 is Aug 31 - Sep 6, reading week is week 8 (Oct 19 - 25).
      const term = tid('tt', 'fall');
      seed.term(term, 'm1', '2026-09-03', '2026-12-02', [8]);
      seed.course(tid('tc', 'a'), 'm1', term);
      seed.meeting(tid('tm', 'all'), tid('tc', 'a'), 'm1', 1, 600);
      seed.meeting(tid('tm', 'odd'), tid('tc', 'a'), 'm1', 1, 660, 710, 'odd');
      seed.meeting(tid('tm', 'even'), tid('tc', 'a'), 'm1', 1, 720, 770, 'even');
      seed.meeting(tid('tm', 'list'), tid('tc', 'a'), 'm1', 1, 780, 830, 'list', [9]);
      const found = async (onDate: string) =>
        (await scanClassReminders(db, [600, 660, 720, 780].map((startMin) => slot(10, onDate, startMin)))).map((row) => row.meetingId).sort();
      // Monday Oct 26 is week 9 (odd).
      expect(await found('2026-10-26')).toEqual([tid('tm', 'all'), tid('tm', 'list'), tid('tm', 'odd')].sort());
      // Monday Nov 2 is week 10 (even).
      expect(await found('2026-11-02')).toEqual([tid('tm', 'all'), tid('tm', 'even')].sort());
      // Monday Oct 19 is reading week.
      expect(await found('2026-10-19')).toEqual([]);
      // Monday Aug 31 is in week 1 but before the term starts; Monday Dec 7 is after it ends.
      expect(await found('2026-08-31')).toEqual([]);
      expect(await found('2026-12-07')).toEqual([]);
    });

    it('finds classes from the run time on both sides of each clock change', async () => {
      seed.member('m1');
      seed.course(tid('tc', 'a'), 'm1', null);
      seed.meeting(tid('tm', 'mon'), tid('tc', 'a'), 'm1', 1, 600);
      seed.meeting(tid('tm', 'sun'), tid('tc', 'a'), 'm1', 7, 540);
      const at = async (runMs: number) => (await scanClassReminders(db, classSlots(runMs))).map((row) => [row.meetingId, row.occursAt]);
      expect(await at(toronto(2026, 10, 26, 9, 50))).toEqual([[tid('tm', 'mon'), '2026-10-26T14:00:00.000Z']]);
      expect(await at(toronto(2026, 11, 1, 8, 50))).toEqual([[tid('tm', 'sun'), '2026-11-01T14:00:00.000Z']]);
      expect(await at(toronto(2026, 11, 2, 9, 50))).toEqual([[tid('tm', 'mon'), '2026-11-02T15:00:00.000Z']]);
      expect(await at(toronto(2027, 3, 14, 8, 50))).toEqual([[tid('tm', 'sun'), '2027-03-14T13:00:00.000Z']]);
      expect(await at(toronto(2027, 3, 15, 9, 50))).toEqual([[tid('tm', 'mon'), '2027-03-15T14:00:00.000Z']]);
      // UTC 09:50 on Monday is not Toronto 09:50.
      expect(await at(Date.parse('2026-10-26T09:50:00Z'))).toEqual([]);
    });

    it('uses an index for every join and subquery', async () => {
      seed.member('m1');
      d1.statements.length = 0;
      await scanClassReminders(db, [slot(10, '2026-10-26', 600), slot(10, '2026-10-26', 630)]);
      const plan = d1.explain(d1.statements[0] as (typeof d1.statements)[number]).join('\n');
      expect(plan).toContain('timetable_meetings_slot');
      expect(plan).toContain('timetable_skips_key');
      expect(plan).toContain('timetable_reminders_class');
      expect(plan).toContain('push_devices_member');
      expect(plan).not.toMatch(/SCAN (m|timetable_meetings|timetable_reminders|timetable_skips|push_devices)\b/);
    });
  });

  describe('claimClassReminders', () => {
    beforeEach(() => {
      seed.member('m1');
      seed.course(tid('tc', 'a'), 'm1', null);
      seed.meeting(tid('tm', 'a'), tid('tc', 'a'), 'm1', 1, 600);
      seed.meeting(tid('tm', 'b'), tid('tc', 'a'), 'm1', 1, 630);
    });

    const runMs = Date.parse('2026-10-26T13:50:00Z');
    const claims = [
      { memberId: 'm1', meetingId: tid('tm', 'a'), occursAt: '2026-10-26T14:00:00.000Z', lead: 10 as const },
      { memberId: 'm1', meetingId: tid('tm', 'b'), occursAt: '2026-10-26T14:30:00.000Z', lead: 30 as const },
    ];

    it('writes rows in sending with one attempt, the lead, and the class start as the expiry', async () => {
      const claimed = await claimClassReminders(db, claims, runMs);
      expect(claimed.map((row) => [row.meetingId, row.occursAt])).toEqual(claims.map((claim) => [claim.meetingId, claim.occursAt]));
      expect(d1.rows('SELECT kind, meeting_id, occurs_at, offset_key, send_at, expires_at, status, attempts, claimed_at, created_at FROM timetable_reminders ORDER BY id')).toEqual([
        {
          kind: 'class',
          meeting_id: tid('tm', 'a'),
          occurs_at: '2026-10-26T14:00:00.000Z',
          offset_key: '10m',
          send_at: '2026-10-26T13:50:00.000Z',
          expires_at: '2026-10-26T14:00:00.000Z',
          status: 'sending',
          attempts: 1,
          claimed_at: '2026-10-26T13:50:00.000Z',
          created_at: '2026-10-26T13:50:00.000Z',
        },
        {
          kind: 'class',
          meeting_id: tid('tm', 'b'),
          occurs_at: '2026-10-26T14:30:00.000Z',
          offset_key: '30m',
          send_at: '2026-10-26T14:00:00.000Z',
          expires_at: '2026-10-26T14:30:00.000Z',
          status: 'sending',
          attempts: 1,
          claimed_at: '2026-10-26T13:50:00.000Z',
          created_at: '2026-10-26T13:50:00.000Z',
        },
      ]);
    });

    it('returns nothing when an overlapping run claims the same classes again', async () => {
      expect(await claimClassReminders(db, claims, runMs)).toHaveLength(2);
      expect(await claimClassReminders(db, claims, runMs + MIN)).toEqual([]);
      const moved = { ...claims[0], occursAt: '2026-10-26T14:05:00.000Z' } as (typeof claims)[number];
      expect((await claimClassReminders(db, [...claims, moved], runMs + MIN)).map((row) => row.occursAt)).toEqual(['2026-10-26T14:05:00.000Z']);
      expect(await claimClassReminders(db, [], runMs)).toEqual([]);
    });
  });

  describe('claimDueReminders', () => {
    const T = Date.parse('2026-10-26T13:50:00Z');
    let assignment: string;

    beforeEach(() => {
      seed.member('m1');
      assignment = tid('ta', 'a');
      seed.assignment(assignment, 'm1', null, '2026-10-27T03:59:00.000Z');
    });

    const base = () => ({ memberId: 'm1', assignmentId: assignment, occursAt: '2026-10-27T03:59:00.000Z' });

    it('claims due rows, leaves future ones, and cancels rows about to expire', async () => {
      const due = seed.reminder({ ...base(), offsetKey: '1d', sendAt: iso(T - 5 * MIN) });
      const future = seed.reminder({ ...base(), offsetKey: '1h', sendAt: iso(T + MIN) });
      const expiring = seed.reminder({ ...base(), occursAt: iso(T + 30_000), offsetKey: '30m', sendAt: iso(T - 30 * MIN) });
      const claimed = await claimDueReminders(db, T);
      expect(claimed).toEqual({
        rows: [{ id: due, memberId: 'm1', kind: 'assignment', meetingId: null, assignmentId: assignment, occursAt: '2026-10-27T03:59:00.000Z', offsetKey: '1d', attempts: 1 }],
        abandoned: 0,
        expired: 1,
      });
      expect(ledger(d1)).toEqual([
        { id: due, status: 'sending', attempts: 1, claimed_at: iso(T), sent_at: null },
        { id: future, status: 'pending', attempts: 0, claimed_at: null, sent_at: null },
        { id: expiring, status: 'cancelled', attempts: 0, claimed_at: null, sent_at: null },
      ]);
      expect(await claimDueReminders(db, T)).toEqual({ rows: [], abandoned: 0, expired: 0 });
    });

    it('puts abandoned rows back and claims them again, and fails them after three attempts or near expiry', async () => {
      const stuck = seed.reminder({ ...base(), offsetKey: '1d', sendAt: iso(T - 10 * MIN), status: 'sending', attempts: 1, claimedAt: iso(T - 4 * MIN) });
      const tired = seed.reminder({ ...base(), offsetKey: '3h', sendAt: iso(T - 10 * MIN), status: 'sending', attempts: 3, claimedAt: iso(T - 4 * MIN) });
      const late = seed.reminder({ ...base(), occursAt: iso(T + 50_000), offsetKey: '30m', sendAt: iso(T - 30 * MIN), status: 'sending', attempts: 1, claimedAt: iso(T - 4 * MIN) });
      const busy = seed.reminder({ ...base(), offsetKey: '1h', sendAt: iso(T - 2 * MIN), status: 'sending', attempts: 1, claimedAt: iso(T - 2 * MIN) });
      const claimed = await claimDueReminders(db, T);
      expect(claimed.rows.map((row) => [row.id, row.attempts])).toEqual([[stuck, 2]]);
      expect(claimed).toMatchObject({ abandoned: 3, expired: 0 });
      expect(ledger(d1).map((row) => [row.id, row.status, row.attempts])).toEqual([
        [stuck, 'sending', 2],
        [tired, 'failed', 3],
        [late, 'failed', 1],
        [busy, 'sending', 1],
      ]);
    });

    it(`claims at most ${REMINDER_CLAIM_BATCH} rows, the earliest first`, async () => {
      const ids: number[] = [];
      for (let i = 0; i < REMINDER_CLAIM_BATCH + 5; i += 1) {
        const id = tid('ta', `n${i}`);
        seed.assignment(id, 'm1', null, '2026-10-27T03:59:00.000Z', ['1h']);
        ids.push(seed.reminder({ memberId: 'm1', assignmentId: id, occursAt: '2026-10-27T03:59:00.000Z', sendAt: iso(T - (100 - i) * MIN) }));
      }
      const claimed = await claimDueReminders(db, T);
      expect(claimed.rows.map((row) => row.id).sort((a, b) => a - b)).toEqual(ids.slice(0, REMINDER_CLAIM_BATCH));
    });

    it('claims class rows put back for a retry', async () => {
      seed.course(tid('tc', 'a'), 'm1', null);
      seed.meeting(tid('tm', 'a'), tid('tc', 'a'), 'm1', 1, 600);
      const retry = seed.reminder({ memberId: 'm1', kind: 'class', meetingId: tid('tm', 'a'), occursAt: '2026-10-26T14:00:00.000Z', sendAt: iso(T - MIN), attempts: 1 });
      expect((await claimDueReminders(db, T)).rows).toEqual([
        { id: retry, memberId: 'm1', kind: 'class', meetingId: tid('tm', 'a'), assignmentId: null, occursAt: '2026-10-26T14:00:00.000Z', offsetKey: '10m', attempts: 2 },
      ]);
    });

    it('uses the status and send-time index, and rowid lookups for the outer update', async () => {
      d1.statements.length = 0;
      await claimDueReminders(db, T);
      const [requeue, cancel, claim] = d1.statements.map((statement) => d1.explain(statement).join('\n'));
      expect(requeue).toContain('timetable_reminders_due');
      expect(cancel).toContain('timetable_reminders_due');
      expect(claim).toContain('timetable_reminders_due');
      expect(claim).toMatch(/INTEGER PRIMARY KEY|rowid/i);
    });
  });

  describe('finishReminders', () => {
    const T = Date.parse('2026-10-26T13:50:00Z');

    it('records each outcome, retrying only while attempts and time remain, and touches only rows in sending', async () => {
      seed.member('m1');
      const a = tid('ta', 'a');
      seed.assignment(a, 'm1', null, '2026-10-27T03:59:00.000Z');
      let n = 0;
      const row = (patch: { attempts?: number; occursAt?: string; status?: string } = {}) =>
        seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: patch.occursAt ?? '2026-10-27T03:59:00.000Z', offsetKey: `k${(n += 1)}`, sendAt: iso(T - MIN), status: patch.status ?? 'sending', attempts: patch.attempts ?? 1, claimedAt: iso(T) });
      const sent = row();
      const skipped = row();
      const failed = row();
      const cancelled = row();
      const again = row();
      const third = row({ attempts: 3 });
      const expiring = row({ occursAt: iso(T + 30_000) });
      const pending = row({ status: 'pending' });
      await finishReminders(db, { sent: [sent, pending], skipped: [skipped], failed: [failed], cancelled: [cancelled], retry: [again, third, expiring] }, T, T + 5_000);
      expect(ledger(d1).map((r) => [r.id, r.status, r.claimed_at === null, r.sent_at])).toEqual([
        [sent, 'sent', false, iso(T + 5_000)],
        [skipped, 'skipped', false, null],
        [failed, 'failed', false, null],
        [cancelled, 'cancelled', false, null],
        [again, 'pending', true, null],
        [third, 'failed', true, null],
        [expiring, 'failed', true, null],
        [pending, 'pending', false, null],
      ]);
    });

    it('writes nothing when there is nothing to finish', async () => {
      d1.statements.length = 0;
      await finishReminders(db, { sent: [], skipped: [], failed: [], cancelled: [], retry: [] }, T, T);
      expect(d1.statements).toEqual([]);
    });

    it('takes any number of ids in one statement per outcome', async () => {
      seed.member('m1');
      const a = tid('ta', 'a');
      seed.assignment(a, 'm1', null, '2026-10-27T03:59:00.000Z');
      const ids = Array.from({ length: 150 }, (_, i) =>
        seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: '2026-10-27T03:59:00.000Z', offsetKey: `k${i}`, sendAt: iso(T - MIN), status: 'sending', attempts: 1, claimedAt: iso(T) }),
      );
      d1.statements.length = 0;
      await finishReminders(db, { sent: ids, skipped: [], failed: [], cancelled: [], retry: [] }, T, T);
      expect(d1.statements).toHaveLength(1);
      expect(d1.statements[0]?.params).toHaveLength(2);
      expect(d1.rows("SELECT count(*) AS n FROM timetable_reminders WHERE status = 'sent'")).toEqual([{ n: 150 }]);
      expect(d1.explain(d1.statements[0] as (typeof d1.statements)[number]).join('\n')).toMatch(/INTEGER PRIMARY KEY|rowid/i);
    });
  });

  describe('pruneReminders', () => {
    it(`deletes finished rows older than 14 days, at most ${REMINDER_PRUNE_BATCH} a run, and keeps the rest`, async () => {
      const T = Date.parse('2026-11-20T12:07:00Z');
      seed.member('m1');
      const a = tid('ta', 'a');
      seed.assignment(a, 'm1', null, '2026-12-01T03:59:00.000Z');
      const old = iso(T - 15 * DAY);
      const kept: number[] = [];
      for (const status of ['sent', 'skipped', 'cancelled', 'failed']) seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: old, offsetKey: status, sendAt: old, status });
      kept.push(seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: old, offsetKey: 'pending', sendAt: old, status: 'pending' }));
      kept.push(seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: old, offsetKey: 'sending', sendAt: old, status: 'sending', claimedAt: old }));
      kept.push(seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: old, offsetKey: 'recent', sendAt: iso(T - 13 * DAY), status: 'sent' }));
      expect(await pruneReminders(db, T)).toBe(4);
      expect(ledger(d1).map((row) => row.id)).toEqual(kept);

      for (let i = 0; i < REMINDER_PRUNE_BATCH + 20; i += 1) seed.reminder({ memberId: 'm1', assignmentId: a, occursAt: old, offsetKey: `n${i}`, sendAt: old, status: 'sent' });
      expect(await pruneReminders(db, T)).toBe(REMINDER_PRUNE_BATCH);
      expect(await pruneReminders(db, T)).toBe(20);
      d1.statements.length = 0;
      await pruneReminders(db, T);
      expect(d1.explain(d1.statements[0] as (typeof d1.statements)[number]).join('\n')).toContain('timetable_reminders_due');
    });
  });

  describe('loadReminderDetails', () => {
    beforeEach(() => {
      seed.member('m1', { locale: 'en' });
      seed.member('m2', { settings: false });
      seed.term(tid('tt', 'fall'), 'm1', '2026-09-03', '2026-12-02', [8]);
      seed.course(tid('tc', 'term'), 'm1', tid('tt', 'fall'), 'MAT102H5F', false);
      seed.course(tid('tc', 'free'), 'm1', null, 'CSC108H5F');
      seed.meeting(tid('tm', 'term'), tid('tc', 'term'), 'm1', 1, 600, 650, 'list', [9, 11]);
      seed.meeting(tid('tm', 'free'), tid('tc', 'free'), 'm1', 1, 660);
      seed.assignment(tid('ta', 'open'), 'm1', tid('tc', 'free'), '2026-10-27T03:59:00.000Z', ['1d', 'bogus', '1h']);
      seed.assignment(tid('ta', 'done'), 'm1', null, '2026-10-27T03:59:00.000Z', [], '2026-10-25T00:00:00.000Z');
    });

    it('loads assignments, retried meetings with their term and skips, and settings in one batch', async () => {
      seed.skip('m1', '2026-10-26', tid('tm', 'term'));
      d1.statements.length = 0;
      const details = await loadReminderDetails(db, {
        assignmentIds: [tid('ta', 'open'), tid('ta', 'done'), tid('ta', 'gone')],
        classRows: [
          { id: 1, meetingId: tid('tm', 'term'), memberId: 'm1', onDate: '2026-10-26' },
          { id: 2, meetingId: tid('tm', 'free'), memberId: 'm1', onDate: '2026-10-26' },
          { id: 3, meetingId: tid('tm', 'free'), memberId: 'm2', onDate: '2026-10-26' },
        ],
        memberIds: ['m1', 'm2'],
      });
      expect(d1.statements).toHaveLength(3);
      expect(details.assignments.get(tid('ta', 'open'))).toEqual({
        id: tid('ta', 'open'),
        memberId: 'm1',
        title: 'PS3',
        dueAt: '2026-10-27T03:59:00.000Z',
        done: false,
        remindOffsets: ['1d', '1h'],
        courseCode: 'CSC108H5F',
      });
      expect(details.assignments.get(tid('ta', 'done'))).toMatchObject({ done: true, remindOffsets: [], courseCode: null });
      expect(details.assignments.has(tid('ta', 'gone'))).toBe(false);
      expect(details.meetings.get(1)).toEqual({
        reminderId: 1,
        meetingId: tid('tm', 'term'),
        memberId: 'm1',
        kind: 'lec',
        weekday: 1,
        startMin: 600,
        endMin: 650,
        location: 'DV 2074',
        weekRule: 'list',
        weekList: [9, 11],
        code: 'MAT102H5F',
        remind: false,
        term: { startsOn: '2026-09-03', endsOn: '2026-12-02', skipWeeks: [8] },
        skipped: true,
      });
      expect(details.meetings.get(2)).toMatchObject({ term: null, skipped: false, remind: true, weekList: null });
      // A meeting is only loaded for its own member.
      // 上课时间只为其所属成员加载。
      expect(details.meetings.has(3)).toBe(false);
      expect(details.settings.get('m1')).toEqual({ locale: 'en', classReminders: true });
      expect(details.settings.has('m2')).toBe(false);
    });

    it('sees a holiday as a skip', async () => {
      seed.skip('m1', '2026-10-26', null);
      const details = await loadReminderDetails(db, { assignmentIds: [], classRows: [{ id: 9, meetingId: tid('tm', 'free'), memberId: 'm1', onDate: '2026-10-26' }], memberIds: [] });
      expect(details.meetings.get(9)?.skipped).toBe(true);
    });

    it('reads nothing when asked for nothing', async () => {
      d1.statements.length = 0;
      const details = await loadReminderDetails(db, { assignmentIds: [], classRows: [], memberIds: [] });
      expect(d1.statements).toEqual([]);
      expect(details.assignments.size + details.meetings.size + details.settings.size).toBe(0);
    });
  });
});
