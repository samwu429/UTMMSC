/**
 * Owner: T3, timetable web core. Media queries as React state, read synchronously on the first render so the
 * layout never flips after mounting: the short landscape window and reduced motion.
 * 维护者：T3，课表网页核心。以 React 状态提供的媒体查询，首次渲染时同步读取，因此挂载后布局不会突然切换：较矮的横屏窗口和减少动态效果。
 */
import { useCallback, useSyncExternalStore } from 'react';

/** The grid's short landscape layout, as in timetable.css. */
/** 课表的较矮横屏布局，与 timetable.css 一致。 */
export const COMPACT_QUERY = '(max-height: 500px) and (orientation: landscape)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function list(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      const media = list(query);
      if (!media) return () => undefined;
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    },
    [query],
  );
  const read = useCallback(() => list(query)?.matches ?? false, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Read once, outside React: whether animations should be skipped right now. */
/** 在 React 之外读取一次：现在是否应当跳过动画。 */
export function prefersReducedMotion(): boolean {
  return list(REDUCED_MOTION_QUERY)?.matches ?? false;
}
