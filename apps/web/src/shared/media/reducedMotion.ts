import { useSyncExternalStore } from 'react';

/**
 * The system's 减弱动态效果 / Reduce Motion setting, read live, so animated avatars turn still the moment it is
 * switched on. One media query and one listener serve every avatar on screen, however many there are. Safe in Node
 * and in old WebViews without matchMedia, where it reads false.
 * 系统的「减弱动态效果」设置，实时读取，开启的那一刻动态头像就会变成静态。屏幕上无论有多少头像，都只共用一个媒体查询和一个监听器。
 * 在 Node 和没有 matchMedia 的旧 WebView 中安全，读作 false。
 */

const QUERY = '(prefers-reduced-motion: reduce)';

/** Undefined until first asked; null where there is no matchMedia. */
/** 第一次读取之前为 undefined；没有 matchMedia 时为 null。 */
let shared: MediaQueryList | null | undefined;
const listeners = new Set<() => void>();

function query(): MediaQueryList | null {
  if (shared !== undefined) return shared;
  try {
    shared = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null;
  } catch {
    shared = null;
  }
  return shared;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function prefersReducedMotion(): boolean {
  return query()?.matches === true;
}

export function subscribeReducedMotion(onChange: () => void): () => void {
  const list = query();
  if (!list) return () => undefined;
  if (listeners.size === 0) {
    if (typeof list.addEventListener === 'function') list.addEventListener('change', notify);
    // Safari before 14 only has the older listener API.
    // 14 之前的 Safari 只有旧的监听接口。
    else list.addListener(notify);
  }
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
    if (listeners.size > 0) return;
    if (typeof list.removeEventListener === 'function') list.removeEventListener('change', notify);
    else list.removeListener(notify);
  };
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}
