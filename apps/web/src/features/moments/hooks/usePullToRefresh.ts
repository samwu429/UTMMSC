import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isAppleTouchDevice } from '../../../shared/native/platform';
import {
  MIN_REFRESH_MS,
  movePullGesture,
  pullAngle,
  pullProgress,
  releasesRefresh,
  rubberBandPull,
  settlePull,
  startPullGesture,
  type PullGesture,
} from '../layout/pull';

/** How far the page is pulled, in px; the cover image grows upward by it. */
/** 页面被下拉的距离（像素）；封面图片向上伸展同样的距离。 */
export const PULL_VAR = '--pull';
/** 0 at rest, 1 once letting go refreshes; the indicator fades and slides in with it. */
/** 静止时为 0，松手即刷新时为 1；指示器随之淡入并滑入。 */
export const PULL_PROGRESS_VAR = '--pull-progress';
/** The indicator's turn, in deg. */
/** 指示器转动的角度（deg）。 */
export const PULL_ANGLE_VAR = '--pull-angle';

export interface PullToRefreshOptions {
  /** Receives the variables above; the cover and the indicator inside it read them. */
  /** 接收上面这些变量；其中的封面和指示器读取它们。 */
  rootRef: RefObject<HTMLElement>;
  /** The scrolling content: the Android pull moves it down, and only touches that start in it can pull. */
  /** 滚动的内容：安卓下拉时把它向下移动，并且只有从它里面开始的触摸才能下拉。 */
  contentRef: RefObject<HTMLElement>;
  /** False while the composer replaces the content. */
  /** 编辑器替换内容期间为 false。 */
  enabled: boolean;
  /**
   * Whether a touch on `target` may pull. By default any touch inside the content; a page with fixed sheets
   * inside its content leaves those out.
   * `target` 上的触摸能否下拉。默认内容中的任何触摸都可以；内容中含有 fixed 菜单的页面会把它们排除在外。
   */
  startsPull?: (target: EventTarget | null, content: HTMLElement) => boolean;
  onRefresh(): Promise<unknown>;
}

function insideContent(target: EventTarget | null, content: HTMLElement): boolean {
  return target instanceof Node && content.contains(target);
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * WeChat pull to refresh on a document-scrolled page. iPhone keeps the native rubber band: a passive scroll
 * listener reads the pull from the negative scrollY, and letting go at 64px or more refreshes; preventDefault
 * is never called. Android has no bounce, so while mounted html gets overscroll-behavior-y: none (which also
 * stops Chrome's own pull-to-reload) and a touch that starts at the very top and moves down pulls the content
 * at half the finger's speed, up to 120px. The variables are written once per frame without rendering;
 * `refreshing` stays true for at least 500 ms. Reduced motion keeps the pull but not the stretch or the turn.
 * 按文档滚动页面上的微信式下拉刷新。iPhone 保留系统回弹：被动的 scroll 监听从负的 scrollY 读出下拉距离，下拉 64px 及以上松手即刷新；
 * 从不调用 preventDefault。安卓没有回弹，因此挂载期间给 html 设置 overscroll-behavior-y: none（同时关掉 Chrome 自带的下拉重新加载），
 * 从最顶部开始且向下移动的触摸会以手指一半的速度拉动内容，最多 120px。变量每帧最多写一次，不触发渲染；`refreshing` 至少保持 500 毫秒。
 * 减少动态效果时保留下拉，但不拉伸封面也不转动图标。
 */
export function usePullToRefresh({ rootRef, contentRef, enabled, startsPull = insideContent, onRefresh }: PullToRefreshOptions): { refreshing: boolean } {
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const onRefreshRef = useRef(onRefresh);
  const startsPullRef = useRef(startsPull);

  useLayoutEffect(() => {
    onRefreshRef.current = onRefresh;
    startsPullRef.current = startsPull;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // For the whole visit, also while the pull is off (the composer), so Chrome never reloads the page under a draft.
  // 在整个访问期间都设置，包括下拉关闭时（编辑器打开），Chrome 因此不会在草稿下重新加载页面。
  useEffect(() => {
    if (isAppleTouchDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return;
    const html = document.documentElement;
    const saved = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = 'none';
    return () => {
      html.style.overscrollBehaviorY = saved;
    };
  }, []);

  const run = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    const minimum = new Promise<void>((resolve) => setTimeout(resolve, MIN_REFRESH_MS));
    const work = Promise.resolve()
      .then(() => onRefreshRef.current())
      .catch(() => undefined);
    void Promise.all([work, minimum]).then(() => {
      busy.current = false;
      if (mounted.current) setRefreshing(false);
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    const content = contentRef.current;
    if (!root || !content) return;
    const reduce = prefersReducedMotion();
    const apple = isAppleTouchDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0);
    let frame = 0;
    let pending = 0;
    let settling = 0;

    const apply = (pull: number) => {
      root.style.setProperty(PULL_VAR, `${reduce ? 0 : Math.round(pull * 10) / 10}px`);
      root.style.setProperty(PULL_PROGRESS_VAR, pullProgress(pull).toFixed(3));
      root.style.setProperty(PULL_ANGLE_VAR, `${reduce ? 0 : Math.round(pullAngle(pull))}deg`);
      // A transform makes the content the containing block of fixed children, so it is only set while pulling.
      // transform 会让内容成为 fixed 子元素的包含块，所以只在下拉期间设置。
      if (!apple) content.style.transform = pull > 0 && !reduce ? `translate3d(0, ${pull}px, 0)` : '';
    };
    const write = (pull: number) => {
      pending = pull;
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(pending);
        });
      }
    };
    const stopFrames = () => {
      if (frame) cancelAnimationFrame(frame);
      if (settling) cancelAnimationFrame(settling);
      frame = 0;
      settling = 0;
    };

    if (apple) {
      const onScroll = () => write(rubberBandPull(window.scrollY));
      const onTouchEnd = () => {
        if (releasesRefresh(rubberBandPull(window.scrollY))) run();
      };
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('touchend', onTouchEnd, { passive: true });
      return () => {
        window.removeEventListener('scroll', onScroll);
        window.removeEventListener('touchend', onTouchEnd);
        stopFrames();
        apply(0);
      };
    }

    let gesture: PullGesture | null = null;

    const settle = (from: number) => {
      stopFrames();
      if (reduce || from <= 0) {
        apply(0);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const pull = settlePull(from, now - start);
        apply(pull);
        settling = pull > 0 ? requestAnimationFrame(step) : 0;
      };
      settling = requestAnimationFrame(step);
    };
    const finish = (mayRefresh: boolean) => {
      const done = gesture;
      gesture = null;
      if (!done?.engaged) return;
      if (mayRefresh && releasesRefresh(done.pull)) run();
      settle(done.pull);
    };
    const onTouchStart = (event: TouchEvent) => {
      gesture = null;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || busy.current || window.scrollY > 0) return;
      // Overlays and sheets own their drags; those must never pull the page.
      // 浮层和菜单自己处理拖动；这些拖动绝不能拉动页面。
      if (!startsPullRef.current(event.target, content)) return;
      if (settling) settle(0);
      gesture = startPullGesture(touch.clientX, touch.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) {
        // A second finger is a pinch, not a pull.
        // 第二根手指是双指缩放，不是下拉。
        finish(false);
        return;
      }
      gesture = movePullGesture(gesture, touch.clientX, touch.clientY, window.scrollY);
      if (!gesture?.engaged) return;
      if (event.cancelable) event.preventDefault();
      write(gesture.pull);
    };
    const onTouchEnd = () => finish(true);
    const onTouchCancel = () => finish(false);

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchCancel);
      stopFrames();
      apply(0);
    };
  }, [enabled, rootRef, contentRef, run]);

  return { refreshing };
}
