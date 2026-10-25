import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_COUNT_KEYS, ADMIN_SECTION_KEYS, enrollmentCalendarYear, type AdminAnnouncementsResponse, type AdminSummaryResponse, type Role } from '@utmmsc/shared';
import { encodeMomentCursor } from '../../../domain/moments/cursor';
import type { Env } from '../../../env';
import { loadAdminCounts } from '../../../infrastructure/d1/admin-summary';
import { findMemberById, type MemberRow } from '../../../infrastructure/d1/members';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { adminRoutes } from './index';

/** Members the stand-in session knows, by the id sent in x-member. */
/** 替身会话认识的成员，按 x-member 中的 id 查找。 */
const session = vi.hoisted(() => ({ members: new Map<string, unknown>() }));

vi.mock('../../middleware/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/session')>();
  const { unauthorized } = await import('../../errors');
  return {
    ...actual,
    requireSession: async (c: { req: { header(name: string): string | undefined }; set(key: string, value: unknown): void }, next: () => Promise<void>) => {
      const member = session.members.get(c.req.header('x-member') ?? '');
      if (!member) throw unauthorized();
      c.set('member', member);
      c.set('sessionId', 'session-1');
      await next();
    },
  };
});
vi.mock('../../../infrastructure/email/brevo', () => ({ sendMail: vi.fn(async () => true) }));

describe('admin routes', () => {
  const paths = adminRoutes.routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`);

  it('adds the summary and the announcement history beside the existing routes', () => {
    expect(paths).toContain('GET /summary');
    expect(paths).toContain('GET /announcements');
    expect(paths).toContain('POST /announcements');
    expect(paths).toContain('GET /members');
    expect(paths).toContain('GET /applications');
  });
});

const NOW = Date.now();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const DAY = 86_400_000;

let d1: SqliteD1;
let seq = 0;

/** Inserts a member and returns the row the session middleware would load. */
/** 写入一位成员，并返回会话中间件会加载的那一行。 */
async function addMember(options: { role?: Role; status?: 'active' | 'pending' | 'disabled'; acting?: Role | null; name?: string; db?: SqliteD1 } = {}): Promise<MemberRow> {
  const db = options.db ?? d1;
  seq += 1;
  const id = `mem_${seq}`;
  db.rows(
    `INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at, acting_role)
     VALUES (?, ?, ?, 'x', ?, ?, 'student', ?, ?, ?, ?)`,
    id,
    `m${seq}@mail.utoronto.ca`,
    options.name ?? `成员${seq}`,
    options.status ?? 'active',
    options.role ?? 'student',
    enrollmentCalendarYear(),
    iso(-seq * 1000),
    iso(-seq * 1000),
    options.acting ?? null,
  );
  const row = await findMemberById(db.db, id);
  if (!row) throw new Error('member insert failed');
  session.members.set(row.id, row);
  return row;
}

const app = new Hono<AppEnv>();
app.onError(errorResponse);
app.route('/admin', adminRoutes);

async function send<T = Record<string, unknown>>(member: MemberRow, method: string, path: string, json?: unknown): Promise<{ status: number; json: T }> {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  const env = { DB: d1.db, SESSION_SECRET: 'test-secret', APP_BASE_URL: 'https://utmmsc.com/', MAIL_FROM_EMAIL: 'a@b.c', MAIL_FROM_NAME: 'UTMMSC' } as unknown as Env;
  const headers: Record<string, string> = { 'x-member': member.id, 'cf-connecting-ip': '203.0.113.9' };
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await app.request(`/admin${path}`, { method, headers, body: json === undefined ? undefined : JSON.stringify(json) }, env, ctx);
  await Promise.all(pending);
  return { status: response.status, json: (await response.json()) as T };
}

/** Statements that counted something for the summary. */
/** 为摘要计数的语句。 */
const countStatements = () => d1.statements.filter((statement) => /SELECT (status, )?COUNT\(\*\)/.test(statement.sql));

/**
 * The club's waiting work and overview numbers: 2 pending applications, 1 pending year request, 3 open reports (one
 * about the president's own post), 2 upcoming events, 1 open invite, 5 channels, and members by status.
 * 社团待处理事项与概况数字：2 个待审核入会申请、1 个待处理入学年份申请、3 条未处理投诉（其中一条针对主席本人的动态）、
 * 2 个即将开始的活动、1 个未使用的邀请、5 个频道，以及按状态区分的成员。
 */
async function seedClub(db: SqliteD1 = d1, options: { reports?: boolean; invites?: boolean } = {}) {
  const president = await addMember({ role: 'president', db });
  const author = await addMember({ db });
  await addMember({ status: 'disabled', db });
  await addMember({ status: 'pending', db });
  for (const [id, status] of [
    ['app_1', 'pending'],
    ['app_2', 'pending'],
    ['app_3', 'approved'],
  ] as const) {
    db.rows(
      "INSERT INTO manual_applications (id, email, display_name, enrollment_status, graduation_year, status, created_at) VALUES (?, ?, '申请人', 'student', 2024, ?, ?)",
      id,
      `${id}@gmail.com`,
      status,
      iso(-DAY),
    );
  }
  db.rows("INSERT INTO enrollment_year_requests (id, member_id, requested_year, status, created_at) VALUES ('eyr_1', ?, 2023, 'pending', ?)", author.id, iso(-DAY));
  db.rows("INSERT INTO enrollment_year_requests (id, member_id, requested_year, status, created_at) VALUES ('eyr_2', ?, 2022, 'approved', ?)", author.id, iso(-2 * DAY));
  for (const [id, startsAt] of [
    ['ev_past', iso(-DAY)],
    ['ev_soon', iso(DAY)],
    ['ev_later', iso(30 * DAY)],
  ] as const) {
    db.rows("INSERT INTO events (id, title, starts_at, created_by, created_at) VALUES (?, '活动', ?, ?, ?)", id, startsAt, president.id, iso(-DAY));
  }
  db.rows("INSERT INTO channels (id, slug, name, audience, post_policy, created_at) VALUES ('ch_extra', 'extra', '学术交流', 'all', 'members', ?)", iso(-DAY));
  if (options.invites !== false) {
    for (const [id, expiresAt, consumedAt] of [
      ['inv_open', iso(DAY), null],
      ['inv_used', iso(DAY), iso(-1000)],
      ['inv_expired', iso(-1000), null],
    ] as const) {
      db.rows(
        "INSERT INTO advisor_invites (id, email, token_hash, expires_at, consumed_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, 'mem_x', ?)",
        id,
        `${id}@example.com`,
        `hash_${id}`,
        expiresAt,
        consumedAt,
        iso(-DAY),
      );
    }
  }
  if (options.reports !== false) {
    const reporters = [await addMember({ db }), await addMember({ db }), await addMember({ db })];
    const report = (id: string, reporter: MemberRow, target: MemberRow, status: string) =>
      db.rows(
        "INSERT INTO moment_reports (id, reporter_id, post_id, target_member_id, reason, snapshot_json, status, created_at) VALUES (?, ?, ?, ?, 'spam', '{}', ?, ?)",
        id,
        reporter.id,
        `post_${id}`,
        target.id,
        status,
        iso(-1000),
      );
    report('rep_1', reporters[0] as MemberRow, author, 'open');
    report('rep_2', reporters[1] as MemberRow, author, 'open');
    report('rep_3', reporters[2] as MemberRow, president, 'open');
    report('rep_4', reporters[0] as MemberRow, president, 'dismissed');
  }
  return { president, author };
}

beforeEach(() => {
  if (sqlite) d1 = createSqliteD1();
});

afterEach(() => {
  d1?.close();
});

describe.skipIf(!sqlite)('GET /admin/summary', () => {
  it('gives an ordinary member no sections and runs no query', async () => {
    await seedClub();
    const student = await addMember();
    d1.statements.length = 0;
    const result = await send<AdminSummaryResponse>(student, 'GET', '/summary');
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ sections: [], counts: {} });
    expect(countStatements()).toHaveLength(0);
  });

  it('gives 活动部部长 only the events section and its count', async () => {
    await seedClub();
    const head = await addMember({ role: 'head_events' });
    d1.statements.length = 0;
    const result = await send<AdminSummaryResponse>(head, 'GET', '/summary');
    expect(result.json).toEqual({ sections: ['events'], counts: { upcomingEvents: 2 } });
    expect(countStatements()).toHaveLength(1);
  });

  it('gives 秘书长 applications and the announcement recipients, but no member counts', async () => {
    await seedClub();
    const secretary = await addMember({ role: 'secretary_general' });
    const result = await send<AdminSummaryResponse>(secretary, 'GET', '/summary');
    // Active: president, author, three reporters and the secretary.
    // 在用成员：主席、作者、三位投诉人和秘书长。
    expect(result.json).toEqual({ sections: ['review', 'announcements'], counts: { pendingApplications: 2, announcementRecipients: 6 } });
  });

  it('gives 主席 every count of their sections, leaving out reports about their own content', async () => {
    const { president } = await seedClub();
    d1.statements.length = 0;
    const result = await send<AdminSummaryResponse>(president, 'GET', '/summary');
    expect(result.json).toEqual({
      sections: ['review', 'members', 'channels', 'events', 'announcements', 'reports'],
      counts: {
        pendingApplications: 2,
        openReports: 2,
        activeMembers: 5,
        disabledMembers: 1,
        channels: 5,
        upcomingEvents: 2,
        announcementRecipients: 5,
      },
    });
    // One batch: applications, reports, members, channels and events.
    // 一个批次：入会申请、投诉、成员、频道和活动。
    expect(countStatements()).toHaveLength(5);
  });

  it('gives the system admin all seven sections and all nine counts', async () => {
    await seedClub();
    const admin = await addMember({ role: 'superadmin' });
    const result = await send<AdminSummaryResponse>(admin, 'GET', '/summary');
    expect(result.json.sections).toEqual([...ADMIN_SECTION_KEYS]);
    expect(Object.keys(result.json.counts).sort()).toEqual([...ADMIN_COUNT_KEYS].sort());
    expect(result.json.counts).toMatchObject({ pendingYearRequests: 1, openInvites: 1, openReports: 3, activeMembers: 6 });
  });

  it('follows the viewed role while a system admin tests another one', async () => {
    await seedClub();
    const testing = await addMember({ role: 'superadmin', acting: 'head_events' });
    expect((await send<AdminSummaryResponse>(testing, 'GET', '/summary')).json).toEqual({ sections: ['events'], counts: { upcomingEvents: 2 } });
    const asSecretary = await addMember({ role: 'superadmin', acting: 'secretary_general' });
    const result = await send<AdminSummaryResponse>(asSecretary, 'GET', '/summary');
    expect(result.json.sections).toEqual(['review', 'announcements']);
    expect(result.json.counts).not.toHaveProperty('pendingYearRequests');
  });

  it('allows 60 requests a minute per member', async () => {
    const president = await addMember({ role: 'president' });
    for (let i = 0; i < 60; i += 1) expect((await send(president, 'GET', '/summary')).status).toBe(200);
    expect((await send(president, 'GET', '/summary')).status).toBe(429);
    expect((await send(await addMember({ role: 'president' }), 'GET', '/summary')).status).toBe(200);
  });
});

describe.skipIf(!sqlite)('loadAdminCounts', () => {
  it('counts a table that a missing migration would add as 0', async () => {
    // Before 0016 there is no moment_reports table.
    // 0016 之前没有 moment_reports 表。
    const before16 = createSqliteD1({ migrate: false });
    before16.migrate({ to: 15 });
    try {
      await seedClub(before16, { reports: false });
      const counts = await loadAdminCounts(before16.db, ADMIN_COUNT_KEYS, { viewerId: 'mem_none', now: iso(0) });
      expect(counts).toEqual({
        pendingApplications: 2,
        pendingYearRequests: 1,
        openReports: 0,
        activeMembers: 2,
        disabledMembers: 1,
        channels: 5,
        upcomingEvents: 2,
        openInvites: 1,
        announcementRecipients: 2,
      });
    } finally {
      before16.close();
    }
  });

  it('counts both missing tables as 0 before 0010', async () => {
    const before10 = createSqliteD1({ migrate: false });
    before10.migrate({ to: 9 });
    try {
      await seedClub(before10, { reports: false, invites: false });
      const counts = await loadAdminCounts(before10.db, ['openInvites', 'openReports', 'pendingYearRequests'], { viewerId: 'mem_none', now: iso(0) });
      expect(counts).toEqual({ openInvites: 0, openReports: 0, pendingYearRequests: 1 });
    } finally {
      before10.close();
    }
  });

  it('runs only the queries for the counts asked for, in one batch', async () => {
    await seedClub();
    d1.statements.length = 0;
    expect(await loadAdminCounts(d1.db, ['disabledMembers'], { viewerId: 'x', now: iso(0) })).toEqual({ disabledMembers: 1 });
    expect(countStatements().map((statement) => statement.sql)).toEqual(['SELECT status, COUNT(*) AS n FROM members GROUP BY status']);
    expect(await loadAdminCounts(d1.db, [], { viewerId: 'x', now: iso(0) })).toEqual({});
  });

  it('passes on errors that are not about a missing table', async () => {
    const failing = { batch: async () => Promise.reject(new Error('D1_ERROR: database is locked')), prepare: d1.db.prepare.bind(d1.db) } as unknown as D1Database;
    await expect(loadAdminCounts(failing, ['channels'], { viewerId: 'x', now: iso(0) })).rejects.toThrow('database is locked');
  });
});

describe.skipIf(!sqlite)('GET /admin/announcements', () => {
  function addAnnouncement(id: string, sentAt: string, sentBy: string, emailed = true, recipients = 12) {
    d1.rows(
      'INSERT INTO announcements (id, title, body, sent_by, sent_at, recipient_count, emailed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      `标题 ${id}`,
      `正文 ${id}`,
      sentBy,
      sentAt,
      recipients,
      emailed ? 1 : 0,
    );
  }

  it('pages newest first, 20 at a time, without repeating rows sent in the same millisecond', async () => {
    const president = await addMember({ role: 'president', name: '张三' });
    const expected: { id: string; at: string }[] = [];
    for (let i = 0; i < 45; i += 1) {
      // Rows come in threes with one timestamp, so the id breaks the tie and a tie straddles both page boundaries.
      // 每三条的时间相同，由 id 决定先后，两处分页边界都落在时间相同的几条之间。
      const at = iso(-Math.floor(i / 3) * 60_000);
      const id = `ann_${String(i).padStart(2, '0')}`;
      addAnnouncement(id, at, president.id);
      expected.push({ id, at });
    }
    expected.sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));

    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    do {
      const query: string = cursor ? `?cursor=${cursor}` : '';
      const page: { status: number; json: AdminAnnouncementsResponse } = await send<AdminAnnouncementsResponse>(president, 'GET', `/announcements${query}`);
      expect(page.status).toBe(200);
      sizes.push(page.json.announcements.length);
      seen.push(...page.json.announcements.map((row) => row.id));
      cursor = page.json.nextCursor;
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(seen).toEqual(expected.map((row) => row.id));
  });

  it('describes each announcement with its sender, recipients and whether it was emailed', async () => {
    const secretary = await addMember({ role: 'secretary_general', name: '李四' });
    addAnnouncement('ann_a', iso(-2000), secretary.id, true, 128);
    addAnnouncement('ann_b', iso(-1000), secretary.id, false, 128);
    const result = await send<AdminAnnouncementsResponse>(secretary, 'GET', '/announcements');
    expect(result.json).toEqual({
      announcements: [
        { id: 'ann_b', title: '标题 ann_b', body: '正文 ann_b', sentAt: iso(-1000), recipientCount: 128, emailed: false, sentBy: { id: secretary.id, displayName: '李四' } },
        { id: 'ann_a', title: '标题 ann_a', body: '正文 ann_a', sentAt: iso(-2000), recipientCount: 128, emailed: true, sentBy: { id: secretary.id, displayName: '李四' } },
      ],
      nextCursor: null,
    });
  });

  it('gives a null sender when their row is gone', async () => {
    const president = await addMember({ role: 'president' });
    d1.exec('PRAGMA foreign_keys = OFF');
    addAnnouncement('ann_orphan', iso(-1000), 'mem_deleted');
    d1.exec('PRAGMA foreign_keys = ON');
    const result = await send<AdminAnnouncementsResponse>(president, 'GET', '/announcements');
    expect(result.json.announcements[0]?.sentBy).toBeNull();
  });

  it('lists what POST /admin/announcements saved, first', async () => {
    const president = await addMember({ role: 'president' });
    await addMember();
    addAnnouncement('ann_old', iso(-DAY), president.id);
    const sent = await send(president, 'POST', '/announcements', { title: '迎新', body: '周五见', sendEmail: false });
    expect(sent.status).toBe(201);
    const result = await send<AdminAnnouncementsResponse>(president, 'GET', '/announcements');
    expect(result.json.announcements.map((row) => [row.title, row.emailed, row.recipientCount])).toEqual([
      ['迎新', false, 2],
      ['标题 ann_old', true, 12],
    ]);
  });

  it('needs announcements.send by the viewed role', async () => {
    const head = await addMember({ role: 'head_events' });
    expect((await send(head, 'GET', '/announcements')).status).toBe(403);
    const testing = await addMember({ role: 'superadmin', acting: 'head_events' });
    expect((await send(testing, 'GET', '/announcements')).status).toBe(403);
    expect((await send(await addMember({ role: 'secretary_general' }), 'GET', '/announcements')).status).toBe(200);
  });

  it('refuses a cursor it cannot read', async () => {
    const president = await addMember({ role: 'president' });
    const result = await send(president, 'GET', '/announcements?cursor=not-a-cursor');
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: { code: 'invalid_cursor', message: '分页参数无效' } });
    const valid = encodeMomentCursor({ at: iso(0), id: 'ann_x' });
    expect((await send(president, 'GET', `/announcements?cursor=${valid}`)).status).toBe(200);
  });
});

describe.skipIf(!sqlite)('POST /admin/members/:id/role', () => {
  /** The stored role and enrollment, and the audience channels the member has a join time in. */
  /** 库中的身份和在读状态，以及成员有加入时间的受众频道。 */
  function stored(id: string) {
    const [row] = d1.rows<{ role: Role; enrollment_status: string }>('SELECT role, enrollment_status FROM members WHERE id = ?', id);
    const joins = d1.rows<{ channel_id: string }>("SELECT channel_id FROM channel_joins WHERE member_id = ? AND channel_id IN ('ch_students', 'ch_alumni') ORDER BY channel_id", id);
    return { role: row?.role, enrollment: row?.enrollment_status, joins: joins.map((join) => join.channel_id) };
  }

  function enrollAs(member: MemberRow, status: 'student' | 'alumni', graduationYear = enrollmentCalendarYear()): void {
    d1.rows('UPDATE members SET enrollment_status = ?, graduation_year = ? WHERE id = ?', status, graduationYear, member.id);
  }

  it('gives a department head back the enrollment that 毕业生 moved when 撤销 sends it', async () => {
    const president = await addMember({ role: 'president' });
    const head = await addMember({ role: 'head_events' });
    const changed = await send(president, 'POST', `/members/${head.id}/role`, { role: 'alumni' });
    expect(changed.json).toEqual({ ok: true, role: 'alumni', enrollmentStatus: 'alumni' });
    expect(stored(head.id)).toEqual({ role: 'alumni', enrollment: 'alumni', joins: ['ch_alumni'] });

    const undone = await send(president, 'POST', `/members/${head.id}/role`, { role: 'head_events', enrollmentStatus: 'student' });
    expect(undone).toEqual({ status: 200, json: { ok: true, role: 'head_events', enrollmentStatus: 'student' } });
    expect(stored(head.id)).toEqual({ role: 'head_events', enrollment: 'student', joins: ['ch_students'] });
  });

  it('gives an alumni head back 毕业生 after 在校生 is undone', async () => {
    const president = await addMember({ role: 'president' });
    const head = await addMember({ role: 'head_technology' });
    enrollAs(head, 'alumni');
    await send(president, 'POST', `/members/${head.id}/role`, { role: 'student' });
    expect(stored(head.id)).toMatchObject({ role: 'student', enrollment: 'student' });
    await send(president, 'POST', `/members/${head.id}/role`, { role: 'head_technology', enrollmentStatus: 'alumni' });
    expect(stored(head.id)).toMatchObject({ role: 'head_technology', enrollment: 'alumni' });
  });

  it('keeps the enrollment the member has when the request names none, as older clients send it', async () => {
    const president = await addMember({ role: 'president' });
    const head = await addMember({ role: 'head_events' });
    enrollAs(head, 'alumni');
    const result = await send(president, 'POST', `/members/${head.id}/role`, { role: 'head_technology' });
    expect(result.json).toEqual({ ok: true, role: 'head_technology', enrollmentStatus: 'alumni' });
    expect(stored(head.id)).toMatchObject({ role: 'head_technology', enrollment: 'alumni' });
  });

  it('lets 在校生 and 毕业生 set the enrollment themselves, whatever the request names', async () => {
    const president = await addMember({ role: 'president' });
    const member = await addMember();
    expect((await send(president, 'POST', `/members/${member.id}/role`, { role: 'alumni', enrollmentStatus: 'student' })).json).toEqual({ ok: true, role: 'alumni', enrollmentStatus: 'alumni' });
    expect((await send(president, 'POST', `/members/${member.id}/role`, { role: 'student', enrollmentStatus: 'alumni' })).json).toEqual({ ok: true, role: 'student', enrollmentStatus: 'student' });
    expect(stored(member.id)).toMatchObject({ role: 'student', enrollment: 'student' });
  });

  it('keeps 毕业生 five years after enrollment, even when 在校生 is named', async () => {
    const president = await addMember({ role: 'president' });
    const head = await addMember({ role: 'head_events' });
    enrollAs(head, 'alumni', enrollmentCalendarYear() - 5);
    const result = await send(president, 'POST', `/members/${head.id}/role`, { role: 'head_technology', enrollmentStatus: 'student' });
    expect(result.json).toEqual({ ok: true, role: 'head_technology', enrollmentStatus: 'alumni' });
    expect(stored(head.id)).toMatchObject({ role: 'head_technology', enrollment: 'alumni' });
  });

  it('refuses a status it does not know and changes nothing', async () => {
    const president = await addMember({ role: 'president' });
    const head = await addMember({ role: 'head_events' });
    const result = await send(president, 'POST', `/members/${head.id}/role`, { role: 'head_technology', enrollmentStatus: 'graduate' });
    expect(result).toEqual({ status: 400, json: { error: { code: 'invalid_field', message: '在读状态 取值无效' } } });
    expect(stored(head.id)).toMatchObject({ role: 'head_events', enrollment: 'student' });
  });
});
