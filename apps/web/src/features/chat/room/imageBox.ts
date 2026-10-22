/**
 * Pure geometry for chat images: the reserved thumbnail box and the viewer's fit, zoom and pan.
 * 聊天图片的纯几何计算：预留的缩略图尺寸，以及查看器的适配、缩放和平移。
 */

export const THUMB_LONG_MAX = 180;
export const THUMB_SHORT_MIN = 60;
export const THUMB_RATIO_MAX = 3;
/** Rows stored before image sizes were recorded get a fixed square. */
/** 记录图片尺寸之前存储的消息使用固定的正方形。 */
export const LEGACY_THUMB = 132;
export const VIEWER_SCALE_MAX = 4;

export interface Size {
  width: number;
  height: number;
}

export interface Box extends Size {
  left: number;
  top: number;
}

export interface ThumbBox extends Size {
  /** True when the ratio was clamped, so the thumbnail shows a centre crop. */
  /** 比例被限制时为 true，缩略图显示居中裁切。 */
  cropped: boolean;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Thumbnail box reserved before the image loads: the long edge is capped at 180px, the short edge is at
 * least 60px, and the ratio is clamped to 1:3 (the rest is cropped).
 * 图片加载前预留的缩略图尺寸：长边不超过 180px，短边不少于 60px，比例限制在 1:3 以内（多出部分裁切）。
 */
export function fitThumb(width: number | null | undefined, height: number | null | undefined): ThumbBox {
  if (!positive(width) || !positive(height)) return { width: LEGACY_THUMB, height: LEGACY_THUMB, cropped: true };
  const landscape = width >= height;
  const longEdge = landscape ? width : height;
  const shortEdge = landscape ? height : width;
  const natural = longEdge / shortEdge;
  const ratio = Math.min(natural, THUMB_RATIO_MAX);
  let long = Math.min(THUMB_LONG_MAX, longEdge);
  let short = long / ratio;
  if (short < THUMB_SHORT_MIN) {
    short = THUMB_SHORT_MIN;
    long = Math.min(THUMB_LONG_MAX, short * ratio);
  }
  const longPx = Math.round(long);
  const shortPx = Math.round(short);
  return { width: landscape ? longPx : shortPx, height: landscape ? shortPx : longPx, cropped: natural > THUMB_RATIO_MAX };
}

/** Largest size with the image's ratio that fits inside the container. */
/** 在容器内按图片比例能放下的最大尺寸。 */
export function fitContain(image: Size, container: Size): Size {
  if (!positive(image.width) || !positive(image.height) || !positive(container.width) || !positive(container.height)) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(container.width / image.width, container.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

/** The box a fitted image occupies when centred in the container. */
/** 适配后的图片在容器中居中时占据的区域。 */
export function centredBox(size: Size, container: Size): Box {
  return { ...size, left: (container.width - size.width) / 2, top: (container.height - size.height) / 2 };
}

/**
 * Translation and uniform scale that make `to` (with a centre origin) cover `from`, for the zoom
 * between a thumbnail and the viewer.
 * 使 `to`（以中心为原点）覆盖 `from` 的平移和等比缩放，用于缩略图与查看器之间的缩放动画。
 */
export function coverTransform(from: Box, to: Box): { x: number; y: number; scale: number } {
  if (!positive(to.width) || !positive(to.height)) return { x: 0, y: 0, scale: 1 };
  const scale = Math.max(from.width / to.width, from.height / to.height);
  return {
    x: from.left + from.width / 2 - (to.left + to.width / 2),
    y: from.top + from.height / 2 - (to.top + to.height / 2),
    scale,
  };
}

/** Keeps a zoomed image from being panned past its edges. Offsets are from the centred position. */
/** 防止放大后的图片被拖出边缘。偏移量相对于居中位置。 */
export function clampPan(x: number, y: number, scale: number, image: Size, container: Size): { x: number; y: number } {
  const limitX = Math.max(0, (image.width * scale - container.width) / 2);
  const limitY = Math.max(0, (image.height * scale - container.height) / 2);
  // Adding zero turns -0 into 0.
  // 加零把 -0 变成 0。
  return { x: Math.min(limitX, Math.max(-limitX, x)) + 0, y: Math.min(limitY, Math.max(-limitY, y)) + 0 };
}

/**
 * Offset that keeps the content under `point` still while the scale changes from `from` to `to`.
 * `point` and the offsets are measured from the container centre.
 * 缩放从 `from` 变为 `to` 时，使 `point` 下的内容保持不动的偏移量。`point` 与偏移量都以容器中心为原点。
 */
export function zoomAbout(point: { x: number; y: number }, offset: { x: number; y: number }, from: number, to: number): { x: number; y: number } {
  if (!positive(from)) return offset;
  const factor = to / from;
  return { x: point.x - (point.x - offset.x) * factor, y: point.y - (point.y - offset.y) * factor };
}
