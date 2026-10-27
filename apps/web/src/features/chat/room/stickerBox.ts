/**
 * Pure geometry and load steps for stickers in chat: the box a sticker message takes, the size of the tap preview,
 * and what a sticker that fails to load shows next.
 * 聊天中表情的纯几何计算和加载步骤：表情消息占用的区域、点按预览的尺寸，以及加载失败的表情接下来显示什么。
 */

/** Longest side a sticker is drawn at in a chat, in CSS px. */
/** 表情在聊天中绘制时的最长边，单位 CSS px。 */
export const STICKER_BOX_MAX = 150;
/** A sticker is never drawn larger than this many times its own pixel size in a chat. */
/** 表情在聊天中绘制的尺寸从不超过其自身像素尺寸的这么多倍。 */
export const STICKER_UPSCALE_MAX = 2;
/** Smallest tap area on each side, with the sticker centred in it. */
/** 每条边上的最小点按区域，表情在其中居中。 */
export const STICKER_TAP_MIN = 48;
/** Rows whose stored size is unusable get a square of this side. */
/** 保存的尺寸不可用的消息使用这个边长的正方形。 */
export const STICKER_FALLBACK_SIDE = 120;
/** Longest side of the tap preview. */
/** 点按预览的最长边。 */
export const STICKER_PREVIEW_MAX = 300;
/** Room the tap preview leaves beside it, both sides together. */
/** 点按预览两侧留出的空间之和。 */
export const STICKER_PREVIEW_MARGIN = 64;
/** The tap preview never draws a sticker larger than this many times its pixel size. */
/** 点按预览绘制表情时从不超过其像素尺寸的这么多倍。 */
export const STICKER_PREVIEW_UPSCALE_MAX = 3;

export interface StickerFit {
  /** The sticker itself. */
  /** 表情本身。 */
  width: number;
  height: number;
  /** The tap area around it, at least 48 px on each side. */
  /** 它周围的点按区域，每边至少 48 px。 */
  boxWidth: number;
  boxHeight: number;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * The box of a sticker message: fitted into 150 x 150 keeping its shape, never more than twice its own size, and a
 * tap area of at least 48 x 48 with the sticker centred. Unusable sizes give a 120 px square.
 * 表情消息的区域：保持比例放入 150 x 150，不超过自身尺寸的两倍，点按区域至少 48 x 48 且表情居中。不可用的尺寸得到 120 px 的正方形。
 */
export function fitSticker(width: number | null | undefined, height: number | null | undefined): StickerFit {
  if (!positive(width) || !positive(height)) {
    return { width: STICKER_FALLBACK_SIDE, height: STICKER_FALLBACK_SIDE, boxWidth: STICKER_FALLBACK_SIDE, boxHeight: STICKER_FALLBACK_SIDE };
  }
  const scale = Math.min(STICKER_BOX_MAX / Math.max(width, height), STICKER_UPSCALE_MAX);
  const drawnWidth = Math.max(1, Math.round(width * scale));
  const drawnHeight = Math.max(1, Math.round(height * scale));
  return { width: drawnWidth, height: drawnHeight, boxWidth: Math.max(drawnWidth, STICKER_TAP_MIN), boxHeight: Math.max(drawnHeight, STICKER_TAP_MIN) };
}

/**
 * The size of the tap preview: the long side at most min(viewport width - 64, 300) px and never more than three times
 * the sticker's own size. Unusable sizes give a square of that side.
 * 点按预览的尺寸：长边不超过 min(视口宽度 - 64, 300) px，且不超过表情自身尺寸的三倍。不可用的尺寸得到这个边长的正方形。
 */
export function fitStickerPreview(width: number | null | undefined, height: number | null | undefined, viewportWidth: number): { width: number; height: number } {
  const room = positive(viewportWidth) ? viewportWidth - STICKER_PREVIEW_MARGIN : STICKER_PREVIEW_MAX;
  const side = Math.max(STICKER_TAP_MIN, Math.min(room, STICKER_PREVIEW_MAX));
  if (!positive(width) || !positive(height)) return { width: side, height: side };
  const scale = Math.min(side / Math.max(width, height), STICKER_PREVIEW_UPSCALE_MAX);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Where loading one sticker image stands.
 * - loading: the first attempt; retrying: the one silent retry; probing: asking the server whether the file exists.
 * - shown: it loaded. gone: the file is really gone (404), so the tile says so and does nothing.
 * - failed: anything else; a tap loads it again. stillBroken: the still failed but the file is there, so the row
 *   shows a neutral tile with the play mark instead of an error.
 * `retry` goes into the address, so every new attempt is a new request.
 * 一张表情图片的加载进度。
 * - loading：第一次尝试；retrying：唯一一次静默重试；probing：向服务端确认文件是否存在。
 * - shown：已加载。gone：文件确实已不存在（404），图块如实显示且不响应点按。
 * - failed：其他情况，点按后重新加载。stillBroken：静态图失败但文件仍在，消息因此显示带播放标记的中性图块，而不是报错。
 * `retry` 会写进地址，每次新的尝试因此都是新的请求。
 */
export type StickerLoadPhase = 'loading' | 'retrying' | 'probing' | 'shown' | 'gone' | 'failed' | 'stillBroken';

export interface StickerLoadState {
  phase: StickerLoadPhase;
  retry: number;
}

export type StickerLoadEvent =
  | { type: 'loaded' }
  | { type: 'error' }
  // The status the file's address answered (null: no answer), and whether the image that failed was the still.
  // 文件地址答复的状态码（null 表示没有答复），以及失败的图片是否为静态图。
  | { type: 'probed'; status: number | null; still: boolean }
  | { type: 'tap' };

export const STICKER_LOAD_START: StickerLoadState = { phase: 'loading', retry: 0 };

/**
 * The next load state (1.4): an error is retried once silently with a new address; a second error probes the file;
 * a 404 means it is gone, any other answer or no answer means the load failed (or, for a still whose file answers,
 * that only the still is broken); a tap on a failed tile starts again with a new address.
 * 下一个加载状态（1.4）：出错后用新地址静默重试一次；再次出错就查询文件；404 表示文件已不存在，其他答复或没有答复表示加载失败
 * （若失败的是静态图而文件有答复，则只是静态图损坏）；点按失败的图块会用新地址重新开始。
 */
export function stickerLoadStep(state: StickerLoadState, event: StickerLoadEvent): StickerLoadState {
  switch (event.type) {
    case 'loaded':
      return state.phase === 'loading' || state.phase === 'retrying' ? { phase: 'shown', retry: state.retry } : state;
    case 'error':
      if (state.phase === 'loading' || state.phase === 'shown') return { phase: 'retrying', retry: state.retry + 1 };
      if (state.phase === 'retrying') return { phase: 'probing', retry: state.retry };
      return state;
    case 'probed': {
      if (state.phase !== 'probing') return state;
      if (event.status === 404) return { phase: 'gone', retry: state.retry };
      const answered = event.status !== null && event.status >= 200 && event.status < 400;
      return { phase: event.still && answered ? 'stillBroken' : 'failed', retry: state.retry };
    }
    case 'tap':
      return state.phase === 'failed' ? { phase: 'loading', retry: state.retry + 1 } : state;
  }
}

/** The address of one attempt: the first goes as it is, later ones carry their retry number. */
/** 某次尝试的地址：第一次原样使用，之后的尝试带上重试序号。 */
export function stickerAttemptSrc(src: string | null, retry: number): string | null {
  if (!src || retry <= 0) return src;
  return `${src}${src.includes('?') ? '&' : '?'}retry=${retry}`;
}
