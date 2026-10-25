import { describe, expect, it } from 'vitest';
import { avatarImageSrc, avatarPxFromClass, coverImageSrc, mediaUrl, presetAvatarSrc } from './media';

const BASE = import.meta.env.BASE_URL;

describe('avatarImageSrc', () => {
  it('draws the 128 px WebP in lists and keeps an animated choice animated', () => {
    expect(avatarImageSrc('preset:man-cool-gold', null)).toBe(`${BASE}avatars/man-cool-gold-128.webp`);
    expect(avatarImageSrc('preset:man-cool-gold', null, { displayPx: 48 })).toBe(`${BASE}avatars/man-cool-gold-128.webp`);
    expect(avatarImageSrc('preset:woman-cute-gold:still', 'tok', { displayPx: 40 })).toBe(`${BASE}avatars/woman-cute-gold-128-still.webp`);
  });

  it('draws the 256 px file above 48 px, as on the profile page', () => {
    expect(avatarImageSrc('preset:man-cute-purple', null, { displayPx: 80 })).toBe(`${BASE}avatars/man-cute-purple-256.webp`);
    expect(avatarImageSrc('preset:man-cute-purple:still', null, { displayPx: 96 })).toBe(`${BASE}avatars/man-cute-purple-256-still.webp`);
  });

  it('draws the 256 px file for the 我的 header and the moments cover, from their classes', () => {
    for (const className of ['h-14 w-14 text-xl', 'h-16 w-16 text-2xl']) {
      const displayPx = avatarPxFromClass(className) ?? 0;
      expect(avatarImageSrc('preset:woman-cute-gold', null, { displayPx })).toBe(`${BASE}avatars/woman-cute-gold-256.webp`);
    }
  });

  it('lets a page ask for the sharper file', () => {
    expect(avatarImageSrc('preset:man-cool-gold', null, { displayPx: 40, presetSize: 256 })).toBe(`${BASE}avatars/man-cool-gold-256.webp`);
  });

  it('turns an animated preset still when the system asks for less motion', () => {
    expect(avatarImageSrc('preset:woman-cool-purple', null, { reducedMotion: true })).toBe(`${BASE}avatars/woman-cool-purple-128-still.webp`);
  });

  it('never points at the old GIF or PNG files', () => {
    for (const key of ['preset:man-cool-gold', 'preset:man-cool-gold:still']) {
      for (const displayPx of [32, 40, 48, 80, 96]) expect(avatarImageSrc(key, null, { displayPx })).toMatch(/\.webp$/);
    }
  });

  it('gives nothing for an unknown preset, a missing key, or an upload without a token', () => {
    expect(avatarImageSrc('preset:nobody', 'tok')).toBeNull();
    expect(avatarImageSrc(null, 'tok')).toBeNull();
    expect(avatarImageSrc('', 'tok')).toBeNull();
    expect(avatarImageSrc('avatar/mem_1/a.jpg', null)).toBeNull();
  });

  it('serves an uploaded photo from the media route', () => {
    expect(avatarImageSrc('avatar/mem_1/a.jpg', 't k')).toBe(mediaUrl('avatar/mem_1/a.jpg', 't k'));
    expect(mediaUrl('avatar/mem_1/a.jpg', 't k')).toMatch(/\/members\/media\/avatar%2Fmem_1%2Fa\.jpg\?t=t%20k$/);
    expect(coverImageSrc('cover/mem_1/c.jpg', 'tok')).toBe(mediaUrl('cover/mem_1/c.jpg', 'tok'));
    expect(coverImageSrc('cover/mem_1/c.jpg', null)).toBeNull();
  });
});

describe('presetAvatarSrc', () => {
  it('names the chooser files', () => {
    expect(presetAvatarSrc('man-cool-gold', 'animated', 256)).toBe(`${BASE}avatars/man-cool-gold-256.webp`);
    expect(presetAvatarSrc('man-cool-gold', 'still', 256)).toBe(`${BASE}avatars/man-cool-gold-256-still.webp`);
    expect(presetAvatarSrc('man-cool-gold', 'animated', 256, true)).toBe(`${BASE}avatars/man-cool-gold-256-still.webp`);
  });
});

describe('avatarPxFromClass', () => {
  it('reads the Tailwind height the call sites use', () => {
    expect(avatarPxFromClass('h-10 w-10 text-sm')).toBe(40);
    expect(avatarPxFromClass('h-20 w-20 text-2xl ring-4 ring-white')).toBe(80);
    expect(avatarPxFromClass('h-11 w-11 text-base')).toBe(44);
    expect(avatarPxFromClass('h-[42px] w-[42px] text-base')).toBe(42);
    expect(avatarPxFromClass('pointer-events-none h-10 w-10')).toBe(40);
    expect(avatarPxFromClass('h-2.5 w-2.5')).toBe(10);
  });

  it('ignores variants and anything it cannot read', () => {
    expect(avatarPxFromClass('sm:h-16 w-16')).toBeNull();
    expect(avatarPxFromClass('h-full w-full')).toBeNull();
    expect(avatarPxFromClass('')).toBeNull();
  });
});
