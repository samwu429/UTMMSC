import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wallTimeToUtcMs, type NotificationPrefs, type PushPayload } from '@utmmsc/shared';
import type { Env } from '../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../d1/testing/sqlite-d1';
import { INLINE_PUSH_MAX, memberPushOutcome, sendToMembersReport } from './send';
import { runTimetableReminders } from './timetable-reminders';
import type { DeliveryJob, DeliveryOutcome, JobOutcome } from './types';

/**
 * sendToMembersReport, the timetable job's way to push: one outcome per member asked about, from the outcomes of
 * their live devices, through the relay in every mode the caller picks, with devices pruned like any other push.
 * Devices are read from real SQLite with every migration; the relay is a stub.
 * sendToMembersReport 是课表工作发送推送的方式：根据每位被询问成员各台有效设备的结果，为其给出一个结果；按调用方选择的模式经由中继发送，
 * 设备的清理与其他推送相同。设备从执行了全部迁移的真实 SQLite 读取；中继为替身。
 */

const NOW = '2026-10-01T12:00:00.000Z';
const payload: PushPayload = { title: 'MAT102 · 10 分钟后上课', body: '10:00–10:50', tag: 'tt:class', url: 'https://utmmsc.com/UTMMSC/timetable', kind: 'class', ttlSeconds: 600 };

describe('memberPushOutcome', () => {
  it('is sent when any device took it, whatever the others did', () => {
    expect(memberPushOutcome(['gone', 'failed', 'transient', 'sent'])).toBe('sent');
  });

  it('is retry when none took it and any failure lay with the push service or our credentials', () => {
    expect(memberPushOutcome(['transient'])).toBe('retry');
    expect(memberPushOutcome(['skipped'])).toBe('retry');
    expect(memberPushOutcome(['gone', 'failed', 'transient'])).toBe('retry');
  });

  it('is failed when every device refused it or is gone', () => {
    expect(memberPushOutcome(['failed'])).toBe('failed');
    expect(memberPushOutcome(['gone'])).toBe('failed');
    expect(memberPushOutcome(['failed', 'gone'])).toBe('failed');
  });

  it('is none without any device outcome', () => {
    expect(memberPushOutcome([])).toBe('none');
  });
});

describe.skipIf(!sqlite)('sendToMembersReport', () => {
  let d1: SqliteD1;
  let relayCalls: DeliveryJob[][];
  let answer: (job: DeliveryJob) => DeliveryOutcome;

  const relay = {
    idFromName: (name: string) => name,
    get: () => ({
      deliver: async (jobs: DeliveryJob[]): Promise<JobOutcome[]> => {
        relayCalls.push(jobs);
        return jobs.map((job) => ({ deviceId: job.deviceId, outcome: answer(job) }));
      },
    }),
  };

  const relayEnv = () => ({ DB: d1.db, PUSH_RELAY: relay, APP_BASE_URL: 'https://utmmsc.com/UTMMSC/' }) as unknown as Env;

  function member(id: string, options: { status?: string; preview?: boolean } = {}): void {
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, 'A', 'h', ?, 'student', 'student', 2028, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      options.status ?? 'active',
      NOW,
      NOW,
    );
    d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `s-${id}`, id, '2030-01-01T00:00:00.000Z', NOW);
    if (options.preview === false) d1.rows('INSERT INTO notification_prefs (member_id, preview, updated_at) VALUES (?, 0, ?)', id, NOW);
  }

  function device(id: string, memberId: string, options: { kind?: 'fcm' | 'webpush'; keys?: string | null; session?: string; failures?: number } = {}): void {
    d1.rows(
      'INSERT INTO push_devices (id, member_id, kind, endpoint, keys_json, session_id, created_at, last_seen_at, failure_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      memberId,
      options.kind ?? 'fcm',
      `endpoint-${id}`,
      options.keys ?? null,
      options.session ?? `s-${memberId}`,
      NOW,
      NOW,
      options.failures ?? 0,
    );
  }

  const devices = () => d1.rows<{ id: string; failure_count: number }>('SELECT id, failure_count FROM push_devices ORDER BY id');

  beforeEach(() => {
    d1 = createSqliteD1();
    relayCalls = [];
    answer = () => 'sent';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    d1.close();
  });

  it('reports each member once from the outcomes of their devices', async () => {
    for (const id of ['ok', 'mixed', 'blip', 'refused', 'quiet']) member(id);
    device('ok-1', 'ok');
    device('mixed-1', 'mixed');
    device('mixed-2', 'mixed');
    device('blip-1', 'blip');
    device('refused-1', 'refused');
    device('refused-2', 'refused');
    const outcomes: Record<string, DeliveryOutcome> = { 'ok-1': 'sent', 'mixed-1': 'gone', 'mixed-2': 'sent', 'blip-1': 'transient', 'refused-1': 'failed', 'refused-2': 'gone' };
    answer = (job) => outcomes[job.deviceId] ?? 'transient';
    const report = await sendToMembersReport(relayEnv(), ['ok', 'mixed', 'blip', 'refused', 'quiet', 'ok'], () => payload, { relay: 'always' });
    expect(Object.fromEntries(report)).toEqual({ ok: 'sent', mixed: 'sent', blip: 'retry', refused: 'failed', quiet: 'none' });
    // Gone devices are removed and a refusal is counted, as for any other push.
    // 与其他推送一样，失效的设备被删除，被拒绝的次数被累计。
    expect(devices()).toEqual([
      { id: 'blip-1', failure_count: 0 },
      { id: 'mixed-2', failure_count: 0 },
      { id: 'ok-1', failure_count: 0 },
      { id: 'refused-1', failure_count: 1 },
    ]);
  });

  it('says none for an inactive member, a signed-out device, and a member given no payload', async () => {
    member('gone', { status: 'disabled' });
    member('out');
    member('skipped');
    device('gone-1', 'gone');
    d1.rows("UPDATE sessions SET revoked_at = ? WHERE id = 's-out'", NOW);
    device('out-1', 'out');
    device('skipped-1', 'skipped');
    const payloadFor = vi.fn((memberId: string) => (memberId === 'skipped' ? null : payload));
    const report = await sendToMembersReport(relayEnv(), ['gone', 'out', 'skipped'], payloadFor, { relay: 'always' });
    expect(Object.fromEntries(report)).toEqual({ gone: 'none', out: 'none', skipped: 'none' });
    expect(payloadFor).toHaveBeenCalledTimes(1);
    expect(relayCalls).toEqual([]);
  });

  it('builds one payload per member from their switches, and pushes it to each of their devices', async () => {
    member('alice', { preview: false });
    member('bob');
    device('a1', 'alice');
    device('a2', 'alice');
    device('b1', 'bob');
    const seen: [string, NotificationPrefs][] = [];
    const payloadFor = (memberId: string, prefs: NotificationPrefs): PushPayload => {
      seen.push([memberId, prefs]);
      return { ...payload, title: prefs.preview ? payload.title : 'UTMMSC' };
    };
    await sendToMembersReport(relayEnv(), ['alice', 'bob'], payloadFor, { relay: 'always' });
    expect(seen.map(([memberId, prefs]) => [memberId, prefs.preview]).sort()).toEqual([
      ['alice', false],
      ['bob', true],
    ]);
    expect(
      relayCalls
        .flat()
        .map((job) => [job.deviceId, job.payload.title])
        .sort(),
    ).toEqual([
      ['a1', 'UTMMSC'],
      ['a2', 'UTMMSC'],
      ['b1', 'MAT102 · 10 分钟后上课'],
    ]);
  });

  it('sends even a single push through the relay when asked to always', async () => {
    member('m1');
    device('d1', 'm1');
    expect(Object.fromEntries(await sendToMembersReport(relayEnv(), ['m1'], () => payload, { relay: 'always' }))).toEqual({ m1: 'sent' });
    expect(relayCalls.map((jobs) => jobs.map((job) => job.deviceId))).toEqual([['d1']]);
    expect(relayCalls[0]?.[0]?.payload).toEqual(payload);
  });

  it(`sends up to ${INLINE_PUSH_MAX} pushes inline by default`, async () => {
    member('m1');
    device('d1', 'm1');
    // Inline, with no FCM credentials in the test env, the push is skipped, which is worth a retry.
    // 直接发送时测试环境没有 FCM 凭据，推送被跳过，值得重试。
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(Object.fromEntries(await sendToMembersReport(relayEnv(), ['m1'], () => payload))).toEqual({ m1: 'retry' });
    expect(relayCalls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('sends inline when the relay binding is missing', async () => {
    member('m1');
    device('d1', 'm1');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = { DB: d1.db } as unknown as Env;
    expect(Object.fromEntries(await sendToMembersReport(env, ['m1'], () => payload, { relay: 'always' }))).toEqual({ m1: 'retry' });
  });

  it('reports retry for everyone in a relay call that fails, and penalises no device', async () => {
    member('m1');
    member('m2');
    device('d1', 'm1', { failures: 2 });
    device('d2', 'm2');
    answer = () => {
      throw new Error('relay down');
    };
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(Object.fromEntries(await sendToMembersReport(relayEnv(), ['m1', 'm2'], () => payload, { relay: 'always' }))).toEqual({ m1: 'retry', m2: 'retry' });
    expect(error).toHaveBeenCalledWith('push: relay call failed', 'relay down');
    expect(devices()).toEqual([
      { id: 'd1', failure_count: 2 },
      { id: 'd2', failure_count: 0 },
    ]);
  });

  it('removes a web device whose stored keys cannot be read, and reports the member failed', async () => {
    member('m1');
    device('w1', 'm1', { kind: 'webpush', keys: 'not json' });
    expect(Object.fromEntries(await sendToMembersReport(relayEnv(), ['m1'], () => payload, { relay: 'always' }))).toEqual({ m1: 'failed' });
    expect(relayCalls).toEqual([]);
    expect(devices()).toEqual([]);
  });

  it('reads nothing for an empty list', async () => {
    d1.statements.length = 0;
    expect((await sendToMembersReport(relayEnv(), [], () => payload, { relay: 'always' })).size).toBe(0);
    expect(d1.statements).toEqual([]);
  });

  it('carries a busy timetable run end to end, through the relay and within the statement budget', async () => {
    const tenAm = wallTimeToUtcMs(2026, 10, 26, 10, 0, 'America/Toronto');
    for (let i = 0; i < 40; i += 1) {
      const id = `c${String(i).padStart(2, '0')}`;
      member(id);
      device(`d-${id}`, id);
      d1.rows("INSERT INTO timetable_settings (member_id, class_reminders, class_lead_min, locale, updated_at) VALUES (?, 1, 10, 'zh', ?)", id, NOW);
      const course = `tc_${id.padEnd(22, 'x')}`;
      d1.rows("INSERT INTO timetable_courses (id, member_id, term_id, code, color, remind, created_at, updated_at) VALUES (?, ?, NULL, 'MAT102H5F', 'purple', 1, ?, ?)", course, id, NOW, NOW);
      d1.rows(
        "INSERT INTO timetable_meetings (id, course_id, member_id, kind, weekday, start_min, end_min, location, created_at, updated_at) VALUES (?, ?, ?, 'lec', 1, 600, 650, 'DV 2074', ?, ?)",
        `tm_${id.padEnd(22, 'x')}`,
        course,
        id,
        NOW,
        NOW,
      );
    }
    for (let i = 0; i < 30; i += 1) {
      const id = `a${String(i).padStart(2, '0')}`;
      member(id);
      device(`d-${id}`, id);
      const assignment = `ta_${id.padEnd(22, 'x')}`;
      const due = new Date(tenAm + 5 * 60 * 60_000).toISOString();
      d1.rows("INSERT INTO timetable_assignments (id, member_id, title, due_at, remind_offsets, created_at, updated_at) VALUES (?, ?, 'PS3', ?, '[\"3h\"]', ?, ?)", assignment, id, due, NOW, NOW);
      d1.rows(
        "INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, created_at) VALUES (?, 'assignment', ?, ?, '3h', ?, ?, ?)",
        id,
        assignment,
        due,
        new Date(tenAm - 15 * 60_000).toISOString(),
        due,
        NOW,
      );
    }
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    d1.statements.length = 0;
    const runMs = tenAm - 10 * 60_000;
    const summary = await runTimetableReminders(relayEnv(), new Date(runMs), { clock: () => runMs });
    expect(summary).toMatchObject({ claimed: 30, scanned: 40, sent: 70, retry: 0, failed: 0, skipped: 0, cancelled: 0 });
    expect(d1.statements.length).toBeLessThanOrEqual(30);
    expect(d1.statements.every((statement) => statement.params.length <= 100)).toBe(true);
    // Every push went through the relay, one per member, each kept only until its class starts or for the assignment.
    // 每条推送都经由中继发送，每位成员一条；上课推送只保留到开课，作业推送按作业的保留时间。
    const jobs = relayCalls.flat();
    expect(relayCalls.map((part) => part.length)).toEqual([40, 30]);
    expect(new Set(jobs.map((job) => job.deviceId)).size).toBe(70);
    expect(jobs.filter((job) => job.payload.kind === 'class').every((job) => job.payload.title === 'MAT102 · 10 分钟后上课' && job.payload.ttlSeconds === 600)).toBe(true);
    expect(jobs.filter((job) => job.payload.kind === 'assignment').every((job) => job.payload.ttlSeconds === 5 * 60 * 60 + 10 * 60)).toBe(true);
    expect(d1.rows("SELECT status, count(*) AS n FROM timetable_reminders GROUP BY status")).toEqual([{ status: 'sent', n: 70 }]);
  });

  it('splits more than 90 members into device queries the database accepts', async () => {
    const ids = Array.from({ length: 95 }, (_, i) => `m${String(i).padStart(2, '0')}`);
    for (const id of ids) {
      member(id);
      device(`d-${id}`, id);
    }
    const report = await sendToMembersReport(relayEnv(), ids, () => payload, { relay: 'always' });
    expect([...report.values()].every((outcome) => outcome === 'sent')).toBe(true);
    expect(report.size).toBe(95);
    expect(relayCalls.map((jobs) => jobs.length)).toEqual([40, 40, 15]);
  });
});
