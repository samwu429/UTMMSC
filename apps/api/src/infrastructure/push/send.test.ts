import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS, type PushPayload } from '@utmmsc/shared';
import type { Env } from '../../env';
import { prefsFromColumns } from '../d1/notification-prefs';
import { recordDeliveryResults, type DeliveryDevice } from '../d1/push-devices';
import { forgetFcmAccessToken } from './fcm';
import { INLINE_PUSH_MAX, RELAY_CHUNK, deliverToDevices, sendTestPush } from './send';
import type { DeliveryJob, JobOutcome } from './types';

/** Records every statement a module prepares; batch and run resolve as empty results, and all() returns `rows`. */
/** 记录模块准备的每条语句；batch 和 run 返回空结果，all() 返回 `rows`。 */
function fakeDb(rows: object[] = []) {
  const statements: { sql: string; params: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      const statement = {
        sql,
        params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
        async run() {
          statements.push({ sql, params: statement.params });
          return { meta: { changes: 1 } };
        },
        async all() {
          return { results: rows };
        },
      };
      return statement;
    },
    async batch(list: { sql: string; params: unknown[] }[]) {
      for (const s of list) statements.push({ sql: s.sql, params: s.params });
      return list.map(() => ({ meta: { changes: 1 } }));
    },
  };
  return { db: db as unknown as D1Database, statements };
}

function device(id: string, memberId: string, patch: Partial<DeliveryDevice> = {}): DeliveryDevice {
  return { id, memberId, kind: 'fcm', endpoint: `token-${id}`, keys: null, failureCount: 0, sessionId: `session-${memberId}`, prefs: { ...DEFAULT_NOTIFICATION_PREFS }, ...patch };
}

const payload: PushPayload = { title: 't', body: 'b', tag: 'x', url: 'https://utmmsc.com/UTMMSC/', kind: 'event', eventId: 'e' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notification prefs defaults', () => {
  it('treats a missing row as every switch on', () => {
    expect(prefsFromColumns({ pref_messages: null, pref_events: null, pref_preview: null })).toEqual({ messages: true, events: true, preview: true, moments: true });
    expect(prefsFromColumns({ pref_messages: 0, pref_events: 1, pref_preview: 0 })).toEqual({ messages: false, events: true, preview: false, moments: true });
  });
});

describe('recordDeliveryResults', () => {
  it('removes gone devices, counts refusals up to the limit, and clears the count after a success', async () => {
    const { db, statements } = fakeDb();
    await recordDeliveryResults(db, [
      { deviceId: 'gone', outcome: 'gone', failureCount: 0 },
      { deviceId: 'fifth', outcome: 'failed', failureCount: 4 },
      { deviceId: 'second', outcome: 'failed', failureCount: 1 },
      { deviceId: 'back', outcome: 'sent', failureCount: 3 },
      { deviceId: 'fine', outcome: 'sent', failureCount: 0 },
      { deviceId: 'blip', outcome: 'transient', failureCount: 2 },
      { deviceId: 'off', outcome: 'skipped', failureCount: 2 },
    ]);
    expect(statements).toEqual([
      { sql: 'DELETE FROM push_devices WHERE id = ?', params: ['gone'] },
      { sql: 'DELETE FROM push_devices WHERE id = ?', params: ['fifth'] },
      { sql: 'UPDATE push_devices SET failure_count = 0 WHERE id = ?', params: ['back'] },
      { sql: 'UPDATE push_devices SET failure_count = failure_count + 1 WHERE id IN (?)', params: ['second'] },
    ]);
  });
});

describe('deliverToDevices', () => {
  function relayEnv(handler: (jobs: DeliveryJob[]) => JobOutcome[]) {
    const { db, statements } = fakeDb();
    const calls: DeliveryJob[][] = [];
    const relay = {
      idFromName: (name: string) => name,
      get: () => ({
        deliver: async (jobs: DeliveryJob[]) => {
          calls.push(jobs);
          return handler(jobs);
        },
      }),
    };
    return { env: { DB: db, PUSH_RELAY: relay } as unknown as Env, calls, statements };
  }

  it('builds one payload per member, skips members it returns null for, and counts members reached', async () => {
    const { env, calls } = relayEnv((jobs) => jobs.map((job) => ({ deviceId: job.deviceId, outcome: job.deviceId === 'a2' ? 'gone' : 'sent' })));
    const devices: DeliveryDevice[] = [];
    for (let i = 0; i < 6; i += 1) devices.push(device(`a${i}`, 'alice'), device(`b${i}`, 'bob'));
    devices.push(device('c0', 'carol', { prefs: { ...DEFAULT_NOTIFICATION_PREFS, events: false } }));
    const payloadFor = vi.fn((_memberId: string, prefs: { events: boolean }) => (prefs.events ? payload : null));
    const summary = await deliverToDevices(env, devices, payloadFor);
    expect(payloadFor).toHaveBeenCalledTimes(3);
    expect(summary).toEqual({ devices: 12, sent: 11, failed: 1, recipients: 2 });
    expect(calls.length).toBe(1);
  });

  it(`sends up to ${INLINE_PUSH_MAX} pushes inline and splits larger fan-outs into relay chunks of ${RELAY_CHUNK}`, async () => {
    const { env, calls } = relayEnv((jobs) => jobs.map((job) => ({ deviceId: job.deviceId, outcome: 'sent' })));
    const many = Array.from({ length: 95 }, (_, i) => device(`d${i}`, `m${i}`));
    const summary = await deliverToDevices(env, many, () => payload);
    expect(calls.map((c) => c.length)).toEqual([40, 40, 15]);
    expect(summary.sent).toBe(95);
    expect(summary.recipients).toBe(95);
  });

  it('counts a failed relay call as transient, so no device is penalised', async () => {
    const { env, statements } = relayEnv(() => {
      throw new Error('relay down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const many = Array.from({ length: 10 }, (_, i) => device(`d${i}`, `m${i}`, { failureCount: 2 }));
    const summary = await deliverToDevices(env, many, () => payload);
    expect(summary).toEqual({ devices: 10, sent: 0, failed: 10, recipients: 0 });
    expect(statements).toEqual([]);
  });

  it('removes a web device whose stored keys cannot be read', async () => {
    const { env, statements } = relayEnv(() => []);
    const summary = await deliverToDevices(env, [device('w', 'm', { kind: 'webpush', keys: null })], () => payload);
    expect(summary.devices).toBe(0);
    expect(statements).toEqual([{ sql: 'DELETE FROM push_devices WHERE id = ?', params: ['w'] }]);
  });
});

describe('sendTestPush', () => {
  const testPayload: PushPayload = { title: 'UTMMSC', body: 'test', tag: 'test', url: 'https://utmmsc.com/UTMMSC/', kind: 'test' };

  /** Device rows as D1 returns them, all belonging to alice. */
  /** 与 D1 返回形式相同的设备记录，全部属于 alice。 */
  function row(id: string, sessionId: string, kind: 'fcm' | 'webpush' = 'fcm') {
    return {
      id,
      member_id: 'alice',
      kind,
      endpoint: `token-${id}`,
      keys_json: kind === 'webpush' ? JSON.stringify({ p256dh: 'p', auth: 'a' }) : null,
      failure_count: 0,
      session_id: sessionId,
      pref_messages: 0,
      pref_events: 0,
      pref_preview: 0,
    };
  }

  /** Inline delivery (fewer than INLINE_PUSH_MAX jobs), with FCM answering per token. */
  /** 直接发送（任务数少于 INLINE_PUSH_MAX），FCM 按令牌逐个应答。 */
  function fcmEnv(rows: object[], answer: (token: string) => Response) {
    const { db } = fakeDb(rows);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://oauth2.googleapis.com/')) return Response.json({ access_token: 'access', expires_in: 3600 });
      const body = JSON.parse(String(init?.body)) as { message: { token: string } };
      return answer(body.message.token);
    });
    return { DB: db, FCM_SERVICE_ACCOUNT: serviceAccount } as unknown as Env;
  }

  let serviceAccount = '';

  beforeAll(async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`;
    serviceAccount = JSON.stringify({ project_id: 'p', client_email: 'push@p.iam.gserviceaccount.com', private_key: pem });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    forgetFcmAccessToken();
  });

  it('reports this device as sent, ignoring the switches, while counting every device', async () => {
    const env = fcmEnv([row('here', 'mine'), row('other', 'phone-2')], (token) => (token === 'token-here' ? Response.json({ name: 'm' }) : Response.json({}, { status: 500 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendTestPush(env, 'alice', 'mine', testPayload)).toEqual({ devices: 2, sent: 1, failed: 1, thisDevice: 'sent', serviceProblem: true });
  });

  it('lets a working token speak for a sign-in that still has its replaced one', async () => {
    const unregistered = { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } };
    const env = fcmEnv([row('old', 'mine'), row('new', 'mine')], (token) => (token === 'token-new' ? Response.json({ name: 'm' }) : Response.json(unregistered, { status: 404 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await sendTestPush(env, 'alice', 'mine', testPayload)).toMatchObject({ thisDevice: 'sent', serviceProblem: false });
  });

  it('says when this device is gone, and when it is not registered at all', async () => {
    const unregistered = { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gone = fcmEnv([row('here', 'mine')], () => Response.json(unregistered, { status: 404 }));
    expect(await sendTestPush(gone, 'alice', 'mine', testPayload)).toEqual({ devices: 1, sent: 0, failed: 1, thisDevice: 'gone', serviceProblem: false });
    const elsewhere = fcmEnv([row('other', 'phone-2')], () => Response.json({ name: 'm' }));
    expect(await sendTestPush(elsewhere, 'alice', 'mine', testPayload)).toMatchObject({ devices: 1, sent: 1, thisDevice: 'none' });
  });

  it('puts a missing server key on the server, not the device', async () => {
    const { db } = fakeDb([row('here', 'mine', 'webpush')]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const env = { DB: db } as unknown as Env;
    expect(await sendTestPush(env, 'alice', 'mine', testPayload)).toEqual({ devices: 1, sent: 0, failed: 1, thisDevice: 'unavailable', serviceProblem: true });
  });
});
