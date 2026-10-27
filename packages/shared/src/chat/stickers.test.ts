import { describe, expect, it } from 'vitest';
import { IMAGE_DIMENSION_MAX } from './protocol';
import {
  STICKER_ANIMATED_FRAMES_MAX,
  STICKER_ANIMATED_PIXELS_MAX,
  STICKER_DIMENSION_MAX,
  STICKER_MAX_BYTES,
  STICKER_MESSAGES,
  STICKER_MIME_TYPES,
  STICKER_THUMB_MAX_BYTES,
  STICKER_TYPES,
  STICKER_UPLOAD_REQUEST_MAX_BYTES,
  STICKERS_PER_MEMBER_MAX,
  isStickerAliasName,
  isStickerId,
  isStickerObjectKey,
  isStickerThumbToken,
  isStickerType,
  normalizeStickerRef,
  stickerAliasKey,
  stickerDay,
  stickerKeyForAlias,
  stickerObjectKey,
  stickerThumbKey,
  type StickerRef,
} from './stickers';

const ID = 'stk_0123456789abcdefghij-_';
const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';

const ref: StickerRef = { id: ID, type: 'gif', width: 240, height: 180, animated: true, bytes: 182_044, thumb: THUMB };

describe('sticker ids and still tokens', () => {
  it('accepts stk_ and 22 base64url characters only', () => {
    expect(ID).toHaveLength(26);
    expect(isStickerId(ID)).toBe(true);
    expect(isStickerId('stk_' + 'A'.repeat(22))).toBe(true);
    expect(isStickerId('stk_' + 'A'.repeat(21))).toBe(false);
    expect(isStickerId('stk_' + 'A'.repeat(23))).toBe(false);
    expect(isStickerId('stx_' + 'A'.repeat(22))).toBe(false);
    expect(isStickerId('STK_' + 'A'.repeat(22))).toBe(false);
    expect(isStickerId('stk_' + 'A'.repeat(21) + '.')).toBe(false);
    expect(isStickerId('stk_' + 'A'.repeat(21) + '/')).toBe(false);
    expect(isStickerId('stk_' + 'A'.repeat(21) + '=')).toBe(false);
    expect(isStickerId(` ${ID}`)).toBe(false);
    expect(isStickerId(`${ID}\n`)).toBe(false);
    expect(isStickerId(null)).toBe(false);
    expect(isStickerId(42)).toBe(false);
    expect(isStickerId(undefined)).toBe(false);
  });

  it('accepts exactly 22 base64url characters as a still token', () => {
    expect(isStickerThumbToken(THUMB)).toBe(true);
    expect(isStickerThumbToken('-'.repeat(22))).toBe(true);
    expect(isStickerThumbToken('A'.repeat(21))).toBe(false);
    expect(isStickerThumbToken('A'.repeat(23))).toBe(false);
    expect(isStickerThumbToken('A'.repeat(21) + '+')).toBe(false);
    expect(isStickerThumbToken(ID)).toBe(false);
    expect(isStickerThumbToken('')).toBe(false);
    expect(isStickerThumbToken(null)).toBe(false);
    expect(isStickerThumbToken({})).toBe(false);
  });

  it('knows the four types and their content types', () => {
    expect([...STICKER_TYPES]).toEqual(['gif', 'png', 'webp', 'jpeg']);
    for (const type of STICKER_TYPES) {
      expect(isStickerType(type)).toBe(true);
      expect(STICKER_MIME_TYPES[type]).toBe(`image/${type}`);
    }
    expect(isStickerType('jpg')).toBe(false);
    expect(isStickerType('GIF')).toBe(false);
    expect(isStickerType(undefined)).toBe(false);
  });
});

describe('sticker object keys', () => {
  it('builds the original and still keys', () => {
    expect(stickerObjectKey(ID, 'gif')).toBe(`sticker/${ID}.gif`);
    expect(stickerObjectKey(ID, 'jpeg')).toBe(`sticker/${ID}.jpeg`);
    expect(stickerThumbKey(ID, THUMB)).toBe(`sticker/${ID}-t-${THUMB}`);
  });

  it('accepts every key it builds', () => {
    for (const type of STICKER_TYPES) expect(isStickerObjectKey(stickerObjectKey(ID, type))).toBe(true);
    expect(isStickerObjectKey(stickerThumbKey(ID, THUMB))).toBe(true);
  });

  it('refuses traversal, other prefixes, wrong lengths, other types and the old -thumb form', () => {
    expect(isStickerObjectKey(`sticker/../${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}.gif/..`)).toBe(false);
    expect(isStickerObjectKey(`sticker/x/${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`stickers/${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`avatar/${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`chat/channel/abc/${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`/sticker/${ID}.gif`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID.slice(0, -1)}.gif`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}A.gif`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}.jpg`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}.svg`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}.gif.gif`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}-thumb.webp`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}-thumb`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}-t-${THUMB.slice(1)}`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}-t-${THUMB}A`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}-t-${THUMB}.webp`)).toBe(false);
    expect(isStickerObjectKey(`sticker/${ID}.gif?x=1`)).toBe(false);
    expect(isStickerObjectKey('')).toBe(false);
  });
});

describe('old-client alias keys', () => {
  it('puts the alias under the room prefix the way chat images are named', () => {
    expect(stickerAliasKey('channel:abc', ref)).toBe(`chat/channel/abc/${ID}.gif`);
    expect(stickerAliasKey('direct:dm_1', { id: ID, type: 'webp' })).toBe(`chat/direct/dm_1/${ID}.webp`);
  });

  it('maps an alias of this room to its original', () => {
    expect(stickerKeyForAlias('channel:abc', stickerAliasKey('channel:abc', ref))).toBe(stickerObjectKey(ID, 'gif'));
    expect(stickerKeyForAlias('direct:dm_1', `chat/direct/dm_1/${ID}.png`)).toBe(`sticker/${ID}.png`);
  });

  it('gives null for another room, real chat images, stills, extra segments and traversal', () => {
    const alias = stickerAliasKey('channel:abc', ref);
    expect(stickerKeyForAlias('channel:abd', alias)).toBeNull();
    expect(stickerKeyForAlias('channel:ab', alias)).toBeNull();
    expect(stickerKeyForAlias('direct:abc', alias)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', 'chat/channel/abc/img_0123456789abcdef.jpeg')).toBeNull();
    expect(stickerKeyForAlias('channel:abc', 'chat/channel/abc/img_0123456789abcdef.png')).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/${ID}-t-${THUMB}`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/x/${ID}.gif`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/../abd/${ID}.gif`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/..${ID}.gif`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/${ID}.jpg`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `chat/channel/abc/${ID}.gif/`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', `sticker/${ID}.gif`)).toBeNull();
    expect(stickerKeyForAlias('channel:abc', 'chat/channel/abc/')).toBeNull();
  });

  it('recognizes an alias name alone or as the last segment of a key', () => {
    expect(isStickerAliasName(`${ID}.gif`)).toBe(true);
    expect(isStickerAliasName(`chat/channel/abc/${ID}.webp`)).toBe(true);
    expect(isStickerAliasName('chat/channel/abc/img_0123456789abcdef.jpeg')).toBe(false);
    expect(isStickerAliasName(`chat/channel/abc/${ID}-t-${THUMB}`)).toBe(false);
    expect(isStickerAliasName(`chat/channel/abc/${ID}.gif/x`)).toBe(false);
    expect(isStickerAliasName(`${ID}.jpg`)).toBe(false);
    expect(isStickerAliasName('')).toBe(false);
  });
});

describe('normalizeStickerRef', () => {
  it('keeps a valid description as is', () => {
    expect(normalizeStickerRef(ref)).toEqual(ref);
    expect(normalizeStickerRef({ ...ref, extra: 'dropped' })).toEqual(ref);
  });

  it('refuses a description with a bad field', () => {
    expect(normalizeStickerRef(null)).toBeNull();
    expect(normalizeStickerRef('stk')).toBeNull();
    expect(normalizeStickerRef([ref])).toBeNull();
    expect(normalizeStickerRef({ ...ref, id: 'stk_short' })).toBeNull();
    expect(normalizeStickerRef({ ...ref, id: undefined })).toBeNull();
    expect(normalizeStickerRef({ ...ref, type: 'jpg' })).toBeNull();
    expect(normalizeStickerRef({ ...ref, type: 'svg' })).toBeNull();
    expect(normalizeStickerRef({ ...ref, width: 0 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, width: 10.5 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, height: '180' })).toBeNull();
    expect(normalizeStickerRef({ ...ref, height: IMAGE_DIMENSION_MAX + 1 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, bytes: 0 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, bytes: -1 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, bytes: 1.5 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, bytes: Number.MAX_SAFE_INTEGER + 1 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, animated: 1 })).toBeNull();
    expect(normalizeStickerRef({ ...ref, animated: undefined })).toBeNull();
  });

  it('checks dimensions against the general image bound, not the upload limits', () => {
    expect(normalizeStickerRef({ ...ref, width: STICKER_DIMENSION_MAX * 3, height: 1 })).toMatchObject({ width: STICKER_DIMENSION_MAX * 3, height: 1 });
    expect(normalizeStickerRef({ ...ref, width: IMAGE_DIMENSION_MAX, height: IMAGE_DIMENSION_MAX })).not.toBeNull();
    expect(normalizeStickerRef({ ...ref, bytes: STICKER_MAX_BYTES * 4 })).not.toBeNull();
  });

  it('turns a bad still into null and keeps the rest', () => {
    expect(normalizeStickerRef({ ...ref, thumb: 'nope' })).toEqual({ ...ref, thumb: null });
    expect(normalizeStickerRef({ ...ref, thumb: 7 })).toEqual({ ...ref, thumb: null });
    expect(normalizeStickerRef({ ...ref, thumb: undefined })).toEqual({ ...ref, thumb: null });
    expect(normalizeStickerRef({ ...ref, thumb: null })).toEqual({ ...ref, thumb: null });
  });

  it('is idempotent', () => {
    for (const value of [ref, { ...ref, thumb: 'bad' }, { ...ref, animated: false, type: 'jpeg' }]) {
      const once = normalizeStickerRef(value);
      expect(normalizeStickerRef(once)).toEqual(once);
    }
  });
});

describe('stickerDay', () => {
  it('turns at Toronto midnight, not UTC midnight', () => {
    // 2026-10-26 is daylight time (UTC-4): midnight is 04:00Z.
    // 2026-10-26 是夏令时（UTC-4）：午夜为 04:00Z。
    expect(stickerDay(Date.parse('2026-10-26T03:59:59.999Z'))).toBe('2026-10-25');
    expect(stickerDay(Date.parse('2026-10-26T04:00:00.000Z'))).toBe('2026-10-26');
    expect(stickerDay(Date.parse('2026-10-26T23:30:00.000Z'))).toBe('2026-10-26');
  });

  it('follows the autumn change from daylight to standard time', () => {
    // Daylight time ends on 2026-11-01 at 06:00Z: that midnight is still 04:00Z, the next one is 05:00Z.
    // 夏令时于 2026-11-01 06:00Z 结束：当天的午夜仍是 04:00Z，下一个午夜是 05:00Z。
    expect(stickerDay(Date.parse('2026-11-01T03:59:59.000Z'))).toBe('2026-10-31');
    expect(stickerDay(Date.parse('2026-11-01T04:00:00.000Z'))).toBe('2026-11-01');
    expect(stickerDay(Date.parse('2026-11-02T04:59:59.000Z'))).toBe('2026-11-01');
    expect(stickerDay(Date.parse('2026-11-02T05:00:00.000Z'))).toBe('2026-11-02');
  });

  it('follows the spring change from standard to daylight time', () => {
    // Daylight time starts on 2027-03-14 at 07:00Z: that midnight is 05:00Z, the next one is 04:00Z.
    // 夏令时于 2027-03-14 07:00Z 开始：当天的午夜是 05:00Z，下一个午夜是 04:00Z。
    expect(stickerDay(Date.parse('2027-03-14T04:59:59.000Z'))).toBe('2027-03-13');
    expect(stickerDay(Date.parse('2027-03-14T05:00:00.000Z'))).toBe('2027-03-14');
    expect(stickerDay(Date.parse('2027-03-15T03:59:59.000Z'))).toBe('2027-03-14');
    expect(stickerDay(Date.parse('2027-03-15T04:00:00.000Z'))).toBe('2027-03-15');
  });

  it('pads month and day and crosses the year', () => {
    expect(stickerDay(Date.parse('2027-01-01T04:59:59.000Z'))).toBe('2026-12-31');
    expect(stickerDay(Date.parse('2027-01-01T05:00:00.000Z'))).toBe('2027-01-01');
    expect(stickerDay(Date.parse('2027-02-05T12:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('limits and messages', () => {
  it('keeps the request cap equal to the file and still caps together', () => {
    expect(STICKER_UPLOAD_REQUEST_MAX_BYTES).toBe(STICKER_MAX_BYTES + STICKER_THUMB_MAX_BYTES);
    expect(STICKER_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(STICKER_ANIMATED_PIXELS_MAX).toBe(1024 * 1024);
  });

  it('builds the numbers in its messages from the limits', () => {
    expect(STICKER_MESSAGES.tooLarge).toBe('表情不能超过 8MB');
    expect(STICKER_MESSAGES.dimensions).toBe(`图片太大，长宽不能超过 ${STICKER_DIMENSION_MAX} 像素`);
    expect(STICKER_MESSAGES.animatedSize).toBe('动图太大，长宽不能超过 1024 像素');
    expect(STICKER_MESSAGES.frames).toBe(`动图帧数太多，不能超过 ${STICKER_ANIMATED_FRAMES_MAX} 帧`);
    expect(STICKER_MESSAGES.full).toBe(`最多添加 ${STICKERS_PER_MEMBER_MAX} 个表情，请先删除一些`);
  });

  it('has a distinct, non-empty message for every key', () => {
    const values = Object.values(STICKER_MESSAGES);
    expect(values.every((value) => value.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});
