import { useLayoutEffect, useState, type RefObject } from 'react';
import { COVER_HEIGHT, HEADER_HEIGHT, headerProgress, isPastCover } from '../layout/pull';

/** Read by MomentsHeader: 0 while transparent over the cover, 1 once solid. */
/** 由 MomentsHeader 读取：覆盖在封面上方、透明时为 0，不透明时为 1。 */
export const HEADER_PROGRESS_VAR = '--header-p';

/** Above this the header takes taps itself instead of letting them through to the cover under it. */
/** 超过这个值后，顶栏自己接收点按，不再让点按穿透到下面的封面。 */
const SOLID_FROM = 0.5;

export interface HeaderProgressOptions {
  /** The cover under the header, in px; 192 on the home feed and the album. */
  /** 顶栏下方封面的高度（像素）；动态首页和相册为 192。 */
  coverHeight?: number;
  enabled?: boolean;
}

/**
 * Fades the fixed header in over the cover as the page scrolls: every scroll writes headerProgress(scrollY) to
 * --header-p on the header and data-solid="true" once it is mostly opaque, without a React render. Returns
 * whether the cover has gone under the header, which only changes at that edge, for 有 N 条新动态. The header
 * element must stay mounted (hide it with `hidden`), because the ref is read once.
 * 页面滚动时让固定顶栏在封面上方渐显：每次滚动都把 headerProgress(scrollY) 写到顶栏的 --header-p，基本不透明后写入
 * data-solid="true"，不触发 React 渲染。返回封面是否已滚到顶栏下面，只在越过那条边时变化，供「有 N 条新动态」使用。
 * 顶栏元素必须一直挂载（用 `hidden` 隐藏），因为 ref 只读取一次。
 */
export function useHeaderProgress(headerRef: RefObject<HTMLElement>, { coverHeight = COVER_HEIGHT, enabled = true }: HeaderProgressOptions = {}): boolean {
  const [pastCover, setPastCover] = useState(false);

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header || !enabled) return;
    let solid: boolean | null = null;
    const update = () => {
      const scrollY = window.scrollY;
      const progress = headerProgress(scrollY, coverHeight, HEADER_HEIGHT);
      header.style.setProperty(HEADER_PROGRESS_VAR, progress.toFixed(3));
      const nextSolid = progress >= SOLID_FROM;
      if (nextSolid !== solid) {
        solid = nextSolid;
        header.dataset.solid = nextSolid ? 'true' : 'false';
      }
      setPastCover(isPastCover(scrollY, coverHeight, HEADER_HEIGHT));
    };
    update();
    // Scroll events already come at most once per frame; writing at once keeps the restored first frame right.
    // 滚动事件本来就每帧最多一次；立即写入可以让恢复位置后的第一帧也正确。
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [headerRef, coverHeight, enabled]);

  return pastCover;
}
