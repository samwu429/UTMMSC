import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { enrollmentCalendarYear } from '@utmmsc/shared';
import { issueSessionToken } from '../../../domain/identity/session-token';
import type { Env } from '../../../env';
import type { MemberRow } from '../../../infrastructure/d1/members';
import type { AppEnv } from '../../context';
import { ApiHttpError, errorResponse } from '../../errors';
import { notificationRoutes, readDeviceRegistration, readTestDelay, readWebPushEndpoint } from './index';

const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ApiHttpError ? err.code : 'other';
  }
}

describe('notification routes', () => {
  const paths = notificationRoutes.routes.map((route) => `${route.method} ${route.path}`);

  it('exposes the key, devices, prefs and test routes', () => {
    expect(paths).toContain('GET /vapid-key');
    expect(paths).toContain('POST /devices');
    expect(paths).toContain('DELETE /devices');
    expect(paths).toContain('GET /prefs');
    expect(paths).toContain('PATCH /prefs');
    expect(paths).toContain('POST /test');
  });
});

const SECRET = 'test-session-secret';

const member: MemberRow = {
  id: 'mem_1',
  email: 'a@mail.utoronto.ca',
  display_name: '张三',
  password_hash: 'x',
  status: 'active',
  role: 'student',
  enrollment_status: 'student',
  graduation_year: enrollmentCalendarYear(),
  major: null,
  headline: null,
  about: null,
  location: null,
  skills: null,
  open_to: null,
  avatar_key: null,
  cover_key: null,
  acting_role: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
};

/**
 * D1 for a signed-in member's prefs requests: the session and member reads of requireSession, and the
 * notification_prefs statements, which before migration 0016 fail on the moments column like D1 does. The
 * stored row is kept between requests.
 * 模拟已登录成员的通知开关请求：requireSession 所做的会话与成员读取，以及 notification_prefs 的语句；迁移 0016 之前，
 * 涉及 moments 列的语句会像 D1 一样报错。已存的行在多次请求之间保留。
 */
function prefsDb(schema: 'current' | 'before-0016' = 'current') {
  const stored = { messages: 1, events: 1, preview: 1, moments: 1 };
  const writes: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
        async first() {
          if (sql.startsWith('SELECT id FROM sessions')) return { id: 'ses_1' };
          if (sql.startsWith('SELECT * FROM members')) return member;
          if (!sql.includes('notification_prefs')) throw new Error(`unexpected query: ${sql}`);
          if (schema === 'before-0016' && /\bmoments\b/.test(sql)) throw new Error('D1_ERROR: no such column: moments: SQLITE_ERROR');
          const columns = (['messages', 'events', 'preview', 'moments'] as const).filter((column) => sql.includes(`${column} AS pref_${column}`));
          if (sql.startsWith('INSERT')) {
            writes.push({ sql, params: statement.params });
            columns.forEach((column, index) => {
              const value = statement.params[1 + index];
              if (value !== null) stored[column] = value as number;
            });
          }
          return Object.fromEntries(columns.map((column) => [`pref_${column}`, stored[column]]));
        },
        async all() {
          return { results: [] };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, writes };
}

async function prefsRequest(db: D1Database, method: 'GET' | 'PATCH', body?: unknown): Promise<Response> {
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.route('/notifications', notificationRoutes);
  const token = await issueSessionToken(SECRET, 'ses_1', member.id, new Date(Date.now() + 60_000));
  const env = { DB: db, SESSION_SECRET: SECRET } as unknown as Env;
  const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  return app.request(
    '/notifications/prefs',
    {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
    ctx,
  );
}

describe('notification prefs routes', () => {
  it('reads and saves the 好友动态互动 switch', async () => {
    const { db, writes } = prefsDb();
    const before = await prefsRequest(db, 'GET');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ prefs: { messages: true, events: true, preview: true, moments: true } });

    const saved = await prefsRequest(db, 'PATCH', { moments: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { messages: true, events: true, preview: true, moments: false } });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.params.slice(0, 5)).toEqual(['mem_1', null, null, null, 0]);

    expect(await (await prefsRequest(db, 'GET')).json()).toEqual({ prefs: { messages: true, events: true, preview: true, moments: false } });
  });

  it('refuses a switch that is not true or false, naming it', async () => {
    const { db, writes } = prefsDb();
    const response = await prefsRequest(db, 'PATCH', { moments: 'off' });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: 'invalid_field', message: '好友动态互动通知 格式错误' } });
    expect(writes).toEqual([]);
  });

  it('answers that push is not ready for a moments change before migration 0016, and still saves the others', async () => {
    const { db, writes } = prefsDb('before-0016');
    const refused = await prefsRequest(db, 'PATCH', { moments: false });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('push_unavailable');
    expect(writes).toEqual([]);

    const saved = await prefsRequest(db, 'PATCH', { events: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { messages: true, events: false, preview: true, moments: true } });
  });
});

describe('readTestDelay', () => {
  it('sends at once without a body, as older clients call it', () => {
    expect(readTestDelay(null)).toBe(0);
    expect(readTestDelay({})).toBe(0);
  });

  it('accepts whole seconds up to the limit and refuses anything else', () => {
    expect(readTestDelay({ delaySeconds: 4 })).toBe(4);
    expect(readTestDelay({ delaySeconds: 10 })).toBe(10);
    expect(code(() => readTestDelay({ delaySeconds: 11 }))).toBe('invalid_field');
    expect(code(() => readTestDelay({ delaySeconds: -1 }))).toBe('invalid_field');
    expect(code(() => readTestDelay({ delaySeconds: 1.5 }))).toBe('invalid_field');
    expect(code(() => readTestDelay({ delaySeconds: '4' }))).toBe('invalid_field');
  });
});

describe('readDeviceRegistration', () => {
  it('accepts a browser subscription and an FCM token', () => {
    expect(readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, platform: 'android-chrome' })).toEqual({
      kind: 'webpush',
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      platform: 'android-chrome',
    });
    expect(readDeviceRegistration({ kind: 'fcm', token: 'dGVzdA:APA91bH-x_y.z' })).toEqual({ kind: 'fcm', endpoint: 'dGVzdA:APA91bH-x_y.z', keys: null, platform: null });
  });

  it('accepts padded keys and drops an unusable platform label', () => {
    const padded = { p256dh: keys.p256dh, auth: `${keys.auth}==` };
    expect(readDeviceRegistration({ kind: 'webpush', endpoint: 'https://web.push.apple.com/x', keys: padded, platform: '<script>' }).platform).toBeNull();
  });

  it('refuses endpoints that are not https, too long, or carry credentials', () => {
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'http://push.example/x', keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://user:pw@push.example/x', keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: `https://push.example/${'a'.repeat(1000)}`, keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'not a url', keys }))).toBe('invalid_device');
  });

  it('accepts only known push services on the default port', () => {
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QH2',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://fcm.googleapis.com:443/fcm/send/abc',
    ]) {
      expect(readDeviceRegistration({ kind: 'webpush', endpoint, keys }).endpoint).toBe(endpoint);
    }
    for (const endpoint of [
      'https://push.example/x',
      'https://203.0.113.7/x',
      'https://[2001:db8::1]/x',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com.example/x',
      'https://push.apple.com/x',
    ]) {
      expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint, keys }))).toBe('invalid_device');
    }
  });

  it('removes a stored endpoint whatever its host', () => {
    expect(readWebPushEndpoint('https://push.example/x', 'remove')).toBe('https://push.example/x');
    expect(code(() => readWebPushEndpoint('http://push.example/x', 'remove'))).toBe('invalid_device');
  });

  it('refuses keys that are not base64url or too long', () => {
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a+b/c', auth: keys.auth } }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a'.repeat(201), auth: keys.auth } }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x' }))).toBe('invalid_device');
  });

  it('refuses tokens that are empty, too long, or contain other characters, and unknown kinds', () => {
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: '' }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: 'a'.repeat(4097) }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: 'a b' }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'apns', token: 'abc' }))).toBe('invalid_device');
  });
});
