import { CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_TYPES } from '@utmmsc/shared';
import { decodeImage, documentCanvas, drawScaled, encodeCanvas, releaseCanvas, type RenderedVariants } from '../../../shared/media/canvas';
import { fullRect, type VariantSpec } from '../../../shared/media/sizing';
import { renderVariants } from '../../../shared/media/variants';
import { readImageTraits, type ImageTraits } from './imageTraits';

/**
 * Prepares picked photos before they are queued: reads their size with EXIF orientation applied and
 * shrinks large non-GIF images to a JPEG the server accepts. Before upload, chat photos are also re-encoded
 * at a 2048px long edge and given a 360px thumbnail for the message rows, except where a canvas copy would lose
 * their animation or transparency (see chatCopiesFor). Nothing here runs at import time.
 * 在排队发送前处理选中的照片：按 EXIF 方向读取尺寸，并把过大的非 GIF 图片缩成服务端接受的 JPEG。
 * 上传前，聊天照片还会按 2048px 长边重新编码，并生成供消息行使用的 360px 缩略图，画布副本会丢掉动画或透明效果的情况除外（见 chatCopiesFor）。
 * 导入时不执行任何操作。
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

/** The stored chat photo: a 2048px long edge is plenty for a phone screen, about 450 to 520KB for a 12MP photo. */
/** 存储的聊天照片：2048px 长边足够手机屏幕使用，1200 万像素的照片约 450 到 520KB。 */
export const CHAT_MAIN_LONG_EDGE = 2048;
export const CHAT_MAIN_QUALITY = 0.82;
/** The message row's copy: rows are at most 180px, so 360px covers a 2x screen, about 40KB. */
/** 消息行使用的副本：消息行最大 180px，360px 足够 2 倍屏，约 40KB。 */
export const CHAT_THUMB_LONG_EDGE = 360;
export const CHAT_THUMB_QUALITY = 0.75;
/** A very wide or tall photo keeps a 120px short edge, since its row shows a 60px-high centre crop. */
/** 很宽或很高的照片保留 120px 的短边，因为它的消息行显示 60px 高的居中裁切。 */
export const CHAT_THUMB_SHORT_MIN = 120;
export const CHAT_THUMB_LONG_MAX = 1080;
/** A thumbnail with this share of the main image's bytes or more saves nothing, so it is dropped. */
/** 缩略图的字节数达到主图的这个比例或更多时毫无节省，因此不用。 */
export const THUMB_WORTH_RATIO = 0.8;
/**
 * A PNG or WebP that may be transparent and is no larger than this is taken for a sticker. Larger ones are most often
 * screenshots, whose alpha channel is there but unused.
 * 可能带透明、且不大于这个尺寸的 PNG 或 WebP 视为表情图。更大的通常是截图，带透明通道但并未使用。
 */
export const CHAT_STICKER_LONG_EDGE = 1024;

export const CHAT_MAIN_VARIANT: VariantSpec = { longEdge: CHAT_MAIN_LONG_EDGE, onlyWhenLarger: true, type: 'image/jpeg', quality: CHAT_MAIN_QUALITY };
export const CHAT_THUMB_VARIANT: VariantSpec = {
  longEdge: CHAT_THUMB_LONG_EDGE,
  shortEdgeMin: CHAT_THUMB_SHORT_MIN,
  longEdgeMax: CHAT_THUMB_LONG_MAX,
  onlyWhenLarger: true,
  type: 'image/jpeg',
  quality: CHAT_THUMB_QUALITY,
};

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

/** What is uploaded for one chat photo. Width and height are null when the main image is the file as picked. */
/** 一张聊天照片实际上传的内容。主图就是所选文件本身时，宽高为 null。 */
export interface ChatUpload {
  main: Blob;
  thumb: Blob | null;
  width: number | null;
  height: number | null;
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

async function encodeJpeg(source: CanvasImageSource, from: ImageSize, size: ImageSize): Promise<Blob | null> {
  const canvas = drawScaled(source, fullRect(from), size, documentCanvas);
  if (!canvas) return null;
  try {
    return await encodeCanvas(canvas, 'image/jpeg', JPEG_QUALITY);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Reads the size and shrinks the image when needed. Rejects with ImagePrepError. */
/** 读取尺寸并在需要时缩小图片。失败时以 ImagePrepError 拒绝。 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const problem = checkImageFile(file);
  if (problem) throw new ImagePrepError(problem);
  let decoded: Awaited<ReturnType<typeof decodeImage>>;
  try {
    decoded = await decodeImage(file);
  } catch {
    throw new ImagePrepError('invalid');
  }
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new ImagePrepError('invalid');
    let plan = planDownscale(decoded.width, decoded.height, file.size, file.type);
    if (!plan) return { file, width: decoded.width, height: decoded.height };
    for (let attempt = 0; attempt < ENCODE_ATTEMPTS; attempt += 1) {
      const blob = await encodeJpeg(decoded.source, decoded, plan);
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

/**
 * Whether a photo needs resized copies before upload. GIFs never do, since the row should animate and a canvas
 * would drop the animation; nor does a photo already no larger than the thumbnail.
 * 照片在上传前是否需要缩放副本。GIF 永远不需要，因为消息行应当播放动画，而画布会丢掉动画；本身不大于缩略图的照片也不需要。
 */
export function needsChatVariants(type: string, size?: ImageSize | null): boolean {
  if (type === 'image/gif') return false;
  if (size && size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= CHAT_THUMB_LONG_EDGE) return false;
  return true;
}

/** Which canvas copies to make of a chat photo: both, only the thumbnail, or none. */
/** 为聊天照片生成哪些画布副本：两者都生成、只生成缩略图，或都不生成。 */
export type ChatCopies = 'both' | 'thumb' | 'none';

/**
 * A canvas copy keeps only the first frame of an animated WebP or APNG and draws transparent pixels on white. So an
 * animated image gets no copies, at any size, and goes as picked, as GIFs do; so does a possibly transparent sticker.
 * A larger possibly transparent image still gets a thumbnail for its row, but keeps its original as the main image,
 * so nothing is lost for good. Formats the header reader does not know (JPEG) get both copies.
 * 画布副本只保留动态 WebP 或 APNG 的第一帧，并把透明像素画在白底上。因此动图无论多大都不生成副本，与 GIF 一样按选中时的样子发送；
 * 可能带透明的表情图也是如此。更大的、可能带透明的图片仍会为消息行生成缩略图，但主图保留原图，不会永久丢失任何内容。
 * 文件头读取不识别的格式（JPEG）两种副本都生成。
 */
export function chatCopiesFor(traits: ImageTraits | null, size?: ImageSize | null): ChatCopies {
  if (!traits) return 'both';
  if (traits.mayAnimate) return 'none';
  if (!traits.mayBeTransparent) return 'both';
  // Without a size the photo is taken for a sticker, which is the choice that changes nothing.
  // 不知道尺寸时视为表情图，这样不会改变任何内容。
  const sticker = !size || Math.max(size.width, size.height) <= CHAT_STICKER_LONG_EDGE;
  return sticker ? 'none' : 'thumb';
}

/**
 * Picks what to upload from the rendered copies. The 2048px copy replaces the original only when it is smaller in
 * bytes (or the original is over the limit); the thumbnail is kept only when it saves a real share of the bytes.
 * 从生成的副本中选出要上传的内容。2048px 的副本只有在字节数更小（或原图超过上限）时才替换原图；缩略图只有在确实节省字节时才保留。
 */
export function chooseChatUpload(original: Blob, rendered: Pick<RenderedVariants, 'outputs'>): ChatUpload {
  const [main = null, thumb = null] = rendered.outputs;
  const useMain = main !== null && (main.blob.size < original.size || original.size > CHAT_IMAGE_MAX_BYTES);
  const mainBlob = useMain ? main.blob : original;
  const thumbBlob = thumb !== null && thumb.blob.size < mainBlob.size * THUMB_WORTH_RATIO ? thumb.blob : null;
  return { main: mainBlob, thumb: thumbBlob, width: useMain ? main.width : null, height: useMain ? main.height : null };
}

/**
 * The main image and thumbnail to upload for a picked chat photo, made in the resize worker where possible. Animated
 * images and possibly transparent stickers go as they were picked, so their rows keep animating and stay see-through
 * (chatCopiesFor). Never rejects: when the copies cannot be made, the photo goes as it was picked, without a thumbnail.
 * 为选中的聊天照片生成要上传的主图和缩略图，尽量在缩放 Worker 中完成。动图和可能带透明的表情图按选中时的样子发送，
 * 消息行因此仍会播放动画、保持透明（见 chatCopiesFor）。永不拒绝：无法生成副本时，照片按选中时的样子发送，不带缩略图。
 */
export async function prepareChatUpload(file: Blob, size?: ImageSize | null): Promise<ChatUpload> {
  const asPicked: ChatUpload = { main: file, thumb: null, width: null, height: null };
  if (!needsChatVariants(file.type, size)) return asPicked;
  // Only the first bytes are read, which costs next to nothing beside a decode.
  // 只读取开头的字节，与解码相比几乎没有开销。
  const copies = chatCopiesFor(await readImageTraits(file), size);
  if (copies === 'none') return asPicked;
  try {
    if (copies === 'thumb') {
      const [thumb = null] = (await renderVariants(file, [CHAT_THUMB_VARIANT])).outputs;
      return chooseChatUpload(file, { outputs: [null, thumb] });
    }
    return chooseChatUpload(file, await renderVariants(file, [CHAT_MAIN_VARIANT, CHAT_THUMB_VARIANT]));
  } catch {
    // Only the saving is lost; the composer already checked that the file itself can be sent.
    // 只是失去了节省；输入框已经确认过文件本身可以发送。
    return asPicked;
  }
}
