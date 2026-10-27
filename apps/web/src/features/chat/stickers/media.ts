import { stickerObjectKey, stickerThumbKey, type StickerRef } from '@utmmsc/shared';
import { mediaUrl } from '../../profile/media';

/**
 * Where a sticker's file and still load from, and when an animated sticker may play. Stickers load from
 * /members/media with the profile media token, so one sticker has one URL in every room and in the panel and is
 * cached once. Pure apart from saveDataPreferred and mediaStatus, which read the browser.
 * 表情文件及其静态图的加载地址，以及动态表情何时可以播放。表情通过 /members/media 加上个人资料媒体令牌加载，
 * 因此同一个表情在每个房间和面板中都只有一个地址，也只缓存一次。除了读取浏览器的 saveDataPreferred 和 mediaStatus，其余都是纯函数。
 */

const KIB = 1024;
const MIB = 1024 * KIB;

/** A grid tile animates files up to this size; larger ones show their still. */
/** 表情格子只播放不超过这个大小的文件，更大的显示静态图。 */
export const STICKER_GRID_PLAY_BYTES_MAX = 1 * MIB;
/** A chat row plays files up to this size. */
/** 聊天消息只播放不超过这个大小的文件。 */
export const STICKER_CHAT_PLAY_BYTES_MAX = 2 * MIB;
/** Width times height an animated sticker may have to play by itself, in chats and in grids. */
/** 动态表情自动播放时允许的宽乘高，聊天和表情格子相同。 */
export const STICKER_PLAY_PIXELS_MAX = 640 * 640;
/** With data saving on, only files up to this size play. */
/** 开启省流量时，只播放不超过这个大小的文件。 */
export const STICKER_SAVE_DATA_BYTES_MAX = 512 * KIB;
/** Animated stickers playing at once: the newest on screen in a chat, the first on screen in a grid. */
/** 同时播放的动态表情数：聊天中为屏幕上最新的几个，表情格子中为屏幕上最靠前的几个。 */
export const STICKER_PLAYING_MAX = { chat: 8, grid: 24 } as const;

export interface StickerDisplayOptions {
  /** The system asks for less motion. */
  /** 系统要求减弱动态效果。 */
  reducedMotion: boolean;
  /** The browser asks to save data. */
  /** 浏览器要求节省流量。 */
  saveData: boolean;
}

export interface StickerImage {
  src: string | null;
  /** An animated sticker shown as its still, which carries the play mark. */
  /** 以静态图显示的动态表情，带有播放标记。 */
  still: boolean;
}

export function stickerFileSrc(ref: StickerRef, token: string | null): string | null {
  return token ? mediaUrl(stickerObjectKey(ref.id, ref.type), token) : null;
}

/** Null without a token, or when the member's row or the message names no still. */
/** 没有令牌，或成员的记录及消息没有指明静态图时为 null。 */
export function stickerThumbSrc(ref: StickerRef, token: string | null): string | null {
  return token && ref.thumb ? mediaUrl(stickerThumbKey(ref.id, ref.thumb), token) : null;
}

function withinPlayLimits(ref: StickerRef, bytesMax: number, options: StickerDisplayOptions): boolean {
  if (!ref.animated || options.reducedMotion) return false;
  if (ref.bytes > bytesMax || ref.width * ref.height > STICKER_PLAY_PIXELS_MAX) return false;
  return !options.saveData || ref.bytes <= STICKER_SAVE_DATA_BYTES_MAX;
}

/**
 * Whether an animated sticker plays by itself in a chat (1.4): at most 2 MB and 640 x 640 px of area, motion allowed,
 * and with data saving at most 512 KB. Static stickers have nothing to play. With both options off it also tells
 * whether a sticker is "large" for the M3b toast.
 * 动态表情在聊天中是否自动播放（1.4）：不超过 2MB 和 640 x 640 像素的面积、允许动态效果，开启省流量时不超过 512KB。
 * 静态表情没有可播放的内容。两个选项都关闭时，它也用来判断表情对 M3b 提示而言是否「较大」。
 */
export function stickerAutoplays(ref: StickerRef, options: StickerDisplayOptions): boolean {
  return withinPlayLimits(ref, STICKER_CHAT_PLAY_BYTES_MAX, options);
}

/**
 * The image a grid tile shows. Static stickers show their still; an animated one shows its file within the grid's
 * limits (1 MB, 640 x 640 px) when motion is allowed and data saving is off, and its still otherwise. Without a
 * still: the file of a static sticker; for an animated one the file within those limits, else nothing (a neutral
 * tile with the play mark).
 * 表情格子显示的图片。静态表情显示静态图；动态表情在格子的上限（1MB、640 x 640 像素）之内、允许动态效果且未开启省流量时显示文件，
 * 否则显示静态图。没有静态图时：静态表情显示文件；动态表情在上述上限之内显示文件，否则什么都不显示（带播放标记的中性图块）。
 */
export function stickerGridImage(ref: StickerRef, token: string | null, options: StickerDisplayOptions): StickerImage {
  if (!options.saveData && withinPlayLimits(ref, STICKER_GRID_PLAY_BYTES_MAX, options)) return { src: stickerFileSrc(ref, token), still: false };
  const thumb = stickerThumbSrc(ref, token);
  if (!ref.animated) return { src: thumb ?? stickerFileSrc(ref, token), still: false };
  return { src: thumb, still: true };
}

/**
 * The image a chat row shows: a static sticker's file, an animated one's file when it autoplays, and otherwise its
 * still with the play mark (nothing without a still).
 * 聊天消息显示的图片：静态表情显示文件；动态表情能自动播放时显示文件，否则显示带播放标记的静态图（没有静态图时什么都不显示）。
 */
export function stickerChatImage(ref: StickerRef, token: string | null, options: StickerDisplayOptions): StickerImage {
  if (!ref.animated || stickerAutoplays(ref, options)) return { src: stickerFileSrc(ref, token), still: false };
  return { src: stickerThumbSrc(ref, token), still: true };
}

/** The browser's Save-Data preference (Chrome and Android WebView); false where it is not exposed. */
/** 浏览器的省流量偏好（Chrome 和 Android WebView）；不提供时为 false。 */
export function saveDataPreferred(): boolean {
  try {
    if (typeof navigator === 'undefined') return false;
    return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

/**
 * The status the server answers for a media URL, without keeping the body, or null when the request did not get an
 * answer. Used only after an image failed twice, to tell a file that is gone (404) from a failed load.
 * 服务端对某个媒体地址返回的状态码，不保留响应体；请求没有得到答复时为 null。只在图片两次加载失败后使用，
 * 以区分文件已不存在（404）和一次失败的加载。
 */
export async function mediaStatus(src: string): Promise<number | null> {
  try {
    const response = await fetch(src, { cache: 'no-store' });
    try {
      await response.body?.cancel();
    } catch {
      // The status is all that is needed; a body that cannot be cancelled is simply left.
      // 只需要状态码；无法取消的响应体直接放着不管。
    }
    return response.status;
  } catch {
    return null;
  }
}
