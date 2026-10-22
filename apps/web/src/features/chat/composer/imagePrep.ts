import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_TYPES } from '@utmmsc/shared';

/**
 * Prepares picked photos before they are queued: reads their size with EXIF orientation applied and
 * shrinks large non-GIF images to a JPEG the server accepts. Nothing here runs at import time.
 * 在排队发送前处理选中的照片：按 EXIF 方向读取尺寸，并把过大的非 GIF 图片缩成服务端接受的 JPEG。导入时不执行任何操作。
 */

/** Listing only these types makes iOS convert HEIC photos to JPEG when they are picked. */
/** 只列出这些类型，iOS 在选图时就会把 HEIC 照片转成 JPEG。 */
export const IMAGE_PICK_ACCEPT = CHAT_IMAGE_TYPES.join(',');
export const IMAGES_PER_PICK_MAX = 9;
export const IMAGE_LONG_EDGE_MAX = 4096;
export const JPEG_QUALITY = 0.85;
/** Each retry shrinks both edges by this factor when the JPEG is still over the byte limit. */
/** JPEG 仍超过字节上限时，每次重试把两条边都按此比例缩小。 */
const RETRY_SCALE = 0.75;
const ENCODE_ATTEMPTS = 3;

export type ImageProblem = 'type' | 'size' | 'invalid';

export class ImagePrepError extends Error {
  constructor(public readonly problem: ImageProblem) {
    super(problem);
  }
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface PreparedImage extends ImageSize {
  file: File;
}

/** Problems that can be told from the file alone. A non-GIF over the byte limit is shrunk instead. */
/** 仅凭文件本身就能判断的问题。超过字节上限的非 GIF 图片会被缩小，而不是拒绝。 */
export function checkImageFile(file: { type: string; size: number }): ImageProblem | null {
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.type === 'image/gif' && file.size > CHAT_IMAGE_MAX_BYTES) return 'size';
  return null;
}

/**
 * Target size for re-encoding, or null to send the file as it is. GIFs are never re-encoded, because a
 * canvas would drop the animation. Anything over the byte limit or with a long edge over 4096px is
 * re-encoded, scaled so the long edge is at most 4096px.
 * 重新编码的目标尺寸；返回 null 表示原样发送。GIF 从不重新编码，因为画布会丢掉动画。
 * 超过字节上限或长边超过 4096px 的图片会重新编码，并缩放到长边不超过 4096px。
 */
export function planDownscale(width: number, height: number, bytes: number, type: string): ImageSize | null {
  if (type === 'image/gif') return null;
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) return null;
  const longEdge = Math.max(width, height);
  if (bytes <= CHAT_IMAGE_MAX_BYTES && longEdge <= IMAGE_LONG_EDGE_MAX) return null;
  const scale = longEdge > IMAGE_LONG_EDGE_MAX ? IMAGE_LONG_EDGE_MAX / longEdge : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function shrinkForRetry(size: ImageSize): ImageSize {
  return { width: Math.max(1, Math.round(size.width * RETRY_SCALE)), height: Math.max(1, Math.round(size.height * RETRY_SCALE)) };
}

export function jpegFileName(name: string): string {
  const base = name.replace(/\.[^./\\]*$/, '').trim();
  return `${base || 'image'}.jpg`;
}

interface Decoded extends ImageSize {
  source: CanvasImageSource;
  release: () => void;
}

function decodeWithImageElement(file: Blob): Promise<Decoded> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve({ source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImagePrepError('invalid'));
    };
    image.src = url;
  });
}

async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Older engines reject the option or the format; an img element still applies EXIF orientation.
      // 较旧的引擎不支持该选项或格式；img 元素同样会应用 EXIF 方向。
    }
  }
  return decodeWithImageElement(file);
}

async function encodeJpeg(source: CanvasImageSource, size: ImageSize): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  // JPEG has no alpha channel, so transparent areas become white rather than black.
  // JPEG 没有透明通道，透明区域填为白色而不是黑色。
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, size.width, size.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  // Releasing the backing store right away matters on iOS, which caps total canvas memory.
  // 立即释放画布内存，这在限制画布总内存的 iOS 上很重要。
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/** Reads the size and shrinks the image when needed. Rejects with ImagePrepError. */
/** 读取尺寸并在需要时缩小图片。失败时以 ImagePrepError 拒绝。 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const problem = checkImageFile(file);
  if (problem) throw new ImagePrepError(problem);
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new ImagePrepError('invalid');
  }
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new ImagePrepError('invalid');
    let plan = planDownscale(decoded.width, decoded.height, file.size, file.type);
    if (!plan) return { file, width: decoded.width, height: decoded.height };
    for (let attempt = 0; attempt < ENCODE_ATTEMPTS; attempt += 1) {
      const blob = await encodeJpeg(decoded.source, plan);
      if (!blob) break;
      if (blob.size <= CHAT_IMAGE_MAX_BYTES) return { file: new File([blob], jpegFileName(file.name), { type: 'image/jpeg' }), width: plan.width, height: plan.height };
      plan = shrinkForRetry(plan);
    }
    // The canvas failed, but an original within the byte limit can still be sent as it is.
    // 画布处理失败，但未超过字节上限的原图仍可原样发送。
    if (file.size <= CHAT_IMAGE_MAX_BYTES) return { file, width: decoded.width, height: decoded.height };
    throw new ImagePrepError('size');
  } finally {
    decoded.release();
  }
}
