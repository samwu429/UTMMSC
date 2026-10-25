import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_ICON_SIZE, CHANNEL_ICON_THUMB_SIZE } from '@utmmsc/shared';
import { encodeSquareIcon } from './encodeSquareIcon';
import { ICON_BACKGROUND, ICON_WORKING_EDGE, IconImageError, type IconCrop, type IconSize } from './squareIcon';

/**
 * encodeSquareIcon on canvas stand-ins that record every draw: where it was drawn from, which rectangle, onto which
 * canvas, and the fill under it. "Encoding" returns a small blob of the asked type, or PNG for WebP when the canvas
 * is told it cannot write WebP (Safari).
 * 在记录每次绘制的画布替身上运行 encodeSquareIcon：绘制来源、源矩形、目标画布，以及其下的填充色。“编码”返回所请求类型的小 blob；
 * 设定为不能写 WebP（Safari）时，WebP 请求返回 PNG。
 */
interface Draw {
  source: unknown;
  rect: number[];
  /** The target canvas as `WxH`. */
  /** 目标画布，格式为 `宽x高`。 */
  onto: string;
  fill: string | null;
}

interface StubCanvas {
  width: number;
  height: number;
  made: string;
}

function setup(width: number, height: number, options: { webp?: boolean } = {}) {
  const draws: Draw[] = [];
  const canvases: StubCanvas[] = [];
  const bitmap = { width, height, close: vi.fn() };
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
  vi.stubGlobal('document', {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(tag);
      let fillStyle: string | null = null;
      let filled: string | null = null;
      const canvas = {
        width: 0,
        height: 0,
        made: '',
        getContext() {
          canvas.made = `${canvas.width}x${canvas.height}`;
          return {
            set fillStyle(value: string) {
              fillStyle = value;
            },
            fillRect(x: number, y: number, w: number, h: number) {
              if (x === 0 && y === 0 && w === canvas.width && h === canvas.height) filled = fillStyle;
            },
            imageSmoothingEnabled: false,
            imageSmoothingQuality: 'low',
            drawImage(source: unknown, ...args: number[]) {
              draws.push({ source, rect: args.slice(0, 4), onto: canvas.made, fill: filled });
            },
          };
        },
        async convertToBlob({ type }: { type: string }) {
          const written = type === 'image/webp' && options.webp === false ? 'image/png' : type;
          return new Blob([new Uint8Array(100)], { type: written });
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  });
  return { bitmap, draws, canvases };
}

const PICKED = new Blob([new Uint8Array(10)], { type: 'image/png' });

function side(onto: string): number {
  return Number(onto.split('x')[0]);
}

/** No draw makes the picture bigger than the source rectangle it came from. */
/** 没有任何一次绘制把图片画得比它的源矩形更大。 */
function expectNoEnlarging(draws: Draw[]) {
  for (const draw of draws) expect(side(draw.onto)).toBeLessThanOrEqual(Math.min(draw.rect[2] ?? 0, draw.rect[3] ?? 0));
}

async function encode(width: number, height: number, crop: IconCrop, basis?: IconSize, options?: { webp?: boolean }) {
  const stub = setup(width, height, options);
  const files = await encodeSquareIcon(PICKED, crop, basis ?? { width, height });
  return { ...stub, files };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeSquareIcon', () => {
  it('draws a panorama crop straight from the decoded image, keeping its pixels', async () => {
    // 16000x4000 zoomed to 4x on one building: a 1000 px crop, which must not be shrunk with the whole photo first.
    // 16000x4000 放大 4 倍对准一栋楼：裁剪区域为 1000px，不能先随整张照片一起缩小。
    const { bitmap, draws, canvases } = await encode(16000, 4000, { sx: 7000, sy: 1500, size: 1000 });
    expect(draws[0]).toEqual({ source: bitmap, rect: [7000, 1500, 1000, 1000], onto: '500x500', fill: ICON_BACKGROUND });
    expect(canvases.map((canvas) => canvas.made)).toEqual(['500x500', '256x256', '128x128', '96x96']);
    expectNoEnlarging(draws);
  });

  it('keeps the full width of a long screenshot', async () => {
    const { bitmap, draws } = await encode(1080, 12000, { sx: 0, sy: 5460, size: 1080 });
    expect(draws[0]).toEqual({ source: bitmap, rect: [0, 5460, 1080, 1080], onto: '540x540', fill: ICON_BACKGROUND });
    expectNoEnlarging(draws);
  });

  it('draws a crop over 4096 straight to 2048, and makes no larger canvas', async () => {
    const { bitmap, draws, canvases } = await encode(16000, 12000, { sx: 2000, sy: 0, size: 12000 });
    expect(draws[0]).toEqual({ source: bitmap, rect: [2000, 0, 12000, 12000], onto: '2048x2048', fill: ICON_BACKGROUND });
    expect(canvases.map((canvas) => canvas.made)).toEqual(['2048x2048', '1024x1024', '512x512', '256x256', '128x128', '96x96']);
    expect(Math.max(...canvases.map((canvas) => side(canvas.made)))).toBeLessThanOrEqual(ICON_WORKING_EDGE);
  });

  it('moves a crop measured on the shown image onto the decoded one', async () => {
    const { bitmap, draws } = await encode(4000, 3000, { sx: 125, sy: 0, size: 750 }, { width: 1000, height: 750 });
    expect(draws[0]).toEqual({ source: bitmap, rect: [500, 0, 3000, 3000], onto: '1500x1500', fill: ICON_BACKGROUND });
  });

  it('fills every canvas with the colour the crop screen shows under transparent parts', async () => {
    const { draws } = await encode(600, 600, { sx: 0, sy: 0, size: 600 });
    expect(draws.length).toBeGreaterThan(0);
    for (const draw of draws) expect(draw.fill).toBe(ICON_BACKGROUND);
  });

  it('writes a 256 px icon and a 96 px thumbnail, WebP where the canvas can and JPEG otherwise', async () => {
    const webp = await encode(600, 600, { sx: 0, sy: 0, size: 600 });
    expect(webp.draws.at(-1)?.onto).toBe(`${CHANNEL_ICON_THUMB_SIZE}x${CHANNEL_ICON_THUMB_SIZE}`);
    expect(webp.canvases.map((canvas) => canvas.made)).toContain(`${CHANNEL_ICON_SIZE}x${CHANNEL_ICON_SIZE}`);
    expect([webp.files.icon.name, webp.files.icon.type, webp.files.thumb.name, webp.files.thumb.type]).toEqual(['icon.webp', 'image/webp', 'icon-96.webp', 'image/webp']);
    vi.unstubAllGlobals();
    const jpeg = await encode(600, 600, { sx: 0, sy: 0, size: 600 }, undefined, { webp: false });
    expect([jpeg.files.icon.name, jpeg.files.icon.type, jpeg.files.thumb.name, jpeg.files.thumb.type]).toEqual(['icon.jpg', 'image/jpeg', 'icon-96.jpg', 'image/jpeg']);
  });

  it('gives back every canvas and the decoded image', async () => {
    const { bitmap, canvases } = await encode(16000, 4000, { sx: 7000, sy: 1500, size: 1000 });
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    for (const canvas of canvases) expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it('rejects an empty crop', async () => {
    setup(600, 600);
    await expect(encodeSquareIcon(PICKED, { sx: 0, sy: 0, size: 0 })).rejects.toBeInstanceOf(IconImageError);
  });
});
