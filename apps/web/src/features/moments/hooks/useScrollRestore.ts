import { useLayoutEffect, useRef } from 'react';
import type { FeedKey } from '../model';
import { READING_SCROLL_Y, useFeedStore } from '../state/feedStore';

export interface ScrollRestoreOptions {
  /** The list can show its content: from memory at once, or after page 1 or the device cache answered. */
  /** 列表已能显示内容：来自内存（立即），或第一页、设备缓存已返回之后。 */
  ready: boolean;
  /** The composer replaces the list: nothing is recorded, and the place comes back when it ends. */
  /** 编辑器替换了列表：期间不记录位置，结束后恢复原来的位置。 */
  paused?: boolean;
}

/**
 * Keeps the reader's place in a list of the document-scrolled moments pages. While mounted the browser's own
 * scroll restoration is off; the window's scrollY is followed on every scroll and handed to the feed store
 * (saveScroll) when the list pauses, when the page is left, and when the reader crosses READING_SCROLL_Y (past
 * the cover, where the store holds new posts back), so scrolling itself does not render. Once the list is
 * ready it is put back in a layout effect, before paint, which lands exactly because the store renders
 * synchronously and media boxes are reserved. Leaving the page resets the window to the top, so the next
 * screen does not open scrolled down; a screen that keeps its own place restores it after this.
 * 在按文档滚动的动态页面中保持阅读位置。挂载期间关闭浏览器自带的滚动恢复；每次滚动都记下 window 的 scrollY，在列表暂停、离开页面，
 * 以及读者越过 READING_SCROLL_Y（滚过封面，store 会在此之后留住新动态）时交给动态 store（saveScroll），因此滚动本身不会触发渲染。
 * 列表就绪后在 layout effect 中、绘制之前恢复位置；由于 store 同步渲染且媒体尺寸已预留，位置是准确的。离开页面时把 window 滚回顶部，
 * 下一个页面不会一打开就停在中间；自己保存位置的页面会在此之后再恢复。
 */
export function useScrollRestore(key: FeedKey, { ready, paused = false }: ScrollRestoreOptions): void {
  // The last scrollY seen while recording; never read from the window during a cleanup, when the page may be
  // half replaced and the browser would report a clamped value.
  // 记录期间最后一次看到的 scrollY；清理时绝不从 window 读取，因为页面那时可能已被部分替换，浏览器会报出被截断的值。
  const lastY = useRef<number | null>(null);

  useLayoutEffect(() => {
    const history = window.history;
    history.scrollRestoration = 'manual';
    return () => {
      // Always 'auto' on the way out, never the value found at mount: an entry reached by Back already holds
      // the 'manual' of an earlier visit, and putting that back would leak it to the pages outside moments.
      // 离开时总是设回 'auto'，而不是挂载时读到的值：通过返回到达的记录已经带着上一次访问留下的 'manual'，把它放回去会漏到动态以外的页面。
      history.scrollRestoration = 'auto';
      if (lastY.current !== null) useFeedStore.getState().saveScroll(key, lastY.current);
      window.scrollTo(0, 0);
    };
  }, [key]);

  useLayoutEffect(() => {
    if (!ready || paused) return;
    const saved = useFeedStore.getState().lists[key]?.scrollY ?? 0;
    window.scrollTo(0, saved);
    lastY.current = saved;
    let reading = saved > READING_SCROLL_Y;
    // A screen left just now may release a scroll lock after this effect, so the place is applied once more.
    // 刚离开的页面可能在这个 effect 之后才解除滚动锁定，所以再设置一次位置。
    const frame = requestAnimationFrame(() => {
      if (saved > 0 && Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
    });
    const remember = () => {
      const y = Math.max(0, window.scrollY);
      lastY.current = y;
      // The store holds new posts back while the reader is past the cover, so it hears about that edge at once.
      // 读者滚过封面后，store 会把新动态留住，因此越过这条边时立即告诉它。
      if ((y > READING_SCROLL_Y) !== reading) {
        reading = !reading;
        useFeedStore.getState().saveScroll(key, y);
      }
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', remember);
      if (lastY.current !== null) useFeedStore.getState().saveScroll(key, lastY.current);
    };
  }, [key, ready, paused]);
}
