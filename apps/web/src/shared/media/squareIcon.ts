/**
 * Pure arithmetic of the square channel icon: the crop screen's pan and zoom and the style of its images
 * (IconCropScreen), the crop rectangle in source pixels, the halving steps of the downscale, and which encoding the
 * canvas really produced (encodeSquareIcon). Nothing here touches the DOM, so it is tested in Node.
 * 方形频道图标的纯计算：裁剪界面的平移与缩放及其图片的样式（IconCropScreen）、以源图像素表示的裁剪矩形、缩小时的逐次减半步骤，
 * 以及画布实际生成的编码（encodeSquareIcon）。这里不访问 DOM，因此可以在 Node 中测试。
 */

/** Where the image sits under the square frame: zoom from 1 (the image just covers the frame) and the offset of the image's centre from the frame's centre, in CSS pixels. */
/** 图片在方框下的位置：缩放倍数从 1 起（图片刚好盖满方框），以及图片中心相对方框中心的偏移，单位为 CSS 像素。 */
export interface IconTransform {
  zoom: number;
  x: number;
  y: number;
}

/** A square of the source image, in source pixels. */
/** 源图中的一个正方形，单位为源图像素。 */
export interface IconCrop {
  sx: number;
  sy: number;
  size: number;
}

export interface IconPoint {
  x: number;
  y: number;
}

export interface IconSize {
  width: number;
  height: number;
}

export const ICON_ZOOM_MIN = 1;
export const ICON_ZOOM_MAX = 4;
/** Double-tap toggles between 1x and this. */
/** 双击在 1 倍与此倍数之间切换。 */
export const ICON_DOUBLE_TAP_ZOOM = 2;
/** The frame is 80% of the screen width, and never more than 320 CSS px. */
/** 方框宽度为屏幕宽度的 80%，最大 320 CSS 像素。 */
export const ICON_FRAME_MAX = 320;
export const ICON_FRAME_SHARE = 0.8;
/** The live preview is drawn at the chat list's avatar size. */
/** 实时预览按聊天列表的头像尺寸绘制。 */
export const ICON_PREVIEW_SIZE = 48;
/**
 * What transparent parts of the picked image become. The encoder fills every canvas with it (JPEG has no alpha), and
 * the crop screen shows it behind its images, so what the admin approves is what is saved.
 * 所选图片的透明部分最终显示的颜色。编码器先用它填满每个画布（JPEG 没有透明通道），裁剪界面的图片背后也显示它，管理员确认的样子因此就是
 * 保存的样子。
 */
export const ICON_BACKGROUND = '#FFFFFF';
/** Arrow keys move the image this many CSS px, with Shift four times as far. */
/** 方向键每次移动图片的 CSS 像素数，按住 Shift 时为四倍。 */
export const ICON_KEY_PAN_STEP = 10;
export const ICON_KEY_PAN_STEP_LARGE = 40;
/** + and − zoom by this factor. */
/** + 和 − 每次按此倍率缩放。 */
export const ICON_KEY_ZOOM_FACTOR = 1.15;

/** WebP quality first; JPEG, where the canvas cannot write WebP (Safari), is a little higher to match. */
/** 先用 WebP 质量；画布不能写 WebP 时（Safari）改用 JPEG，质量略高以保持观感一致。 */
export const ICON_WEBP_QUALITY = 0.86;
export const ICON_JPEG_QUALITY = 0.88;
/** Tried in turn when an output is over its byte cap, which only a very noisy image reaches. */
/** 输出超过字节上限时依次尝试，只有噪点极多的图片才会用到。 */
export const ICON_FALLBACK_QUALITIES = [0.75, 0.6] as const;

/** A crop square wider than this is drawn straight to ICON_WORKING_EDGE first, so no larger canvas is made while the decoded image is held (iOS caps canvas memory). */
/** 边长超过此值的裁剪正方形先直接画成 ICON_WORKING_EDGE，持有解码图片期间因此不会创建更大的画布（iOS 限制画布内存）。 */
export const ICON_DECODE_LIMIT = 4096;
export const ICON_WORKING_EDGE = 2048;

/**
 * What the picker offers. GIF is left out (a canvas drops the animation), and with this list iOS converts a HEIC
 * photo to JPEG on the way in.
 * 选择器接受的类型。不含 GIF（画布会丢掉动画）；使用这个列表时，iOS 会在选择时把 HEIC 照片转成 JPEG。
 */
export const ICON_PICK_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ICON_PICK_ACCEPT = ICON_PICK_TYPES.join(',');

export const ICON_IDENTITY: Readonly<IconTransform> = Object.freeze({ zoom: 1, x: 0, y: 0 });

/**
 * Whether a picked file can be cropped. An empty type (some Android file pickers) is let through, and decoding
 * decides.
 * 选中的文件能否裁剪。类型为空（部分安卓文件选择器）时放行，由解码决定。
 */
export function isIconPickType(type: string): boolean {
  return type === '' || (ICON_PICK_TYPES as readonly string[]).includes(type);
}

/** The frame's side for a window this wide. */
/** 窗口为此宽度时方框的边长。 */
export function frameSide(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : ICON_FRAME_MAX / ICON_FRAME_SHARE;
  return Math.max(1, Math.round(Math.min(width * ICON_FRAME_SHARE, ICON_FRAME_MAX)));
}

function usable(width: number, height: number, viewport: number): boolean {
  return [width, height, viewport].every((value) => Number.isFinite(value) && value > 0);
}

/** CSS px per source px at zoom 1: the short edge of the image just fills the frame. 0 for an unusable size. */
/** 缩放为 1 时每个源图像素对应的 CSS 像素：图片的短边刚好填满方框。尺寸不可用时为 0。 */
export function coverScale(width: number, height: number, viewport: number): number {
  if (!usable(width, height, viewport)) return 0;
  return viewport / Math.min(width, height);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ICON_ZOOM_MIN;
  return Math.min(ICON_ZOOM_MAX, Math.max(ICON_ZOOM_MIN, zoom));
}

function clampOffset(offset: number, shown: number, viewport: number): number {
  const limit = Math.max(0, (shown - viewport) / 2);
  if (!Number.isFinite(offset)) return 0;
  // `|| 0` turns -0 into 0, so a centred image compares equal however it got there.
  // `|| 0` 把 -0 变成 0，居中的图片无论怎样到达都比较相等。
  return Math.min(limit, Math.max(-limit, offset)) || 0;
}

/**
 * The transform kept within bounds: zoom between 1x and 4x, and the image always covering the whole frame, so the
 * icon never has an empty edge.
 * 限制在范围内的变换：缩放在 1 到 4 倍之间，图片始终盖满整个方框，图标因此不会出现空白边。
 */
export function clampTransform(transform: IconTransform, width: number, height: number, viewport: number): IconTransform {
  const cover = coverScale(width, height, viewport);
  if (cover === 0) return { ...ICON_IDENTITY };
  const zoom = clampZoom(transform.zoom);
  const scale = cover * zoom;
  return { zoom, x: clampOffset(transform.x, width * scale, viewport), y: clampOffset(transform.y, height * scale, viewport) };
}

/** One-finger drag (or an arrow key): the image follows by the same CSS px. */
/** 单指拖动（或方向键）：图片跟随移动相同的 CSS 像素。 */
export function panBy(transform: IconTransform, dx: number, dy: number, width: number, height: number, viewport: number): IconTransform {
  return clampTransform({ zoom: transform.zoom, x: transform.x + dx, y: transform.y + dy }, width, height, viewport);
}

/**
 * Zooms to `zoom` keeping the image point under `focal` (relative to the frame's centre, in CSS px) where it is,
 * which is how a wheel, a double-tap or a pinch feels anchored under the pointer.
 * 缩放到 `zoom`，同时让 `focal`（相对方框中心，单位为 CSS 像素）下方的图片点保持不动，滚轮、双击和捏合因此像是固定在指针之下。
 */
export function zoomAround(transform: IconTransform, zoom: number, focal: IconPoint, width: number, height: number, viewport: number): IconTransform {
  const from = clampZoom(transform.zoom);
  const to = clampZoom(zoom);
  const ratio = to / from;
  return clampTransform({ zoom: to, x: focal.x - (focal.x - transform.x) * ratio, y: focal.y - (focal.y - transform.y) * ratio }, width, height, viewport);
}

/**
 * Two fingers: the zoom grows with the distance between them (`ratio` = distance now / distance at the start), around
 * the midpoint where they started, and the image follows the midpoint as it moves.
 * 双指：缩放随两指距离变化（`ratio` = 当前距离 / 开始时的距离），以开始时的中点为中心，图片同时跟随中点移动。
 */
export function pinchTransform(
  start: IconTransform,
  startMid: IconPoint,
  mid: IconPoint,
  ratio: number,
  width: number,
  height: number,
  viewport: number,
): IconTransform {
  const zoom = clampZoom(start.zoom * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1));
  const factor = zoom / clampZoom(start.zoom);
  return clampTransform({ zoom, x: mid.x - (startMid.x - start.x) * factor, y: mid.y - (startMid.y - start.y) * factor }, width, height, viewport);
}

/** Double-tap: 2x around the tapped point when near 1x, back to 1x otherwise. */
/** 双击：接近 1 倍时以点按处为中心放大到 2 倍，否则回到 1 倍。 */
export function toggleZoom(transform: IconTransform, focal: IconPoint, width: number, height: number, viewport: number): IconTransform {
  const zoomedIn = transform.zoom >= (ICON_ZOOM_MIN + ICON_DOUBLE_TAP_ZOOM) / 2;
  return zoomAround(transform, zoomedIn ? ICON_ZOOM_MIN : ICON_DOUBLE_TAP_ZOOM, focal, width, height, viewport);
}

/** The zoom after one wheel event; `deltaY` in pixels, negative to zoom in. */
/** 一次滚轮事件之后的缩放倍数；`deltaY` 以像素为单位，为负时放大。 */
export function wheelZoom(zoom: number, deltaY: number): number {
  if (!Number.isFinite(deltaY)) return clampZoom(zoom);
  return clampZoom(zoom * Math.exp(-deltaY * 0.002));
}

/** The same place under a frame of another size, after the window is resized or rotated. */
/** 窗口改变大小或旋转后，在另一尺寸的方框下保持相同的位置。 */
export function rescaleTransform(transform: IconTransform, fromViewport: number, toViewport: number): IconTransform {
  if (!(fromViewport > 0) || !(toViewport > 0)) return transform;
  const factor = toViewport / fromViewport;
  return { zoom: transform.zoom, x: transform.x * factor, y: transform.y * factor };
}

export interface IconImageStyle {
  width: string;
  height: string;
  maxWidth: string;
  backgroundColor: string;
  transform: string;
}

/**
 * The inline style of a crop-screen image at `scale` times its size on the stage (1 for the stage, ICON_PREVIEW_SIZE /
 * frame for the preview), centred and moved by `transform`. It is backed by ICON_BACKGROUND, the encoder's fill, so
 * transparent parts show as they will be saved.
 * 裁剪界面中一张图片的内联样式：尺寸为它在舞台上的 `scale` 倍（舞台为 1，预览为 ICON_PREVIEW_SIZE / 方框边长），居中后按 `transform`
 * 移动。背景为编码器的填充色 ICON_BACKGROUND，透明部分因此显示为保存后的样子。
 */
export function iconImageStyle(natural: IconSize, frame: number, transform: IconTransform, scale: number): IconImageStyle {
  const cover = coverScale(natural.width, natural.height, frame);
  return {
    width: `${natural.width * cover * scale}px`,
    height: `${natural.height * cover * scale}px`,
    maxWidth: 'none',
    backgroundColor: ICON_BACKGROUND,
    transform: `translate(-50%, -50%) translate(${transform.x * scale}px, ${transform.y * scale}px) scale(${transform.zoom})`,
  };
}

/**
 * The square of the source under the frame, in source pixels: what the icon will show. Always inside the image.
 * 方框下方的源图正方形，单位为源图像素，即图标将显示的内容。始终位于图片之内。
 */
export function cropRect(transform: IconTransform, width: number, height: number, viewport: number): IconCrop {
  const cover = coverScale(width, height, viewport);
  if (cover === 0) return { sx: 0, sy: 0, size: 0 };
  const t = clampTransform(transform, width, height, viewport);
  const scale = cover * t.zoom;
  const size = Math.min(viewport / scale, width, height);
  const cx = width / 2 - t.x / scale;
  const cy = height / 2 - t.y / scale;
  return {
    sx: Math.min(width - size, Math.max(0, cx - size / 2)),
    sy: Math.min(height - size, Math.max(0, cy - size / 2)),
    size,
  };
}

/**
 * A crop measured on one copy of the image moved onto another copy `factor` times its size (the decoded image, when
 * the crop screen measured one of another size), kept inside `bounds`.
 * 把在图片某一副本上量得的裁剪区域换算到尺寸为其 `factor` 倍的另一副本上（裁剪界面量得的图片与解码后的尺寸不同时），并保持在
 * `bounds` 之内。
 */
export function scaleCrop(crop: IconCrop, factor: number, bounds: IconSize): IconCrop {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const size = Math.min(crop.size * f, bounds.width, bounds.height);
  return {
    sx: Math.min(bounds.width - size, Math.max(0, crop.sx * f)),
    sy: Math.min(bounds.height - size, Math.max(0, crop.sy * f)),
    size,
  };
}

/**
 * The square sides a downscale draws through, ending exactly on `to`: halved while the half stays clearly above the
 * target, so no single draw shrinks by more than about 2.5x and no step is a near-copy of the next (1500 -> 750,
 * 375, 256; 256 -> 128, 96). An upscale or a small step is one draw.
 * 缩小过程依次绘制的正方形边长，最后正好落在 `to`：只要一半仍明显大于目标就减半，因此单次绘制的缩小不超过约 2.5 倍，也不会出现与下一步
 * 几乎相同的步骤（1500 -> 750、375、256；256 -> 128、96）。放大或小幅缩小只画一次。
 */
export function downscaleSteps(from: number, to: number): number[] {
  const target = Math.max(1, Math.round(to));
  const steps: number[] = [];
  let side = Number.isFinite(from) ? Math.max(1, Math.round(from)) : target;
  while (side / 2 >= target * 1.25) {
    side = Math.round(side / 2);
    steps.push(side);
  }
  steps.push(target);
  return steps;
}

/**
 * The square sides the icon is drawn through from a crop `from` source px across, ending on `to`. Only the crop is
 * drawn, straight from the decoded image, so the icon keeps every source pixel it can use however wide or tall the
 * photo is. A crop over ICON_DECODE_LIMIT goes to ICON_WORKING_EDGE in its first draw, a larger shrink that the
 * halving steps after it smooth out, so no canvas over ICON_WORKING_EDGE is made.
 * 从边长为 `from` 个源图像素的裁剪区域绘制图标时依次经过的正方形边长，最后落在 `to`。只绘制裁剪区域，并直接取自解码后的图片，因此无论
 * 照片多宽多高，图标都保留所有可用的源图像素。超过 ICON_DECODE_LIMIT 的裁剪区域第一次绘制就画成 ICON_WORKING_EDGE，这一步缩小较多，
 * 由之后的减半步骤平滑，因此不会创建超过 ICON_WORKING_EDGE 的画布。
 */
export function iconDrawSides(from: number, to: number): number[] {
  if (from > ICON_DECODE_LIMIT) return [ICON_WORKING_EDGE, ...downscaleSteps(ICON_WORKING_EDGE, to)];
  return downscaleSteps(from, to);
}

export type IconEncoding = 'webp' | 'jpeg';

/**
 * Which encoding the upload uses, from the type of the blob the canvas returned for a WebP request: WebP when it
 * really is WebP, JPEG otherwise. Safari's canvas silently returns PNG for WebP, and the server checks the bytes.
 * 根据画布对 WebP 请求返回的 blob 类型决定上传所用的编码：确实是 WebP 时用 WebP，否则用 JPEG。Safari 的画布会悄悄把 WebP 换成 PNG，
 * 而服务器会检查字节。
 */
export function pickEncoding(blobType: string | null | undefined): IconEncoding {
  return blobType === 'image/webp' ? 'webp' : 'jpeg';
}

export function encodingType(encoding: IconEncoding): 'image/webp' | 'image/jpeg' {
  return encoding === 'webp' ? 'image/webp' : 'image/jpeg';
}

export function encodingQuality(encoding: IconEncoding): number {
  return encoding === 'webp' ? ICON_WEBP_QUALITY : ICON_JPEG_QUALITY;
}

/** File names of the two uploads; the server names the stored objects itself. */
/** 两个上传文件的文件名；服务器自行命名存储的对象。 */
export function iconFileName(encoding: IconEncoding, thumb: boolean): string {
  return `${thumb ? 'icon-96' : 'icon'}.${encoding === 'webp' ? 'webp' : 'jpg'}`;
}

/** type: not an image the picker offers. decode: the browser could not read it. encode: the canvas could not write it. */
/** type：不是选择器提供的图片类型。decode：浏览器无法读取。encode：画布无法写出。 */
export type IconImageProblem = 'type' | 'decode' | 'encode';

export class IconImageError extends Error {
  constructor(public readonly problem: IconImageProblem) {
    super(problem);
  }
}

/** What to tell the member when an image can't become an icon. */
/** 图片无法做成图标时给成员的提示。 */
export function iconProblemText(error: unknown, tr: (zh: string, en: string) => string): string {
  if (error instanceof IconImageError && error.problem === 'type') return tr('只支持 JPEG、PNG、WebP', 'Only JPEG, PNG, and WebP are supported.');
  return tr('图片无法读取，请换一张', "Couldn't read that image. Try another.");
}
