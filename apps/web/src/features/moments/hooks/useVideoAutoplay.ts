import { useEffect, useState } from 'react';
import { isOnScreen, onScreenChange } from '../../../shared/native/onScreen';

/**
 * Inline muted autoplay of feed videos, WeChat style, but only where it costs the member nothing: on Wi-Fi
 * (navigator.connection.type, which iPhone Safari does not expose, so iPhone stays tap to play), without
 * Save-Data, without reduced motion, while the page is on screen, and for one tile at a time that is at least
 * 60% visible. Tapping a tile suspends autoplay until the overlay it opened closes.
 * 微信式的信息流视频静音自动播放，但只在不额外消耗成员流量时进行：连接 Wi-Fi（navigator.connection.type；iPhone Safari
 * 不提供它，因此 iPhone 仍为轻触播放）、未开启省流量、未开启减少动态效果、页面显示在屏幕上，并且同一时间只播放一个可见面积
 * 至少 60% 的格子。轻触格子后自动播放暂停，直到它打开的浮层关闭。
 */

/** Share of a tile that must be on screen before it plays. */
/** 格子至少有这一比例显示在屏幕上才会播放。 */
const VISIBLE_SHARE = 0.6;
/** Visibility ratios closer than this count as equal, so the upper tile wins. */
/** 可见比例相差小于此值视为相同，由位置更靠上的格子播放。 */
const RATIO_EPSILON = 0.01;

interface NetworkInformationLike {
  type?: string;
  saveData?: boolean;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

function connection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null;
}

function reducedMotion(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}

/** Whether this device and its settings allow inline autoplay at all right now. */
/** 当前这台设备及其设置是否允许内联自动播放。 */
export function autoplayAllowed(): boolean {
  const net = connection();
  if (!net || net.type !== 'wifi' || net.saveData === true) return false;
  if (reducedMotion()?.matches) return false;
  return typeof IntersectionObserver !== 'undefined';
}

interface Tile {
  element: HTMLElement;
  ratio: number;
  top: number;
  setActive: (active: boolean) => void;
}

const tiles = new Map<HTMLElement, Tile>();
let observer: IntersectionObserver | null = null;
let active: Tile | null = null;
let allowed = false;
let suspended = false;
let detachGlobal: (() => void) | null = null;

function choose(): void {
  const running = allowed && !suspended && isOnScreen();
  let next: Tile | null = null;
  if (running) {
    // The playing tile keeps playing while it stays visible enough, so two tiles on screen never swap back and forth.
    // 正在播放的格子只要仍足够可见就继续播放，屏幕上的两个格子因此不会来回切换。
    if (active && tiles.get(active.element) === active && active.ratio >= VISIBLE_SHARE) {
      next = active;
    } else {
      for (const tile of tiles.values()) {
        if (tile.ratio < VISIBLE_SHARE) continue;
        if (!next || tile.ratio > next.ratio + RATIO_EPSILON || (Math.abs(tile.ratio - next.ratio) <= RATIO_EPSILON && tile.top < next.top)) next = tile;
      }
    }
  }
  if (next === active) return;
  active?.setActive(false);
  active = next;
  next?.setActive(true);
}

function attachGlobal(): () => void {
  const net = connection();
  const motion = reducedMotion();
  const refresh = () => {
    allowed = autoplayAllowed();
    choose();
  };
  // An overlay opened from a tile (the player) closes through history, so the next popstate resumes autoplay.
  // 从格子打开的浮层（播放器）通过历史记录关闭，因此下一次 popstate 时恢复自动播放。
  const resume = () => {
    if (!suspended) return;
    suspended = false;
    choose();
  };
  net?.addEventListener?.('change', refresh);
  motion?.addEventListener?.('change', refresh);
  window.addEventListener('popstate', resume);
  const stopScreen = onScreenChange(() => choose());
  allowed = autoplayAllowed();
  return () => {
    net?.removeEventListener?.('change', refresh);
    motion?.removeEventListener?.('change', refresh);
    window.removeEventListener('popstate', resume);
    stopScreen();
  };
}

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const tile = tiles.get(entry.target as HTMLElement);
        if (!tile) continue;
        tile.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
        tile.top = entry.boundingClientRect.top;
      }
      choose();
    },
    { threshold: [0, 0.3, VISIBLE_SHARE, 0.8, 1] },
  );
  return observer;
}

function register(element: HTMLElement, setActive: (active: boolean) => void): () => void {
  const io = ensureObserver();
  if (!io) return () => undefined;
  const tile: Tile = { element, ratio: 0, top: Number.POSITIVE_INFINITY, setActive };
  tiles.set(element, tile);
  detachGlobal ??= attachGlobal();
  io.observe(element);
  return () => {
    io.unobserve(element);
    if (tiles.get(element) === tile) tiles.delete(element);
    if (active === tile) {
      active = null;
      setActive(false);
      choose();
    }
    if (tiles.size === 0) {
      detachGlobal?.();
      detachGlobal = null;
      observer?.disconnect();
      observer = null;
      suspended = false;
    }
  };
}

/**
 * Stops inline autoplay while an overlay opened from a tile is up; the next history pop resumes it. Call it
 * in the tap that opens the player.
 * 在从格子打开的浮层显示期间停止内联自动播放；下一次历史记录弹出时恢复。在打开播放器的那次点击中调用。
 */
export function suspendAutoplay(): void {
  suspended = true;
  choose();
}

/**
 * Registers a video tile with the page's autoplay coordinator while `enabled`. Attach `ref` to the tile;
 * `active` is true while this tile is the one that should play muted inline.
 * 在 `enabled` 期间把一个视频格子登记到页面的自动播放协调器。把 `ref` 挂到格子上；`active` 为 true 表示应由这个格子静音内联播放。
 */
export function useVideoAutoplay<T extends HTMLElement>(enabled: boolean): { ref: (element: T | null) => void; active: boolean } {
  const [element, setElement] = useState<T | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!enabled || !element) return;
    const unregister = register(element, setPlaying);
    return () => {
      unregister();
      setPlaying(false);
    };
  }, [enabled, element]);

  return { ref: setElement, active: enabled && playing };
}
