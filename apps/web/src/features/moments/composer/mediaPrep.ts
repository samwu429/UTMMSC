import {
  MOMENT_IMAGE_LIMIT,
  MOMENT_IMAGE_TYPES,
  MOMENT_MEDIA_DIMENSION_MAX,
  MOMENT_PREVIEW_LONG_EDGE,
  MOMENT_VIDEO_DURATION_MAX_MS,
  MOMENT_VIDEO_MAX_BYTES,
  MOMENT_VIDEO_TYPES,
} from '@utmmsc/shared';
import { IMAGE_PICK_ACCEPT, ImagePrepError, prepareImage, type ImageSize } from '../../chat/composer/imagePrep';

/**
 * Turns picked files into what a post uploads: which files a pick keeps (nine photos or one video, never
 * mixed, a video at most 25MB), each photo through the chat's prepareImage plus a 720px JPEG preview, and each
 * video's size, length and first frame. The pure parts are tested in Node; the canvas and video parts run only
 * when called, never at import time.
 * 把选中的文件变成动态要上传的内容：一次选择保留哪些文件（九张照片或一个视频，不能混发，视频不超过 25MB），每张照片经聊天的
 * prepareImage 处理并生成 720px 的 JPEG 预览图，以及每个视频的尺寸、时长和第一帧。纯函数部分在 Node 中测试；画布和视频部分只在调用时运行，
 * 导入时不执行。
 */

export type MediaKind = 'image' | 'video';

/** Quality of the 720px preview JPEG. */
/** 720px 预览图 JPEG 的质量。 */
export const PREVIEW_JPEG_QUALITY = 0.8;
/** The video frame used as its preview, in seconds; the very first frame is often black. */
/** 用作视频预览图的画面位置（秒）；最开头的一帧常常是黑的。 */
export const VIDEO_FRAME_AT_S = 0.1;
/** A video that has not reported its size by then is uploaded without one. */
/** 超过这个时间仍未报告尺寸的视频，不带尺寸上传。 */
const VIDEO_METADATA_TIMEOUT_MS = 8000;
/** A frame that has not been decoded by then leaves the video without a preview (a dark tile with the glyph). */
/** 超过这个时间仍未解码出画面，视频就不带预览图（显示深色图块和播放标志）。 */
const VIDEO_FRAME_TIMEOUT_MS = 4000;

/** 拍照: listing only these types makes iOS convert HEIC photos to JPEG. */
/** 拍照：只列出这些类型，iOS 会把 HEIC 照片转成 JPEG。 */
export const PHOTO_CAPTURE_ACCEPT = IMAGE_PICK_ACCEPT;
/** 录像: any camera format; one the server does not take is refused when picked. */
/** 录像：接受相机的任何格式；服务器不接受的格式在选中时拒绝。 */
export const VIDEO_CAPTURE_ACCEPT = 'video/*';
/** 从相册选择: photos plus MP4, MOV and WebM. */
/** 从相册选择：照片以及 MP4、MOV、WebM。 */
export const LIBRARY_ACCEPT = [IMAGE_PICK_ACCEPT, ...MOMENT_VIDEO_TYPES].join(',');

const BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
};

/**
 * The content type a picked file is uploaded as. Some Android pickers leave File.type empty or generic, and
 * some report image/jpg, so the extension decides then. An empty string means a type nothing here accepts.
 * 选中的文件上传时使用的内容类型。部分安卓选择器不填 File.type 或只给出通用类型，有的报告 image/jpg，此时按扩展名判断。
 * 空字符串表示这里不接受的类型。
 */
export function pickedContentType(file: { type: string; name: string }): string {
  const type = file.type.trim().toLowerCase();
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (type && type !== 'application/octet-stream') return mediaKindOf(type) ? type : '';
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? '';
  return BY_EXTENSION[extension] ?? '';
}

export function mediaKindOf(contentType: string): MediaKind | null {
  if ((MOMENT_IMAGE_TYPES as readonly string[]).includes(contentType)) return 'image';
  if ((MOMENT_VIDEO_TYPES as readonly string[]).includes(contentType)) return 'video';
  return null;
}

/** A picked file the composer keeps, with the type it is uploaded as. */
/** 编辑器保留的选中文件，以及上传时使用的类型。 */
export interface PickedMedia {
  file: File;
  kind: MediaKind;
  contentType: string;
}

/**
 * Why part of a pick was left out. mixed: 照片和视频不能发在同一条里. video_too_large: over 25MB. too_many: past
 * nine photos. one_video: a second video. unsupported: a type the server does not take.
 * 一次选择中部分文件被舍弃的原因。mixed：照片和视频不能发在同一条里。video_too_large：超过 25MB。too_many：超过九张照片。
 * one_video：第二个视频。unsupported：服务器不接受的类型。
 */
export type PickProblem = 'mixed' | 'video_too_large' | 'too_many' | 'one_video' | 'unsupported';

export interface PickPlan {
  accepted: PickedMedia[];
  /** Each problem once, in the order met. */
  /** 每种问题只出现一次，按遇到的顺序。 */
  problems: PickProblem[];
}

/**
 * Which files of a pick join the tiles already there. Existing tiles decide the kind; an empty composer takes
 * photos when the pick has any (mixed picks keep the photos), otherwise its first video.
 * 一次选择中哪些文件加入已有的图块。已有图块决定类型；编辑器为空时，只要选择中有照片就保留照片（混选时保留照片），否则取第一个视频。
 */
export function planPick(files: readonly File[], existing: { kind: MediaKind | null; count: number }): PickPlan {
  const problems: PickProblem[] = [];
  const note = (problem: PickProblem) => {
    if (!problems.includes(problem)) problems.push(problem);
  };
  const typed: PickedMedia[] = [];
  for (const file of files) {
    const contentType = pickedContentType(file);
    const kind = mediaKindOf(contentType);
    if (!kind) note('unsupported');
    else typed.push({ file: withContentType(file, contentType), kind, contentType });
  }
  const kind: MediaKind | null = existing.count > 0 && existing.kind ? existing.kind : typed.some((item) => item.kind === 'image') ? 'image' : typed.length ? 'video' : null;
  const accepted: PickedMedia[] = [];
  if (kind === 'image') {
    let room = MOMENT_IMAGE_LIMIT - existing.count;
    for (const item of typed) {
      if (item.kind !== 'image') note('mixed');
      else if (room <= 0) note('too_many');
      else {
        accepted.push(item);
        room -= 1;
      }
    }
  } else if (kind === 'video') {
    let room = existing.count > 0 ? 0 : 1;
    for (const item of typed) {
      if (item.kind !== 'video') note('mixed');
      else if (room <= 0) note('one_video');
      else if (item.file.size > MOMENT_VIDEO_MAX_BYTES) note('video_too_large');
      else {
        accepted.push(item);
        room -= 1;
      }
    }
  }
  return { accepted, problems };
}

/** The file itself when its type is already right, otherwise the same bytes labelled with the type to upload. */
/** 类型已正确时返回文件本身，否则返回标注为上传类型的同一份数据。 */
function withContentType(file: File, contentType: string): File {
  if (file.type === contentType) return file;
  return new File([file], file.name, { type: contentType, lastModified: file.lastModified });
}

export type Translate = (zh: string, en: string) => string;

/** What a toast says about a pick problem. */
/** 选择问题对应的提示文字。 */
export function pickProblemText(problem: PickProblem, tr: Translate): string {
  switch (problem) {
    case 'mixed':
      return tr('照片和视频不能发在同一条里', "Photos and a video can't share one post");
    case 'video_too_large':
      return tr('视频不能超过 25MB，可以先在相册里剪短', 'Videos must be 25 MB or less. Trim it in your library first');
    case 'too_many':
      return tr(`最多 ${MOMENT_IMAGE_LIMIT} 张照片`, `Up to ${MOMENT_IMAGE_LIMIT} photos`);
    case 'one_video':
      return tr('一条动态只能有一个视频', 'One video per post');
    case 'unsupported':
      return tr('只支持 JPEG、PNG、WebP、GIF 照片，或 MP4、MOV、WebM 视频', 'Only JPEG, PNG, WebP or GIF photos, or MP4, MOV or WebM videos');
  }
}

/** What a toast says when a picked photo or video could not be prepared; the tile is dropped. */
/** 选中的照片或视频无法处理时的提示文字；对应的图块会被移除。 */
export function prepProblemText(error: unknown, tr: Translate): string {
  const problem = error instanceof ImagePrepError ? error.problem : 'invalid';
  if (problem === 'type') return pickProblemText('unsupported', tr);
  if (problem === 'size') return tr('照片不能超过 8MB', 'Photos must be 8 MB or less');
  return tr('有照片或视频无法使用，请重新选择', "A photo or video can't be used. Choose it again");
}

/** The size scaled down so the long edge is at most `longEdge`; never scaled up. */
/** 缩小到长边不超过 `longEdge` 的尺寸；不会放大。 */
export function previewSize(width: number, height: number, longEdge: number = MOMENT_PREVIEW_LONG_EDGE): ImageSize {
  const long = Math.max(width, height);
  if (!(width > 0 && height > 0) || long <= longEdge) return { width: Math.max(1, Math.round(width) || 1), height: Math.max(1, Math.round(height) || 1) };
  const scale = longEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A photo gets its own preview unless it already is one: a JPEG no larger than the preview. A GIF always
 * gets one, because the grid shows its first frame still and only the viewer animates it.
 * 照片需要单独的预览图，除非它本身就符合预览图的要求：不大于预览尺寸的 JPEG。GIF 总是需要，因为网格中显示静止的第一帧，只有查看器才播放动画。
 */
export function needsPhotoPreview(contentType: string, width: number, height: number): boolean {
  if (contentType === 'image/gif') return true;
  return !(contentType === 'image/jpeg' && Math.max(width, height) <= MOMENT_PREVIEW_LONG_EDGE);
}

/** A width or height the server takes (an integer 1..20000), otherwise null so the field is left out. */
/** 服务器接受的宽度或高度（1..20000 的整数）；否则为 null，不发送该字段。 */
export function validDimension(value: number): number | null {
  const rounded = Math.round(value);
  return Number.isFinite(value) && rounded >= 1 && rounded <= MOMENT_MEDIA_DIMENSION_MAX ? rounded : null;
}

/** A video length in ms the server takes (0..10 min), otherwise null; streams report Infinity or NaN. */
/** 服务器接受的视频时长（毫秒，0..10 分钟）；否则为 null。流式视频会报告 Infinity 或 NaN。 */
export function validDurationMs(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const ms = Math.round(seconds * 1000);
  return ms <= MOMENT_VIDEO_DURATION_MAX_MS ? ms : null;
}

/** A picked file ready to upload, with the facts the post records about it. */
/** 可以上传的选中文件，以及动态为它记录的信息。 */
export interface PreparedMedia {
  kind: MediaKind;
  contentType: string;
  /** What is uploaded: the photo as prepareImage left it, or the video itself. */
  /** 要上传的内容：经 prepareImage 处理后的照片，或视频本身。 */
  file: Blob;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  /** The 720px JPEG, or null when the original serves as its own preview or none could be made. */
  /** 720px 的 JPEG；原图本身可作预览图或无法生成时为 null。 */
  preview: Blob | null;
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

async function decodeImage(file: Blob): Promise<Decoded> {
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

/** Draws `source` at the preview size and encodes it as JPEG; null when the canvas fails. */
/** 按预览尺寸绘制 `source` 并编码为 JPEG；画布失败时为 null。 */
async function encodePreview(source: CanvasImageSource, width: number, height: number): Promise<Blob | null> {
  const size = previewSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    // JPEG has no alpha channel, so transparent areas become white rather than black.
    // JPEG 没有透明通道，透明区域填为白色而不是黑色。
    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, size.width, size.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', PREVIEW_JPEG_QUALITY));
  } catch {
    // A tainted or lost canvas only costs the preview; the grid falls back to the original.
    // 画布被污染或丢失只会失去预览图；网格会改用原图。
    return null;
  } finally {
    // Releasing the backing store right away matters on iOS, which caps total canvas memory.
    // 立即释放画布内存，这在限制画布总内存的 iOS 上很重要。
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** prepareImage (EXIF size, shrinking big photos), then the preview. Rejects with ImagePrepError. */
/** 先经 prepareImage（按 EXIF 方向取尺寸、缩小过大的照片），再生成预览图。失败时以 ImagePrepError 拒绝。 */
export async function prepareMomentPhoto(file: File, contentType: string): Promise<PreparedMedia> {
  const prepared = await prepareImage(file);
  const type = prepared.file.type || contentType;
  let preview: Blob | null = null;
  if (needsPhotoPreview(type, prepared.width, prepared.height)) {
    try {
      const decoded = await decodeImage(prepared.file);
      try {
        preview = await encodePreview(decoded.source, decoded.width, decoded.height);
      } finally {
        decoded.release();
      }
    } catch {
      preview = null;
    }
  }
  return {
    kind: 'image',
    contentType: type,
    file: prepared.file,
    width: validDimension(prepared.width),
    height: validDimension(prepared.height),
    durationMs: null,
    preview,
  };
}

/** Resolves on the first of `events`, or with false after `ms`. */
/** 在 `events` 中任一事件发生时完成；超过 `ms` 后以 false 完成。 */
function waitFor(target: HTMLVideoElement, events: string[], ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      for (const name of events) target.removeEventListener(name, onEvent);
      target.removeEventListener('error', onError);
      resolve(value);
    };
    const onEvent = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => finish(false), ms);
    for (const name of events) target.addEventListener(name, onEvent);
    target.addEventListener('error', onError);
  });
}

/**
 * Reads a video's size and length from its metadata and grabs the frame at 0.1 s for the preview. A video
 * the browser cannot decode still uploads, without a size, a length or a preview.
 * 从视频的元数据读取尺寸和时长，并截取 0.1 秒处的画面作为预览图。浏览器无法解码的视频仍会上传，只是不带尺寸、时长和预览图。
 */
export async function prepareMomentVideo(file: File, contentType: string, url: string): Promise<PreparedMedia> {
  const result: PreparedMedia = { kind: 'video', contentType, file, width: null, height: null, durationMs: null, preview: null };
  if (typeof document === 'undefined') return result;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  try {
    const metadata = waitFor(video, ['loadedmetadata'], VIDEO_METADATA_TIMEOUT_MS);
    video.src = url;
    if (!(await metadata)) return result;
    result.width = validDimension(video.videoWidth);
    result.height = validDimension(video.videoHeight);
    result.durationMs = validDurationMs(video.duration);
    if (!result.width || !result.height) return result;
    const at = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(VIDEO_FRAME_AT_S, video.duration / 2) : VIDEO_FRAME_AT_S;
    const seeked = waitFor(video, ['seeked'], VIDEO_FRAME_TIMEOUT_MS);
    video.currentTime = at;
    if (!(await seeked)) return result;
    // Safari can report seeked before the frame is decoded; HAVE_CURRENT_DATA means one is ready to draw.
    // Safari 可能在画面解码前就报告 seeked；HAVE_CURRENT_DATA 表示已有可绘制的画面。
    if (video.readyState < 2 && !(await waitFor(video, ['loadeddata', 'canplay'], VIDEO_FRAME_TIMEOUT_MS))) return result;
    result.preview = await encodePreview(video, video.videoWidth, video.videoHeight);
    return result;
  } catch {
    return result;
  } finally {
    video.removeAttribute('src');
    try {
      video.load();
    } catch {
      // Detached elements may refuse load(); the element is dropped anyway.
      // 已分离的元素可能拒绝 load()；该元素随后即被丢弃。
    }
  }
}

/** Prepares one picked file. `url` is the object URL the composer already made for it. */
/** 处理一个选中的文件。`url` 是编辑器已为它创建的对象地址。 */
export function prepareMomentMedia(picked: PickedMedia, url: string): Promise<PreparedMedia> {
  return picked.kind === 'video' ? prepareMomentVideo(picked.file, picked.contentType, url) : prepareMomentPhoto(picked.file, picked.contentType);
}
