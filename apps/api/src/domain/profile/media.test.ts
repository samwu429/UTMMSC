import { describe, expect, it } from 'vitest';
import { FieldError } from './fields';
import { momentObjectKey, normalizePostMedia, ownsMomentKey } from './media';

const MEMBER = 'mem_localprofile';

describe('moment media', () => {
  it('accepts a photo key that belongs to the member', () => {
    const key = momentObjectKey(MEMBER, 'image/jpeg');
    expect(ownsMomentKey(MEMBER, key, 'image/jpeg')).toBe(true);
    expect(normalizePostMedia(MEMBER, [{ key, contentType: 'image/jpeg' }])).toEqual([
      { key, contentType: 'image/jpeg', kind: 'image' },
    ]);
  });

  it('rejects another member’s file, a mix of photo and video, and too many photos', () => {
    const own = momentObjectKey(MEMBER, 'image/png');
    const video = momentObjectKey(MEMBER, 'video/mp4');
    expect(ownsMomentKey(MEMBER, own.replace(MEMBER, 'mem_other'), 'image/png')).toBe(false);
    expect(() => normalizePostMedia(MEMBER, [{ key: 'moments/mem_other/med_x.png', contentType: 'image/png' }])).toThrow(FieldError);
    expect(() =>
      normalizePostMedia(MEMBER, [
        { key: own, contentType: 'image/png' },
        { key: video, contentType: 'video/mp4' },
      ]),
    ).toThrow(/不能发在同一条/);
    const many = Array.from({ length: 10 }, () => ({ key: momentObjectKey(MEMBER, 'image/jpeg'), contentType: 'image/jpeg' }));
    expect(() => normalizePostMedia(MEMBER, many)).toThrow(/9/);
  });
});
