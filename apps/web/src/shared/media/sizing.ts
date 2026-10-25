/**
 * Pure size arithmetic for resizing images on the device: fitting a long edge, a centred square crop, and the
 * halving steps a large downscale goes through. Nothing here touches the DOM, so it runs in Node tests and in the
 * resize worker.
 * 在设备上缩放图片的纯尺寸计算：按长边适配、居中正方形裁切，以及大幅缩小时经过的减半步骤。这里不访问 DOM，
 * 因此可以在 Node 测试和缩放 Worker 中运行。
 */

export interface Size {
  width: number;
  height: number;
}

/** A rectangle of the source, in source pixels. */
/** 源图中的一个矩形，单位为源图像素。 */
export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Output types every browser canvas can encode. Safari turns a WebP request into PNG, so callers check blob.type. */
/** 所有浏览器画布都能编码的输出类型。Safari 会把 WebP 请求变成 PNG，因此调用方要检查 blob.type。 */
export type VariantType = 'image/jpeg' | 'image/webp';

/** One resized copy of an image. */
/** 图片的一份缩放副本。 */
export interface VariantSpec {
  /** Long edge of the output in pixels; the source is never scaled up. */
  /** 输出的长边像素数；源图不会被放大。 */
  longEdge: number;
  /** A very wide or tall image is scaled less, so its short edge keeps at least this many pixels. */
  /** 很宽或很高的图片缩得少一些，使短边至少保留这么多像素。 */
  shortEdgeMin?: number;
  /** Upper bound on the long edge when shortEdgeMin asks for a larger copy. */
  /** shortEdgeMin 要求更大的副本时，长边的上限。 */
  longEdgeMax?: number;
  /** Centre-crop to a square before scaling. */
  /** 缩放前先居中裁成正方形。 */
  square?: boolean;
  /** No copy is made when the source already fits within longEdge; the caller keeps the original. */
  /** 源图已在 longEdge 以内时不生成副本，由调用方保留原图。 */
  onlyWhenLarger?: boolean;
  type: VariantType;
  quality: number;
}

export interface VariantPlan {
  crop: CropRect;
  size: Size;
}

export function isUsableSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
}

/** The whole source as a crop rectangle. */
/** 把整张源图作为裁切矩形。 */
export function fullRect(size: Size): CropRect {
  return { sx: 0, sy: 0, sw: size.width, sh: size.height };
}

/** The largest centred square of the source. */
/** 源图中最大的居中正方形。 */
export function centredSquare(size: Size): CropRect {
  const side = Math.min(size.width, size.height);
  return { sx: (size.width - side) / 2, sy: (size.height - side) / 2, sw: side, sh: side };
}

/** Scaled so the long edge is at most longEdge, keeping the ratio; never scaled up, never below 1px. */
/** 按比例缩小到长边不超过 longEdge；不放大，也不小于 1px。 */
export function scaleToLongEdge(size: Size, longEdge: number): Size {
  const long = Math.max(size.width, size.height);
  const scale = long > longEdge ? longEdge / long : 1;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/**
 * Where a variant comes from in the source and how large it is, or null when onlyWhenLarger finds the source already
 * small enough (or the source size is unusable).
 * 一个副本取自源图的哪一部分、尺寸多大；onlyWhenLarger 发现源图已经够小（或源图尺寸不可用）时为 null。
 */
export function planVariant(source: Size, spec: VariantSpec): VariantPlan | null {
  if (!isUsableSize(source.width, source.height)) return null;
  const crop = spec.square ? centredSquare(source) : fullRect(source);
  const long = Math.max(crop.sw, crop.sh);
  const short = Math.min(crop.sw, crop.sh);
  if (spec.onlyWhenLarger && long <= spec.longEdge) return null;
  let scale = Math.min(1, spec.longEdge / long);
  if (spec.shortEdgeMin && short * scale < spec.shortEdgeMin) scale = Math.min(1, spec.shortEdgeMin / short);
  if (spec.longEdgeMax && long * scale > spec.longEdgeMax) scale = Math.min(scale, spec.longEdgeMax / long);
  return { crop, size: { width: Math.max(1, Math.round(crop.sw * scale)), height: Math.max(1, Math.round(crop.sh * scale)) } };
}

/**
 * The sizes a downscale draws through: halved while the next half is still at least the target, then the target.
 * One large step skips source pixels and looks jagged; halving keeps every pixel in the average. Upscales and
 * small steps are a single draw.
 * 缩小过程依次绘制的尺寸：只要下一半仍不小于目标就减半，最后是目标尺寸。一次大幅缩小会跳过源像素、出现锯齿；
 * 逐次减半让每个像素都参与平均。放大和小幅缩小只画一次。
 */
export function halvingSteps(from: Size, to: Size): Size[] {
  const steps: Size[] = [];
  let width = from.width;
  let height = from.height;
  while (width / 2 >= to.width && height / 2 >= to.height && (width / 2 > to.width || height / 2 > to.height)) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    steps.push({ width, height });
  }
  const last = steps[steps.length - 1];
  if (!last || last.width !== to.width || last.height !== to.height) steps.push({ width: to.width, height: to.height });
  return steps;
}

/**
 * Output size of a crop drawn into a frame of the given shape: as wide as the source pixels it covers, but no wider
 * than maxWidth, so a cover is never scaled up and never larger than the screen needs.
 * 把裁切区域画进给定形状的画框时的输出尺寸：宽度等于它覆盖的源像素，但不超过 maxWidth，因此封面不会被放大，也不会大于屏幕所需。
 */
export function cropOutputSize(sourceWidth: number, frame: Size, maxWidth: number): Size {
  if (!isUsableSize(frame.width, frame.height) || !(sourceWidth > 0)) return { width: 1, height: 1 };
  const width = Math.max(1, Math.min(maxWidth, Math.round(sourceWidth)));
  return { width, height: Math.max(1, Math.round(width * (frame.height / frame.width))) };
}
