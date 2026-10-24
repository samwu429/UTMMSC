import { useEffect, useRef, type CSSProperties } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { PULL_ANGLE_VAR, PULL_PROGRESS_VAR } from '../hooks/usePullToRefresh';
import type { LoadState } from '../model';

/**
 * The states around the cards of a moments list: skeletons while page 1 loads, the empty and error states,
 * the offline banner, the list footer with its load-more sentinel, and the pull indicator.
 * 动态列表中卡片周围的各种状态：第一页加载时的骨架、空状态和错误状态、离线横幅、带加载更多哨兵的列表底部，以及下拉指示器。
 */

function SkeletonPost() {
  return (
    <div className="flex gap-2.5 border-b-[0.5px] border-wx-line px-4 py-4" aria-hidden>
      <div className="h-[42px] w-[42px] shrink-0 rounded-[4px] bg-stone-200" />
      <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
        <div className="h-4 w-24 rounded bg-stone-200" />
        <div className="h-3.5 w-full rounded bg-stone-100" />
        <div className="h-3.5 w-3/4 rounded bg-stone-100" />
        <div className="h-[104px] w-[104px] rounded-[2px] bg-stone-100" />
      </div>
    </div>
  );
}

/** Three placeholder posts while page 1 loads with nothing cached. */
/** 第一页加载中且没有缓存时显示的三条占位动态。 */
export function FeedSkeleton() {
  const tr = useTr();
  return (
    <div role="status" aria-label={tr('加载中', 'Loading')} className="motion-safe:animate-pulse">
      <SkeletonPost />
      <SkeletonPost />
      <SkeletonPost />
    </div>
  );
}

export interface FeedEmptyProps {
  /** The member has no friends yet, so the way forward is 通讯录. */
  /** 成员还没有好友，所以出路是「通讯录」。 */
  noFriends: boolean;
  onOpenContacts(): void;
  onPost(): void;
}

/** 加好友后，就能在这里看到他们的动态 [去通讯录] [发一条], or 朋友们还没有发动态 [发一条]. */
/** 「加好友后，就能在这里看到他们的动态」[去通讯录] [发一条]，或「朋友们还没有发动态」[发一条]。 */
export function FeedEmpty({ noFriends, onOpenContacts, onPost }: FeedEmptyProps) {
  const tr = useTr();
  return (
    <div className="flex flex-col items-center px-8 pb-16 pt-14 text-center">
      <p className="text-[15px] leading-6 text-wx-meta">
        {noFriends ? tr('加好友后，就能在这里看到他们的动态', 'Add friends to see their updates here') : tr('朋友们还没有发动态', "Your friends haven't posted yet")}
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        {noFriends ? (
          <button type="button" onClick={onOpenContacts} className="min-h-11 rounded-[4px] bg-wx-bar px-5 text-[15px] font-medium text-wx-link active:bg-wx-pressed">
            {tr('去通讯录', 'Open contacts')}
          </button>
        ) : null}
        <button type="button" onClick={onPost} className="min-h-11 rounded-[4px] bg-wx-bar px-5 text-[15px] font-medium text-wx-link active:bg-wx-pressed">
          {tr('发一条', 'Post one')}
        </button>
      </div>
    </div>
  );
}

/** Page 1 failed with nothing to show: 加载失败，轻触重试. */
/** 第一页加载失败且没有可显示的内容：「加载失败，轻触重试」。 */
export function FeedError({ message, onRetry }: { message?: string | null; onRetry(): void }) {
  const tr = useTr();
  return (
    <div className="flex flex-col items-center px-8 pb-16 pt-14 text-center">
      {message ? <p className="mb-1 text-[14px] leading-5 text-wx-meta">{message}</p> : null}
      <button type="button" onClick={onRetry} className="min-h-11 px-4 text-[15px] text-wx-link">
        {tr('加载失败，轻触重试', "Couldn't load. Tap to retry")}
      </button>
    </div>
  );
}

/**
 * Over content that loaded earlier: offline (网络不可用，显示的是上次加载的内容), or a refresh that failed with
 * `error`, which a tap retries.
 * 显示在之前加载的内容上方：离线时（网络不可用，显示的是上次加载的内容），或刷新失败时显示 `error`，轻触可重试。
 */
export function OfflineBanner({ offline, error, onRetry }: { offline: boolean; error: string | null; onRetry(): void }) {
  const tr = useTr();
  if (!offline && !error) return null;
  const icon = (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-wx-red" fill="currentColor" aria-hidden>
      <path d="M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19Zm-.9 5h1.8l-.3 6.5h-1.2l-.3-6.5Zm.9 9.6a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
    </svg>
  );
  const row = 'flex min-h-12 w-full items-center gap-3 border-y-[0.5px] border-wx-line bg-white px-4 py-2.5 text-left text-[14px] leading-snug text-wx-ink';
  if (offline) {
    return (
      <div role="status" className={row}>
        {icon}
        <span className="min-w-0 flex-1">{tr('网络不可用，显示的是上次加载的内容', "You're offline. Showing what loaded last")}</span>
      </div>
    );
  }
  return (
    <button type="button" onClick={onRetry} className={`${row} active:bg-wx-pressed`}>
      {icon}
      <span className="min-w-0 flex-1">{error}</span>
      <span className="shrink-0 text-wx-link">{tr('重试', 'Retry')}</span>
    </button>
  );
}

export interface ListFooterProps {
  more: LoadState;
  /** Another page exists. */
  /** 还有下一页。 */
  hasMore: boolean;
  /** Something is listed, so 没有更多了 means something. */
  /** 列表中有内容，「没有更多了」才有意义。 */
  hasItems: boolean;
  onLoadMore(): void;
}

/**
 * The end of a list: a sentinel 150% of the screen below the fold asks for the next page early, then a spinner,
 * 加载失败，轻触重试, or 没有更多了.
 * 列表的末尾：位于首屏下方 150% 屏幕高度处的哨兵提前请求下一页，然后显示转圈、「加载失败，轻触重试」或「没有更多了」。
 */
export function ListFooter({ more, hasMore, hasItems, onLoadMore }: ListFooterProps) {
  const tr = useTr();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadRef = useRef(onLoadMore);

  useEffect(() => {
    loadRef.current = onLoadMore;
  });

  // A fresh observer whenever a load settles reports the sentinel's place at once, so a short page that leaves
  // the sentinel on screen keeps loading.
  // 每次加载结束后重新创建观察器，它会立即报告哨兵的位置；页面很短、哨兵仍在屏幕上时会继续加载。
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || more !== 'idle' || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadRef.current();
      },
      { rootMargin: '0px 0px 150% 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, more]);

  return (
    <div className="relative">
      <div ref={sentinelRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" />
      {more === 'loading' ? (
        <div className="flex min-h-16 items-center justify-center">
          <WxSpinner />
        </div>
      ) : more === 'failed' ? (
        <div className="flex min-h-16 items-center justify-center">
          <button type="button" onClick={onLoadMore} className="min-h-11 px-4 text-[14px] text-wx-link">
            {tr('加载失败，轻触重试', "Couldn't load. Tap to retry")}
          </button>
        </div>
      ) : !hasMore && hasItems ? (
        <div className="flex min-h-16 items-center justify-center gap-3 px-16 text-[13px] text-wx-meta">
          <span aria-hidden className="h-[0.5px] flex-1 bg-wx-line" />
          <span>{tr('没有更多了', "That's everything")}</span>
          <span aria-hidden className="h-[0.5px] flex-1 bg-wx-line" />
        </div>
      ) : (
        <div className="min-h-16" />
      )}
    </div>
  );
}

const INDICATOR: CSSProperties = {
  top: 'calc(var(--safe-top) + 52px)',
  left: 'calc(16px + var(--safe-left))',
  opacity: `var(${PULL_PROGRESS_VAR}, 0)`,
  transform: `translate3d(0, calc((var(${PULL_PROGRESS_VAR}, 0) - 1) * 24px), 0) rotate(var(${PULL_ANGLE_VAR}, 0deg))`,
};

const INDICATOR_BUSY: CSSProperties = {
  top: INDICATOR.top,
  left: INDICATOR.left,
  opacity: 1,
  transform: 'none',
};

/**
 * The WeChat refresh disc at the top left under the header. While pulling it fades and slides in and turns
 * with the pull (read from the variables usePullToRefresh writes); while refreshing it stays and spins.
 * 顶栏下方左上角的微信式刷新圆盘。下拉时随下拉距离淡入、滑入并转动（读取 usePullToRefresh 写入的变量）；刷新期间停在原处并旋转。
 */
export function PullIndicator({ refreshing, hidden = false }: { refreshing: boolean; hidden?: boolean }) {
  // Not rendered rather than given the hidden attribute, which its display class would override.
  // 隐藏时不渲染，而不是加 hidden 属性，因为它的 display 类会覆盖该属性。
  if (hidden) return null;
  return (
    <div
      aria-hidden
      className={`pointer-events-none fixed z-20 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] ${
        refreshing ? 'transition-opacity duration-200' : '[&_.wx-spinner]:[animation-play-state:paused]'
      }`}
      style={refreshing ? INDICATOR_BUSY : INDICATOR}
    >
      <WxSpinner size={20} />
    </div>
  );
}
