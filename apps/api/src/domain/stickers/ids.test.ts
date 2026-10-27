import { describe, expect, it } from 'vitest';
import { isStickerId, isStickerThumbToken, isStickerObjectKey, stickerObjectKey, stickerThumbKey } from '@utmmsc/shared';
import { bytesToBase64Url, utf8ToBytes } from '../crypto/encoding';
import { stickerObjectId, stickerThumbToken } from './ids';

const SECRET = 'test-session-secret';
const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);

describe('stickerObjectId', () => {
  it('is stk_ and 22 base64url characters, the same every time for the same bytes', async () => {
    const id = await stickerObjectId(SECRET, SHA);
    expect(id).toHaveLength(26);
    expect(isStickerId(id)).toBe(true);
    expect(await stickerObjectId(SECRET, SHA)).toBe(id);
    expect(isStickerObjectKey(stickerObjectKey(id, 'gif'))).toBe(true);
  });

  it('is the first 22 characters of HMAC-SHA-256 over sticker-object:v1:<sha256>', async () => {
    const key = await crypto.subtle.importKey('raw', utf8ToBytes(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8ToBytes(`sticker-object:v1:${SHA}`)));
    expect(await stickerObjectId(SECRET, SHA)).toBe(`stk_${bytesToBase64Url(signature).slice(0, 22)}`);
  });

  it('differs per secret and per hash', async () => {
    const id = await stickerObjectId(SECRET, SHA);
    expect(await stickerObjectId('another-secret', SHA)).not.toBe(id);
    expect(await stickerObjectId(SECRET, OTHER_SHA)).not.toBe(id);
  });
});

describe('stickerThumbToken', () => {
  it('is 22 base64url characters and deterministic', async () => {
    const id = await stickerObjectId(SECRET, SHA);
    const token = await stickerThumbToken(SECRET, id, OTHER_SHA);
    expect(token).toHaveLength(22);
    expect(isStickerThumbToken(token)).toBe(true);
    expect(await stickerThumbToken(SECRET, id, OTHER_SHA)).toBe(token);
    expect(isStickerObjectKey(stickerThumbKey(id, token))).toBe(true);
  });

  it('differs per secret, per still and per sticker, so one still image gives each sticker its own token', async () => {
    const id = await stickerObjectId(SECRET, SHA);
    const other = await stickerObjectId(SECRET, OTHER_SHA);
    const token = await stickerThumbToken(SECRET, id, SHA);
    expect(await stickerThumbToken('another-secret', id, SHA)).not.toBe(token);
    expect(await stickerThumbToken(SECRET, id, OTHER_SHA)).not.toBe(token);
    expect(await stickerThumbToken(SECRET, other, SHA)).not.toBe(token);
  });
});
