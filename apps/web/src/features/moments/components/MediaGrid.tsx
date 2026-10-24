import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { MomentMedia } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { mediaUrl } from '../../profile/media';
import { mediaLayout, momentContentWidth, type MediaLayout } from '../layout/grid';
import { isLocalPostKey, MEDIA_CELL_ATTRIBUTE, mediaCellValue, type LocalMedia } from '../model';
import { VideoTile } from './VideoTile';

export interface MediaGridProps {
  /** post.id of the media, for data-moment-cell. */
  /** 媒体所属的 post.id，用于 data-moment-cell。 */
  postId: string;
  media: readonly MomentMedia[];
  /** This device's copies, index for index, shown until the server previews load. */
  /** 本设备上的副本，逐项对应，在服务器预览图加载完成之前显示。 */
  localMedia?: readonly LocalMedia[] | null;
  mediaToken: string | null;
  /** Content width in px for layout/grid.ts; measured from the parent when omitted. */
  /** 供 layout/grid.ts 使用的内容宽度（像素）；省略时按父元素测量。 */
  width?: number;
  /** A cell was tapped; without it the cells are not buttons (a moderator's snapshot). */
  /** 点击了某个格子；不提供时格子不是按钮（管理员查看快照时）。 */
  onOpen?: (index: number, rect: DOMRect | null) => void;
  /** Every server preview has loaded, so the local copies can be released. Called once. */
  /** 所有服务器预览图都已加载，本地副本可以释放。只调用一次。 */
  onPreviewsLoaded?: () => void;
}

/**
 * The first address that loaded for each object key. Reusing it when a later response carries another
 * media token keeps cells from loading again.
 * 每个对象键第一个加载成功的地址。之后的响应带来别的媒体令牌时沿用它，格子不会重新加载。
 */
const workingSrc = new Map<string, string>();
const WORKING_SRC_MAX = 600;

function remember(key: string, src: string): void {
  if (workingSrc.get(key) === src) return;
  workingSrc.delete(key);
  workingSrc.set(key, src);
  if (workingSrc.size > WORKING_SRC_MAX) {
    const oldest = workingSrc.keys().next().value;
    if (oldest !== undefined) workingSrc.delete(oldest);
  }
}

function storedSrc(key: string | null | undefined, token: string | null): string | null {
  if (!key) return null;
  return workingSrc.get(key) ?? (token ? mediaUrl(key, token) : null);
}

/**
 * The content width last measured, so a grid that mounts again (returning to the feed) reserves its final
 * boxes on the first render and the restored scroll position stays exact.
 * 上次测得的内容宽度。再次挂载的宫格（回到信息流时）在第一次渲染时就预留最终尺寸，恢复的滚动位置因此保持准确。
 */
let lastMeasuredWidth: number | null = null;

function estimateWidth(): number {
  if (lastMeasuredWidth !== null) return lastMeasuredWidth;
  if (typeof document === 'undefined') return momentContentWidth(375);
  // The page column is white, centred and at most 672px (max-w-2xl).
  // 页面列为白色、居中，最宽 672px（max-w-2xl）。
  return momentContentWidth(Math.min(document.documentElement.clientWidth || 375, 672));
}

/** Measures the parent's content box, before paint, and follows it as it resizes. */
/** 在绘制之前测量父元素的内容宽度，并随其尺寸变化更新。 */
function useContentWidth(explicit: number | undefined): { ref: (element: HTMLDivElement | null) => void; width: number } {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<number>(() => explicit ?? estimateWidth());

  useLayoutEffect(() => {
    if (explicit !== undefined || !element) return;
    const measure = () => {
      const next = Math.round(element.clientWidth);
      if (next <= 0) return;
      lastMeasuredWidth = next;
      setMeasured((prev) => (prev === next ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, explicit]);

  return { ref: setElement, width: explicit ?? measured };
}

interface CellProps {
  postId: string;
  index: number;
  count: number;
  item: MomentMedia;
  local: LocalMedia | null;
  /** No server copy exists yet: the post is still being published. */
  /** 还没有服务器副本：动态仍在发表中。 */
  localOnly: boolean;
  mediaToken: string | null;
  width: number;
  height: number;
  /** Single tall crops keep the top of the picture. */
  /** 单张竖向裁切保留画面顶部。 */
  align: 'top' | 'center';
  long: boolean;
  onOpen?: (index: number, rect: DOMRect | null) => void;
  onServerReady: (index: number) => void;
}

/**
 * One photo: the preview (or the original for media posted before previews), lazily decoded inside its
 * reserved box. A failed load retries once without a word, then shows a grey tile that retries on tap.
 * 一张照片：预览图（预览图出现之前发布的媒体使用原图），在预留好的格子中延迟解码。加载失败时先静默重试一次，之后显示灰色格子，轻触重试。
 */
function ImageCell({ postId, index, count, item, local, localOnly, mediaToken, width, height, align, long, onOpen, onServerReady }: CellProps) {
  const tr = useTr();
  const key = item.previewKey ?? item.key;
  const base = localOnly ? null : storedSrc(key, mediaToken);
  // 0: first try. 1: the silent retry. 2 and up: taps on the error tile.
  // 0：第一次加载。1：静默重试。2 及以上：在错误格子上的轻触重试。
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const src = base ? (attempt === 0 ? base : `${base}&retry=${attempt}`) : null;
  const localSrc = local ? (local.previewUrl ?? local.fileUrl) : null;
  const gif = item.contentType === 'image/gif';
  const loaded = src !== null && (src === loadedSrc || workingSrc.get(key) === src);

  const position = count > 1 ? tr(`图片 ${index + 1}，共 ${count} 张`, `Photo ${index + 1} of ${count}`) : tr('图片', 'Photo');
  const badges = [long ? tr('长图', 'Long') : null, gif ? 'GIF' : null].filter(Boolean).join(tr('，', ', '));
  const failure = tr('图片加载失败，轻触重试', 'Photo didn’t load. Tap to retry');
  const label = failed && !localSrc ? failure : badges ? `${position}${tr('，', ', ')}${badges}` : position;

  function retry() {
    setFailed(false);
    setAttempt((value) => Math.max(2, value + 1));
  }

  const content = (
    <>
      {failed && !localSrc ? (
        <span className="absolute inset-0 flex items-center justify-center px-1.5 text-center text-[12px] leading-4 text-wx-meta" aria-hidden>
          {failure}
        </span>
      ) : null}
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setLoadedSrc(src);
            remember(key, src);
            onServerReady(index);
          }}
          onError={() => {
            workingSrc.delete(key);
            if (attempt === 0) setAttempt(1);
            else setFailed(true);
          }}
          className={`absolute inset-0 h-full w-full object-cover ${align === 'top' ? 'object-top' : 'object-center'} ${loaded ? '' : 'opacity-0'}`}
        />
      ) : null}
      {localSrc ? (
        <img
          src={localSrc}
          alt=""
          draggable={false}
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover ${align === 'top' ? 'object-top' : 'object-center'}`}
        />
      ) : null}
      {badges ? (
        <span className="pointer-events-none absolute bottom-1 right-1 flex gap-1" aria-hidden>
          {long ? <span className="rounded-[3px] bg-black/50 px-1 text-[11px] font-medium leading-4 text-white">{tr('长图', 'Long')}</span> : null}
          {gif ? <span className="rounded-[3px] bg-black/50 px-1 text-[11px] font-medium leading-4 text-white">GIF</span> : null}
        </span>
      ) : null}
    </>
  );

  const box = { width, height, WebkitTouchCallout: 'none', touchAction: 'manipulation' } as const;
  const className = 'relative block shrink-0 select-none overflow-hidden bg-wx-line';
  const cellProps = { [MEDIA_CELL_ATTRIBUTE]: mediaCellValue(postId, index) };

  if (!onOpen) {
    return (
      <div {...cellProps} role="img" aria-label={label} className={className} style={box} onContextMenu={(event) => event.preventDefault()}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      {...cellProps}
      aria-label={label}
      className={className}
      style={box}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        if (failed && !localSrc) {
          retry();
          return;
        }
        onOpen(index, event.currentTarget.getBoundingClientRect());
      }}
    >
      {content}
    </button>
  );
}

/**
 * The WeChat grid: one sized box, two columns for four, otherwise up to three columns, with reserved boxes,
 * previews, the 长图 and GIF badges, and video tiles with our play glyph and duration.
 * 微信式宫格：单张按尺寸显示，四张为两列，其余最多三列；预留尺寸、使用预览图，带「长图」和 GIF 标记，视频格子带我们的播放标志和时长。
 */
export const MediaGrid = memo(function MediaGrid({ postId, media, localMedia = null, mediaToken, width, onOpen, onPreviewsLoaded }: MediaGridProps) {
  const measured = useContentWidth(width);
  const layout: MediaLayout | null = mediaLayout(media, measured.width);
  const localOnly = isLocalPostKey(postId);
  const ready = useRef(new Set<number>());
  const reported = useRef(false);
  const loadedRef = useRef(onPreviewsLoaded);
  const countRef = useRef(media.length);

  useLayoutEffect(() => {
    loadedRef.current = onPreviewsLoaded;
    countRef.current = media.length;
  });

  // Only server copies count; while the post is still local there is nothing to wait for yet.
  // 只计算服务器副本；动态仍在本地时还没有需要等待的内容。
  const onServerReady = useCallback(
    (index: number) => {
      if (localOnly || reported.current) return;
      ready.current.add(index);
      if (ready.current.size < countRef.current) return;
      reported.current = true;
      loadedRef.current?.();
    },
    [localOnly],
  );

  if (!layout) return null;

  const cell = (item: MomentMedia, index: number, boxWidth: number, boxHeight: number, align: 'top' | 'center', long: boolean) => {
    const local = localMedia?.[index] ?? null;
    if (item.kind === 'video') {
      return (
        <VideoTile
          key={`${index}:${item.key}`}
          media={item}
          local={local}
          previewSrc={localOnly ? null : storedSrc(item.previewKey, mediaToken)}
          videoSrc={localOnly ? null : storedSrc(item.key, mediaToken)}
          width={boxWidth}
          height={boxHeight}
          cell={mediaCellValue(postId, index)}
          onOpen={onOpen ? (rect) => onOpen(index, rect) : undefined}
          onServerReady={() => onServerReady(index)}
          onPreviewLoad={(src) => {
            if (item.previewKey) remember(item.previewKey, src);
          }}
        />
      );
    }
    return (
      <ImageCell
        key={`${index}:${item.key}`}
        postId={postId}
        index={index}
        count={media.length}
        item={item}
        local={local}
        localOnly={localOnly}
        mediaToken={mediaToken}
        width={boxWidth}
        height={boxHeight}
        align={align}
        long={long}
        onOpen={onOpen}
        onServerReady={onServerReady}
      />
    );
  };

  return (
    <div ref={measured.ref} className="mt-2">
      {layout.kind === 'single' ? (
        <div className="flex">
          {media[0] ? cell(media[0], 0, layout.box.width, layout.box.height, layout.box.align, layout.box.cropped && media[0].kind === 'image') : null}
        </div>
      ) : (
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${layout.columns}, ${layout.cell}px)`, gap: layout.gap, width: layout.width, height: layout.height }}
        >
          {media.map((item, index) => cell(item, index, layout.cell, layout.cell, 'center', false))}
        </div>
      )}
    </div>
  );
});
