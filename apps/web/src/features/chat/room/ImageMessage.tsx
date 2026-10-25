import { useRef, useState } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { thumbKeyFor } from '../../../shared/media/thumbIndex';
import type { LongPressHandlers } from '../../../shared/ui/useLongPress';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { chatApi } from '../api';
import { fitThumb } from './imageBox';

/**
 * The first address that loaded for each stored key (a thumbnail or a full image). Media tokens are refreshed from
 * time to time; reusing the address that already worked keeps rows from reloading when that happens.
 * 每个存储键（缩略图或完整图片）第一个加载成功的地址。媒体令牌会不时刷新；沿用已成功的地址，刷新时消息行不会重新加载。
 */
const workingSrc = new Map<string, string>();
const WORKING_SRC_MAX = 500;

function remember(key: string, src: string) {
  if (workingSrc.get(key) === src) return;
  workingSrc.delete(key);
  workingSrc.set(key, src);
  if (workingSrc.size > WORKING_SRC_MAX) {
    const oldest = workingSrc.keys().next().value;
    if (oldest !== undefined) workingSrc.delete(oldest);
  }
}

function srcOf(key: string, mediaToken: string | null): string | null {
  return workingSrc.get(key) ?? (mediaToken ? chatApi.mediaUrl(key, mediaToken) : null);
}

/** The full image, which the viewer shows and 保存图片 saves. */
/** 完整图片，查看器显示它，「保存图片」也保存它。 */
export function chatImageSrc(imageKey: string, mediaToken: string | null): string | null {
  return srcOf(imageKey, mediaToken);
}

/** The image's 360px thumbnail, or null when it has none (sent before thumbnails, or a GIF). */
/** 图片的 360px 缩略图；没有缩略图时（缩略图出现之前发送的图片，或 GIF）为 null。 */
export function chatThumbSrc(imageKey: string, mediaToken: string | null): string | null {
  const thumbKey = thumbKeyFor(imageKey);
  return thumbKey ? srcOf(thumbKey, mediaToken) : null;
}

export interface PendingImageView {
  localUrl: string;
  progress: number;
  /** Still uploading, so the percentage is shown. */
  /** 仍在上传，因此显示百分比。 */
  uploading: boolean;
}

interface Props {
  imageKey: string | null;
  width: number | null;
  height: number | null;
  mediaToken: string | null;
  pending?: PendingImageView | null;
  pressed?: boolean;
  handlers?: LongPressHandlers;
  onOpen?: (rect: DOMRect) => void;
}

/**
 * Bare thumbnail with no bubble, in a box reserved before it loads so the list never shifts. It shows the 360px
 * thumbnail stored beside the image when there is one and loads only once it nears the screen. A failed load is
 * retried once with the current token; a thumbnail that still fails gives way to the full image, and only then does
 * the gray 「图片已失效」 tile show. A pending image shows the local file dimmed with its upload percentage.
 * 不带气泡的缩略图，加载前就预留好尺寸，列表因此不会跳动。有与图片一同存储的 360px 缩略图时显示缩略图，并且只在接近屏幕时才加载。
 * 加载失败时用当前令牌重试一次；缩略图仍然失败就改用完整图片，之后才显示灰色的「图片已失效」。待发图片显示变暗的本地文件和上传百分比。
 */
export function ImageMessage({ imageKey, width, height, mediaToken, pending, pressed = false, handlers, onOpen }: Props) {
  const tr = useTr();
  const box = fitThumb(width, height);
  const elementRef = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState<{ key: string; src: string } | null>(null);
  const [retry, setRetry] = useState<{ key: string; src: string } | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const thumbKey = imageKey ? thumbKeyFor(imageKey) : null;
  const shownKey = thumbKey && thumbKey !== thumbFailed ? thumbKey : imageKey;
  const known = shownKey ? (workingSrc.get(shownKey) ?? null) : null;
  const fresh = shownKey && mediaToken ? chatApi.mediaUrl(shownKey, mediaToken) : null;
  const retrySrc = retry && retry.key === shownKey ? retry.src : null;
  const pinnedSrc = pinned && pinned.key === shownKey ? pinned.src : null;
  const src = pending ? pending.localUrl : (retrySrc ?? pinnedSrc ?? known ?? fresh);
  // An address that already loaded once is in the browser cache, so it shows without the placeholder.
  // 已经加载过的地址在浏览器缓存中，因此不经过占位即可显示。
  const loaded = Boolean(pending) || (src !== null && (src === loadedSrc || src === known));
  // Once the upload is done, warm the cache with the copy the confirmed row will show, so it appears at once.
  // 上传完成后预先加载确认后的消息行将要显示的副本，它因此能立即出现。
  const warm = pending && !pending.uploading && fresh ? fresh : null;

  function onLoad() {
    if (!src || pending || !shownKey) return;
    remember(shownKey, src);
    setLoadedSrc(src);
    setPinned({ key: shownKey, src });
  }

  function onError() {
    if (pending || !imageKey || !shownKey) return;
    if (retrySrc === null && mediaToken) {
      workingSrc.delete(shownKey);
      setPinned(null);
      setRetry({ key: shownKey, src: `${chatApi.mediaUrl(shownKey, mediaToken)}&retry=1` });
      return;
    }
    if (shownKey !== imageKey && thumbKey) {
      // The thumbnail is only a lighter copy; the full image may still load.
      // 缩略图只是更轻的副本；完整图片仍可能加载成功。
      setThumbFailed(thumbKey);
      setPinned(null);
      setRetry(null);
      return;
    }
    setFailed(true);
  }

  return (
    <button
      ref={elementRef}
      type="button"
      className="relative block select-none overflow-hidden rounded-[4px] bg-wx-line"
      style={{ width: box.width, height: box.height, WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
      aria-label={failed ? tr('图片已失效', 'Image unavailable') : tr('图片', 'Photo')}
      data-interactive
      data-thumb
      onClick={() => {
        const element = elementRef.current;
        if (element && onOpen && !pending && !failed) onOpen(element.getBoundingClientRect());
      }}
      {...handlers}
    >
      {failed ? (
        <span className="absolute inset-0 flex items-center justify-center px-2 text-center text-[13px] leading-[18px] text-wx-meta" aria-hidden>
          {tr('图片已失效', 'Image unavailable')}
        </span>
      ) : (
        <>
          {src ? (
            <img
              src={src}
              alt=""
              draggable={false}
              loading={pending ? undefined : 'lazy'}
              decoding="async"
              onLoad={onLoad}
              onError={onError}
              className={`absolute inset-0 h-full w-full object-cover ${pending ? 'opacity-60' : loaded ? '' : 'opacity-0'}`}
            />
          ) : null}
          {!loaded ? (
            <span className="absolute inset-0 flex items-center justify-center">
              <WxSpinner size={20} />
            </span>
          ) : null}
          {pending?.uploading ? (
            <span className="absolute inset-0 flex items-center justify-center text-[15px] font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
              {Math.round(pending.progress * 100)}%
            </span>
          ) : null}
        </>
      )}
      {pressed ? <span className="absolute inset-0 bg-black/15" aria-hidden /> : null}
      {warm && shownKey ? <img src={warm} alt="" hidden onLoad={() => remember(shownKey, warm)} /> : null}
    </button>
  );
}
