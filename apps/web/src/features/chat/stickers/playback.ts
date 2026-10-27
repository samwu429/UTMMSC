import { useEffect, useRef, useState } from 'react';
import { STICKER_PLAYING_MAX } from './media';

/**
 * How many animated stickers move at once. Each decoded animation holds its frames in memory, so a chat plays at most
 * 8 (the newest on screen) and a grid at most 24 (the first on screen); the others, and every one scrolled away,
 * show their still. One IntersectionObserver per scope watches every registered sticker.
 * 同时播放的动态表情数量。每个解码后的动画都会在内存中保留它的帧，所以聊天中最多播放 8 个（屏幕上最新的），
 * 表情格子中最多 24 个（屏幕上最靠前的）；其余的以及所有滚出屏幕的都显示静态图。每个范围用一个 IntersectionObserver 观察所有登记的表情。
 */

export type StickerPlaybackScope = 'chat' | 'grid';

/** Stickers within this distance of the screen count as on screen, so one scrolled in is already moving. */
/** 距离屏幕这么近的表情视为在屏幕上，滚动进来的表情因此已经在播放。 */
const ROOT_MARGIN = '200px';

/**
 * The keys that may play: the `max` highest ranks, earlier candidates first among equal ranks.
 * 可以播放的键：名次最高的 `max` 个；名次相同时先出现的候选优先。
 */
export function choosePlaying(candidates: readonly { key: string; rank: number }[], max: number): Set<string> {
  const limit = Math.max(0, Math.floor(max));
  const order = candidates.map((candidate, index) => ({ ...candidate, index }));
  order.sort((a, b) => b.rank - a.rank || a.index - b.index);
  const playing = new Set<string>();
  for (const candidate of order) {
    if (playing.size >= limit) break;
    playing.add(candidate.key);
  }
  return playing;
}

interface Entry {
  key: string;
  /** Higher plays first: the message id in a chat, the negated index in a grid. */
  /** 越高越先播放：聊天中为消息 id，表情格子中为序号取负。 */
  rank: number;
  eligible: boolean;
  element: Element | null;
  visible: boolean;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
}

interface Scope {
  entries: Set<Entry>;
  byElement: Map<Element, Entry>;
  observer: IntersectionObserver | null | undefined;
  scheduled: boolean;
}

const scopes: Record<StickerPlaybackScope, Scope> = {
  chat: { entries: new Set(), byElement: new Map(), observer: undefined, scheduled: false },
  grid: { entries: new Set(), byElement: new Map(), observer: undefined, scheduled: false },
};

function decide(name: StickerPlaybackScope): void {
  const scope = scopes[name];
  scope.scheduled = false;
  const candidates: { key: string; rank: number }[] = [];
  for (const entry of scope.entries) {
    if (entry.eligible && entry.element && entry.visible) candidates.push({ key: entry.key, rank: entry.rank });
  }
  const playing = choosePlaying(candidates, STICKER_PLAYING_MAX[name]);
  for (const entry of scope.entries) {
    const next = entry.eligible && entry.element !== null && entry.visible && playing.has(entry.key);
    if (next === entry.playing) continue;
    entry.playing = next;
    entry.setPlaying(next);
  }
}

/** Decides once after a burst of changes, such as a grid of 999 tiles mounting. */
/** 一连串变化（例如 999 个格子同时挂载）之后只判断一次。 */
function schedule(name: StickerPlaybackScope): void {
  const scope = scopes[name];
  if (scope.scheduled) return;
  scope.scheduled = true;
  queueMicrotask(() => decide(name));
}

/** The scope's observer, or null where the browser has none (every registered sticker then counts as on screen). */
/** 该范围的观察器；浏览器没有时为 null（这时每个登记的表情都视为在屏幕上）。 */
function observerOf(name: StickerPlaybackScope): IntersectionObserver | null {
  const scope = scopes[name];
  if (scope.observer !== undefined) return scope.observer;
  scope.observer =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (records) => {
            for (const record of records) {
              const entry = scope.byElement.get(record.target);
              if (entry) entry.visible = record.isIntersecting;
            }
            schedule(name);
          },
          { rootMargin: ROOT_MARGIN },
        );
  return scope.observer;
}

function attach(name: StickerPlaybackScope, entry: Entry, element: Element): () => void {
  const scope = scopes[name];
  const observer = observerOf(name);
  entry.element = element;
  entry.visible = observer === null;
  scope.entries.add(entry);
  scope.byElement.set(element, entry);
  observer?.observe(element);
  schedule(name);
  return () => {
    observer?.unobserve(element);
    if (scope.byElement.get(element) === entry) scope.byElement.delete(element);
    scope.entries.delete(entry);
    entry.element = null;
    entry.visible = false;
    if (entry.playing) {
      entry.playing = false;
      entry.setPlaying(false);
    }
    schedule(name);
    if (scope.entries.size === 0 && scope.observer) {
      scope.observer.disconnect();
      scope.observer = undefined;
    }
  };
}

/**
 * Registers one animated sticker with its scope's playback limit. Attach `ref` to the sticker's element; `playing`
 * is true while it may move, and false while it should show its still. `rank` is the message id in a chat (newest
 * wins) and the tile index in a grid (first wins). A sticker that is not `eligible` (static, too large, reduced
 * motion) never plays and takes no place.
 * 把一个动态表情登记到所在范围的播放上限中。把 `ref` 挂到表情元素上；`playing` 为 true 时可以播放，为 false 时应显示静态图。
 * `rank` 在聊天中为消息 id（最新的优先），在表情格子中为格子序号（最靠前的优先）。不 `eligible` 的表情（静态、过大、减弱动态效果）
 * 永远不播放，也不占名额。
 */
export function useStickerPlayback(
  key: string,
  rank: number,
  eligible: boolean,
  scope: StickerPlaybackScope,
): { ref: (element: Element | null) => void; playing: boolean } {
  const [element, setElement] = useState<Element | null>(null);
  const [playing, setPlaying] = useState(false);
  const entryRef = useRef<Entry | null>(null);
  const effectiveRank = scope === 'grid' ? -rank : rank;

  useEffect(() => {
    if (!element) return;
    const entry: Entry = { key, rank: effectiveRank, eligible, element: null, visible: false, playing: false, setPlaying };
    entryRef.current = entry;
    const detach = attach(scope, entry, element);
    return () => {
      detach();
      if (entryRef.current === entry) entryRef.current = null;
    };
    // Rank and eligibility change in place below, without observing the element again.
    // 名次和是否可播放在下面的 effect 中原地更新，不必重新观察元素。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element, key, scope]);

  useEffect(() => {
    const entry = entryRef.current;
    if (!entry || (entry.rank === effectiveRank && entry.eligible === eligible)) return;
    entry.rank = effectiveRank;
    entry.eligible = eligible;
    schedule(scope);
  }, [effectiveRank, eligible, scope]);

  return { ref: setElement, playing: eligible && playing };
}
