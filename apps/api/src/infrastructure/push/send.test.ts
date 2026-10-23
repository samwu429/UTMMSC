import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS, type PushPayload } from '@utmmsc/shared';
import type { Env } from '../../env';
import { prefsFromColumns } from '../d1/notification-prefs';
import { recordDeliveryResults, type DeliveryDevice } from '../d1/push-devices';
import { INLINE_PUSH_MAX, RELAY_CHUNK, deliverToDevices } from './send';
import type { DeliveryJob, JobOutcome } from './types';

/** Records every statement a module prepares; batch and run resolve as empty results. */
function fakeDb() {
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
  return { id, memberId, kind: 'fcm', endpoint: `token-${id}`, keys: null, failureCount: 0, prefs: { ...DEFAULT_NOTIFICATION_PREFS }, ...patch };
}

const payload: PushPayload = { title: 't', body: 'b', tag: 'x', url: 'https://utmmsc.com/UTMMSC/', kind: 'event', eventId: 'e' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notification prefs defaults', () => {
  it('treats a missing row as every switch on', () => {
    expect(prefsFromColumns({ pref_messages: null, pref_events: null, pref_preview: null })).toEqual({ messages: true, events: true, preview: true });
    expect(prefsFromColumns({ pref_messages: 0, pref_events: 1, pref_preview: 0 })).toEqual({ messages: false, events: true, preview: false });
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
