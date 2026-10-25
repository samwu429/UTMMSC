import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaDecodeError, drawScaled, renderVariantsWith, type CanvasFactory, type DrawingCanvas } from './canvas';
import type { VariantSpec } from './sizing';

/**
 * A canvas stand-in that records what is drawn on it. "Encoding" makes a blob whose size is the pixel count / 10,
 * so tests can tell copies apart.
 * 记录绘制内容的画布替身。“编码”生成大小为像素数 / 10 的 blob，测试据此区分各个副本。
 */
interface FakeCanvas {
  id: number;
  /** The size it was made at; width and height drop to 0 once it is released. */
  /** 创建时的尺寸；释放后 width 和 height 变为 0。 */
  made: string;
  width: number;
  height: number;
  calls: string[];
  draws: { source: unknown; args: number[] }[];
  noContext?: boolean;
  failEncode?: boolean;
  getContext(kind: string): unknown;
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

function fakeFactory(options: { noContextAt?: number; failEncodeAt?: number } = {}) {
  const made: FakeCanvas[] = [];
  const make = ((width: number, height: number) => {
    const canvas: FakeCanvas = {
      id: made.length,
      made: `${width}x${height}`,
      width,
      height,
      calls: [],
      draws: [],
      noContext: options.noContextAt === made.length,
      failEncode: options.failEncodeAt === made.length,
      getContext() {
        if (canvas.noContext) return null;
        return {
          set fillStyle(value: string) {
            canvas.calls.push(`fill ${value}`);
          },
          set imageSmoothingEnabled(value: boolean) {
            canvas.calls.push(`smooth ${value}`);
          },
          set imageSmoothingQuality(value: string) {
            canvas.calls.push(`quality ${value}`);
          },
          fillRect: (...args: number[]) => canvas.calls.push(`fillRect ${args.join(',')}`),
          drawImage: (source: unknown, ...args: number[]) => {
            canvas.calls.push('draw');
            canvas.draws.push({ source, args });
          },
        };
      },
      async convertToBlob({ type }) {
        if (canvas.failEncode) throw new Error('lost');
        return new Blob([new Uint8Array(Math.max(1, Math.round((canvas.width * canvas.height) / 10)))], { type });
      },
    };
    made.push(canvas);
    return canvas as unknown as DrawingCanvas;
  }) as CanvasFactory;
  return { make, made };
}

function stubBitmap(width: number, height: number) {
  const bitmap = { width, height, close: vi.fn() };
  const create = vi.fn(async () => bitmap);
  vi.stubGlobal('createImageBitmap', create);
  return { bitmap, create };
}

const MAIN: VariantSpec = { longEdge: 2048, onlyWhenLarger: true, type: 'image/jpeg', quality: 0.82 };
const THUMB: VariantSpec = { longEdge: 360, shortEdgeMin: 120, longEdgeMax: 1080, onlyWhenLarger: true, type: 'image/jpeg', quality: 0.75 };
const AVATAR: VariantSpec = { longEdge: 320, square: true, type: 'image/jpeg', quality: 0.85 };
const PHOTO = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('drawScaled', () => {
  it('fills white, smooths and draws through the halving steps', () => {
    const { make, made } = fakeFactory();
    const source = { tag: 'bitmap' } as unknown as CanvasImageSource;
    const out = drawScaled(source, { sx: 0, sy: 0, sw: 1600, sh: 1200 }, { width: 360, height: 270 }, make) as unknown as FakeCanvas;
    expect(made.map((c) => c.made)).toEqual(['800x600', '400x300', '360x270']);
    expect(out.id).toBe(2);
    expect(made[0]?.calls).toEqual(['fill #FFFFFF', 'fillRect 0,0,800,600', 'smooth true', 'quality high', 'draw']);
    expect(made[0]?.draws[0]).toEqual({ source, args: [0, 0, 1600, 1200, 0, 0, 800, 600] });
    // Each step draws the previous step, which is then released.
    // 每一步都绘制上一步的画布，随后释放上一步。
    expect(made[1]?.draws[0]?.source).toBe(made[0]);
    expect(made[2]?.draws[0]).toEqual({ source: made[1], args: [0, 0, 400, 300, 0, 0, 360, 270] });
    expect([made[0]?.width, made[1]?.width, made[2]?.width]).toEqual([0, 0, 360]);
  });

  it('gives null and releases what it made when a canvas has no context', () => {
    const { make, made } = fakeFactory({ noContextAt: 1 });
    expect(drawScaled({} as CanvasImageSource, { sx: 0, sy: 0, sw: 1600, sh: 1200 }, { width: 360, height: 270 }, make)).toBeNull();
    expect(made.map((c) => c.width)).toEqual([0, 0]);
  });
});

describe('renderVariantsWith', () => {
  it('decodes once and draws the thumbnail from the 2048px copy', async () => {
    const { bitmap, create } = stubBitmap(4032, 3024);
    const { make, made } = fakeFactory();
    const result = await renderVariantsWith(PHOTO, [MAIN, THUMB], make);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(PHOTO, { imageOrientation: 'from-image' });
    expect(result.width).toBe(4032);
    expect(result.outputs.map((o) => o && `${o.width}x${o.height} ${o.blob.type}`)).toEqual(['2048x1536 image/jpeg', '360x270 image/jpeg']);
    const main = made.find((c) => c.draws.length > 0 && c.draws[0]?.source === bitmap);
    expect(main).toBeDefined();
    // The thumbnail's first step reads the main copy's last canvas, not the 12MP bitmap.
    // 缩略图的第一步读取主图副本的最终画布，而不是 1200 万像素的位图。
    const thumbFirst = made.find((c) => c.width === 0 && c.draws[0]?.args[2] === 2048);
    expect(thumbFirst?.draws[0]?.source).not.toBe(bitmap);
    expect(made.filter((c) => c.draws.some((d) => d.source === bitmap))).toHaveLength(1);
    expect(made.every((c) => c.width === 0)).toBe(true);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('skips the main copy of a photo already within 2048px and draws the thumbnail from the source', async () => {
    const { bitmap } = stubBitmap(1600, 1200);
    const { make, made } = fakeFactory();
    const result = await renderVariantsWith(PHOTO, [MAIN, THUMB], make);
    expect(result.outputs[0]).toBeNull();
    expect(result.outputs[1]).toMatchObject({ width: 360, height: 270 });
    expect(made[0]?.draws[0]?.source).toBe(bitmap);
  });

  it('crops a square avatar from the source', async () => {
    const { bitmap } = stubBitmap(4032, 3024);
    const { make, made } = fakeFactory();
    const result = await renderVariantsWith(PHOTO, [AVATAR], make);
    expect(result.outputs[0]).toMatchObject({ width: 320, height: 320 });
    expect(made[0]?.draws[0]).toEqual({ source: bitmap, args: [504, 0, 3024, 3024, 0, 0, 1512, 1512] });
  });

  it('loses only the copy whose encoding fails', async () => {
    stubBitmap(4032, 3024);
    // Canvas 0 is the main copy, drawn in one step (half of 4032 is already below 2048); its encoding fails, but its
    // pixels still serve the thumbnail.
    // 画布 0 是主图副本，一步画成（4032 的一半已小于 2048）；它的编码失败，但其像素仍可用于缩略图。
    const { make, made } = fakeFactory({ failEncodeAt: 0 });
    const result = await renderVariantsWith(PHOTO, [MAIN, THUMB], make);
    expect(made[0]?.width).toBe(0);
    expect(result.outputs[0]).toBeNull();
    expect(result.outputs[1]).toMatchObject({ width: 360, height: 270 });
  });

  it('rejects an image without a usable size and still closes the bitmap', async () => {
    const { bitmap } = stubBitmap(0, 0);
    const { make } = fakeFactory();
    await expect(renderVariantsWith(PHOTO, [MAIN], make)).rejects.toBeInstanceOf(MediaDecodeError);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it('rejects when nothing can decode the file', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported');
      }),
    );
    const { make } = fakeFactory();
    await expect(renderVariantsWith(PHOTO, [MAIN], make)).rejects.toBeInstanceOf(MediaDecodeError);
  });
});
