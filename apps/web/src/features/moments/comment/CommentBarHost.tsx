import { useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useVisualViewportOverlay } from '../../chat/room/useVisualViewport';
import { CommentBar } from './CommentBar';

export interface CommentBarHostProps {
  /** Px under the safe area covered by the page's fixed header, so a target is never aligned under it. 44 by default. */
  /** 页面固定顶栏在安全区下方遮住的高度（像素），对齐时目标不会落在它下面。默认 44。 */
  headerHeight?: number;
}

/**
 * Always-mounted fixed layer pinned to the visual viewport with the comment bar at its bottom. Closed, it is
 * moved off screen (never display:none, hidden or inert, which iOS cannot focus). Mount one per page.
 * 始终挂载的固定层，贴合可视视口，评论栏位于其底部。关闭时移到屏幕外（从不使用 display:none、hidden 或 inert，否则 iOS 无法聚焦）。
 * 每个页面挂载一个。
 */
export function CommentBarHost({ headerHeight = 44 }: CommentBarHostProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const safeTopRef = useRef<HTMLDivElement>(null);
  // Only pins the layer; the page keeps scrolling the document, which useVisualViewport would lock.
  // 只固定这一层；页面仍然滚动文档，而 useVisualViewport 会锁定文档滚动。
  useVisualViewportOverlay(rootRef);
  // var(--safe-top) resolved to px by a probe, since the custom property itself holds an unresolved max().
  // 用探测元素把 var(--safe-top) 换算成像素，因为该自定义属性本身保存的是未计算的 max()。
  const safeTop = useCallback(() => safeTopRef.current?.offsetHeight ?? 0, []);

  return createPortal(
    <div ref={rootRef} className="pointer-events-none fixed inset-x-0 top-0 z-40 flex h-full flex-col justify-end overflow-hidden">
      <div ref={safeTopRef} aria-hidden className="invisible absolute left-0 top-0 w-0" style={{ height: 'var(--safe-top)' }} />
      <CommentBar headerHeight={headerHeight} safeTop={safeTop} />
    </div>,
    document.body,
  );
}
