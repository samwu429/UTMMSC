import { afterEach, describe, expect, it } from 'vitest';
import { forgetThumbs, rememberThumb, rememberThumbsOf, thumbKeyFor } from './thumbIndex';

afterEach(() => forgetThumbs());

describe('thumbIndex', () => {
  it('finds the thumbnail remembered for an image', () => {
    rememberThumb('chat/channel/ch_all/img_a.jpeg', 'chat/channel/ch_all/img_b.jpeg');
    expect(thumbKeyFor('chat/channel/ch_all/img_a.jpeg')).toBe('chat/channel/ch_all/img_b.jpeg');
    expect(thumbKeyFor('chat/channel/ch_all/other.jpeg')).toBeNull();
    expect(thumbKeyFor(null)).toBeNull();
    expect(thumbKeyFor('')).toBeNull();
  });

  it('ignores missing keys', () => {
    rememberThumb('img', null);
    rememberThumb(null, 'thumb');
    rememberThumb('', 'thumb');
    expect(thumbKeyFor('img')).toBeNull();
  });

  it('learns from a page of messages, skipping rows without an image or a thumbnail', () => {
    rememberThumbsOf([
      { imageKey: 'i1', thumbKey: 't1' },
      { imageKey: 'i2', thumbKey: null },
      { imageKey: null, thumbKey: 't3' },
      { imageKey: 'i4' },
    ]);
    expect([thumbKeyFor('i1'), thumbKeyFor('i2'), thumbKeyFor('i4')]).toEqual(['t1', null, null]);
  });

  it('keeps the 2000 most recently learned images', () => {
    for (let i = 0; i < 2001; i += 1) rememberThumb(`i${i}`, `t${i}`);
    expect(thumbKeyFor('i0')).toBeNull();
    expect(thumbKeyFor('i1')).toBe('t1');
    expect(thumbKeyFor('i2000')).toBe('t2000');
    // Learning an image again makes it the newest, so it outlives older ones.
    // 再次得知某张图片会让它成为最新的一项，因此比更早的项保留得更久。
    rememberThumb('i1', 't1b');
    rememberThumb('x', 'y');
    expect(thumbKeyFor('i1')).toBe('t1b');
    expect(thumbKeyFor('i2')).toBeNull();
  });

  it('forgets everything on sign-out', () => {
    rememberThumb('i', 't');
    forgetThumbs();
    expect(thumbKeyFor('i')).toBeNull();
  });
});
