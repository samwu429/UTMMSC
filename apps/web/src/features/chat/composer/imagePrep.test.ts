import { CHAT_IMAGE_MAX_BYTES } from '@utmmsc/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderVariants } from '../../../shared/media/variants';
import {
  CHAT_MAIN_VARIANT,
  CHAT_STICKER_LONG_EDGE,
  CHAT_THUMB_LONG_EDGE,
  CHAT_THUMB_VARIANT,
  IMAGE_LONG_EDGE_MAX,
  IMAGE_PICK_ACCEPT,
  THUMB_WORTH_RATIO,
  chatCopiesFor,
  checkImageFile,
  chooseChatUpload,
  jpegFileName,
  needsChatVariants,
  planDownscale,
  prepareChatUpload,
  shrinkForRetry,
} from './imagePrep';

vi.mock('../../../shared/media/variants', () => ({ renderVariants: vi.fn() }));

const render = vi.mocked(renderVariants);

const MB = 1024 * 1024;

describe('IMAGE_PICK_ACCEPT', () => {
  it('lists exactly the types that make iOS convert HEIC', () => {
    expect(IMAGE_PICK_ACCEPT).toBe('image/jpeg,image/png,image/webp,image/gif');
  });
});

describe('checkImageFile', () => {
  it('rejects types the server does not store', () => {
    expect(checkImageFile({ type: 'image/heic', size: MB })).toBe('type');
    expect(checkImageFile({ type: '', size: MB })).toBe('type');
  });

  it('rejects only GIFs over the byte limit, since other types are shrunk', () => {
    expect(checkImageFile({ type: 'image/gif', size: CHAT_IMAGE_MAX_BYTES + 1 })).toBe('size');
    expect(checkImageFile({ type: 'image/gif', size: CHAT_IMAGE_MAX_BYTES })).toBeNull();
    expect(checkImageFile({ type: 'image/jpeg', size: 12 * MB })).toBeNull();
  });
});

describe('planDownscale', () => {
  it('keeps small images as they are', () => {
    expect(planDownscale(4000, 3000, 3 * MB, 'image/jpeg')).toBeNull();
    expect(planDownscale(IMAGE_LONG_EDGE_MAX, 1000, CHAT_IMAGE_MAX_BYTES, 'image/png')).toBeNull();
  });

  it('re-encodes at the same size when only the byte limit is passed', () => {
    expect(planDownscale(4000, 3000, 12 * MB, 'image/jpeg')).toEqual({ width: 4000, height: 3000 });
    expect(planDownscale(1000, 800, CHAT_IMAGE_MAX_BYTES + 1, 'image/webp')).toEqual({ width: 1000, height: 800 });
  });

  it('scales the long edge down to 4096px and keeps the ratio', () => {
    expect(planDownscale(4097, 1000, MB, 'image/jpeg')).toEqual({ width: 4096, height: 1000 });
    expect(planDownscale(8192, 6144, 20 * MB, 'image/jpeg')).toEqual({ width: 4096, height: 3072 });
    expect(planDownscale(3000, 9000, 2 * MB, 'image/png')).toEqual({ width: 1365, height: 4096 });
    expect(planDownscale(100_000, 10, MB, 'image/png')).toEqual({ width: 4096, height: 1 });
  });

  it('never re-encodes a GIF or an unreadable size', () => {
    expect(planDownscale(9000, 9000, 20 * MB, 'image/gif')).toBeNull();
    expect(planDownscale(0, 100, 20 * MB, 'image/jpeg')).toBeNull();
    expect(planDownscale(Number.NaN, 100, 20 * MB, 'image/jpeg')).toBeNull();
  });
});

describe('shrinkForRetry and jpegFileName', () => {
  it('shrinks both edges and never reaches zero', () => {
    expect(shrinkForRetry({ width: 4096, height: 3072 })).toEqual({ width: 3072, height: 2304 });
    expect(shrinkForRetry({ width: 1, height: 1 })).toEqual({ width: 1, height: 1 });
  });

  it('renames the file to .jpg', () => {
    expect(jpegFileName('IMG_0001.PNG')).toBe('IMG_0001.jpg');
    expect(jpegFileName('photo.final.webp')).toBe('photo.final.jpg');
    expect(jpegFileName('')).toBe('image.jpg');
    expect(jpegFileName('.png')).toBe('image.jpg');
  });
});

describe('chat upload copies', () => {
  const jpeg = (size: number) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

  it('makes copies for photos but not for GIFs or photos already thumbnail-sized', () => {
    expect(needsChatVariants('image/jpeg', { width: 4032, height: 3024 })).toBe(true);
    expect(needsChatVariants('image/png')).toBe(true);
    expect(needsChatVariants('image/gif', { width: 4032, height: 3024 })).toBe(false);
    expect(needsChatVariants('image/webp', { width: CHAT_THUMB_LONG_EDGE, height: 200 })).toBe(false);
    expect(needsChatVariants('image/webp', { width: CHAT_THUMB_LONG_EDGE + 1, height: 200 })).toBe(true);
  });

  it('asks for a 2048px main copy at 0.82 and a 360px thumbnail at 0.75, both only when larger', () => {
    expect(CHAT_MAIN_VARIANT).toEqual({ longEdge: 2048, onlyWhenLarger: true, type: 'image/jpeg', quality: 0.82 });
    expect(CHAT_THUMB_VARIANT).toMatchObject({ longEdge: 360, onlyWhenLarger: true, type: 'image/jpeg', quality: 0.75 });
  });

  it('uploads the 2048px copy and its thumbnail for a camera photo', () => {
    const original = jpeg(3 * MB);
    const main = jpeg(480_000);
    const thumb = jpeg(39_000);
    expect(chooseChatUpload(original, { outputs: [{ blob: main, width: 2048, height: 1536 }, { blob: thumb, width: 360, height: 270 }] })).toEqual({
      main,
      thumb,
      width: 2048,
      height: 1536,
    });
  });

  it('keeps an original that is already lighter than its re-encode', () => {
    const original = jpeg(300_000);
    const thumb = jpeg(30_000);
    const upload = chooseChatUpload(original, { outputs: [{ blob: jpeg(400_000), width: 2048, height: 1536 }, { blob: thumb, width: 360, height: 270 }] });
    expect(upload).toEqual({ main: original, thumb, width: null, height: null });
  });

  it('uses the re-encode of an original over the byte limit even when it is larger', () => {
    const original = new Blob([new Uint8Array(1)], { type: 'image/jpeg' });
    Object.defineProperty(original, 'size', { value: CHAT_IMAGE_MAX_BYTES + 1 });
    const main = jpeg(2 * MB);
    expect(chooseChatUpload(original, { outputs: [{ blob: main, width: 2048, height: 1536 }, null] }).main).toBe(main);
  });

  it('drops a thumbnail that saves little', () => {
    const original = jpeg(100_000);
    expect(chooseChatUpload(original, { outputs: [null, { blob: jpeg(80_000), width: 360, height: 270 }] }).thumb).toBeNull();
    expect(chooseChatUpload(original, { outputs: [null, { blob: jpeg(79_999), width: 360, height: 270 }] }).thumb).not.toBeNull();
    expect(THUMB_WORTH_RATIO).toBe(0.8);
  });

  it('makes both copies in one pass and sends the photo as picked when they fail', async () => {
    const original = jpeg(3 * MB);
    const main = jpeg(480_000);
    const thumb = jpeg(39_000);
    render.mockResolvedValueOnce({ width: 4032, height: 3024, outputs: [{ blob: main, width: 2048, height: 1536 }, { blob: thumb, width: 360, height: 270 }] });
    await expect(prepareChatUpload(original, { width: 4032, height: 3024 })).resolves.toEqual({ main, thumb, width: 2048, height: 1536 });
    expect(render).toHaveBeenCalledWith(original, [CHAT_MAIN_VARIANT, CHAT_THUMB_VARIANT]);

    render.mockRejectedValueOnce(new Error('decode'));
    await expect(prepareChatUpload(original)).resolves.toEqual({ main: original, thumb: null, width: null, height: null });

    const gif = new Blob([new Uint8Array(10)], { type: 'image/gif' });
    render.mockClear();
    await expect(prepareChatUpload(gif)).resolves.toEqual({ main: gif, thumb: null, width: null, height: null });
    expect(render).not.toHaveBeenCalled();
  });
});

describe('animated and transparent images', () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  const sticker = { width: 512, height: 512 };
  /** A 512x512 PNG header of this colour type, the given chunks, then the first IDAT, padded to about 150KB. */
  /** 这种颜色类型的 512x512 PNG 文件头、给定的块和第一个 IDAT，再补足到约 150KB。 */
  const pngFile = (colourType: number, ...chunks: number[][]) =>
    new Blob(
      [
        new Uint8Array([
          ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
          ...[0, 0, 0, 13, ...ascii('IHDR'), 0, 0, 2, 0, 0, 0, 2, 0, 8, colourType, 0, 0, 0, 0, 0, 0, 0],
          ...chunks.flat(),
          ...[0, 0, 0, 0, ...ascii('IDAT'), 0, 0, 0, 0],
        ]),
        new Uint8Array(150_000),
      ],
      { type: 'image/png' },
    );
  /** A 512x512 extended WebP header with these VP8X flags (0x02 animation, 0x10 alpha), padded to about 150KB. */
  /** 带这些 VP8X 标志（0x02 动画，0x10 透明）的 512x512 扩展 WebP 文件头，补足到约 150KB。 */
  const webpFile = (flags: number) =>
    new Blob(
      [new Uint8Array([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8X'), 10, 0, 0, 0, flags, 0, 0, 0, 0xff, 0x01, 0, 0xff, 0x01, 0]), new Uint8Array(150_000)],
      { type: 'image/webp' },
    );
  const actl = [0, 0, 0, 8, ...ascii('acTL'), 0, 0, 0, 12, 0, 0, 0, 0, 0, 0, 0, 0];

  it('makes no copy that would stop an animation or fill a sticker with white', () => {
    const screenshot = { width: 1170, height: 2532 };
    const transparent = { mayAnimate: false, mayBeTransparent: true };
    expect(chatCopiesFor(null, screenshot)).toBe('both');
    expect(chatCopiesFor({ mayAnimate: false, mayBeTransparent: false }, screenshot)).toBe('both');
    expect(chatCopiesFor({ mayAnimate: true, mayBeTransparent: false }, sticker)).toBe('none');
    expect(chatCopiesFor({ mayAnimate: true, mayBeTransparent: true }, screenshot)).toBe('none');
    expect(chatCopiesFor(transparent, sticker)).toBe('none');
    expect(chatCopiesFor(transparent, { width: CHAT_STICKER_LONG_EDGE, height: 300 })).toBe('none');
    expect(chatCopiesFor(transparent, null)).toBe('none');
    // Larger than a sticker, most often a screenshot: the row still gets a thumbnail.
    // 比表情图大的，通常是截图：消息行仍然有缩略图。
    expect(chatCopiesFor(transparent, { width: CHAT_STICKER_LONG_EDGE + 1, height: 300 })).toBe('thumb');
    expect(chatCopiesFor(transparent, screenshot)).toBe('thumb');
  });

  it('sends an animated WebP or APNG sticker as picked, so its row keeps animating', async () => {
    render.mockClear();
    for (const file of [webpFile(0x02), pngFile(2, actl)]) {
      await expect(prepareChatUpload(file, sticker)).resolves.toEqual({ main: file, thumb: null, width: null, height: null });
    }
    // An animated WebP larger than the 2048px main copy is not re-encoded either.
    // 比 2048px 主图更大的动态 WebP 同样不会被重新编码。
    const large = webpFile(0x12);
    await expect(prepareChatUpload(large, { width: 3000, height: 3000 })).resolves.toEqual({ main: large, thumb: null, width: null, height: null });
    expect(render).not.toHaveBeenCalled();
  });

  it('sends a PNG or WebP sticker that may be transparent as picked, so its row is not drawn on white', async () => {
    render.mockClear();
    for (const file of [pngFile(6), pngFile(4), pngFile(3, [0, 0, 0, 1, ...ascii('tRNS'), 0, 0, 0, 0, 0]), webpFile(0x10)]) {
      await expect(prepareChatUpload(file, sticker)).resolves.toEqual({ main: file, thumb: null, width: null, height: null });
    }
    expect(render).not.toHaveBeenCalled();
  });

  it('gives a larger possibly transparent image a thumbnail but keeps its original as the main image', async () => {
    const thumb = new Blob([new Uint8Array(30_000)], { type: 'image/jpeg' });
    for (const file of [pngFile(6), webpFile(0x10)]) {
      render.mockClear();
      render.mockResolvedValueOnce({ width: 1170, height: 2532, outputs: [{ blob: thumb, width: 360, height: 779 }] });
      await expect(prepareChatUpload(file, { width: 1170, height: 2532 })).resolves.toEqual({ main: file, thumb, width: null, height: null });
      expect(render).toHaveBeenCalledWith(file, [CHAT_THUMB_VARIANT]);
    }
  });

  it('still makes copies of an opaque PNG or WebP', async () => {
    const thumb = new Blob([new Uint8Array(20_000)], { type: 'image/jpeg' });
    for (const file of [pngFile(2), webpFile(0x20)]) {
      render.mockClear();
      render.mockResolvedValueOnce({ width: 512, height: 512, outputs: [null, { blob: thumb, width: 360, height: 360 }] });
      await expect(prepareChatUpload(file, sticker)).resolves.toEqual({ main: file, thumb, width: null, height: null });
      expect(render).toHaveBeenCalledWith(file, [CHAT_MAIN_VARIANT, CHAT_THUMB_VARIANT]);
    }
  });
});
