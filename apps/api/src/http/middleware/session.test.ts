import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrollmentCalendarYear } from '@utmmsc/shared';
import { issueSessionToken } from '../../domain/identity/session-token';
import type { Env } from '../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../infrastructure/d1/testing/sqlite-d1';
import type { AppEnv } from '../context';
import { errorResponse } from '../errors';

const graduations = vi.hoisted(() => ({ recorded: [] as string[][] }));

vi.mock('../access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../access')>()),
  recordGraduations: async (_env: Env, graduated: readonly { before: { id: string } }[]) => {
    graduations.recorded.push(graduated.map((g) => g.before.id));
  },
}));

const { requireSession } = await import('./session');

const SECRET = 'test-session-secret';
const HOUR = 60 * 60 * 1000;

describe.skipIf(!sqlite)('requireSession', () => {
  let d1: SqliteD1;
  let clock = Date.parse('2026-10-24T12:00:00.000Z');
  const waits: Promise<unknown>[] = [];

  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.get('/me', requireSession, (c) => c.json({ id: c.get('member').id, role: c.get('member').role, sessionId: c.get('sessionId') }));

  function addMember(id: string, options: { status?: string; graduationYear?: number } = {}) {
    const at = new Date(clock - 30 * 24 * HOUR).toISOString();
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, 'student', 'student', ?, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      id,
      options.status ?? 'active',
      options.graduationYear ?? enrollmentCalendarYear(new Date(clock)),
      at,
      at,
    );
  }

  async function signIn(memberId: string, sessionId = `ses_${memberId}`, revoked = false): Promise<string> {
    const expires = new Date(clock + 24 * HOUR);
    d1.rows(
      'INSERT INTO sessions (id, member_id, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
      sessionId,
      memberId,
      expires.toISOString(),
      new Date(clock).toISOString(),
      revoked ? new Date(clock).toISOString() : null,
    );
    return issueSessionToken(SECRET, sessionId, memberId, expires);
  }

  const call = (token: string | null) =>
    app.request(
      '/me',
      { headers: token ? { authorization: `Bearer ${token}` } : {} },
      { DB: d1.db, SESSION_SECRET: SECRET } as unknown as Env,
      { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext,
    );

  /** Moves past the sweep's hour, so the next request runs it again. */
  /** 越过毕业处理的一小时间隔，下一个请求会再次执行它。 */
  function nextHour() {
    clock += 2 * HOUR;
    vi.setSystemTime(clock);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    nextHour();
    d1 = createSqliteD1();
    graduations.recorded.length = 0;
    waits.length = 0;
  });
  afterEach(async () => {
    await Promise.allSettled(waits);
    vi.useRealTimers();
    d1.close();
  });

  it('loads the member of a live session with one query once the sweep has run this hour', async () => {
    addMember('mem_ann');
    const token = await signIn('mem_ann');
    expect((await call(token)).status).toBe(200);
    d1.statements.length = 0;
    const res = await call(token);
    expect(await res.json()).toEqual({ id: 'mem_ann', role: 'student', sessionId: 'ses_mem_ann' });
    expect(d1.statements).toHaveLength(1);
    expect(d1.statements[0]?.sql).toMatch(/FROM sessions s LEFT JOIN members m/);
  });

  it('refuses a missing, forged or revoked token, and a disabled member', async () => {
    addMember('mem_ann');
    addMember('mem_off', { status: 'disabled' });
    const revoked = await signIn('mem_ann', 'ses_old', true);
    const disabled = await signIn('mem_off');
    const messages = async (token: string | null) => {
      const res = await call(token);
      return [res.status, ((await res.json()) as { error: { message: string } }).error.message];
    };
    expect(await messages(null)).toEqual([401, expect.any(String)]);
    expect(await messages('not-a-token')).toEqual([401, '登录已过期，请重新登录']);
    expect(await messages(revoked)).toEqual([401, '登录已失效，请重新登录']);
    expect(await messages(disabled)).toEqual([401, '账号不可用']);
  });

  it('runs the graduation sweep beside the session query and schedules its follow-up', async () => {
    addMember('mem_ann');
    addMember('mem_old', { graduationYear: enrollmentCalendarYear(new Date(clock)) - 5 });
    const token = await signIn('mem_ann');
    expect((await call(token)).status).toBe(200);
    await Promise.allSettled(waits);
    expect(graduations.recorded).toEqual([['mem_old']]);
    expect(d1.rows("SELECT enrollment_status FROM members WHERE id = 'mem_old'")).toEqual([{ enrollment_status: 'alumni' }]);
  });

  it('still schedules the follow-up when the session is not live', async () => {
    addMember('mem_ann');
    addMember('mem_old', { graduationYear: enrollmentCalendarYear(new Date(clock)) - 5 });
    const revoked = await signIn('mem_ann', 'ses_old', true);
    expect((await call(revoked)).status).toBe(401);
    await Promise.allSettled(waits);
    expect(graduations.recorded).toEqual([['mem_old']]);
  });

  it('gives a member the sweep graduates in this very request the graduated role, with the follow-up once', async () => {
    addMember('mem_old', { graduationYear: enrollmentCalendarYear(new Date(clock)) - 5 });
    const token = await signIn('mem_old');
    const res = await call(token);
    expect(await res.json()).toMatchObject({ id: 'mem_old', role: 'alumni' });
    await Promise.allSettled(waits);
    expect(graduations.recorded).toEqual([['mem_old']]);
  });
});
