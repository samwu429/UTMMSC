import { AVATAR_MAX_BYTES } from '@utmmsc/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_GIF_KEEP_BYTES, AVATAR_VARIANT, AvatarPrepError, avatarProblemText, planAvatarUpload, prepareAvatarUpload } from './avatarPrep';
import { MediaDecodeError } from './canvas';
import { renderVariants } from './variants';

vi.mock('./variants', () => ({ renderVariants: vi.fn() }));

const MB = 1024 * 1024;
const render = vi.mocked(renderVariants);

function file(type: string, size: number, name = 'photo'): File {
  return new File([new Uint8Array(size)], name, { type });
}

const zh = (text: string) => text;
const en = (_zh: string, text: string) => text;

afterEach(() => {
  render.mockReset();
});

describe('planAvatarUpload', () => {
  it('re-encodes photos and large GIFs, keeps a small GIF animated', () => {
    expect(planAvatarUpload({ type: 'image/jpeg', size: 6 * MB })).toBe('encode');
    expect(planAvatarUpload({ type: 'image/png', size: 300 })).toBe('encode');
    expect(planAvatarUpload({ type: 'image/webp', size: MB })).toBe('encode');
    expect(planAvatarUpload({ type: 'image/gif', size: AVATAR_GIF_KEEP_BYTES })).toBe('keep');
    expect(planAvatarUpload({ type: 'image/gif', size: AVATAR_GIF_KEEP_BYTES + 1 })).toBe('encode');
  });

  it('refuses other types and empty files', () => {
    expect(planAvatarUpload({ type: 'image/heic', size: MB })).toBe('type');
    expect(planAvatarUpload({ type: '', size: MB })).toBe('type');
    expect(planAvatarUpload({ type: 'image/jpeg', size: 0 })).toBe('invalid');
  });
});

describe('prepareAvatarUpload', () => {
  it('uploads a 320px square JPEG made from the photo', async () => {
    const jpeg = new Blob([new Uint8Array(25_000)], { type: 'image/jpeg' });
    render.mockResolvedValue({ width: 4032, height: 3024, outputs: [{ blob: jpeg, width: 320, height: 320 }] });
    const picked = file('image/jpeg', 6 * MB);
    const out = await prepareAvatarUpload(picked);
    expect(render).toHaveBeenCalledWith(picked, [AVATAR_VARIANT]);
    expect(AVATAR_VARIANT).toMatchObject({ longEdge: 320, square: true, type: 'image/jpeg', quality: 0.85 });
    expect(out.name).toBe('avatar.jpg');
    expect(out.type).toBe('image/jpeg');
    expect(out.size).toBe(25_000);
  });

  it('sends a small GIF as it is', async () => {
    const gif = file('image/gif', 200_000);
    await expect(prepareAvatarUpload(gif)).resolves.toBe(gif);
    expect(render).not.toHaveBeenCalled();
  });

  it('falls back to the original when the canvas fails, within the server limit', async () => {
    render.mockResolvedValue({ width: 1000, height: 1000, outputs: [null] });
    const small = file('image/png', 2 * MB);
    await expect(prepareAvatarUpload(small)).resolves.toBe(small);
    await expect(prepareAvatarUpload(file('image/png', AVATAR_MAX_BYTES + 1))).rejects.toMatchObject({ problem: 'size' });
  });

  it('refuses a file nothing can decode, or of the wrong type', async () => {
    render.mockRejectedValue(new MediaDecodeError());
    await expect(prepareAvatarUpload(file('image/jpeg', MB))).rejects.toMatchObject({ problem: 'invalid' });
    await expect(prepareAvatarUpload(file('image/heic', MB))).rejects.toBeInstanceOf(AvatarPrepError);
  });
});

describe('avatarProblemText', () => {
  it('says what went wrong in either language', () => {
    expect(avatarProblemText(new AvatarPrepError('type'), zh)).toBe('只支持 JPEG、PNG、WebP、GIF');
    expect(avatarProblemText(new AvatarPrepError('size'), en)).toBe(`Profile photos must be ${AVATAR_MAX_BYTES / MB}MB or smaller.`);
    expect(avatarProblemText(new AvatarPrepError('invalid'), zh)).toBe('图片无法读取，请换一张');
    expect(avatarProblemText(new Error('other'), en)).toBe('Couldn’t read that image. Try another.');
  });
});
