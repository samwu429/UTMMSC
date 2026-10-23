import { afterEach, describe, expect, it, vi } from 'vitest';
import { base64UrlToBytes, bytesToUtf8, utf8ToBytes } from '../../domain/crypto/encoding';
import {
  FCM_SCOPE,
  GOOGLE_TOKEN_URL,
  buildFcmMessage,
  classifyFcmResponse,
  fcmAccessToken,
  fcmJwtClaims,
  forgetFcmAccessToken,
  parseServiceAccount,
  signServiceAccountJwt,
  type ServiceAccount,
} from './fcm';

async function makeAccount(): Promise<{ account: ServiceAccount; publicKey: CryptoKey; json: string }> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer);
  let binary = '';
  for (const byte of der) binary += String.fromCharCode(byte);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(binary).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
  const json = JSON.stringify({ type: 'service_account', project_id: 'utmmsc-test', private_key_id: 'kid1', private_key: pem, client_email: 'push@utmmsc-test.iam.gserviceaccount.com' });
  const account = parseServiceAccount(json);
  if (!account) throw new Error('fixture account did not parse');
  return { account, publicKey: pair.publicKey, json };
}

function decodePart(part: string): unknown {
  return JSON.parse(bytesToUtf8(base64UrlToBytes(part) as Uint8Array));
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetFcmAccessToken();
});

describe('parseServiceAccount', () => {
  it('reads the fields FCM needs and unescapes newlines', async () => {
    const { json } = await makeAccount();
    const escaped = json.replace(/\\n/g, '\\\\n');
    const account = parseServiceAccount(escaped);
    expect(account?.projectId).toBe('utmmsc-test');
    expect(account?.privateKey.includes('\n')).toBe(true);
    expect(account?.privateKey.includes('\\n')).toBe(false);
  });

  it('returns null for an absent or incomplete secret', () => {
    expect(parseServiceAccount(undefined)).toBeNull();
    expect(parseServiceAccount('')).toBeNull();
    expect(parseServiceAccount('not json')).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ project_id: 'x', client_email: 'y' }))).toBeNull();
  });
});

describe('service account JWT', () => {
  it('claims the messaging scope for the Google token endpoint for one hour', async () => {
    const { account } = await makeAccount();
    expect(fcmJwtClaims(account, 1_000)).toEqual({ iss: account.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat: 1_000, exp: 4_600 });
  });

  it('is an RS256 token that verifies with the public key', async () => {
    const { account, publicKey } = await makeAccount();
    const jwt = await signServiceAccountJwt(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.') as [string, string, string];
    expect(decodePart(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'kid1' });
    expect(decodePart(claims)).toMatchObject({ iss: account.clientEmail, aud: GOOGLE_TOKEN_URL, iat: 1_700_000_000, exp: 1_700_003_600 });
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, base64UrlToBytes(signature) as Uint8Array, utf8ToBytes(`${header}.${claims}`));
    expect(ok).toBe(true);
  });
});

describe('fcmAccessToken', () => {
  it('exchanges the assertion once and reuses the token until shortly before expiry', async () => {
    const { account } = await makeAccount();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(String(init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
      return new Response(JSON.stringify({ access_token: `tok${fetchMock.mock.calls.length}`, expires_in: 3600 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const now = 1_700_000_000_000;
    expect(await fcmAccessToken(account, now)).toBe('tok1');
    expect(await fcmAccessToken(account, now + 50 * 60 * 1000)).toBe('tok1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(GOOGLE_TOKEN_URL);
    // Past expiry minus five minutes, a new token is fetched.
    expect(await fcmAccessToken(account, now + 56 * 60 * 1000)).toBe('tok2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the exchange is refused', async () => {
    const { account } = await makeAccount();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await fcmAccessToken(account, Date.now())).toBeNull();
  });
});

describe('buildFcmMessage', () => {
  it('sends a notification on the matching channel with string data', () => {
    const message = buildFcmMessage(
      'token-1',
      { title: '全体成员', body: '张三: 你好', tag: 'channel:ch_all', url: 'https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all', kind: 'message', roomId: 'channel:ch_all' },
      { ttl: 86_400, urgency: 'high' },
    );
    expect(message).toEqual({
      message: {
        token: 'token-1',
        notification: { title: '全体成员', body: '张三: 你好' },
        android: {
          priority: 'HIGH',
          ttl: '86400s',
          collapse_key: 'channel:ch_all',
          notification: { channel_id: 'messages', tag: 'channel:ch_all', icon: 'ic_stat_notify', color: '#3C165F' },
        },
        data: { url: 'https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all', kind: 'message', tag: 'channel:ch_all', roomId: 'channel:ch_all' },
      },
    });
    const event = buildFcmMessage('t', { title: 'a', body: 'b', tag: 'event:e:publish', url: 'u', kind: 'event', eventId: 'e' }, { ttl: 172_800, urgency: 'normal' }) as {
      message: { android: { notification: { channel_id: string } }; data: Record<string, string> };
    };
    expect(event.message.android.notification.channel_id).toBe('events');
    expect(event.message.android).not.toHaveProperty('collapse_key');
    expect(event.message.data).toEqual({ url: 'u', kind: 'event', tag: 'event:e:publish', eventId: 'e' });
    const recall = buildFcmMessage('t', { title: '全体成员', body: '张三 撤回了一条消息', tag: 'channel:ch_all', url: 'u', kind: 'recall', roomId: 'channel:ch_all' }, { ttl: 86_400, urgency: 'high' }) as {
      message: { android: { collapse_key?: string; notification: { channel_id: string; tag: string } } };
    };
    expect(recall.message.android).toMatchObject({ collapse_key: 'channel:ch_all', notification: { channel_id: 'messages', tag: 'channel:ch_all' } });
  });
});

describe('classifyFcmResponse', () => {
  const fcmError = (status: string, errorCode: string, extra: object[] = [], message = '') => ({
    error: { status, message, details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode }, ...extra] },
  });

  it('removes unregistered tokens and tokens from another project', () => {
    expect(classifyFcmResponse(404, fcmError('NOT_FOUND', 'UNREGISTERED'))).toBe('gone');
    expect(classifyFcmResponse(403, fcmError('PERMISSION_DENIED', 'SENDER_ID_MISMATCH'))).toBe('gone');
  });

  it('removes a token only when INVALID_ARGUMENT is about the token', () => {
    const tokenViolation = { '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.token' }] };
    expect(classifyFcmResponse(400, fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', [tokenViolation]))).toBe('gone');
    expect(classifyFcmResponse(400, fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', [], 'The registration token is not a valid FCM registration token'))).toBe('gone');
    expect(classifyFcmResponse(400, fcmError('INVALID_ARGUMENT', 'INVALID_ARGUMENT', [], 'Invalid value at message.android.ttl'))).toBe('failed');
  });

  it('does not blame the device for quota, outages or our credentials', () => {
    expect(classifyFcmResponse(429, fcmError('RESOURCE_EXHAUSTED', 'QUOTA_EXCEEDED'))).toBe('transient');
    expect(classifyFcmResponse(503, null)).toBe('transient');
    expect(classifyFcmResponse(401, null)).toBe('transient');
    expect(classifyFcmResponse(200, null)).toBe('sent');
  });
});
