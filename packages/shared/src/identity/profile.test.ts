import { describe, expect, it } from 'vitest';
import { PRESET_AVATARS, parsePresetAvatarKey, presetAvatarFile, presetAvatarKey, presetAvatarSizeFor, presetAvatarWebpFile } from './profile';

describe('preset avatar keys', () => {
  it('reads the preset and motion of every key', () => {
    for (const { id } of PRESET_AVATARS) {
      expect(parsePresetAvatarKey(presetAvatarKey(id))).toEqual({ id, motion: 'animated' });
      expect(parsePresetAvatarKey(presetAvatarKey(id, 'still'))).toEqual({ id, motion: 'still' });
    }
    expect(parsePresetAvatarKey('preset:unknown')).toBeNull();
    expect(parsePresetAvatarKey('avatar/mem_1/ava_x.jpg')).toBeNull();
  });

  it('still names the original GIF and PNG for old builds', () => {
    expect(presetAvatarFile('preset:woman-cute-gold')).toEqual({ id: 'woman-cute-gold', ext: 'gif' });
    expect(presetAvatarFile('preset:woman-cute-gold:still')).toEqual({ id: 'woman-cute-gold', ext: 'png' });
    expect(presetAvatarFile('preset:nope:still')).toBeNull();
  });
});

describe('preset avatar WebP files', () => {
  it('keeps an animated choice animated and a still choice still', () => {
    expect(presetAvatarWebpFile('preset:man-cool-gold', 128)).toBe('man-cool-gold-128.webp');
    expect(presetAvatarWebpFile('preset:man-cool-gold', 256)).toBe('man-cool-gold-256.webp');
    expect(presetAvatarWebpFile('preset:man-cool-gold:still', 128)).toBe('man-cool-gold-128-still.webp');
    expect(presetAvatarWebpFile('preset:man-cool-gold:still', 256)).toBe('man-cool-gold-256-still.webp');
  });

  it('uses the still file when reduced motion is set', () => {
    expect(presetAvatarWebpFile('preset:man-cool-gold', 128, true)).toBe('man-cool-gold-128-still.webp');
    expect(presetAvatarWebpFile('preset:man-cool-gold:still', 256, true)).toBe('man-cool-gold-256-still.webp');
  });

  it('gives no file for an upload or an unknown preset', () => {
    expect(presetAvatarWebpFile('avatar/mem_1/ava_x.jpg', 128)).toBeNull();
    expect(presetAvatarWebpFile('preset:other', 128)).toBeNull();
  });

  it('draws lists with the 128 file and larger avatars with the 256 file', () => {
    // Lists: 32 to 48 px.
    // 列表：32 到 48px。
    expect(presetAvatarSizeFor(32)).toBe(128);
    expect(presetAvatarSizeFor(40)).toBe(128);
    expect(presetAvatarSizeFor(48)).toBe(128);
    // 我的 (56 px), the moments cover (64 px), the profile (80 px) and the chooser (96 px).
    // 「我的」（56px）、动态封面（64px）、个人资料页（80px）和头像选择（96px）。
    expect(presetAvatarSizeFor(56)).toBe(256);
    expect(presetAvatarSizeFor(64)).toBe(256);
    expect(presetAvatarSizeFor(80)).toBe(256);
    expect(presetAvatarSizeFor(96)).toBe(256);
  });
});
