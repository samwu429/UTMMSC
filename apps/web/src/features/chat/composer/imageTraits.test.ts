import { describe, expect, it } from 'vitest';
import { IMAGE_HEAD_BYTES, imageTraitsFromHeader, readImageTraits } from './imageTraits';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const be32 = (value: number) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const le32 = (value: number) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

/** A PNG chunk; the CRC is not checked, so it is left as zeros. */
/** 一个 PNG 块；CRC 不做校验，因此填零。 */
function chunk(type: string, data: number[] = []): number[] {
  return [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
}

/** A 512x512 PNG of the given colour type, with the chunks given placed between IHDR and the first IDAT. */
/** 指定颜色类型的 512x512 PNG，给定的块放在 IHDR 与第一个 IDAT 之间。 */
function png(colourType: number, ...before: number[][]) {
  const ihdr = chunk('IHDR', [...be32(512), ...be32(512), 8, colourType, 0, 0, 0]);
  return new Uint8Array([...PNG_SIGNATURE, ...ihdr, ...before.flat(), ...chunk('IDAT', [1, 2, 3]), ...chunk('IEND')]);
}

function webp(first: string, data: number[]) {
  const body = [...ascii('WEBP'), ...ascii(first), ...le32(data.length), ...data];
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
}

/** A VP8X header with these flags for a 512x512 canvas. */
/** 512x512 画布、带这些标志的 VP8X 头。 */
const vp8x = (flags: number) => webp('VP8X', [flags, 0, 0, 0, 0xff, 0x01, 0x00, 0xff, 0x01, 0x00]);
/** A VP8L header for a 512x512 image, with or without the alpha-is-used bit. */
/** 512x512 图片的 VP8L 头，带或不带「使用了透明」位。 */
const vp8l = (alpha: boolean) => webp('VP8L', [0x2f, ...le32((511 | (511 << 14) | (alpha ? 1 << 28 : 0)) >>> 0), 0, 0]);

describe('imageTraitsFromHeader for PNG', () => {
  it('finds nothing in an opaque PNG', () => {
    expect(imageTraitsFromHeader(png(2))).toEqual({ mayAnimate: false, mayBeTransparent: false });
    expect(imageTraitsFromHeader(png(0, chunk('gAMA', [0, 0, 0xb1, 0x8f])))).toEqual({ mayAnimate: false, mayBeTransparent: false });
  });

  it('counts an alpha channel or a transparent colour as transparent', () => {
    expect(imageTraitsFromHeader(png(6))).toEqual({ mayAnimate: false, mayBeTransparent: true });
    expect(imageTraitsFromHeader(png(4))).toEqual({ mayAnimate: false, mayBeTransparent: true });
    expect(imageTraitsFromHeader(png(3, chunk('PLTE', [0, 0, 0]), chunk('tRNS', [0])))).toEqual({ mayAnimate: false, mayBeTransparent: true });
  });

  it('finds the animation chunk of an APNG', () => {
    expect(imageTraitsFromHeader(png(2, chunk('acTL', [...be32(12), ...be32(0)])))).toEqual({ mayAnimate: true, mayBeTransparent: false });
    expect(imageTraitsFromHeader(png(6, chunk('iCCP', new Array(3000).fill(7)), chunk('acTL', [...be32(12), ...be32(0)])))).toEqual({
      mayAnimate: true,
      mayBeTransparent: true,
    });
  });

  it('ignores an acTL after the image data, which APNG does not allow', () => {
    const bytes = new Uint8Array([...png(2), ...chunk('acTL', [...be32(12), ...be32(0)])]);
    expect(imageTraitsFromHeader(bytes)).toEqual({ mayAnimate: false, mayBeTransparent: false });
  });

  it('assumes both when the header is cut off before the image data', () => {
    expect(imageTraitsFromHeader(png(2).subarray(0, 40))).toEqual({ mayAnimate: true, mayBeTransparent: true });
    expect(imageTraitsFromHeader(new Uint8Array(PNG_SIGNATURE))).toEqual({ mayAnimate: true, mayBeTransparent: true });
  });
});

describe('imageTraitsFromHeader for WebP', () => {
  it('reads a lossy still as opaque', () => {
    expect(imageTraitsFromHeader(webp('VP8 ', [0x9d, 0x01, 0x2a, 0, 2, 0, 2]))).toEqual({ mayAnimate: false, mayBeTransparent: false });
  });

  it('reads the alpha bit of a lossless image', () => {
    expect(imageTraitsFromHeader(vp8l(true))).toEqual({ mayAnimate: false, mayBeTransparent: true });
    expect(imageTraitsFromHeader(vp8l(false))).toEqual({ mayAnimate: false, mayBeTransparent: false });
  });

  it('reads the animation and alpha flags of an extended file', () => {
    expect(imageTraitsFromHeader(vp8x(0x02))).toEqual({ mayAnimate: true, mayBeTransparent: false });
    expect(imageTraitsFromHeader(vp8x(0x12))).toEqual({ mayAnimate: true, mayBeTransparent: true });
    expect(imageTraitsFromHeader(vp8x(0x10))).toEqual({ mayAnimate: false, mayBeTransparent: true });
    // ICC, EXIF and XMP flags alone say nothing about either.
    // 只有 ICC、EXIF 和 XMP 标志时两者都不成立。
    expect(imageTraitsFromHeader(vp8x(0x2c))).toEqual({ mayAnimate: false, mayBeTransparent: false });
  });

  it('assumes both for a chunk it does not know or a header cut short', () => {
    expect(imageTraitsFromHeader(webp('ABCD', [0, 0, 0, 0]))).toEqual({ mayAnimate: true, mayBeTransparent: true });
    expect(imageTraitsFromHeader(vp8x(0).subarray(0, 18))).toEqual({ mayAnimate: true, mayBeTransparent: true });
  });
});

describe('imageTraitsFromHeader for other formats', () => {
  it('reads nothing from JPEG, GIF or empty bytes', () => {
    expect(imageTraitsFromHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...ascii('JFIF')]))).toBeNull();
    expect(imageTraitsFromHeader(new Uint8Array(ascii('GIF89a')))).toBeNull();
    expect(imageTraitsFromHeader(new Uint8Array(0))).toBeNull();
  });
});

describe('readImageTraits', () => {
  it('reads only the head of a large file', async () => {
    const bytes = vp8x(0x02);
    const file = new Blob([bytes, new Uint8Array(IMAGE_HEAD_BYTES * 4)], { type: 'image/webp' });
    let asked = 0;
    const slice = file.slice.bind(file);
    Object.defineProperty(file, 'slice', {
      value: (start?: number, end?: number) => {
        asked = (end ?? file.size) - (start ?? 0);
        return slice(start, end);
      },
    });
    await expect(readImageTraits(file)).resolves.toEqual({ mayAnimate: true, mayBeTransparent: false });
    expect(asked).toBe(IMAGE_HEAD_BYTES);
  });

  it('gives null when the file cannot be read', async () => {
    const broken = new Blob([png(6)], { type: 'image/png' });
    Object.defineProperty(broken, 'slice', { value: () => ({ arrayBuffer: () => Promise.reject(new Error('gone')) }) });
    await expect(readImageTraits(broken)).resolves.toBeNull();
  });
});
