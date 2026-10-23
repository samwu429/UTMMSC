import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { bytesToBase64Url, randomBytes } from '../../domain/crypto/encoding';
import { deliverJobs, mapWithConcurrency } from './deliver';
import { deliveryOptions, type DeliveryJob } from './types';
import { classifyWebPushStatus, parseVapidPrivateKey, pushTopic } from './webpush';

async function vapidPrivateKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

async function browserKeys(): Promise<{ p256dh: string; auth: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
  return { p256dh: bytesToBase64Url(raw), auth: bytesToBase64Url(randomBytes(16)) };
}

function env(patch: Partial<Env>): Env {
  return { APP_BASE_URL: 'https://utmmsc.com/UTMMSC/', ...patch } as Env;
}

const payload = { title: '全体成员', body: '张三: 你好', tag: 'channel:ch_all', url: 'https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all', kind: 'message' as const, roomId: 'channel:ch_all' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('delivery options', () => {
  it('keeps messages a day at high urgency and events two days', () => {
    expect(deliveryOptions('message')).toEqual({ ttl: 86_400, urgency: 'high' });
    expect(deliveryOptions('recall')).toEqual({ ttl: 86_400, urgency: 'high' });
    expect(deliveryOptions('event')).toEqual({ ttl: 172_800, urgency: 'normal' });
  });
});

describe('web push helpers', () => {
  it('turns any tag into a 32-character URL-safe topic', async () => {
    const topic = await pushTopic('channel:ch_all');
    expect(topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await pushTopic('channel:ch_all')).toBe(topic);
    expect(await pushTopic('direct:dm_1')).not.toBe(topic);
  });

  it('classifies push service answers', () => {
    expect(classifyWebPushStatus(201)).toBe('sent');
    expect(classifyWebPushStatus(404)).toBe('gone');
    expect(classifyWebPushStatus(410)).toBe('gone');
    expect(classifyWebPushStatus(400)).toBe('failed');
    expect(classifyWebPushStatus(301)).toBe('failed');
    expect(classifyWebPushStatus(307)).toBe('failed');
    expect(classifyWebPushStatus(403)).toBe('transient');
    expect(classifyWebPushStatus(413)).toBe('failed');
    expect(classifyWebPushStatus(401)).toBe('transient');
    expect(classifyWebPushStatus(429)).toBe('transient');
    expect(classifyWebPushStatus(502)).toBe('transient');
  });

  it('accepts only an EC P-256 private JWK', async () => {
    expect(parseVapidPrivateKey(await vapidPrivateKey())).not.toBeNull();
    expect(parseVapidPrivateKey(undefined)).toBeNull();
    expect(parseVapidPrivateKey('{"kty":"RSA"}')).toBeNull();
    expect(parseVapidPrivateKey('nope')).toBeNull();
  });
});

describe('mapWithConcurrency', () => {
  it('keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await mapWithConcurrency([5, 1, 4, 2, 3, 0], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30, 0]);
    expect(peak).toBe(2);
  });
});

describe('deliverJobs', () => {
  it('encrypts web pushes with TTL, urgency and topic, and reports each outcome', async () => {
    const keys = await browserKeys();
    const requests: { url: string; headers: Headers; body: ArrayBuffer }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, headers: new Headers(init.headers), body: init.body as ArrayBuffer });
        return new Response(null, { status: url.endsWith('/gone') ? 410 : 201 });
      }),
    );
    const jobs: DeliveryJob[] = [
      { deviceId: 'd1', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/ok', keys, payload },
      { deviceId: 'd2', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/gone', keys, payload: { ...payload, kind: 'event' } },
    ];
    const outcomes = await deliverJobs(env({ VAPID_PRIVATE_KEY: await vapidPrivateKey() }), jobs);
    expect(outcomes).toEqual([
      { deviceId: 'd1', outcome: 'sent' },
      { deviceId: 'd2', outcome: 'gone' },
    ]);
    const first = requests.find((r) => r.url.endsWith('/ok'));
    expect(first?.headers.get('ttl')).toBe('86400');
    expect(first?.headers.get('urgency')).toBe('high');
    expect(first?.headers.get('topic')).toBe(await pushTopic('channel:ch_all'));
    expect(first?.headers.get('authorization')).toMatch(/^vapid t=.+, k=.+$/);
    expect(first?.body.byteLength).toBeGreaterThan(0);
    expect(requests.find((r) => r.url.endsWith('/gone'))?.headers.get('ttl')).toBe('172800');
  });

  it('skips each kind of device whose credentials are missing, with one warning per kind', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keys = await browserKeys();
    const outcomes = await deliverJobs(env({}), [
      { deviceId: 'w1', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys, payload },
      { deviceId: 'w2', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/2', keys, payload },
      { deviceId: 'f1', kind: 'fcm', endpoint: 'fcm-token', keys: null, payload },
    ]);
    expect(outcomes.map((o) => o.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('never posts outside the known push services and never follows a redirect', async () => {
    const requests: { url: string; redirect: RequestInit['redirect'] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, redirect: init.redirect });
        return new Response(null, { status: 307, headers: { location: 'https://target.example/hook' } });
      }),
    );
    const keys = await browserKeys();
    const outcomes = await deliverJobs(env({ VAPID_PRIVATE_KEY: await vapidPrivateKey() }), [
      { deviceId: 'relay', kind: 'webpush', endpoint: 'https://target.example/api/hook?id=1', keys, payload },
      { deviceId: 'moved', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/moved', keys, payload },
    ]);
    expect(outcomes).toEqual([
      { deviceId: 'relay', outcome: 'gone' },
      { deviceId: 'moved', outcome: 'failed' },
    ]);
    expect(requests).toEqual([{ url: 'https://fcm.googleapis.com/fcm/send/moved', redirect: 'manual' }]);
  });

  it('counts a subscription with unusable keys as failed and a network error as transient', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    const keys = await browserKeys();
    const outcomes = await deliverJobs(env({ VAPID_PRIVATE_KEY: await vapidPrivateKey() }), [
      { deviceId: 'bad', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/1', keys: { p256dh: 'AAAA', auth: keys.auth }, payload },
      { deviceId: 'net', kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/2', keys, payload },
    ]);
    expect(outcomes).toEqual([
      { deviceId: 'bad', outcome: 'failed' },
      { deviceId: 'net', outcome: 'transient' },
    ]);
  });
});
