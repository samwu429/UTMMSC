import { describe, expect, it } from 'vitest';
import { sniffImage, sniffJpeg, sniffWebp } from './image-sniff';

const bytesOf = (text: string) => [...text].map((ch) => ch.charCodeAt(0));
const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const u24le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];

/**
 * A small JPEG laid out the way encoders write one: SOI, APP0, DQT, the frame header, SOS, a little scan data with a
 * stuffed byte, then EOI.
 * 按编码器的写法排列的小 JPEG：SOI、APP0、DQT、帧头、SOS、一点含填充字节的扫描数据，然后是 EOI。
 */
function jpeg(width: number, height: number, options: { frame?: number; eoi?: boolean; fill?: number } = {}): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...bytesOf('JFIF'), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const dqt = [0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array<number>(64).fill(1)];
  const fill = new Array<number>(options.fill ?? 0).fill(0xff);
  const sof = [
    ...fill,
    0xff,
    options.frame ?? 0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0x00, 0x56];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...dqt, ...sof, ...sos, ...(options.eoi === false ? [] : [0xff, 0xd9])]);
}

function chunk(fourcc: string, data: number[]): number[] {
  return [...bytesOf(fourcc), ...u32le(data.length), ...data, ...(data.length % 2 === 1 ? [0] : [])];
}

function riff(chunks: number[]): Uint8Array {
  return Uint8Array.from([...bytesOf('RIFF'), ...u32le(4 + chunks.length), ...bytesOf('WEBP'), ...chunks]);
}

/** A lossy key frame: frame tag, start code, 14-bit sizes, then some partition data. */
/** 有损关键帧：帧标签、起始码、14 位尺寸，然后是一些分区数据。 */
function vp8Data(width: number, height: number, options: { keyFrame?: boolean; startCode?: number[] } = {}): number[] {
  return [options.keyFrame === false ? 0x11 : 0x10, 0x2b, 0x00, ...(options.startCode ?? [0x9d, 0x01, 0x2a]), width & 0xff, width >> 8, height & 0xff, height >> 8, 0x3e, 0x65, 0x2a, 0x94];
}

function vp8(width: number, height: number, options?: { keyFrame?: boolean; startCode?: number[] }): Uint8Array {
  return riff(chunk('VP8 ', vp8Data(width, height, options)));
}

function vp8l(width: number, height: number, options: { signature?: number; version?: number } = {}): Uint8Array {
  const bits = ((width - 1) | ((height - 1) << 14) | (1 << 28) | ((options.version ?? 0) << 29)) >>> 0;
  return riff(chunk('VP8L', [options.signature ?? 0x2f, ...u32le(bits), 0x07, 0x00]));
}

function vp8x(width: number, height: number, flags = 0x10): Uint8Array {
  return riff([...chunk('VP8X', [flags, 0, 0, 0, ...u24le(width - 1), ...u24le(height - 1)]), ...chunk('VP8 ', vp8Data(width, height))]);
}

describe('sniffJpeg', () => {
  it('reads the size from baseline, extended and progressive frame headers', () => {
    for (const frame of [0xc0, 0xc1, 0xc2]) {
      expect(sniffJpeg(jpeg(256, 256, { frame }))).toEqual({ type: 'image/jpeg', width: 256, height: 256 });
      expect(sniffJpeg(jpeg(96, 96, { frame }))).toEqual({ type: 'image/jpeg', width: 96, height: 96 });
    }
  });

  it('reads width and height in the right order', () => {
    expect(sniffJpeg(jpeg(300, 200))).toEqual({ type: 'image/jpeg', width: 300, height: 200 });
    expect(sniffJpeg(jpeg(1, 4000))).toEqual({ type: 'image/jpeg', width: 1, height: 4000 });
  });

  it('skips fill bytes before a marker', () => {
    expect(sniffJpeg(jpeg(256, 256, { fill: 3 }))).toEqual({ type: 'image/jpeg', width: 256, height: 256 });
  });

  it('refuses lossless, hierarchical and arithmetic-coded frames', () => {
    for (const frame of [0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) expect(sniffJpeg(jpeg(256, 256, { frame }))).toBeNull();
  });

  it('refuses a file that does not end with EOI', () => {
    expect(sniffJpeg(jpeg(256, 256, { eoi: false }))).toBeNull();
  });

  it('refuses every truncation of a valid file', () => {
    const full = jpeg(256, 256);
    for (let length = 0; length < full.length; length += 1) expect(sniffJpeg(full.slice(0, length))).toBeNull();
    expect(sniffJpeg(full)).not.toBeNull();
  });

  it('refuses a scan before any frame header', () => {
    const scanFirst = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]);
    expect(sniffJpeg(scanFirst)).toBeNull();
  });

  it('refuses a zero size, a short frame header and a segment that runs past the end', () => {
    expect(sniffJpeg(jpeg(0, 256))).toBeNull();
    expect(sniffJpeg(jpeg(256, 0))).toBeNull();
    const short = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x05, 0x08, 0x01, 0x00, 0xff, 0xd9]);
    expect(sniffJpeg(short)).toBeNull();
    const overlong = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x7f, 0xff, 0x00, 0xff, 0xd9]);
    expect(sniffJpeg(overlong)).toBeNull();
  });

  it('refuses bytes between segments that are not a marker', () => {
    const stray = Uint8Array.from([0xff, 0xd8, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x00, 0x01, 0x00, 0xff, 0xd9]);
    expect(sniffJpeg(stray)).toBeNull();
  });
});

describe('sniffWebp', () => {
  it('reads lossy (VP8) sizes', () => {
    expect(sniffWebp(vp8(256, 256))).toEqual({ type: 'image/webp', width: 256, height: 256 });
    expect(sniffWebp(vp8(96, 96))).toEqual({ type: 'image/webp', width: 96, height: 96 });
    expect(sniffWebp(vp8(300, 200))).toEqual({ type: 'image/webp', width: 300, height: 200 });
  });

  it('reads lossless (VP8L) sizes', () => {
    expect(sniffWebp(vp8l(256, 256))).toEqual({ type: 'image/webp', width: 256, height: 256 });
    expect(sniffWebp(vp8l(96, 96))).toEqual({ type: 'image/webp', width: 96, height: 96 });
    expect(sniffWebp(vp8l(16384, 1))).toEqual({ type: 'image/webp', width: 16384, height: 1 });
  });

  it('reads the canvas size of an extended (VP8X) still', () => {
    expect(sniffWebp(vp8x(256, 256))).toEqual({ type: 'image/webp', width: 256, height: 256 });
    expect(sniffWebp(vp8x(1000, 70000))).toEqual({ type: 'image/webp', width: 1000, height: 70000 });
  });

  it('refuses an animated image', () => {
    expect(sniffWebp(vp8x(256, 256, 0x12))).toBeNull();
    expect(sniffWebp(vp8x(256, 256, 0x02))).toBeNull();
  });

  it('refuses a lossy frame that is not a key frame or lacks the start code', () => {
    expect(sniffWebp(vp8(256, 256, { keyFrame: false }))).toBeNull();
    expect(sniffWebp(vp8(256, 256, { startCode: [0x9d, 0x01, 0x2b] }))).toBeNull();
  });

  it('refuses a lossless header with the wrong signature or version', () => {
    expect(sniffWebp(vp8l(256, 256, { signature: 0x2e }))).toBeNull();
    expect(sniffWebp(vp8l(256, 256, { version: 1 }))).toBeNull();
  });

  it('refuses every truncation of a valid file', () => {
    for (const full of [vp8(256, 256), vp8l(96, 96), vp8x(256, 256)]) {
      for (let length = 0; length < full.length; length += 1) expect(sniffWebp(full.slice(0, length))).toBeNull();
      expect(sniffWebp(full)).not.toBeNull();
    }
  });

  it('refuses a first chunk that runs past the RIFF size', () => {
    const file = vp8(256, 256);
    const lying = file.slice();
    lying.set(u32le(4 + 8 + 4), 4);
    expect(sniffWebp(lying)).toBeNull();
  });

  it('refuses a first chunk that is not an image', () => {
    expect(sniffWebp(riff(chunk('ALPH', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])))).toBeNull();
    const notWebp = vp8(256, 256);
    notWebp.set(bytesOf('WAVE'), 8);
    expect(sniffWebp(notWebp)).toBeNull();
  });
});

describe('sniffImage', () => {
  it('tells JPEG and WebP apart by their bytes', () => {
    expect(sniffImage(jpeg(256, 256))?.type).toBe('image/jpeg');
    expect(sniffImage(vp8(256, 256))?.type).toBe('image/webp');
  });

  it('refuses PNG, GIF, text and empty input', () => {
    const png = Uint8Array.from([0x89, ...bytesOf('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...bytesOf('IHDR'), 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(sniffImage(png)).toBeNull();
    expect(sniffImage(Uint8Array.from([...bytesOf('GIF89a'), 1, 0, 1, 0]))).toBeNull();
    expect(sniffImage(Uint8Array.from(bytesOf('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
