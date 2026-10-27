import { afterEach, describe, expect, it, vi } from 'vitest';
import { STICKER_MAX_BYTES, STICKER_SNIFF_STEPS_MAX, STICKER_THUMB_MAX_BYTES, sniffSticker } from '@utmmsc/shared';
import {
  STICKER_PICK_ACCEPT,
  StickerPrepError,
  planStickerPrep,
  prepareSticker,
  sha256Hex,
  stickerProblemText,
  type StickerCopySpec,
  type StickerPrepDeps,
} from './prep';

/*
 * Minimal files built by hand, as the shared sniffer's tests build them: image data is filler, since nothing here
 * decodes.
 * 与共用嗅探器的测试一样，手工构造的最小文件：图像数据只是占位，因为这里没有任何解码。
 */

type Part = number[] | string | Uint8Array;

function bytes(...parts: Part[]): Uint8Array<ArrayBuffer> {
  const list = parts.map((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : [...part]));
  return Uint8Array.from(list.flat());
}

const le16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const le24 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

function gifHeader(width: number, height: number): number[] {
  return [...bytes('GIF89a'), ...le16(width), ...le16(height), 0x81, 0, 0, ...new Array<number>(12).fill(0)];
}

function gifControl(transparent: boolean): number[] {
  return [0x21, 0xf9, 4, transparent ? 0x01 : 0x00, 10, 0, 0, 0];
}

function gifFrame(width: number, height: number): number[] {
  return [0x2c, 0, 0, 0, 0, ...le16(width), ...le16(height), 0x80, ...new Array<number>(6).fill(0), 2, 3, 0x55, 0x55, 0x55, 0];
}

function gif(width: number, height: number, frames = 1, transparent = false): Uint8Array<ArrayBuffer> {
  const body: number[] = [];
  for (let i = 0; i < frames; i += 1) body.push(...gifControl(transparent), ...gifFrame(width, height));
  return bytes(gifHeader(width, height), body, [0x3b]);
}

/** An animated GIF of about `size` bytes: two frames of 255-byte sub-blocks, written straight into the buffer. */
/** 约 `size` 字节的动态 GIF：两帧由 255 字节子块组成的数据，直接写入缓冲区。 */
function bigGif(size: number): Uint8Array<ArrayBuffer> {
  const head = bytes(gifHeader(64, 64));
  const per = Math.ceil((size - head.length) / 2 / 256);
  const frameHead = [...gifControl(false), 0x2c, 0, 0, 0, 0, ...le16(64), ...le16(64), 0x80, ...new Array<number>(6).fill(0), 2];
  const out = new Uint8Array(head.length + 2 * (frameHead.length + per * 256 + 1) + 1);
  out.set(head, 0);
  let at = head.length;
  for (let f = 0; f < 2; f += 1) {
    out.set(frameHead, at);
    at += frameHead.length;
    for (let i = 0; i < per; i += 1) {
      out[at] = 255;
      at += 256;
    }
    out[at] = 0;
    at += 1;
  }
  out[at] = 0x3b;
  return out;
}

function pngChunk(type: string, data: number[] = []): number[] {
  return [...be32(data.length), ...bytes(type), ...data, 0, 0, 0, 0];
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ihdr = (width: number, height: number, colourType = 2) => pngChunk('IHDR', [...be32(width), ...be32(height), 8, colourType, 0, 0, 0]);
const IDAT = pngChunk('IDAT', [0x78, 0x9c, 1, 2, 3]);
const IEND = pngChunk('IEND');
const actl = (frames: number) => pngChunk('acTL', [...be32(frames), ...be32(0)]);
const fctl = (sequence: number) => pngChunk('fcTL', [...be32(sequence), ...new Array<number>(22).fill(0)]);
const fdat = (sequence: number) => pngChunk('fdAT', [...be32(sequence), 1, 2, 3]);

function png(width: number, height: number, transparent = false): Uint8Array<ArrayBuffer> {
  return bytes(PNG_SIGNATURE, ihdr(width, height, transparent ? 6 : 2), IDAT, IEND);
}

function apng(width: number, height: number): Uint8Array<ArrayBuffer> {
  return bytes(PNG_SIGNATURE, ihdr(width, height, 6), actl(2), fctl(0), IDAT, fctl(1), fdat(2), IEND);
}

function webpChunk(type: string, data: number[]): number[] {
  return [...bytes(type), ...le32(data.length), ...data, ...(data.length % 2 === 1 ? [0] : [])];
}

function riff(...chunks: number[][]): Uint8Array<ArrayBuffer> {
  const body = chunks.flat();
  return bytes('RIFF', le32(4 + body.length), 'WEBP', body);
}

function vp8(width: number, height: number): number[] {
  return webpChunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(width), ...le16(height), 1, 2, 3]);
}

function webpStill(width: number, height: number, alpha: boolean): Uint8Array<ArrayBuffer> {
  const bits = ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0;
  return riff(webpChunk('VP8L', [0x2f, ...le32(bits), 7, 7]));
}

function webpAnimated(width: number, height: number): Uint8Array<ArrayBuffer> {
  const anmf = () => webpChunk('ANMF', [...new Array<number>(16).fill(0), ...vp8(4, 4)]);
  return riff(webpChunk('VP8X', [0x12, 0, 0, 0, ...le24(width - 1), ...le24(height - 1)]), webpChunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(), anmf());
}

function jpeg(width: number, height: number): Uint8Array<ArrayBuffer> {
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe0, ...be16(16), ...bytes('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0],
    [0xff, 0xc0, ...be16(17), 8, ...be16(height), ...be16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
    [0xff, 0xda, ...be16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0],
    [0x12, 0x34, 0x56],
    [0xff, 0xd9],
  );
}

const TRAILER = bytes('PK', [3, 4, 0, 0, 0, 0]);

function withTrailer(file: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return bytes(file, TRAILER);
}

const blob = (data: Uint8Array<ArrayBuffer>, type = '') => new Blob([data], { type });

async function blobBytes(value: Blob): Promise<number[]> {
  return [...new Uint8Array(await value.arrayBuffer())];
}

/** A canvas stand-in: a well-formed file of the asked type at the asked long edge (square). */
/** 画布替身：按请求的类型和长边（正方形）生成格式完好的文件。 */
function fakeRender(sizeFor: (spec: StickerCopySpec) => number = (spec) => spec.longEdge) {
  const calls: { source: Blob; specs: StickerCopySpec[] }[] = [];
  const render: StickerPrepDeps['render'] = async (source, specs) => {
    calls.push({ source, specs: [...specs] });
    return specs.map((spec) => {
      const side = sizeFor(spec);
      if (spec.mime === 'image/jpeg') return blob(jpeg(side, side), 'image/jpeg');
      if (spec.mime === 'image/webp') return blob(webpStill(side, side, true), 'image/webp');
      return blob(png(side, side, true), 'image/png');
    });
  };
  return { render, calls };
}

describe('STICKER_PICK_ACCEPT', () => {
  it('lists the four types, so iOS converts HEIC on pick', () => {
    expect(STICKER_PICK_ACCEPT).toBe('image/jpeg,image/png,image/webp,image/gif');
  });
});

describe('planStickerPrep', () => {
  const plan = (data: Uint8Array, webp = true) => planStickerPrep({ bytes: data, webp });

  it('keeps GIFs and animated files byte for byte', () => {
    const animated = gif(200, 200, 3, true);
    expect(plan(animated)).toEqual({ action: 'keep', type: 'gif', end: animated.length, still: { mime: 'image/webp', quality: 0.8 } });
    const still = gif(100, 80);
    expect(plan(still)).toMatchObject({ action: 'keep', type: 'gif', end: still.length });
    expect(plan(apng(300, 300))).toMatchObject({ action: 'keep', type: 'png' });
    expect(plan(webpAnimated(400, 300))).toMatchObject({ action: 'keep', type: 'webp' });
    // A wide banner is within the area, even though one side is above 1024.
    // 宽横幅的面积在上限之内，即使有一边超过 1024。
    expect(plan(gif(1500, 600, 2))).toMatchObject({ action: 'keep' });
  });

  it('cuts trailing bytes at the real end', () => {
    const file = gif(64, 64, 2);
    expect(plan(withTrailer(file))).toMatchObject({ action: 'keep', end: file.length });
    const still = png(300, 300, true);
    expect(plan(withTrailer(still))).toMatchObject({ action: 'keep', end: still.length });
    const webp = webpStill(100, 100, false);
    expect(plan(withTrailer(webp))).toMatchObject({ action: 'keep', end: webp.length });
  });

  it('keeps a static PNG or WebP up to 720 px and re-encodes a larger one', () => {
    expect(plan(png(720, 400))).toMatchObject({ action: 'keep', type: 'png' });
    expect(plan(webpStill(500, 720, true))).toMatchObject({ action: 'keep', type: 'webp' });
    expect(plan(png(721, 400))).toMatchObject({ action: 'render', encoding: { mime: 'image/jpeg', quality: 0.88 } });
    // A static GIF above the static limits is re-encoded too.
    // 超过静态上限的静态 GIF 同样重新编码。
    expect(plan(gif(900, 900))).toMatchObject({ action: 'render', type: 'gif' });
  });

  it('re-encodes every JPEG, with no fallback to its bytes, also one with data after its end', () => {
    expect(plan(jpeg(100, 100))).toEqual({
      action: 'render',
      type: 'jpeg',
      encoding: { mime: 'image/jpeg', quality: 0.88 },
      fallbackEnd: null,
      still: { mime: 'image/jpeg', quality: 0.85 },
    });
    expect(plan(withTrailer(jpeg(4000, 3000)))).toMatchObject({ action: 'render', type: 'jpeg', fallbackEnd: null });
  });

  it('falls back to the bytes of a large static file only within the upload limits', () => {
    const fits = png(1500, 1000);
    expect(plan(fits)).toMatchObject({ action: 'render', fallbackEnd: fits.length });
    expect(plan(png(3000, 2000))).toMatchObject({ action: 'render', fallbackEnd: null });
  });

  it('refuses animated files over the area, side, frame or byte limits with the right problem', () => {
    expect(plan(gif(1100, 1000, 2))).toEqual({ action: 'refuse', problem: 'dimensions' });
    expect(plan(gif(2100, 400, 2))).toEqual({ action: 'refuse', problem: 'dimensions' });
    expect(plan(webpAnimated(1200, 1200))).toEqual({ action: 'refuse', problem: 'dimensions' });
    expect(plan(gif(100, 100, 301))).toEqual({ action: 'refuse', problem: 'frames' });
    expect(plan(gif(100, 100, 300))).toMatchObject({ action: 'keep' });
    const big = bigGif(STICKER_MAX_BYTES + 4096);
    expect(big.length).toBeGreaterThan(STICKER_MAX_BYTES);
    expect(plan(big)).toEqual({ action: 'refuse', problem: 'size' });
  });

  it('judges a GIF by its frames, not only its logical screen', () => {
    expect(plan(bytes(gifHeader(16, 16), gifFrame(1200, 1200), gifFrame(1200, 1200), [0x3b]))).toEqual({ action: 'refuse', problem: 'dimensions' });
    const still = bytes(gifHeader(16, 16), gifFrame(900, 900), [0x3b]);
    expect(plan(still)).toMatchObject({ action: 'render', type: 'gif', fallbackEnd: still.length });
    expect(plan(bytes(gifHeader(16, 16), gifFrame(3000, 3000), [0x3b]))).toMatchObject({ action: 'render', fallbackEnd: null });
  });

  it('refuses a GIF too long to sniff as too large, not as unreadable', () => {
    // The same layout sniffs at 12 MB; at 16 MB its sub-blocks pass the step cap.
    // 同样的结构在 12MB 时可以嗅探；到 16MB 时子块数超过步数上限。
    expect(sniffSticker(bigGif(12 * 1024 * 1024))).toMatchObject({ type: 'gif', frames: 2 });
    const huge = bigGif(16 * 1024 * 1024);
    expect(huge.length / 256).toBeGreaterThan(STICKER_SNIFF_STEPS_MAX);
    expect(sniffSticker(huge)).toBeNull();
    expect(plan(huge)).toEqual({ action: 'refuse', problem: 'size' });
    // Any unreadable file over 8 MB says the same; under it, unreadable stays unreadable.
    // 任何超过 8MB 且无法读取的文件都这样提示；不超过时仍提示无法识别。
    const big = bigGif(STICKER_MAX_BYTES + 4096);
    expect(plan(big.subarray(0, big.length - 1))).toEqual({ action: 'refuse', problem: 'size' });
    const small = gif(64, 64, 2);
    expect(plan(small.subarray(0, small.length - 1))).toEqual({ action: 'refuse', problem: 'invalid' });
  });

  it('refuses what is not an image by its bytes, and what cannot be read', () => {
    expect(plan(bytes('hello'))).toEqual({ action: 'refuse', problem: 'type' });
    expect(plan(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ action: 'refuse', problem: 'type' });
    expect(plan(new Uint8Array(0))).toEqual({ action: 'refuse', problem: 'type' });
    const cut = png(100, 100);
    expect(plan(cut.slice(0, cut.length - 6))).toEqual({ action: 'refuse', problem: 'invalid' });
    expect(plan(bytes('GIF89a', [1, 0, 1, 0]))).toEqual({ action: 'refuse', problem: 'invalid' });
  });

  it('picks the still format from transparency and WebP encoding support', () => {
    expect(plan(png(100, 100, false))).toMatchObject({ still: { mime: 'image/jpeg', quality: 0.85 } });
    expect(plan(png(100, 100, true), true)).toMatchObject({ still: { mime: 'image/webp', quality: 0.8 } });
    expect(plan(png(100, 100, true), false)).toMatchObject({ still: { mime: 'image/png' } });
    expect(plan(gif(100, 100, 2, true), false)).toMatchObject({ still: { mime: 'image/png' } });
    expect(plan(jpeg(100, 100), false)).toMatchObject({ still: { mime: 'image/jpeg' } });
  });

  it('re-encodes a transparent large file as WebP, or PNG where WebP cannot be written', () => {
    expect(plan(png(1000, 1000, true), true)).toMatchObject({ action: 'render', encoding: { mime: 'image/webp', quality: 0.9 } });
    expect(plan(png(1000, 1000, true), false)).toMatchObject({ action: 'render', encoding: { mime: 'image/png' } });
    expect(plan(png(1000, 1000, false), false)).toMatchObject({ action: 'render', encoding: { mime: 'image/jpeg' } });
  });
});

describe('sha256Hex', () => {
  it('hashes a known buffer', async () => {
    expect(await sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('prepareSticker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps an animated GIF without its trailing bytes, hashes what it uploads, and makes a still', async () => {
    const file = gif(200, 160, 2, true);
    const { render, calls } = fakeRender();
    const prepared = await prepareSticker(blob(withTrailer(file), 'image/gif'), { render, webpEncodes: () => true });
    expect(await blobBytes(prepared.file)).toEqual([...file]);
    expect(prepared.file.type).toBe('image/gif');
    expect(prepared.sha256).toBe(await sha256Hex(file));
    expect(prepared.thumbSha256).toBe(await sha256Hex(new Uint8Array(await prepared.thumb.arrayBuffer())));
    expect(prepared).toMatchObject({ type: 'gif', width: 200, height: 160, animated: true, bytes: file.length });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.specs).toEqual([{ longEdge: 240, mime: 'image/webp', quality: 0.8 }]);
    expect(prepared.thumb.type).toBe('image/webp');
  });

  it('decides by the bytes when the declared type lies, and works with no declared type', async () => {
    const file = gif(64, 64, 2);
    const lying = await prepareSticker(blob(file, 'image/png'), { render: fakeRender().render, webpEncodes: () => true });
    expect(lying).toMatchObject({ type: 'gif', animated: true });
    expect(lying.file.type).toBe('image/gif');
    const untyped = await prepareSticker(blob(png(100, 100, true)), { render: fakeRender().render, webpEncodes: () => true });
    expect(untyped).toMatchObject({ type: 'png', width: 100, height: 100, animated: false });
    await expect(prepareSticker(blob(bytes('not an image'), 'image/png'))).rejects.toMatchObject({ problem: 'type' });
  });

  it('re-encodes a JPEG at 720 px and its still as JPEG', async () => {
    const { render, calls } = fakeRender((spec) => Math.min(spec.longEdge, 720));
    const prepared = await prepareSticker(blob(jpeg(4032, 3024), 'image/jpeg'), { render, webpEncodes: () => true });
    expect(calls[0]?.specs).toEqual([
      { longEdge: 720, mime: 'image/jpeg', quality: 0.88 },
      { longEdge: 240, mime: 'image/jpeg', quality: 0.85 },
    ]);
    expect(prepared).toMatchObject({ type: 'jpeg', width: 720, height: 720, animated: false });
    expect(prepared.thumb.type).toBe('image/jpeg');
  });

  it('refuses a JPEG the canvas cannot read, and falls back to the bytes of a file the server would take', async () => {
    const broken: StickerPrepDeps['render'] = async () => {
      throw new Error('decode');
    };
    await expect(prepareSticker(blob(jpeg(100, 100)), { render: broken, webpEncodes: () => true })).rejects.toMatchObject({ problem: 'invalid' });

    const large = png(1500, 1000, true);
    const stillOnly: StickerPrepDeps['render'] = async (_source, specs) => specs.map((spec) => (spec.longEdge === 240 ? blob(webpStill(240, 160, true)) : null));
    const prepared = await prepareSticker(blob(withTrailer(large)), { render: stillOnly, webpEncodes: () => true });
    expect(await blobBytes(prepared.file)).toEqual([...large]);
    expect(prepared).toMatchObject({ type: 'png', width: 1500, height: 1000 });
  });

  it('makes the still again at 160 px when it is over 96 KB, and gives up after that', async () => {
    const heavy = new Uint8Array(STICKER_THUMB_MAX_BYTES + 1);
    heavy.set(webpStill(240, 240, true));
    const calls: StickerCopySpec[][] = [];
    const render: StickerPrepDeps['render'] = async (_source, specs) => {
      calls.push([...specs]);
      return specs.map((spec) => (spec.longEdge === 160 ? blob(webpStill(160, 160, true)) : blob(heavy)));
    };
    const prepared = await prepareSticker(blob(gif(300, 300, 2, true)), { render, webpEncodes: () => true });
    expect(calls.map((specs) => specs.map((spec) => spec.longEdge))).toEqual([[240], [160]]);
    expect(calls[1]?.[0]).toEqual({ longEdge: 160, mime: 'image/webp', quality: 0.6 });
    expect(prepared.thumb.size).toBeLessThanOrEqual(STICKER_THUMB_MAX_BYTES);

    const alwaysHeavy: StickerPrepDeps['render'] = async (_source, specs) => specs.map(() => blob(heavy));
    await expect(prepareSticker(blob(gif(300, 300, 2, true)), { render: alwaysHeavy, webpEncodes: () => true })).rejects.toMatchObject({ problem: 'invalid' });
  });

  it('refuses an animated file over the limits before any canvas work', async () => {
    const { render, calls } = fakeRender();
    await expect(prepareSticker(blob(gif(1200, 1200, 2)), { render, webpEncodes: () => true })).rejects.toMatchObject({ problem: 'dimensions' });
    await expect(prepareSticker(blob(gif(10, 10, 301)), { render, webpEncodes: () => true })).rejects.toMatchObject({ problem: 'frames' });
    await expect(prepareSticker(blob(bigGif(16 * 1024 * 1024)), { render, webpEncodes: () => true })).rejects.toMatchObject({ problem: 'size' });
    expect(calls).toHaveLength(0);
  });

  it('says unsupported where the browser cannot hash', async () => {
    vi.stubGlobal('crypto', {});
    const { render, calls } = fakeRender();
    const error = await prepareSticker(blob(gif(64, 64, 2)), { render, webpEncodes: () => true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StickerPrepError);
    expect((error as StickerPrepError).problem).toBe('unsupported');
    expect(calls).toHaveLength(0);
  });
});

describe('stickerProblemText', () => {
  const zh = (z: string) => z;
  const en = (_z: string, e: string) => e;

  it('names each problem in both languages', () => {
    const text = (problem: StickerPrepError['problem'], tr: (z: string, e: string) => string) => stickerProblemText(new StickerPrepError(problem), tr);
    expect(text('type', zh)).toBe('只支持 JPEG、PNG、WebP、GIF');
    expect(text('size', zh)).toBe('表情不能超过 8MB');
    expect(text('dimensions', zh)).toBe('动图太大，长宽不能超过 1024 像素');
    expect(text('frames', zh)).toBe('动图帧数太多，不能超过 300 帧');
    expect(text('invalid', zh)).toBe('无法识别这张图片');
    expect(text('unsupported', zh)).toBe('当前浏览器无法添加表情');
    expect(text('type', en)).toBe('Only JPEG, PNG, WebP, and GIF images are supported.');
    expect(text('size', en)).toBe('Stickers must be 8 MB or smaller.');
    expect(text('dimensions', en)).toBe('Animated stickers can be at most 1024 pixels on each side.');
    expect(text('frames', en)).toBe('Animated stickers can have at most 300 frames.');
    expect(text('invalid', en)).toBe("That image couldn't be read.");
    expect(text('unsupported', en)).toBe("This browser can't add stickers.");
  });

  it('treats anything else as unreadable', () => {
    expect(stickerProblemText(new Error('x'), zh)).toBe('无法识别这张图片');
  });
});
