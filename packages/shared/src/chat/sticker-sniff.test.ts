import { describe, expect, it } from 'vitest';
import { detectStickerType, sniffSticker } from './sticker-sniff';
import {
  STICKER_ANIMATED_PIXELS_MAX,
  STICKER_DIMENSION_MAX,
  STICKER_MAX_BYTES,
  STICKER_SNIFF_STEPS_MAX,
  STICKER_THUMB_DIMENSION_MAX,
} from './stickers';

/*
 * Minimal files built by hand, byte by byte, so each test shows exactly what the sniffer walks. Image data is filler:
 * the sniffer never decodes.
 * 逐字节手工构造的最小文件，让每个测试都清楚地显示嗅探器遍历的内容。图像数据只是占位：嗅探器从不解码。
 */

type Part = number[] | string | Uint8Array;

function bytes(...parts: Part[]): Uint8Array {
  const list = parts.map((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : [...part]));
  return Uint8Array.from(list.flat());
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function gifHeader(width: number, height: number, tableBits: number | null = 1): number[] {
  const table = tableBits === null ? [] : new Array<number>(3 * (1 << (tableBits + 1))).fill(0);
  return [...bytes('GIF89a'), ...le16(width), ...le16(height), tableBits === null ? 0 : 0x80 | tableBits, 0, 0, ...table];
}

function gifControl(transparent: boolean): number[] {
  return [0x21, 0xf9, 4, transparent ? 0x01 : 0x00, 10, 0, 0, 0];
}

/** An image descriptor with a local colour table, then its data as sub-blocks of the given sizes. */
/** 带局部颜色表的图像描述符，然后是按给定大小切分的子块数据。 */
function gifFrame(width: number, height: number, subBlocks: number[] = [3]): number[] {
  const data = subBlocks.flatMap((size) => [size, ...new Array<number>(size).fill(0x55)]);
  return [0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0x80, ...new Array<number>(6).fill(0), 2, ...data, 0];
}

/** The same image descriptor placed at `left`, `top` on the screen. */
/** 放在屏幕上 `left`、`top` 位置的同样的图像描述符。 */
function gifFrameAt(left: number, top: number, width: number, height: number): number[] {
  const frame = gifFrame(width, height);
  frame.splice(1, 4, ...le16(left), ...le16(top));
  return frame;
}

const GIF_LOOP = [0x21, 0xff, 11, ...bytes('NETSCAPE2.0'), 3, 1, 0, 0, 0];
const GIF_COMMENT = [0x21, 0xfe, 5, ...bytes('hello'), 0];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[] = []): number[] {
  return [...be32(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
}

function ihdr(width: number, height: number, colourType = 2): number[] {
  return pngChunk('IHDR', [...be32(width), ...be32(height), 8, colourType, 0, 0, 0]);
}

const IDAT = pngChunk('IDAT', [0x78, 0x9c, 1, 2, 3]);
const IEND = pngChunk('IEND');
const actl = (frames: number) => pngChunk('acTL', [...be32(frames), ...be32(0)]);
const fctl = (sequence: number) => pngChunk('fcTL', [...be32(sequence), ...new Array<number>(22).fill(0)]);
const fdat = (sequence: number) => pngChunk('fdAT', [...be32(sequence), 1, 2, 3]);

function png(...chunks: number[][]): Uint8Array {
  return bytes(PNG_SIGNATURE, ...chunks);
}

function webpChunk(type: string, data: number[]): number[] {
  return [...bytes(type), ...le32(data.length), ...data, ...(data.length % 2 === 1 ? [0] : [])];
}

function riff(...chunks: number[][]): Uint8Array {
  const body = chunks.flat();
  return bytes('RIFF', le32(4 + body.length), 'WEBP', body);
}

function vp8(width: number, height: number): number[] {
  return webpChunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 1, 2, 3]);
}

function vp8l(width: number, height: number, alpha: boolean): number[] {
  const bits = ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0;
  return webpChunk('VP8L', [0x2f, ...le32(bits), 7, 7]);
}

function vp8x(width: number, height: number, flags: number): number[] {
  return webpChunk('VP8X', [flags, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]);
}

const ANIM = webpChunk('ANIM', [0, 0, 0, 0, 0, 0]);
const anmf = () => webpChunk('ANMF', [...new Array<number>(16).fill(0), ...vp8(4, 4)]);
const ALPH = webpChunk('ALPH', [0, 9, 9]);

function jpeg(width: number, height: number, frameMarker = 0xc0): Uint8Array {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, ...be16(16), ...bytes('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xdb, ...be16(4), 0, 1],
    [0xff, frameMarker, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0],
    [0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd3, 0x78],
    [0xff, 0xd9],
  );
}

describe('detectStickerType', () => {
  it('names the format from the first bytes only', () => {
    expect(detectStickerType(bytes('GIF89a'))).toBe('gif');
    expect(detectStickerType(bytes('GIF87a', [1, 2]))).toBe('gif');
    expect(detectStickerType(bytes(PNG_SIGNATURE))).toBe('png');
    expect(detectStickerType(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('webp');
    expect(detectStickerType(bytes([0xff, 0xd8, 0xff]))).toBe('jpeg');
  });

  it('names nothing else', () => {
    expect(detectStickerType(new Uint8Array(0))).toBeNull();
    expect(detectStickerType(bytes('GIF88a'))).toBeNull();
    expect(detectStickerType(bytes('GIF8'))).toBeNull();
    expect(detectStickerType(bytes(PNG_SIGNATURE.slice(0, 7)))).toBeNull();
    expect(detectStickerType(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
    expect(detectStickerType(bytes([0xff, 0xd8, 0x00]))).toBeNull();
    expect(detectStickerType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectStickerType(bytes([0x00, 0x00, 0x00, 0x18], 'ftypheic'))).toBeNull();
  });
});

describe('sniffSticker: GIF', () => {
  it('reads a static GIF', () => {
    const file = bytes(gifHeader(120, 80), gifControl(false), gifFrame(120, 80), [0x3b]);
    expect(sniffSticker(file)).toEqual({ type: 'gif', width: 120, height: 80, animated: false, frames: 1, end: file.length, mayBeTransparent: false });
  });

  it('counts a second frame deep in the file, past long data, comments and the loop extension', () => {
    const long = new Array<number>(40).fill(255);
    const file = bytes(gifHeader(64, 48), GIF_LOOP, gifControl(false), gifFrame(64, 48, long), GIF_COMMENT, gifControl(true), gifFrame(32, 32, [255, 255, 7]), [0x3b]);
    expect(file.length).toBeGreaterThan(10_000);
    expect(sniffSticker(file)).toEqual({ type: 'gif', width: 64, height: 48, animated: true, frames: 2, end: file.length, mayBeTransparent: true });
  });

  it('reads a GIF without a global colour table', () => {
    const file = bytes(gifHeader(10, 10, null), gifFrame(10, 10), [0x3b]);
    expect(sniffSticker(file)).toMatchObject({ width: 10, height: 10, frames: 1 });
  });

  it('marks transparency only from a graphic control extension with the flag', () => {
    expect(sniffSticker(bytes(gifHeader(8, 8), gifControl(true), gifFrame(8, 8), [0x3b]))?.mayBeTransparent).toBe(true);
    expect(sniffSticker(bytes(gifHeader(8, 8), gifControl(false), gifFrame(8, 8), [0x3b]))?.mayBeTransparent).toBe(false);
  });

  it('ends at the trailer, whatever follows it', () => {
    const real = bytes(gifHeader(8, 8), gifFrame(8, 8), [0x3b]);
    const padded = concat(real, bytes('PK', [3, 4, 0x3b, 0, 0xff]));
    expect(sniffSticker(padded)).toMatchObject({ end: real.length, frames: 1 });
  });

  it('is null without a trailer, without a frame, with a zero size or when cut short', () => {
    const file = bytes(gifHeader(8, 8), gifFrame(8, 8), [0x3b]);
    expect(sniffSticker(file.subarray(0, file.length - 1))).toBeNull();
    expect(sniffSticker(file.subarray(0, file.length - 4))).toBeNull();
    expect(sniffSticker(file.subarray(0, 20))).toBeNull();
    expect(sniffSticker(file.subarray(0, 12))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(8, 8), [0x3b]))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(0, 8), gifFrame(8, 8), [0x3b]))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(8, 0), gifFrame(8, 8), [0x3b]))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(8, 8), [0x99], gifFrame(8, 8), [0x3b]))).toBeNull();
  });

  it('grows the size to cover frames larger than the screen, so the upload limits see what browsers decode', () => {
    // A 16 x 16 screen with two 8000 x 8000 frames: past the side limit.
    // 16 x 16 的屏幕，两帧都是 8000 x 8000：超过边长上限。
    const oversized = sniffSticker(bytes(gifHeader(16, 16), gifFrame(8000, 8000), gifFrame(8000, 8000), [0x3b]));
    expect(oversized).toMatchObject({ width: 8000, height: 8000, animated: true, frames: 2 });
    expect(oversized?.width).toBeGreaterThan(STICKER_DIMENSION_MAX);
    // Within the side limit but past the animated area.
    // 在边长上限之内，但超过动图的面积上限。
    const wide = sniffSticker(bytes(gifHeader(16, 16), gifFrame(16, 16), gifFrame(1100, 1000), [0x3b]));
    expect(wide).toMatchObject({ width: 1100, height: 1000, animated: true });
    expect((wide?.width ?? 0) * (wide?.height ?? 0)).toBeGreaterThan(STICKER_ANIMATED_PIXELS_MAX);
    // A still of a few dozen bytes: a 1 x 1 screen with one 60000 x 60000 frame, past the still's side limit.
    // 只有几十字节的静态图：1 x 1 的屏幕加一帧 60000 x 60000，超过静态图的边长上限。
    const still = bytes(gifHeader(1, 1, null), gifFrame(60000, 60000), [0x3b]);
    expect(still.length).toBeLessThan(40);
    expect(sniffSticker(still)).toMatchObject({ width: 60000, height: 60000, animated: false, frames: 1 });
    expect(sniffSticker(bytes(gifHeader(8, 8), gifFrame(300, 8), [0x3b]))?.width).toBeGreaterThan(STICKER_THUMB_DIMENSION_MAX);
  });

  it('grows the size to cover frames offset past the screen, and keeps it for frames inside', () => {
    expect(sniffSticker(bytes(gifHeader(16, 16), gifFrameAt(100, 50, 16, 16), [0x3b]))).toMatchObject({ width: 116, height: 66 });
    // Each side grows on its own, from any frame.
    // 每一边各自扩大，任何一帧都可以。
    const file = bytes(gifHeader(64, 48), gifFrame(64, 48), gifFrameAt(0, 40, 30, 20), gifFrameAt(10, 0, 90, 8), [0x3b]);
    expect(sniffSticker(file)).toMatchObject({ width: 100, height: 60, frames: 3 });
    // The farthest a descriptor can reach.
    // 图像描述符所能到达的最远位置。
    expect(sniffSticker(bytes(gifHeader(16, 16), gifFrameAt(0xffff, 0xffff, 0xffff, 0xffff), [0x3b]))).toMatchObject({ width: 0x1fffe, height: 0x1fffe });
    expect(sniffSticker(bytes(gifHeader(64, 48), gifFrameAt(10, 10, 20, 20), gifFrameAt(32, 16, 32, 32), [0x3b]))).toMatchObject({ width: 64, height: 48 });
  });

  it('is null for a frame of zero width or height, first or later', () => {
    expect(sniffSticker(bytes(gifHeader(8, 8), gifFrame(0, 8), [0x3b]))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(8, 8), gifFrame(8, 0), [0x3b]))).toBeNull();
    expect(sniffSticker(bytes(gifHeader(8, 8), gifFrame(8, 8), gifFrameAt(4, 4, 0, 0), [0x3b]))).toBeNull();
  });

  it('is null, without throwing, for an image descriptor cut anywhere', () => {
    const head = bytes(gifHeader(8, 8));
    const file = bytes(head, gifFrameAt(0x1234, 0x5678, 0xffff, 0xffff), [0x3b]);
    for (let cut = head.length; cut < file.length; cut += 1) expect(sniffSticker(file.subarray(0, cut)), `cut at ${cut}`).toBeNull();
    expect(sniffSticker(file)).toMatchObject({ width: 0x1234 + 0xffff, height: 0x5678 + 0xffff });
  });
});

describe('sniffSticker: PNG and APNG', () => {
  it('reads a static PNG', () => {
    const file = png(ihdr(300, 200), IDAT, IEND);
    expect(sniffSticker(file)).toEqual({ type: 'png', width: 300, height: 200, animated: false, frames: 1, end: file.length, mayBeTransparent: false });
  });

  it('treats an acTL of one frame as a still', () => {
    const file = png(ihdr(30, 20), actl(1), fctl(0), IDAT, IEND);
    expect(sniffSticker(file)).toMatchObject({ animated: false, frames: 1, end: file.length });
  });

  it('reads an APNG of two frames from its fcTL chunks', () => {
    const file = png(ihdr(30, 20, 6), actl(2), fctl(0), IDAT, fctl(1), fdat(2), IEND);
    expect(sniffSticker(file)).toEqual({ type: 'png', width: 30, height: 20, animated: true, frames: 2, end: file.length, mayBeTransparent: true });
  });

  it('is null when the fcTL count differs from acTL', () => {
    expect(sniffSticker(png(ihdr(30, 20), actl(3), fctl(0), IDAT, fctl(1), fdat(2), IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(30, 20), actl(2), fctl(0), IDAT, IEND))).toBeNull();
  });

  it('ignores an acTL after the image data, as browsers do', () => {
    expect(sniffSticker(png(ihdr(30, 20), IDAT, actl(2), fctl(0), IEND))).toMatchObject({ animated: false, frames: 1 });
  });

  it('marks transparency from the colour type or a tRNS chunk', () => {
    expect(sniffSticker(png(ihdr(4, 4, 2), IDAT, IEND))?.mayBeTransparent).toBe(false);
    expect(sniffSticker(png(ihdr(4, 4, 0), IDAT, IEND))?.mayBeTransparent).toBe(false);
    expect(sniffSticker(png(ihdr(4, 4, 3), IDAT, IEND))?.mayBeTransparent).toBe(false);
    expect(sniffSticker(png(ihdr(4, 4, 4), IDAT, IEND))?.mayBeTransparent).toBe(true);
    expect(sniffSticker(png(ihdr(4, 4, 6), IDAT, IEND))?.mayBeTransparent).toBe(true);
    expect(sniffSticker(png(ihdr(4, 4, 3), pngChunk('PLTE', [0, 0, 0]), pngChunk('tRNS', [0]), IDAT, IEND))?.mayBeTransparent).toBe(true);
  });

  it('ends at the end of IEND, whatever follows it', () => {
    const real = png(ihdr(4, 4), IDAT, IEND);
    expect(sniffSticker(concat(real, bytes('<html><script>x</script>')))).toMatchObject({ end: real.length });
  });

  it('is null without IEND, without IHDR first, without image data, with a zero size or when cut short', () => {
    const file = png(ihdr(4, 4), IDAT, IEND);
    expect(sniffSticker(png(ihdr(4, 4), IDAT))).toBeNull();
    expect(sniffSticker(file.subarray(0, file.length - 1))).toBeNull();
    expect(sniffSticker(file.subarray(0, 40))).toBeNull();
    expect(sniffSticker(png(IDAT, ihdr(4, 4), IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(4, 4), IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(0, 4), IDAT, IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(4, 0), IDAT, IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(4, 4), ihdr(8, 8), IDAT, IEND))).toBeNull();
    // A chunk claiming more data than the file holds.
    // 声明的数据比文件实际拥有的更多的数据块。
    expect(sniffSticker(png(ihdr(4, 4), [...be32(1000), ...bytes('IDAT'), 1, 2, 3]))).toBeNull();
  });

  it('gives up past the step cap', () => {
    const filler = new Array(STICKER_SNIFF_STEPS_MAX + 10).fill(pngChunk('teXt')).flat();
    expect(sniffSticker(png(ihdr(4, 4), filler, IDAT, IEND))).toBeNull();
    expect(sniffSticker(png(ihdr(4, 4), new Array(100).fill(pngChunk('teXt')).flat(), IDAT, IEND))).not.toBeNull();
  });
});

describe('sniffSticker: WebP', () => {
  it('reads a lossy WebP', () => {
    const file = riff(vp8(400, 300));
    expect(sniffSticker(file)).toEqual({ type: 'webp', width: 400, height: 300, animated: false, frames: 1, end: file.length, mayBeTransparent: false });
  });

  it('reads a lossless WebP and its alpha bit', () => {
    expect(sniffSticker(riff(vp8l(100, 50, true)))).toMatchObject({ width: 100, height: 50, frames: 1, mayBeTransparent: true });
    expect(sniffSticker(riff(vp8l(100, 50, false)))).toMatchObject({ width: 100, height: 50, mayBeTransparent: false });
  });

  it('reads an extended still from its canvas, with alpha from the flag or an ALPH chunk', () => {
    expect(sniffSticker(riff(vp8x(640, 480, 0), vp8(640, 480)))).toMatchObject({ width: 640, height: 480, animated: false, frames: 1, mayBeTransparent: false });
    expect(sniffSticker(riff(vp8x(640, 480, 0x10), ALPH, vp8(640, 480)))?.mayBeTransparent).toBe(true);
    expect(sniffSticker(riff(vp8x(640, 480, 0), ALPH, vp8(640, 480)))?.mayBeTransparent).toBe(true);
    expect(sniffSticker(riff(vp8x(640, 480, 0), vp8l(640, 480, false)))).toMatchObject({ frames: 1 });
  });

  it('counts the ANMF chunks of an animated WebP', () => {
    const file = riff(vp8x(320, 240, 0x02 | 0x10), ANIM, anmf(), anmf(), anmf());
    expect(sniffSticker(file)).toEqual({ type: 'webp', width: 320, height: 240, animated: true, frames: 3, end: file.length, mayBeTransparent: true });
    expect(sniffSticker(riff(vp8x(320, 240, 0x02), ANIM, anmf()))).toMatchObject({ animated: false, frames: 1 });
  });

  it('is null for an animation without frames or a still without image data', () => {
    expect(sniffSticker(riff(vp8x(320, 240, 0x02), ANIM))).toBeNull();
    expect(sniffSticker(riff(vp8x(320, 240, 0)))).toBeNull();
  });

  it('ends at the RIFF size, padded to even, whatever follows it', () => {
    const real = riff(vp8(8, 8));
    expect(sniffSticker(concat(real, bytes('trailing')))).toMatchObject({ end: real.length });
    // An odd RIFF size: the last chunk's padding byte is part of the file.
    // RIFF 大小为奇数：最后一个数据块的填充字节属于文件。
    const odd = riff(webpChunk('VP8L', [0x2f, ...le32((7 | (7 << 14)) >>> 0)]));
    odd.set(le32(odd.length - 8 - 1), 4);
    expect(sniffSticker(concat(odd, bytes('xx')))).toMatchObject({ width: 8, height: 8, end: odd.length });
  });

  it('is null when the chunks miss the RIFF end, the RIFF size runs past the bytes, or the first chunk is unknown', () => {
    const file = riff(vp8(8, 8));
    const short = file.slice();
    short.set(le32(file.length - 8 + 6), 4);
    expect(sniffSticker(concat(short, new Uint8Array(6)))).toBeNull();
    expect(sniffSticker(file.subarray(0, file.length - 2))).toBeNull();
    expect(sniffSticker(riff(webpChunk('JUNK', [1, 2]), vp8(8, 8)))).toBeNull();
    expect(sniffSticker(riff(vp8(0, 8)))).toBeNull();
    expect(sniffSticker(riff(webpChunk('VP8 ', [0x11, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(8), ...le16(8)])))).toBeNull();
    expect(sniffSticker(riff(webpChunk('VP8L', [0x2f, ...le32((7 | (1 << 29)) >>> 0)])))).toBeNull();
    expect(sniffSticker(riff())).toBeNull();
  });
});

describe('sniffSticker: JPEG', () => {
  it('reads a JPEG as an opaque still that ends at its length', () => {
    const file = jpeg(1024, 768);
    expect(sniffSticker(file)).toEqual({ type: 'jpeg', width: 1024, height: 768, animated: false, frames: 1, end: file.length, mayBeTransparent: false });
    expect(sniffSticker(jpeg(10, 20, 0xc2))).toMatchObject({ width: 10, height: 20 });
  });

  it('is null with anything after EOI, since entropy-coded data is not walked', () => {
    expect(sniffSticker(concat(jpeg(8, 8), bytes([0, 1, 2])))).toBeNull();
    expect(sniffSticker(concat(jpeg(8, 8), jpeg(4, 4).subarray(0, 10)))).toBeNull();
  });

  it('is null without EOI, with a zero size, an unsupported frame type or a scan before the frame', () => {
    const file = jpeg(8, 8);
    expect(sniffSticker(file.subarray(0, file.length - 1))).toBeNull();
    expect(sniffSticker(file.subarray(0, 20))).toBeNull();
    expect(sniffSticker(jpeg(0, 8))).toBeNull();
    expect(sniffSticker(jpeg(8, 0))).toBeNull();
    expect(sniffSticker(jpeg(8, 8, 0xc3))).toBeNull();
    expect(sniffSticker(jpeg(8, 8, 0xc9))).toBeNull();
    expect(sniffSticker(bytes([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]))).toBeNull();
  });

  it('gives up on endless fill bytes past the step cap', () => {
    const file = concat(bytes([0xff, 0xd8]), new Uint8Array(STICKER_SNIFF_STEPS_MAX + 10).fill(0xff), jpeg(8, 8).subarray(2));
    expect(sniffSticker(file)).toBeNull();
  });
});

describe('sniffSticker: anything else', () => {
  it('is null for empty, garbage and truncated input', () => {
    expect(sniffSticker(new Uint8Array(0))).toBeNull();
    expect(sniffSticker(bytes('hello world, not an image'))).toBeNull();
    let seed = 7;
    const garbage = new Uint8Array(4096).map(() => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed >>> 24;
    });
    expect(sniffSticker(garbage)).toBeNull();
    for (const file of [bytes(gifHeader(8, 8), gifFrame(8, 8), [0x3b]), png(ihdr(4, 4), IDAT, IEND), riff(vp8(8, 8)), jpeg(8, 8)]) {
      for (let cut = 0; cut < file.length; cut += 1) expect(sniffSticker(file.subarray(0, cut)), `cut at ${cut}`).toBeNull();
    }
  });

  it('works on a view into a larger buffer', () => {
    const file = png(ihdr(4, 4), IDAT, IEND);
    const buffer = concat(bytes('xxxx'), file, bytes('yyyy'));
    expect(sniffSticker(buffer.subarray(4, 4 + file.length))).toMatchObject({ type: 'png', end: file.length });
  });
});

/** An 8 MB GIF whose image data is cut into sub-blocks of one size. */
/** 一个 8MB 的 GIF，其图像数据切分为同样大小的子块。 */
function bigGif(subBlock: number, frames: number): Uint8Array {
  const file = new Uint8Array(STICKER_MAX_BYTES);
  const head = bytes(gifHeader(256, 256));
  file.set(head, 0);
  let at = head.length;
  const perFrame = Math.floor((file.length - at - 1) / frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const stop = at + perFrame;
    file.set([0x2c, 0, 0, 0, 0, ...le16(256), ...le16(256), 0x00, 8], at);
    at += 11;
    while (at + 1 + subBlock < stop - 1) {
      file[at] = subBlock;
      at += 1 + subBlock;
    }
    file[at] = 0;
    at += 1;
  }
  file[at] = 0x3b;
  return file.subarray(0, at + 1);
}

/** The fastest of three runs, in milliseconds, so one garbage collection does not decide the result. */
/** 三次运行中最快的一次（毫秒），避免一次垃圾回收左右结果。 */
function fastest(run: () => void): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    run();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe('sniffSticker: worst cases', () => {
  it('refuses an 8 MB GIF of 1-byte sub-blocks at the step cap, quickly', () => {
    const file = bigGif(1, 1);
    expect(file.length).toBeGreaterThan(STICKER_MAX_BYTES - 16);
    let result: unknown = 'unset';
    const ms = fastest(() => {
      result = sniffSticker(file);
    });
    expect(result).toBeNull();
    expect(ms).toBeLessThan(5);
  });

  it('reads an 8 MB GIF of 255-byte sub-blocks to its last frame, quickly', () => {
    const file = bigGif(255, 2);
    expect(file.length).toBeGreaterThan(STICKER_MAX_BYTES - 1024);
    let result: ReturnType<typeof sniffSticker> = null;
    const ms = fastest(() => {
      result = sniffSticker(file);
    });
    expect(result).toEqual({ type: 'gif', width: 256, height: 256, animated: true, frames: 2, end: file.length, mayBeTransparent: false });
    expect(ms).toBeLessThan(5);
  });
});
