import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PushPayload } from '@utmmsc/shared';
import { base64UrlToBytes, bytesToBase64Url, utf8ToBytes } from '../../domain/crypto/encoding';
import { sendWebPush, vapidKeysFromJwk } from './webpush';

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Decrypts an aes128gcm body the way a browser does (RFC 8291 section 3.4, RFC 8188 section 2). */
async function decrypt(body: Uint8Array, receiver: CryptoKeyPair, receiverPublic: Uint8Array, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idLength = body[20] ?? 0;
  const senderPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  // Workers' WebCrypto types name the ECDH peer key `$public`; the runtime takes the standard `public`.
  // Workers 的 WebCrypto 类型把 ECDH 对端密钥写作 `$public`；运行时使用标准的 `public`。
  const ecdh = { name: 'ECDH', public: senderKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, receiver.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(utf8ToBytes('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const cek = await hkdf(salt, ikm, utf8ToBytes('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8ToBytes('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));
  const end = padded.lastIndexOf(2);
  return new TextDecoder().decode(padded.slice(0, end));
}

async function serverKey(): Promise<JsonWebKey> {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
}

afterEach(() => vi.unstubAllGlobals());

describe('sendWebPush', () => {
  it('sends an aes128gcm body that a browser can decrypt, with a VAPID token for the push service', async () => {
    const receiver = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    const receiverPublic = new Uint8Array((await crypto.subtle.exportKey('raw', receiver.publicKey)) as ArrayBuffer);
    const auth = crypto.getRandomValues(new Uint8Array(16));
    const payload: PushPayload = { title: '全体成员', body: 'Alice: 你好', tag: 'channel:ch_all', url: 'https://utmmsc.com/UTMMSC/chat', kind: 'message' };

    let captured: { headers: Headers; body: Uint8Array } | null = null;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      captured = { headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) };
      return new Response(null, { status: 201 });
    });

    const jwk = await serverKey();
    const outcome = await sendWebPush(
      jwk,
      { deviceId: 'dev_1', kind: 'webpush', endpoint: ENDPOINT, keys: { p256dh: bytesToBase64Url(receiverPublic), auth: bytesToBase64Url(auth) }, payload },
      { ttl: 86_400, urgency: 'high' },
    );

    expect(outcome).toBe('sent');
    expect(captured).not.toBeNull();
    const request = captured as unknown as { headers: Headers; body: Uint8Array };
    expect(request.headers.get('content-encoding')).toBe('aes128gcm');
    expect(request.headers.get('ttl')).toBe('86400');
    expect(request.headers.get('urgency')).toBe('high');
    expect(request.headers.get('authorization')).toContain(`k=${vapidKeysFromJwk(jwk).publicKey}`);
    expect(JSON.parse(await decrypt(request.body, receiver, receiverPublic, auth))).toMatchObject({ title: '全体成员', body: 'Alice: 你好', tag: 'channel:ch_all' });
  });

  it('derives the uncompressed public point from the private JWK', async () => {
    const jwk = await serverKey();
    const point = base64UrlToBytes(vapidKeysFromJwk(jwk).publicKey ?? '');
    expect(point?.length).toBe(65);
    expect(point?.[0]).toBe(4);
  });
});
