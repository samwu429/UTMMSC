import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { enrollmentCalendarYear } from '@utmmsc/shared';
import { issueSessionToken } from '../../../domain/identity/session-token';
import type { Env } from '../../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
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

/**
 * Prefs requests run on real SQLite with the migrations up to `to`, so the session check and every
 * notification_prefs statement behave as on D1 at that migration. One active member with one live session.
 * 通知开关请求运行在执行到 `to` 号迁移的真实 SQLite 上，会话检查和每条 notification_prefs 语句都与该迁移阶段的 D1 一致。
 * 只有一位在用成员和一个有效会话。
 */
function prefsDb(to: number = Number.POSITIVE_INFINITY): SqliteD1 {
  const d1 = createSqliteD1({ migrate: false });
  d1.migrate({ to });
  const now = new Date().toISOString();
  d1.rows(
    "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES ('mem_1', 'a@mail.utoronto.ca', '张三', 'x', 'active', 'student', 'student', ?, ?, ?)",
    enrollmentCalendarYear(),
    now,
    now,
  );
  d1.rows("INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES ('ses_1', 'mem_1', ?, ?)", new Date(Date.now() + 86_400_000).toISOString(), now);
  return d1;
}

function prefsWrites(d1: SqliteD1): number {
  return d1.statements.filter((statement) => statement.sql.trimStart().startsWith('INSERT INTO notification_prefs')).length;
}

async function prefsRequest(db: D1Database, method: 'GET' | 'PATCH', body?: unknown): Promise<Response> {
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.route('/notifications', notificationRoutes);
  const token = await issueSessionToken(SECRET, 'ses_1', 'mem_1', new Date(Date.now() + 60_000));
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

const ALL_ON = { messages: true, events: true, preview: true, moments: true, timetable: true };

describe.skipIf(!sqlite)('notification prefs routes', () => {
  let d1: SqliteD1 | null = null;

  afterEach(() => {
    d1?.close();
    d1 = null;
  });

  it('reads and saves the 好友动态互动 and 课表提醒 switches', async () => {
    d1 = prefsDb();
    const before = await prefsRequest(d1.db, 'GET');
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ prefs: ALL_ON });

    const saved = await prefsRequest(d1.db, 'PATCH', { moments: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { ...ALL_ON, moments: false } });

    const timetable = await prefsRequest(d1.db, 'PATCH', { timetable: false });
    expect(await timetable.json()).toEqual({ prefs: { ...ALL_ON, moments: false, timetable: false } });
    expect(prefsWrites(d1)).toBe(2);

    expect(await (await prefsRequest(d1.db, 'GET')).json()).toEqual({ prefs: { ...ALL_ON, moments: false, timetable: false } });
    expect(d1.rows('SELECT messages, moments, timetable FROM notification_prefs')).toEqual([{ messages: 1, moments: 0, timetable: 0 }]);
  });

  it('refuses a switch that is not true or false, naming it', async () => {
    d1 = prefsDb();
    for (const [field, label] of [
      ['moments', '好友动态互动通知'],
      ['timetable', '课表提醒'],
    ] as const) {
      const response = await prefsRequest(d1.db, 'PATCH', { [field]: 'off' });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: { code: 'invalid_field', message: `${label} 格式错误` } });
    }
    expect(prefsWrites(d1)).toBe(0);
  });

  it('answers that push is not ready for a timetable change before migration 0017, and still saves the others', async () => {
    d1 = prefsDb(16);
    const refused = await prefsRequest(d1.db, 'PATCH', { timetable: false });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('push_unavailable');
    expect(d1.rows('SELECT * FROM notification_prefs')).toEqual([]);

    const saved = await prefsRequest(d1.db, 'PATCH', { moments: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { ...ALL_ON, moments: false } });
  });

  it('answers that push is not ready for a moments change before migration 0016, and still saves the others', async () => {
    d1 = prefsDb(15);
    const refused = await prefsRequest(d1.db, 'PATCH', { moments: false });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('push_unavailable');
    expect(d1.rows('SELECT * FROM notification_prefs')).toEqual([]);

    const saved = await prefsRequest(d1.db, 'PATCH', { events: false });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ prefs: { ...ALL_ON, events: false } });
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
