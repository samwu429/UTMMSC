import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../context';
import { errorResponse } from '../errors';
import type { MemberRow } from '../../infrastructure/d1/members';
import { memberRateLimit, rateLimit } from './rate-limit';

/**
 * A tiny app where the x-member header stands in for requireSession, so each test picks who is asking and
 * from which IP. Every test uses its own limit name, because member buckets are shared by name.
 * 一个小应用，用 x-member 请求头代替 requireSession，每个测试自己决定由谁、从哪个 IP 发出请求。
 * 成员计数按名称共用，所以每个测试使用自己的名称。
 */
function appWith(name: string, limit: number, windowMs = 60_000) {
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.use('*', async (c, next) => {
    const id = c.req.header('x-member');
    if (id) c.set('member', { id } as MemberRow);
    await next();
  });
  const limited = memberRateLimit(name, limit, windowMs);
  app.get('/a/:id', limited, (c) => c.json({ ok: true }));
  app.post('/b', limited, (c) => c.json({ ok: true }));
  return app;
}

function ask(app: Hono<AppEnv>, path: string, member: string | null, ip = '203.0.113.1', method = 'GET') {
  const headers: Record<string, string> = { 'cf-connecting-ip': ip };
  if (member) headers['x-member'] = member;
  return app.request(path, { method, headers });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('memberRateLimit', () => {
  it('lets the limit through and then answers 429 rate_limited', async () => {
    const app = appWith('limit-basic', 3);
    for (let i = 0; i < 3; i += 1) expect((await ask(app, '/a/1', 'm1')).status).toBe(200);
    const refused = await ask(app, '/a/1', 'm1');
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: { code: 'rate_limited', message: '操作过于频繁，请稍后再试' } });
  });

  it('counts each member on their own even behind one IP', async () => {
    const app = appWith('limit-members', 2);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(429);
    expect((await ask(app, '/a/1', 'm2')).status).toBe(200);
  });

  it('follows the member across IPs and paths instead of starting a new bucket', async () => {
    const app = appWith('limit-paths', 2);
    expect((await ask(app, '/a/1', 'm1', '198.51.100.1')).status).toBe(200);
    expect((await ask(app, '/a/2', 'm1', '198.51.100.2')).status).toBe(200);
    expect((await ask(app, '/b', 'm1', '198.51.100.3', 'POST')).status).toBe(429);
  });

  it('keeps separate budgets for different names', async () => {
    const first = appWith('limit-name-a', 1);
    const second = appWith('limit-name-b', 1);
    expect((await ask(first, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(first, '/a/1', 'm1')).status).toBe(429);
    expect((await ask(second, '/a/1', 'm1')).status).toBe(200);
  });

  it('shares one count between routes that give the same name', async () => {
    const first = appWith('limit-shared', 2);
    const second = appWith('limit-shared', 2);
    expect((await ask(first, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(second, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(first, '/a/1', 'm1')).status).toBe(429);
  });

  it('starts a fresh window once the old one has passed', async () => {
    const app = appWith('limit-window', 1, 60_000);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(200);
    vi.advanceTimersByTime(59_999);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(429);
    vi.advanceTimersByTime(1);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(200);
    expect((await ask(app, '/a/1', 'm1')).status).toBe(429);
  });

  it('refuses a request that reached it without a signed-in member', async () => {
    const response = await ask(appWith('limit-anonymous', 5), '/a/1', null);
    expect(response.status).toBe(401);
  });
});

describe('rateLimit', () => {
  it('still keys by path and IP', async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.get('/x/:id', rateLimit(1, 60_000), (c) => c.json({ ok: true }));
    expect((await ask(app, '/x/1', null, '192.0.2.1')).status).toBe(200);
    expect((await ask(app, '/x/1', null, '192.0.2.1')).status).toBe(429);
    expect((await ask(app, '/x/2', null, '192.0.2.1')).status).toBe(200);
    expect((await ask(app, '/x/1', null, '192.0.2.2')).status).toBe(200);
  });
});
