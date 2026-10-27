import {
  CHAT_IMAGE_TYPES,
  STICKER_ANIMATED_FRAMES_MAX,
  STICKER_ANIMATED_PIXELS_MAX,
  STICKER_DIMENSION_MAX,
  STICKER_MAX_BYTES,
  STICKER_MESSAGES,
  STICKER_MIME_TYPES,
  STICKER_STATIC_LONG_EDGE,
  STICKER_THUMB_DIMENSION_MAX,
  STICKER_THUMB_LONG_EDGE,
  STICKER_THUMB_MAX_BYTES,
  detectStickerType,
  sniffSticker,
  type SniffedSticker,
  type StickerType,
} from '@utmmsc/shared';
import { decodeImage, documentCanvas, releaseCanvas, type DrawingCanvas } from '../../../shared/media/canvas';
import { halvingSteps, scaleToLongEdge, type Size } from '../../../shared/media/sizing';
import { renderVariants } from '../../../shared/media/variants';
import type { Translate } from '../format/systemText';

/**
 * Prepares a picked or fetched image as a sticker before it is uploaded. The bytes decide everything (a picker can
 * give an empty type, and a chat photo's blob type is whatever its uploader declared): animated GIF, WebP and APNG
 * and small static files are kept byte for byte up to their real end; every other static file, and every JPEG, is
 * re-encoded at a 720 px long edge; each sticker gets a still of its first frame. The decisions are the pure
 * planStickerPrep, which the tests cover without a canvas. Nothing here runs at import time.
 * 在上传前把选中或下载的图片处理成表情。一切由字节决定（选择器可能给出空的类型，聊天图片 blob 的类型则是上传者声明的任意值）：
 * 动态 GIF、WebP、APNG 以及较小的静态文件按原样保留到其真正的结尾；其余静态文件以及所有 JPEG 按 720px 长边重新编码；
 * 每个表情都生成一张第一帧的静态图。判断逻辑在纯函数 planStickerPrep 中，测试无需画布即可覆盖。导入时不执行任何操作。
 */

/** Listing only these types makes iOS convert HEIC photos to JPEG when they are picked. */
/** 只列出这些类型，iOS 在选图时就会把 HEIC 照片转成 JPEG。 */
export const STICKER_PICK_ACCEPT = CHAT_IMAGE_TYPES.join(',');

/** Quality of a re-encoded static sticker, WebP where it may be transparent and JPEG otherwise. */
/** 重新编码的静态表情的质量：可能透明时用 WebP，否则用 JPEG。 */
export const STICKER_WEBP_QUALITY = 0.9;
export const STICKER_JPEG_QUALITY = 0.88;
/** Quality of the still, JPEG for opaque sources and WebP otherwise. */
/** 静态图的质量：不透明的来源用 JPEG，否则用 WebP。 */
export const STICKER_STILL_JPEG_QUALITY = 0.85;
export const STICKER_STILL_WEBP_QUALITY = 0.8;
/** A still over STICKER_THUMB_MAX_BYTES is made again this small, at this quality. */
/** 超过 STICKER_THUMB_MAX_BYTES 的静态图按这个尺寸和质量重新生成。 */
export const STICKER_STILL_RETRY_LONG_EDGE = 160;
export const STICKER_STILL_RETRY_QUALITY = 0.6;

export type StickerPrepProblem = 'type' | 'size' | 'dimensions' | 'frames' | 'invalid' | 'unsupported';

export class StickerPrepError extends Error {
  constructor(public readonly problem: StickerPrepProblem) {
    super(problem);
  }
}

/** The encoders a sticker copy can ask a canvas for. Safari answers a WebP request with PNG. */
/** 表情副本可以向画布请求的编码。Safari 会用 PNG 回应 WebP 请求。 */
export type StickerImageMime = 'image/jpeg' | 'image/webp' | 'image/png';

export interface StickerEncoding {
  mime: StickerImageMime;
  quality: number;
}

/** One copy to render: its long edge and encoding. */
/** 要生成的一份副本：长边和编码。 */
export interface StickerCopySpec extends StickerEncoding {
  longEdge: number;
}

/**
 * What to do with one file:
 * - refuse: a problem the member is told about;
 * - keep: upload the bytes as given, cut at `end`;
 * - render: upload a canvas copy, falling back to the bytes up to `fallbackEnd` when the canvas fails and the server
 *   would take them (null: no fallback).
 * Every plan that is not refused names the still's encoding.
 * 对一个文件的处理方式：
 * - refuse：告知成员的问题；
 * - keep：原样上传这些字节，截到 `end`；
 * - render：上传画布副本；画布失败且服务端能接受原字节时，退回到截到 `fallbackEnd` 的原字节（null 表示无法退回）。
 * 不被拒绝的方案都会指明静态图的编码。
 */
export type StickerPrepPlan =
  | { action: 'refuse'; problem: StickerPrepProblem }
  | { action: 'keep'; type: StickerType; end: number; still: StickerEncoding }
  | { action: 'render'; type: StickerType; encoding: StickerEncoding; fallbackEnd: number | null; still: StickerEncoding };

export interface StickerPrepInput {
  bytes: Uint8Array;
  /** Whether this browser's canvas encodes WebP. */
  /** 这个浏览器的画布能否编码 WebP。 */
  webp: boolean;
}

/** A static file that can be uploaded as it is: small enough on the long edge and in bytes. */
/** 可以原样上传的静态文件：长边和字节数都足够小。 */
function fitsStatic(sniffed: SniffedSticker): boolean {
  return Math.max(sniffed.width, sniffed.height) <= STICKER_STATIC_LONG_EDGE && sniffed.end <= STICKER_MAX_BYTES;
}

/** A static file the upload route would still accept, used only when the canvas cannot make a copy. */
/** 上传接口仍会接受的静态文件，只在画布无法生成副本时使用。 */
function fitsUpload(sniffed: SniffedSticker): boolean {
  return Math.max(sniffed.width, sniffed.height) <= STICKER_DIMENSION_MAX && sniffed.end <= STICKER_MAX_BYTES;
}

function copyEncoding(transparent: boolean, webp: boolean): StickerEncoding {
  if (!transparent) return { mime: 'image/jpeg', quality: STICKER_JPEG_QUALITY };
  return { mime: webp ? 'image/webp' : 'image/png', quality: STICKER_WEBP_QUALITY };
}

/**
 * JPEG for a source that cannot be transparent: Safari cannot encode WebP, and its PNG of a photo can pass 96 KB.
 * 不可能透明的来源用 JPEG：Safari 无法编码 WebP，而照片的 PNG 可能超过 96 KB。
 */
function stillEncoding(transparent: boolean, webp: boolean): StickerEncoding {
  if (!transparent) return { mime: 'image/jpeg', quality: STICKER_STILL_JPEG_QUALITY };
  return { mime: webp ? 'image/webp' : 'image/png', quality: STICKER_STILL_WEBP_QUALITY };
}

/**
 * Decides how one file becomes a sticker, from its bytes alone. A JPEG is always re-encoded, which applies its EXIF
 * rotation and drops anything after its end, so it needs no exact sniff; every other format must sniff cleanly.
 * Animated files are kept within the area, side, frame and byte limits and refused beyond them; a static file small
 * enough is kept; the rest is re-encoded.
 * 只根据字节决定一个文件如何变成表情。JPEG 总是重新编码，这会应用 EXIF 方向并丢掉结尾之后的内容，所以无需精确嗅探；
 * 其他格式必须嗅探成功。动图在面积、边长、帧数和字节数的上限内按原样保留，超出则拒绝；足够小的静态文件按原样保留；其余重新编码。
 */
export function planStickerPrep({ bytes, webp }: StickerPrepInput): StickerPrepPlan {
  const type = detectStickerType(bytes);
  if (!type) return { action: 'refuse', problem: 'type' };
  const sniffed = sniffSticker(bytes);
  // A real GIF far past 8 MB (a screen recording) runs out of sniff steps: the member is told the size, not that it
  // cannot be read. It is not rendered either, since a canvas would keep only the first frame of an animation.
  // 远超 8MB 的真实 GIF（例如录屏）会用尽嗅探步数：此时告诉成员大小超限，而不是无法识别。
  // 也不重新编码，因为画布只会保留动画的第一帧。
  if (type !== 'jpeg' && !sniffed) return { action: 'refuse', problem: bytes.length > STICKER_MAX_BYTES ? 'size' : 'invalid' };
  const transparent = type !== 'jpeg' && sniffed?.mayBeTransparent === true;
  const still = stillEncoding(transparent, webp);
  if (sniffed?.animated) {
    const area = sniffed.width * sniffed.height;
    if (area > STICKER_ANIMATED_PIXELS_MAX || Math.max(sniffed.width, sniffed.height) > STICKER_DIMENSION_MAX) return { action: 'refuse', problem: 'dimensions' };
    if (sniffed.frames > STICKER_ANIMATED_FRAMES_MAX) return { action: 'refuse', problem: 'frames' };
    if (sniffed.end > STICKER_MAX_BYTES) return { action: 'refuse', problem: 'size' };
    return { action: 'keep', type, end: sniffed.end, still };
  }
  if (type !== 'jpeg' && sniffed && fitsStatic(sniffed)) return { action: 'keep', type, end: sniffed.end, still };
  const fallbackEnd = type !== 'jpeg' && sniffed && fitsUpload(sniffed) ? sniffed.end : null;
  return { action: 'render', type, encoding: copyEncoding(transparent, webp), fallbackEnd, still };
}

/** What one sticker upload sends, and what its tile shows meanwhile. */
/** 一次表情上传发送的内容，以及其间图块显示的内容。 */
export interface PreparedSticker {
  file: Blob;
  thumb: Blob;
  /** Lowercase hex SHA-256 of exactly the bytes of `file`. */
  /** `file` 字节的 SHA-256，小写十六进制。 */
  sha256: string;
  thumbSha256: string;
  type: StickerType;
  width: number;
  height: number;
  animated: boolean;
  bytes: number;
  /** An object URL of the still for the upload tile; the store revokes it when the tile goes. */
  /** 上传图块使用的静态图对象 URL；图块消失时由 store 释放。 */
  previewUrl: string | null;
}

export interface StickerPrepDeps {
  /** One blob per spec, or null where the canvas could not make it; rejects when the image cannot be decoded. */
  /** 每个规格一个 blob，画布无法生成时为 null；图片无法解码时拒绝。 */
  render(source: Blob, specs: readonly StickerCopySpec[]): Promise<(Blob | null)[]>;
  webpEncodes(): boolean;
}

/** Lowercase hex SHA-256. Without crypto.subtle (a page on plain http) it rejects with the problem 'unsupported'. */
/** 小写十六进制的 SHA-256。没有 crypto.subtle（通过普通 http 打开的页面）时以问题 'unsupported' 拒绝。 */
export async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new StickerPrepError('unsupported');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function subtleAvailable(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

async function readBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** The sniff of a canvas copy the upload route will take as a sticker file, or null. */
/** 上传接口会作为表情文件接受的画布副本的嗅探结果；否则为 null。 */
function uploadableFile(bytes: Uint8Array): SniffedSticker | null {
  const sniffed = sniffSticker(bytes);
  if (!sniffed || sniffed.end !== bytes.length || bytes.length > STICKER_MAX_BYTES) return null;
  return Math.max(sniffed.width, sniffed.height) <= STICKER_DIMENSION_MAX ? sniffed : null;
}

/** The sniff of a still the upload route will take, or null. */
/** 上传接口会接受的静态图的嗅探结果；否则为 null。 */
function uploadableStill(bytes: Uint8Array): SniffedSticker | null {
  if (bytes.length > STICKER_THUMB_MAX_BYTES) return null;
  const sniffed = sniffSticker(bytes);
  if (!sniffed || sniffed.end !== bytes.length || sniffed.animated) return null;
  return Math.max(sniffed.width, sniffed.height) <= STICKER_THUMB_DIMENSION_MAX ? sniffed : null;
}

async function renderOrNothing(deps: StickerPrepDeps, source: Blob, specs: readonly StickerCopySpec[]): Promise<(Blob | null)[]> {
  try {
    return await deps.render(source, specs);
  } catch {
    // An image the canvas cannot decode: the caller decides whether the bytes as given can still go.
    // 画布无法解码的图片：由调用方决定原字节是否仍可上传。
    return specs.map(() => null);
  }
}

async function stillFrom(blob: Blob | null): Promise<{ bytes: Uint8Array<ArrayBuffer>; sniffed: SniffedSticker } | null> {
  if (!blob) return null;
  const bytes = await readBytes(blob);
  const sniffed = uploadableStill(bytes);
  return sniffed ? { bytes, sniffed } : null;
}

function objectUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/**
 * Prepares one image as a sticker (see planStickerPrep). Rejects with StickerPrepError: 'type' for a file that is
 * not JPEG, PNG, WebP or GIF by its bytes, 'invalid' for one that cannot be read or rendered, 'dimensions', 'frames'
 * and 'size' for an animated file over the limits ('size' also for an unreadable one over 8 MB), 'unsupported' where
 * the browser cannot hash.
 * 把一张图片处理成表情（见 planStickerPrep）。以 StickerPrepError 拒绝：按字节不是 JPEG、PNG、WebP、GIF 时为 'type'；
 * 无法读取或渲染时为 'invalid'；动图超出上限时为 'dimensions'、'frames' 和 'size'（无法读取且超过 8MB 时也为 'size'）；
 * 浏览器无法计算哈希时为 'unsupported'。
 */
export async function prepareSticker(source: Blob, overrides: Partial<StickerPrepDeps> = {}): Promise<PreparedSticker> {
  const deps: StickerPrepDeps = { render: overrides.render ?? renderStickerCopies, webpEncodes: overrides.webpEncodes ?? canvasEncodesWebp };
  const bytes = await readBytes(source);
  const plan = planStickerPrep({ bytes, webp: deps.webpEncodes() });
  if (plan.action === 'refuse') throw new StickerPrepError(plan.problem);
  // Checked before any canvas work, which would be wasted without a way to hash the result.
  // 在任何画布处理之前检查：无法计算哈希时，处理结果也用不上。
  if (!subtleAvailable()) throw new StickerPrepError('unsupported');

  const stillSpec: StickerCopySpec = { longEdge: STICKER_THUMB_LONG_EDGE, ...plan.still };
  let fileBytes: Uint8Array<ArrayBuffer> | null = null;
  let fileSniff: SniffedSticker | null = null;
  let stillBlob: Blob | null = null;
  if (plan.action === 'render') {
    const [copy = null, still = null] = await renderOrNothing(deps, source, [{ longEdge: STICKER_STATIC_LONG_EDGE, ...plan.encoding }, stillSpec]);
    const copyBytes = copy ? await readBytes(copy) : null;
    fileSniff = copyBytes ? uploadableFile(copyBytes) : null;
    if (copyBytes && fileSniff) fileBytes = copyBytes;
    else if (plan.fallbackEnd !== null) fileBytes = bytes.slice(0, plan.fallbackEnd);
    else throw new StickerPrepError('invalid');
    stillBlob = still;
  } else {
    fileBytes = bytes.slice(0, plan.end);
  }
  fileSniff ??= uploadableFile(fileBytes);
  if (!fileSniff) throw new StickerPrepError('invalid');
  const file = new Blob([fileBytes], { type: STICKER_MIME_TYPES[fileSniff.type] });

  let still = await stillFrom(stillBlob);
  if (!still) {
    const [made = null] = await renderOrNothing(deps, file, [stillSpec]);
    still = await stillFrom(made);
  }
  if (!still) {
    // Too many bytes at 240 px (a detailed transparent PNG on Safari): smaller and lossier once more.
    // 240px 时字节数太多（例如 Safari 上细节丰富的透明 PNG）：再缩小一次并降低质量。
    const [made = null] = await renderOrNothing(deps, file, [{ ...stillSpec, longEdge: STICKER_STILL_RETRY_LONG_EDGE, quality: STICKER_STILL_RETRY_QUALITY }]);
    still = await stillFrom(made);
  }
  if (!still) throw new StickerPrepError('invalid');
  const thumb = new Blob([still.bytes], { type: STICKER_MIME_TYPES[still.sniffed.type] });

  const [sha256, thumbSha256] = await Promise.all([sha256Hex(fileBytes), sha256Hex(still.bytes)]);
  return {
    file,
    thumb,
    sha256,
    thumbSha256,
    type: fileSniff.type,
    width: fileSniff.width,
    height: fileSniff.height,
    animated: fileSniff.animated,
    bytes: fileBytes.length,
    previewUrl: objectUrl(thumb),
  };
}

/** What a toast or a dropped tile says about a file that cannot be used. */
/** 文件无法使用时，提示或被移除的图块所说明的原因。 */
export function stickerProblemText(error: unknown, tr: Translate): string {
  const problem: StickerPrepProblem = error instanceof StickerPrepError ? error.problem : 'invalid';
  const mib = STICKER_MAX_BYTES / (1024 * 1024);
  switch (problem) {
    case 'type':
      return tr('只支持 JPEG、PNG、WebP、GIF', 'Only JPEG, PNG, WebP, and GIF images are supported.');
    case 'size':
      return tr(STICKER_MESSAGES.tooLarge, `Stickers must be ${mib} MB or smaller.`);
    case 'dimensions':
      return tr(STICKER_MESSAGES.animatedSize, `Animated stickers can be at most ${Math.sqrt(STICKER_ANIMATED_PIXELS_MAX)} pixels on each side.`);
    case 'frames':
      return tr(STICKER_MESSAGES.frames, `Animated stickers can have at most ${STICKER_ANIMATED_FRAMES_MAX} frames.`);
    case 'unsupported':
      return tr('当前浏览器无法添加表情', "This browser can't add stickers.");
    case 'invalid':
      return tr(STICKER_MESSAGES.unreadable, "That image couldn't be read.");
  }
}

/* Canvas work: browser only, reached from prepareSticker's default deps. */
/* 画布处理：仅在浏览器中运行，由 prepareSticker 的默认依赖调用。 */

let webpEncoding: boolean | null = null;

/** Whether this browser's canvas writes WebP (Safari writes PNG instead). Asked once per page. */
/** 这个浏览器的画布能否写出 WebP（Safari 会改写成 PNG）。每个页面只询问一次。 */
export function canvasEncodesWebp(): boolean {
  if (webpEncoding !== null) return webpEncoding;
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    webpEncoding = canvas.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    webpEncoding = false;
  }
  return webpEncoding;
}

async function encode(canvas: DrawingCanvas, mime: StickerImageMime, quality: number): Promise<Blob | null> {
  try {
    if ('convertToBlob' in canvas) return await canvas.convertToBlob({ type: mime, quality });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));
  } catch {
    // A tainted or lost canvas only costs this copy.
    // 画布被污染或丢失只会失去这一份副本。
    return null;
  }
}

/**
 * Draws `source` at `to` in halving steps on a clear canvas, so transparent pixels stay transparent (the shared
 * drawScaled paints white first, for JPEG). Returns the final canvas, which the caller releases, or null.
 * 以逐次减半的方式在透明画布上把 `source` 画成 `to`，透明像素因此保持透明（共用的 drawScaled 会先涂白，供 JPEG 使用）。
 * 返回最终的画布，由调用方释放；失败时为 null。
 */
function drawClear(source: CanvasImageSource, from: Size, to: Size): DrawingCanvas | null {
  let image: CanvasImageSource = source;
  let size = from;
  let owned: DrawingCanvas | null = null;
  for (const step of halvingSteps(from, to)) {
    const canvas = documentCanvas(step.width, step.height);
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!context) {
      releaseCanvas(canvas);
      if (owned) releaseCanvas(owned);
      return null;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size.width, size.height, 0, 0, step.width, step.height);
    if (owned) releaseCanvas(owned);
    owned = canvas;
    image = canvas;
    size = step;
  }
  return owned;
}

/**
 * Copies that keep transparency, on the main thread: decoded once, each later copy drawn from the previous one when
 * that is at least as large. Sticker copies are at most 720 px, so this stays short.
 * 保留透明度的副本，在主线程生成：只解码一次，之后的副本在上一份不小于它时从上一份绘制。表情副本最大 720px，所以耗时很短。
 */
async function renderClear(source: Blob, specs: readonly StickerCopySpec[]): Promise<(Blob | null)[]> {
  const decoded = await decodeImage(source);
  // Declared through a cast so the loop below does not narrow it to null.
  // 通过类型断言声明，下面的循环因此不会把它收窄为 null。
  let previous = null as DrawingCanvas | null;
  try {
    const outputs: (Blob | null)[] = [];
    for (const spec of specs) {
      const size = scaleToLongEdge(decoded, spec.longEdge);
      const from: DrawingCanvas | null = previous && previous.width >= size.width && previous.height >= size.height ? previous : null;
      const canvas: DrawingCanvas | null = from ? drawClear(from, { width: from.width, height: from.height }, size) : drawClear(decoded.source, decoded, size);
      if (!canvas) {
        outputs.push(null);
        continue;
      }
      outputs.push(await encode(canvas, spec.mime, spec.quality));
      if (previous) releaseCanvas(previous);
      previous = canvas;
    }
    return outputs;
  } finally {
    if (previous) releaseCanvas(previous);
    decoded.release();
  }
}

/**
 * Renders sticker copies. Opaque copies (all JPEG) go to the shared resize worker, whose white background changes
 * nothing for them; copies that may be transparent are drawn on a clear canvas here.
 * 生成表情副本。不透明的副本（全部为 JPEG）交给共用的缩放 Worker，它的白色背景对这些副本没有影响；可能透明的副本在这里画在透明画布上。
 */
export async function renderStickerCopies(source: Blob, specs: readonly StickerCopySpec[]): Promise<(Blob | null)[]> {
  if (specs.every((spec) => spec.mime === 'image/jpeg')) {
    const rendered = await renderVariants(
      source,
      specs.map((spec) => ({ longEdge: spec.longEdge, type: 'image/jpeg' as const, quality: spec.quality })),
    );
    return specs.map((_, i) => rendered.outputs[i]?.blob ?? null);
  }
  return renderClear(source, specs);
}
