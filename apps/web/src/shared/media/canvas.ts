import { halvingSteps, isUsableSize, planVariant, type CropRect, type Size, type VariantSpec, type VariantType } from './sizing';

/**
 * Decoding and resizing with a canvas, shared by the main thread (HTMLCanvasElement) and the resize worker
 * (OffscreenCanvas). Nothing runs at import time and nothing here needs document, except the img-element decode
 * fallback, which only the main thread reaches.
 * 用画布解码和缩放，主线程（HTMLCanvasElement）和缩放 Worker（OffscreenCanvas）共用。导入时不执行任何操作，
 * 除了只有主线程才会用到的 img 元素解码后备方案，这里都不需要 document。
 */

/** The image could not be decoded, so it cannot be resized. */
/** 图片无法解码，因此无法缩放。 */
export class MediaDecodeError extends Error {
  constructor() {
    super('decode');
  }
}

export interface DecodedImage extends Size {
  source: CanvasImageSource;
  release: () => void;
}

export type DrawingCanvas = HTMLCanvasElement | OffscreenCanvas;
export type CanvasFactory = (width: number, height: number) => DrawingCanvas;

/** One rendered variant, or null when it was not needed (onlyWhenLarger) or the canvas failed. */
/** 一个已生成的副本；不需要（onlyWhenLarger）或画布失败时为 null。 */
export type VariantOutput = { blob: Blob; width: number; height: number } | null;

export interface RenderedVariants extends Size {
  /** One entry per spec, in the order asked for. */
  /** 每个规格一项，顺序与请求一致。 */
  outputs: VariantOutput[];
}

export const documentCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

export const offscreenCanvas: CanvasFactory = (width, height) => new OffscreenCanvas(width, height);

function decodeWithImageElement(blob: Blob): Promise<DecodedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new MediaDecodeError());
    };
    image.src = url;
  });
}

/**
 * Decodes with EXIF orientation applied. createImageBitmap first; engines that reject the option or the format fall
 * back to an img element, which applies EXIF orientation too, where one exists (not in a worker).
 * 解码并应用 EXIF 方向。先用 createImageBitmap；不支持该选项或格式的引擎改用 img 元素（同样会应用 EXIF 方向），
 * 前提是存在 img 元素（Worker 中没有）。
 */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to the img element.
      // 改用 img 元素。
    }
  }
  if (typeof Image === 'undefined') throw new MediaDecodeError();
  return decodeWithImageElement(blob);
}

/** Releasing the backing store right away matters on iOS, which caps total canvas memory. */
/** 立即释放画布内存，这在限制画布总内存的 iOS 上很重要。 */
export function releaseCanvas(canvas: DrawingCanvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

function context2d(canvas: DrawingCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
}

/**
 * Draws the crop of `source` at `size` in halving steps on a white background (JPEG has no alpha, so transparent
 * areas become white rather than black). Returns the final canvas, which the caller releases, or null when a
 * canvas could not be made.
 * 在白色背景上以逐次减半的方式把 `source` 的裁切区域画成 `size`（JPEG 没有透明通道，透明区域填为白色而不是黑色）。
 * 返回最终的画布，由调用方释放；无法创建画布时为 null。
 */
export function drawScaled(source: CanvasImageSource, crop: CropRect, size: Size, make: CanvasFactory): DrawingCanvas | null {
  let current: { image: CanvasImageSource; rect: CropRect; owned: DrawingCanvas | null } = { image: source, rect: crop, owned: null };
  for (const step of halvingSteps({ width: crop.sw, height: crop.sh }, size)) {
    const canvas = make(step.width, step.height);
    const context = context2d(canvas);
    if (!context) {
      releaseCanvas(canvas);
      if (current.owned) releaseCanvas(current.owned);
      return null;
    }
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, step.width, step.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    const { sx, sy, sw, sh } = current.rect;
    context.drawImage(current.image, sx, sy, sw, sh, 0, 0, step.width, step.height);
    if (current.owned) releaseCanvas(current.owned);
    current = { image: canvas, rect: { sx: 0, sy: 0, sw: step.width, sh: step.height }, owned: canvas };
  }
  return current.owned;
}

export async function encodeCanvas(canvas: DrawingCanvas, type: VariantType, quality: number): Promise<Blob | null> {
  try {
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type, quality });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  } catch {
    // A tainted or lost canvas only costs this copy.
    // 画布被污染或丢失只会失去这一份副本。
    return null;
  }
}

/** The last variant drawn, which a smaller variant may be drawn from. */
/** 上一个绘制的副本，更小的副本可以从它绘制。 */
interface PreviousCanvas {
  canvas: DrawingCanvas;
  square: boolean;
}

/**
 * Decodes once and renders every variant in order. A variant without a crop is drawn from the previous variant's
 * canvas when that one is at least as large (the thumbnail from the 2048px copy rather than the 12MP original),
 * which is both faster and lighter on memory. Rejects with MediaDecodeError.
 * 只解码一次，按顺序生成每个副本。不裁切的副本在上一个副本的画布不小于它时从该画布绘制（缩略图取自 2048px 的副本而不是
 * 1200 万像素的原图），这样更快也更省内存。失败时以 MediaDecodeError 拒绝。
 */
export async function renderVariantsWith(blob: Blob, specs: readonly VariantSpec[], make: CanvasFactory): Promise<RenderedVariants> {
  const decoded = await decodeImage(blob);
  let previous = null as PreviousCanvas | null;
  try {
    if (!isUsableSize(decoded.width, decoded.height)) throw new MediaDecodeError();
    const outputs: VariantOutput[] = [];
    for (const spec of specs) {
      const plan = planVariant(decoded, spec);
      if (!plan) {
        outputs.push(null);
        continue;
      }
      const prior: PreviousCanvas | null = previous;
      const reuse: boolean =
        prior !== null && !spec.square && !prior.square && prior.canvas.width >= plan.size.width && prior.canvas.height >= plan.size.height;
      const canvas: DrawingCanvas | null =
        reuse && prior
          ? drawScaled(prior.canvas, { sx: 0, sy: 0, sw: prior.canvas.width, sh: prior.canvas.height }, plan.size, make)
          : drawScaled(decoded.source, plan.crop, plan.size, make);
      if (!canvas) {
        outputs.push(null);
        continue;
      }
      const out = await encodeCanvas(canvas, spec.type, spec.quality);
      outputs.push(out ? { blob: out, width: plan.size.width, height: plan.size.height } : null);
      if (previous) releaseCanvas(previous.canvas);
      previous = { canvas, square: spec.square === true };
    }
    return { width: decoded.width, height: decoded.height, outputs };
  } finally {
    if (previous) releaseCanvas(previous.canvas);
    decoded.release();
  }
}
