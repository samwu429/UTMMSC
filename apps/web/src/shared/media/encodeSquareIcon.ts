import { CHANNEL_ICON_MAX_BYTES, CHANNEL_ICON_SIZE, CHANNEL_ICON_THUMB_MAX_BYTES, CHANNEL_ICON_THUMB_SIZE } from '@utmmsc/shared';
import { decodeImage, encodeCanvas, releaseCanvas } from './canvas';
import {
  ICON_BACKGROUND,
  ICON_FALLBACK_QUALITIES,
  IconImageError,
  downscaleSteps,
  encodingQuality,
  encodingType,
  iconDrawSides,
  iconFileName,
  pickEncoding,
  scaleCrop,
  type IconCrop,
  type IconEncoding,
  type IconSize,
} from './squareIcon';

/**
 * The browser part of a channel icon: the cropped square drawn at 256 px and at 96 px, encoded WebP, or JPEG where
 * the canvas cannot write WebP (Safari). The arithmetic lives in squareIcon.ts; decoding is the shared canvas.ts one,
 * which applies EXIF orientation. Main thread only.
 * 频道图标在浏览器中的部分：把裁剪出的正方形画成 256px 和 96px，编码为 WebP；画布不能写 WebP 时（Safari）改为 JPEG。计算放在
 * squareIcon.ts 中；解码使用共享的 canvas.ts，会应用 EXIF 方向。只在主线程运行。
 */

export interface SquareIconFiles {
  /** 256 x 256. */
  /** 256 x 256 像素。 */
  icon: File;
  /** 96 x 96, the same type as the icon. */
  /** 96 x 96，与图标类型相同。 */
  thumb: File;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Draws `rect` of `source` through `sizes`, each step from the one before, on ICON_BACKGROUND (white: JPEG has no
 * alpha, so transparent areas become white rather than black, as the crop screen shows them), with high-quality
 * smoothing. Returns the last canvas; every other canvas is released on the way.
 * 把 `source` 的 `rect` 区域依次画成 `sizes` 中的尺寸，每一步取自上一步，背景为 ICON_BACKGROUND（白色：JPEG 没有透明通道，透明区域因此为
 * 白色而不是黑色，与裁剪界面显示的一致），并使用高质量平滑。返回最后一个画布，其余画布在途中释放。
 */
function drawThrough(source: CanvasImageSource, rect: Rect, sizes: readonly IconSize[]): HTMLCanvasElement {
  let image: CanvasImageSource = source;
  let from = rect;
  let previous: HTMLCanvasElement | null = null;
  for (const size of sizes) {
    const canvas = makeCanvas(size.width, size.height);
    const context = canvas.getContext('2d');
    if (!context) {
      releaseCanvas(canvas);
      if (previous) releaseCanvas(previous);
      throw new IconImageError('encode');
    }
    context.fillStyle = ICON_BACKGROUND;
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, from.sx, from.sy, from.sw, from.sh, 0, 0, size.width, size.height);
    if (previous) releaseCanvas(previous);
    previous = canvas;
    image = canvas;
    from = { sx: 0, sy: 0, sw: size.width, sh: size.height };
  }
  if (!previous) throw new IconImageError('encode');
  return previous;
}

function squares(sides: readonly number[]): IconSize[] {
  return sides.map((side) => ({ width: side, height: side }));
}

/** The first blob at or under `max` bytes, trying the encoding's quality and then the lower ones. */
/** 依次尝试该编码的质量和更低的质量，返回第一个不超过 `max` 字节的 blob。 */
async function encodeWithin(canvas: HTMLCanvasElement, encoding: IconEncoding, max: number): Promise<Blob | null> {
  const type = encodingType(encoding);
  for (const quality of [encodingQuality(encoding), ...ICON_FALLBACK_QUALITIES]) {
    const blob = await encodeCanvas(canvas, type, quality);
    if (!blob || blob.type !== type) return null;
    if (blob.size <= max) return blob;
  }
  return null;
}

/**
 * The icon and thumbnail of `crop`, a square of the picked image in the pixels the crop screen measured on `basis`
 * (the image as the browser shows it, orientation applied; the decoded size when left out). Only the crop square is
 * drawn, straight from the decoded image, so a panorama or a long screenshot keeps every source pixel the icon can
 * use; a crop over 4096 is drawn to 2048 first, so no canvas over 2048 is made while the decoded image is held (iOS
 * caps canvas memory). The thumbnail is drawn from the 256 px canvas. Rejects with IconImageError.
 * `crop` 对应的图标和缩略图。`crop` 是所选图片中的一个正方形，单位为裁剪界面在 `basis` 上量得的像素（即浏览器显示的图片，已应用方向；
 * 省略时为解码尺寸）。只绘制裁剪出的正方形，并直接取自解码后的图片，全景照片或长截图因此保留图标可用的所有源图像素；超过 4096 的裁剪区域
 * 先画成 2048，持有解码图片期间不会创建超过 2048 的画布（iOS 限制画布内存）。缩略图取自 256px 的画布。失败时以 IconImageError 拒绝。
 */
export async function encodeSquareIcon(file: Blob, crop: IconCrop, basis?: IconSize): Promise<SquareIconFiles> {
  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new IconImageError('decode');
  }
  const canvases: HTMLCanvasElement[] = [];
  let decodedReleased = false;
  const releaseDecoded = () => {
    if (decodedReleased) return;
    decodedReleased = true;
    decoded.release();
  };
  try {
    if (!(decoded.width > 0) || !(decoded.height > 0) || !(crop.size > 0)) throw new IconImageError('decode');
    const measured = basis && basis.width > 0 ? basis.width : decoded.width;
    const area = scaleCrop(crop, decoded.width / measured, { width: decoded.width, height: decoded.height });
    const icon = drawThrough(decoded.source, { sx: area.sx, sy: area.sy, sw: area.size, sh: area.size }, squares(iconDrawSides(area.size, CHANNEL_ICON_SIZE)));
    canvases.push(icon);
    releaseDecoded();
    const thumb = drawThrough(icon, { sx: 0, sy: 0, sw: CHANNEL_ICON_SIZE, sh: CHANNEL_ICON_SIZE }, squares(downscaleSteps(CHANNEL_ICON_SIZE, CHANNEL_ICON_THUMB_SIZE)));
    canvases.push(thumb);

    // Ask for WebP and look at what came back: a canvas that cannot write WebP returns PNG, and then both are JPEG.
    // 请求 WebP 并查看实际返回的类型：不能写 WebP 的画布会返回 PNG，此时两者都用 JPEG。
    const probe = await encodeCanvas(icon, 'image/webp', encodingQuality('webp'));
    let encoding = pickEncoding(probe?.type);
    let iconBlob = encoding === 'webp' && probe && probe.size <= CHANNEL_ICON_MAX_BYTES ? probe : await encodeWithin(icon, encoding, CHANNEL_ICON_MAX_BYTES);
    let thumbBlob = iconBlob ? await encodeWithin(thumb, encoding, CHANNEL_ICON_THUMB_MAX_BYTES) : null;
    if ((!iconBlob || !thumbBlob) && encoding === 'webp') {
      encoding = 'jpeg';
      iconBlob = await encodeWithin(icon, encoding, CHANNEL_ICON_MAX_BYTES);
      thumbBlob = iconBlob ? await encodeWithin(thumb, encoding, CHANNEL_ICON_THUMB_MAX_BYTES) : null;
    }
    if (!iconBlob || !thumbBlob) throw new IconImageError('encode');
    const type = encodingType(encoding);
    return {
      icon: new File([iconBlob], iconFileName(encoding, false), { type }),
      thumb: new File([thumbBlob], iconFileName(encoding, true), { type }),
    };
  } finally {
    // iOS caps the canvas memory of a page, so every canvas gives its memory back at once.
    // iOS 限制页面的画布总内存，因此每个画布都立即归还内存。
    for (const canvas of canvases) releaseCanvas(canvas);
    releaseDecoded();
  }
}
