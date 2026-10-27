import { memo, useState, type CSSProperties } from 'react';
import type { StickerRef } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { stickerFileSrc, stickerGridImage, stickerThumbSrc } from '../stickers/media';
import { useStickerPlayback } from '../stickers/playback';
import type { StickerUploadTile } from '../stickers/store';
import { CheckCircleIcon, PlusIcon, StickerPlayIcon } from './composerIcons';

/**
 * The cells of a sticker grid: a sticker, the + tile and an upload tile. Each is a button carrying `data-tile` (its
 * place in the grid); the grid handles every press, click and key in one delegated handler, so the tiles take no
 * callbacks and a grid of 999 re-renders only the tiles that changed.
 * 表情格子中的单元：表情、+ 格子和上传中的格子。每个都是带有 `data-tile`（在格子中的位置）的按钮；所有按压、点击和按键都由格子
 * 统一委托处理，因此单元不接收回调，999 个格子也只会重新渲染有变化的那几个。
 */

/** Long-pressing a sticker must not open the system image menu or select text. */
/** 长按表情时不能弹出系统图片菜单，也不能选中文字。 */
const NO_CALLOUT: CSSProperties = { WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' };

const TILE =
  'relative flex aspect-square w-full min-w-0 items-center justify-center rounded-[6px] p-1.5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-700';

export type StickerTileSource = 'file' | 'still' | 'none';

/**
 * The image a sticker tile shows (`src`) and the still kept under it (`under`). A static sticker's still that does
 * not load falls back to the file once; an animated sticker's never does, as the tile shows a still only where it
 * may not play the file. A file that does not load falls back to its still; with neither the tile is gray (with the
 * play mark when animated). While the tile shows a file its still stays under it: shown until the file has loaded
 * (`waiting`), as in the peek card, so a tile that starts playing never goes blank, and hidden after that, so it is
 * back at once when the tile stops. `loaded` is the address whose image has loaded since it became `src`.
 * 表情格子显示的图片（`src`）以及垫在它下面的静态图（`under`）。静态表情的静态图加载失败时改用文件一次；动态表情从不这样做，
 * 因为格子只在不能播放文件时才显示静态图。文件加载失败时改用静态图；两者都不行时显示灰色格子（动态表情带播放标记）。
 * 格子显示文件期间，静态图一直垫在下面：文件加载完成之前显示它（`waiting`），与预览卡片相同，开始播放的格子因此不会变空；
 * 之后将它隐藏，格子停止播放时它能立即回来。`loaded` 是成为 `src` 之后已加载完成的地址。
 */
export function stickerTileSources({
  wanted,
  animated,
  file,
  still,
  failed,
  loaded,
}: {
  wanted: StickerTileSource;
  animated: boolean;
  file: string | null;
  still: string | null;
  failed: readonly string[];
  loaded: string | null;
}): { src: string | null; under: string | null; waiting: boolean } {
  const fileOk = file !== null && !failed.includes(file);
  const stillOk = still !== null && !failed.includes(still);
  let src: string | null = null;
  if (wanted === 'file') src = fileOk ? file : stillOk ? still : null;
  // Only a static sticker falls back to its file. An animated tile wants its still exactly where it may not play the
  // file (less motion, data saving, the grid's limits, no playback slot), so it turns gray with its play mark instead.
  // 只有静态表情改用文件。动态表情只在不能播放文件时才使用静态图（减弱动态效果、省流量、超出格子的上限、没有播放名额），
  // 因此改为显示带播放标记的灰色格子。
  else if (wanted === 'still') src = stillOk ? still : !animated && fileOk ? file : null;
  const under = src !== null && src === file && stillOk ? still : null;
  return { src, under, waiting: under !== null && loaded !== src };
}

/**
 * Calls `reveal` once a loaded image is decoded, so showing it never paints an empty frame, and only while the image
 * is still on the page. At once where the browser has no decode().
 * 已加载的图片解码完成后调用 `reveal`，显示它时因此不会画出空白的一帧；图片已不在页面上时不调用。浏览器没有 decode() 时立即调用。
 */
function afterDecode(image: HTMLImageElement, reveal: () => void): void {
  const done = () => {
    if (image.isConnected) reveal();
  };
  if (typeof image.decode === 'function') image.decode().then(done, done);
  else done();
}

interface StickerTileProps {
  sticker: StickerRef;
  /** Place in the grid: `data-tile`, and the rank for playback (the first tiles play first). */
  /** 在格子中的位置：用作 `data-tile`，也是播放的名次（越靠前越先播放）。 */
  index: number;
  /** Unique within the grid scope, as the same sticker can sit in 最近使用 and in 我的表情. */
  /** 在格子范围内唯一，因为同一个表情可能同时出现在「最近使用」和「我的表情」中。 */
  playKey: string;
  /** 1-based place in its section, for the label. */
  /** 在所在区域中从 1 开始的位置，用于朗读标签。 */
  number: number;
  token: string | null;
  reducedMotion: boolean;
  saveData: boolean;
  /** The one tile of the grid that Tab reaches. */
  /** 格子中 Tab 键能到达的那一个单元。 */
  focusable: boolean;
  selecting: boolean;
  checked: boolean;
}

export const StickerTile = memo(function StickerTile({ sticker, index, playKey, number, token, reducedMotion, saveData, focusable, selecting, checked }: StickerTileProps) {
  const tr = useTr();
  const [failed, setFailed] = useState<readonly string[]>([]);
  const [loaded, setLoaded] = useState<string | null>(null);
  const image = stickerGridImage(sticker, token, { reducedMotion, saveData });
  // Animated files the grid may play take a place in its playback limit; the others always show their still.
  // 格子可以播放的动态文件占用播放名额；其余的始终显示静态图。
  const eligible = sticker.animated && !image.still && image.src !== null;
  const playback = useStickerPlayback(playKey, index, eligible, 'grid');
  const file = stickerFileSrc(sticker, token);
  const still = stickerThumbSrc(sticker, token);

  let wanted: StickerTileSource;
  if (eligible) wanted = playback.playing ? 'file' : 'still';
  else if (image.src === null) wanted = 'none';
  else wanted = image.src === file ? 'file' : 'still';
  const { src, under, waiting } = stickerTileSources({ wanted, animated: sticker.animated, file, still, failed, loaded });
  // Each address is its own image element (keyed by it), so a new `src` has not loaded yet, even one that loaded before.
  // 每个地址都是单独的图片元素（以地址为 key），所以新的 `src` 还没有加载，即使它以前加载过。
  const [current, setCurrent] = useState(src);
  if (current !== src) {
    setCurrent(src);
    setLoaded(null);
  }
  // The still shown in place of a loading file keeps its play mark until the file shows.
  // 代替加载中文件显示的静态图保留播放标记，直到文件显示出来。
  const moving = src !== null && src === file && sticker.animated && !waiting;
  const fail = (url: string) => setFailed((list) => (list.includes(url) ? list : [...list, url]));

  const label = sticker.animated ? tr(`第 ${number} 个动画表情`, `Animated sticker ${number}`) : tr(`第 ${number} 个表情`, `Sticker ${number}`);

  return (
    <button
      type="button"
      data-tile={index}
      tabIndex={focusable ? 0 : -1}
      role={selecting ? 'checkbox' : undefined}
      aria-checked={selecting ? checked : undefined}
      aria-label={label}
      className={`${TILE} active:bg-wx-pressed`}
      style={NO_CALLOUT}
    >
      <span ref={eligible ? playback.ref : undefined} className="relative flex h-full w-full items-center justify-center">
        {/* Keyed by its address, the still moves under the file and back as the same element, so neither switch goes blank. */}
        {/* 以地址为 key，静态图作为同一个元素移到文件下面再移回来，因此两个方向的切换都不会出现空白。 */}
        {under ? (
          <img
            key={under}
            src={under}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => fail(under)}
            className={`pointer-events-none absolute inset-0 h-full w-full object-contain ${waiting ? '' : 'opacity-0'}`}
            style={NO_CALLOUT}
          />
        ) : null}
        {src ? (
          <img
            key={src}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={(event) => afterDecode(event.currentTarget, () => setLoaded(src))}
            onError={() => fail(src)}
            className={`pointer-events-none relative h-full w-full object-contain ${waiting ? 'opacity-0' : ''}`}
            style={NO_CALLOUT}
          />
        ) : (
          <span className="h-full w-full rounded-[4px] bg-wx-pressed" aria-hidden />
        )}
        {sticker.animated && !moving ? (
          <span className="pointer-events-none absolute bottom-0 right-0" aria-hidden>
            <StickerPlayIcon className="h-[18px] w-[18px]" />
          </span>
        ) : null}
      </span>
      {selecting ? (
        <span className="pointer-events-none absolute right-1 top-1" aria-hidden>
          <CheckCircleIcon checked={checked} />
        </span>
      ) : null}
    </button>
  );
});

/** The + tile: opens the picker, or shows why it cannot. Dimmed and inert while selecting on the manage screen. */
/** + 格子：打开选择器，或说明为什么不能打开。在管理界面选择表情时变暗且不可用。 */
export const AddStickerTile = memo(function AddStickerTile({ index, focusable, inactive }: { index: number; focusable: boolean; inactive: boolean }) {
  const tr = useTr();
  return (
    <button
      type="button"
      data-tile={index}
      tabIndex={focusable ? 0 : -1}
      aria-label={tr('添加表情', 'Add sticker')}
      aria-disabled={inactive || undefined}
      className={`${TILE} ${inactive ? 'opacity-40' : 'active:bg-wx-pressed'}`}
      style={NO_CALLOUT}
    >
      <span className="flex h-full w-full items-center justify-center rounded-[6px] border border-dashed border-wx-line text-wx-meta">
        <PlusIcon />
      </span>
    </button>
  );
});

/**
 * A file being added: its still at half strength with the progress, or a red ! once it failed (a tap then offers 重试
 * and 移除).
 * 正在添加的文件：以半透明显示其静态图和进度；失败后显示红色感叹号（点按后可选择重试或移除）。
 */
export const UploadStickerTile = memo(function UploadStickerTile({ upload, index, focusable }: { upload: StickerUploadTile; index: number; focusable: boolean }) {
  const tr = useTr();
  const failed = upload.status === 'failed';
  const percent = Math.round(Math.min(1, Math.max(0, Number.isFinite(upload.progress) ? upload.progress : 0)) * 100);
  const label = failed ? tr('添加失败，点按重试', "Couldn't add. Tap to retry.") : tr(`正在添加 ${percent}%`, `Adding, ${percent}%`);
  return (
    <button type="button" data-tile={index} tabIndex={focusable ? 0 : -1} aria-label={label} className={`${TILE} ${failed ? 'active:bg-wx-pressed' : ''}`} style={NO_CALLOUT}>
      <span className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[4px]">
        {upload.previewUrl ? (
          <img src={upload.previewUrl} alt="" draggable={false} className="pointer-events-none h-full w-full object-contain opacity-50" style={NO_CALLOUT} />
        ) : (
          <span className="h-full w-full bg-wx-pressed" aria-hidden />
        )}
        {failed ? null : (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-medium tabular-nums text-wx-ink" aria-hidden>
            {percent}%
          </span>
        )}
      </span>
      {failed ? (
        <span
          className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-wx-red text-[13px] font-bold leading-none text-white"
          aria-hidden
        >
          !
        </span>
      ) : null}
    </button>
  );
});
