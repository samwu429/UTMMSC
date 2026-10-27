import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StickerRef } from '@utmmsc/shared';
import {
  mediaStatus,
  saveDataPreferred,
  stickerAutoplays,
  stickerChatImage,
  stickerFileSrc,
  stickerGridImage,
  stickerThumbSrc,
} from './media';

const ID = `stk_${'a'.repeat(22)}`;
const THUMB = 'T'.repeat(22);
const KIB = 1024;
const MIB = 1024 * KIB;

function ref(overrides: Partial<StickerRef> = {}): StickerRef {
  return { id: ID, type: 'gif', width: 240, height: 240, animated: true, bytes: 300 * KIB, thumb: THUMB, ...overrides };
}

const FILE = `/members/media/sticker%2F${ID}.gif?t=tok`;
const STILL = `/members/media/sticker%2F${ID}-t-${THUMB}?t=tok`;
const calm = { reducedMotion: false, saveData: false };

function path(src: string | null): string | null {
  return src === null ? null : src.slice(src.indexOf('/members/media/'));
}

describe('sticker URLs', () => {
  it('load the file and the still from members media with the profile token', () => {
    expect(path(stickerFileSrc(ref(), 'tok'))).toBe(FILE);
    expect(path(stickerThumbSrc(ref(), 'tok'))).toBe(STILL);
    expect(path(stickerFileSrc(ref({ type: 'jpeg' }), 'tok'))).toBe(`/members/media/sticker%2F${ID}.jpeg?t=tok`);
  });

  it('give nothing without a token, and no still without a thumb', () => {
    expect(stickerFileSrc(ref(), null)).toBeNull();
    expect(stickerThumbSrc(ref(), null)).toBeNull();
    expect(stickerThumbSrc(ref({ thumb: null }), 'tok')).toBeNull();
  });
});

describe('stickerAutoplays', () => {
  it('plays a small animated sticker', () => {
    expect(stickerAutoplays(ref(), calm)).toBe(true);
    expect(stickerAutoplays(ref({ bytes: 2 * MIB, width: 640, height: 640 }), calm)).toBe(true);
  });

  it('stills static, large, wide, reduced-motion and data-saving cases', () => {
    expect(stickerAutoplays(ref({ animated: false }), calm)).toBe(false);
    expect(stickerAutoplays(ref({ bytes: 2 * MIB + 1 }), calm)).toBe(false);
    expect(stickerAutoplays(ref({ width: 641, height: 640 }), calm)).toBe(false);
    expect(stickerAutoplays(ref(), { reducedMotion: true, saveData: false })).toBe(false);
    expect(stickerAutoplays(ref({ bytes: 512 * KIB }), { reducedMotion: false, saveData: true })).toBe(true);
    expect(stickerAutoplays(ref({ bytes: 512 * KIB + 1 }), { reducedMotion: false, saveData: true })).toBe(false);
  });
});

describe('stickerChatImage', () => {
  const chat = (r: StickerRef, options = calm) => {
    const image = stickerChatImage(r, 'tok', options);
    return { src: path(image.src), still: image.still };
  };

  it('shows a static sticker\'s file, with or without a still', () => {
    expect(chat(ref({ animated: false }))).toEqual({ src: FILE, still: false });
    expect(chat(ref({ animated: false, thumb: null }))).toEqual({ src: FILE, still: false });
    expect(chat(ref({ animated: false }), { reducedMotion: true, saveData: true })).toEqual({ src: FILE, still: false });
  });

  it('plays an animated sticker within the limits, and shows its still otherwise', () => {
    expect(chat(ref())).toEqual({ src: FILE, still: false });
    expect(chat(ref({ bytes: 3 * MIB }))).toEqual({ src: STILL, still: true });
    expect(chat(ref({ width: 800, height: 800 }))).toEqual({ src: STILL, still: true });
    expect(chat(ref(), { reducedMotion: true, saveData: false })).toEqual({ src: STILL, still: true });
    expect(chat(ref({ bytes: 1 * MIB }), { reducedMotion: false, saveData: true })).toEqual({ src: STILL, still: true });
    expect(chat(ref({ bytes: 100 * KIB }), { reducedMotion: false, saveData: true })).toEqual({ src: FILE, still: false });
  });

  it('shows nothing for a still animated sticker that has no still', () => {
    expect(chat(ref({ thumb: null, bytes: 3 * MIB }))).toEqual({ src: null, still: true });
    expect(chat(ref({ thumb: null }))).toEqual({ src: FILE, still: false });
  });
});

describe('stickerGridImage', () => {
  const grid = (r: StickerRef, options = calm) => {
    const image = stickerGridImage(r, 'tok', options);
    return { src: path(image.src), still: image.still };
  };

  it('shows a static sticker\'s still, or its file without one', () => {
    expect(grid(ref({ animated: false }))).toEqual({ src: STILL, still: false });
    expect(grid(ref({ animated: false, thumb: null }))).toEqual({ src: FILE, still: false });
  });

  it('animates within the grid limits only when motion is allowed and data saving is off', () => {
    expect(grid(ref({ bytes: 1 * MIB }))).toEqual({ src: FILE, still: false });
    expect(grid(ref({ bytes: 1 * MIB + 1 }))).toEqual({ src: STILL, still: true });
    expect(grid(ref({ width: 700, height: 600 }))).toEqual({ src: STILL, still: true });
    expect(grid(ref(), { reducedMotion: true, saveData: false })).toEqual({ src: STILL, still: true });
    expect(grid(ref({ bytes: 10 * KIB }), { reducedMotion: false, saveData: true })).toEqual({ src: STILL, still: true });
  });

  it('without a still, shows the file within the limits and a neutral tile otherwise', () => {
    expect(grid(ref({ thumb: null }))).toEqual({ src: FILE, still: false });
    expect(grid(ref({ thumb: null, bytes: 2 * MIB }))).toEqual({ src: null, still: true });
    expect(grid(ref({ thumb: null }), { reducedMotion: true, saveData: false })).toEqual({ src: null, still: true });
    expect(grid(ref({ thumb: null }), { reducedMotion: false, saveData: true })).toEqual({ src: null, still: true });
  });

  it('shows nothing without a token', () => {
    expect(stickerGridImage(ref(), null, calm).src).toBeNull();
    expect(stickerChatImage(ref(), null, calm).src).toBeNull();
  });
});

describe('saveDataPreferred', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads navigator.connection.saveData, and false where it is missing', () => {
    vi.stubGlobal('navigator', { connection: { saveData: true } });
    expect(saveDataPreferred()).toBe(true);
    vi.stubGlobal('navigator', { connection: { saveData: false } });
    expect(saveDataPreferred()).toBe(false);
    vi.stubGlobal('navigator', {});
    expect(saveDataPreferred()).toBe(false);
  });
});

describe('mediaStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives the status without the cache and cancels the body, or null on a network error', async () => {
    const cancel = vi.fn(async () => undefined);
    const fetchMock = vi.fn(async () => ({ status: 404, body: { cancel } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await mediaStatus('https://x.test/members/media/a')).toBe(404);
    expect(fetchMock).toHaveBeenCalledWith('https://x.test/members/media/a', { cache: 'no-store' });
    expect(cancel).toHaveBeenCalled();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    expect(await mediaStatus('https://x.test/members/media/a')).toBeNull();
  });
});
