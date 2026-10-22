import { useRef, useState } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import type { LongPressHandlers } from '../../../shared/ui/useLongPress';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { chatApi } from '../api';
import { fitThumb } from './imageBox';

/**
 * The first address that loaded for each image key. Media tokens are refreshed every 50 minutes; reusing
 * the address that already worked keeps thumbnails from reloading when that happens.
 * 每个图片键第一个加载成功的地址。媒体令牌每 50 分钟刷新一次；沿用已成功的地址，刷新时缩略图不会重新加载。
 */
const workingSrc = new Map<string, string>();
const WORKING_SRC_MAX = 500;

function remember(imageKey: string, src: string) {
  if (workingSrc.get(imageKey) === src) return;
  workingSrc.delete(imageKey);
  workingSrc.set(imageKey, src);
  if (workingSrc.size > WORKING_SRC_MAX) {
    const oldest = workingSrc.keys().next().value;
    if (oldest !== undefined) workingSrc.delete(oldest);
  }
}

export function chatImageSrc(imageKey: string, mediaToken: string | null): string | null {
  return workingSrc.get(imageKey) ?? (mediaToken ? chatApi.mediaUrl(imageKey, mediaToken) : null);
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
 * Bare thumbnail with no bubble, in a box reserved before it loads so the list never shifts. It retries
 * once with the current token, then shows a gray 「图片已失效」 tile. A pending image shows the local
 * file dimmed with its upload percentage.
 * 不带气泡的缩略图，加载前就预留好尺寸，列表因此不会跳动。失败时用当前令牌重试一次，之后显示灰色的「图片已失效」。
 * 待发图片显示变暗的本地文件和上传百分比。
 */
export function ImageMessage({ imageKey, width, height, mediaToken, pending, pressed = false, handlers, onOpen }: Props) {
  const tr = useTr();
  const box = fitThumb(width, height);
  const elementRef = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [retrySrc, setRetrySrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const known = imageKey ? (workingSrc.get(imageKey) ?? null) : null;
  const fresh = imageKey && mediaToken ? chatApi.mediaUrl(imageKey, mediaToken) : null;
  const src = pending ? pending.localUrl : (retrySrc ?? pinned ?? known ?? fresh);
  // An address that already loaded once is in the browser cache, so it shows without the placeholder.
  // 已经加载过的地址在浏览器缓存中，因此不经过占位即可显示。
  const loaded = Boolean(pending) || (src !== null && (src === loadedSrc || src === known));
  // Once the upload is done, warm the cache with the stored copy so the confirmed row shows at once.
  // 上传完成后预先加载存储副本，确认后的消息因此能立即显示。
  const warm = pending && !pending.uploading && fresh ? fresh : null;

  function onLoad() {
    if (!src || pending) return;
    if (imageKey) remember(imageKey, src);
    setLoadedSrc(src);
    setPinned(src);
  }

  function onError() {
    if (pending || !imageKey) return;
    if (retrySrc === null && mediaToken) {
      workingSrc.delete(imageKey);
      setPinned(null);
      setRetrySrc(`${chatApi.mediaUrl(imageKey, mediaToken)}&retry=1`);
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
      {warm && imageKey ? <img src={warm} alt="" hidden onLoad={() => remember(imageKey, warm)} /> : null}
    </button>
  );
}
