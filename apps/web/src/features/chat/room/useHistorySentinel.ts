import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface Options {
  rootRef: RefObject<HTMLElement | null>;
  sentinelRef: RefObject<HTMLElement | null>;
  hasMore: boolean;
  loadingOlder: boolean;
  /** Read when a load is about to start, for example false until the list has been positioned. */
  /** 即将开始加载时读取，例如列表定位完成之前为 false。 */
  canLoad(): boolean;
  loadOlder(): void;
  /** Runs right before loadOlder, so the scroll anchor is fresh when the page lands. */
  /** 在 loadOlder 之前执行，新的一页到达时滚动锚点是最新的。 */
  onBeforeLoad(): void;
  /** Any value that changes when rows change, so the check runs again after every result. */
  /** 消息变化时随之变化的任意值，使每次结果之后都会再次检查。 */
  version: unknown;
}

/** Prefetch distance above the visible area, as a share of the list height. */
/** 可见区域上方的预取距离，以列表高度的倍数计。 */
const PREFETCH_SCREENS = 1.5;
const ROOT_MARGIN = `${PREFETCH_SCREENS * 100}% 0px 0px 0px`;

/**
 * Loads older pages from a sentinel at the top of the list, observed with a 150% top margin. It keeps
 * loading while the sentinel stays within that margin or while the rows do not fill the list, and never
 * listens to scroll events.
 * 通过列表顶部的哨兵加载更早的消息，观察范围向上扩展 150%。只要哨兵仍在该范围内、或消息填不满列表，就继续加载；
 * 从不监听滚动事件。
 */
export function useHistorySentinel(options: Options): void {
  const latest = useRef(options);
  const { rootRef, sentinelRef, hasMore, loadingOlder, version } = options;

  useLayoutEffect(() => {
    latest.current = options;
  });

  const check = useCallback(() => {
    const { canLoad, loadOlder, onBeforeLoad } = latest.current;
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !latest.current.hasMore || latest.current.loadingOlder || !canLoad()) return;
    const short = root.scrollHeight <= root.clientHeight + 1;
    const rootRect = root.getBoundingClientRect();
    const rect = sentinel.getBoundingClientRect();
    const near = rect.bottom >= rootRect.top - rootRect.height * PREFETCH_SCREENS && rect.top <= rootRect.bottom;
    if (!short && !near) return;
    onBeforeLoad();
    loadOlder();
  }, [rootRef, sentinelRef]);

  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) check();
      },
      { root, rootMargin: ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [rootRef, sentinelRef, check]);

  // The observer only reports changes, so a sentinel that is still in range after a page lands, or a page
  // too short to scroll, needs this second look.
  // 观察器只报告变化；新的一页到达后哨兵仍在范围内，或内容太短无法滚动时，需要这里再检查一次。
  useEffect(() => {
    check();
  }, [hasMore, loadingOlder, version, check]);
}
