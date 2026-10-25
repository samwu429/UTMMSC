import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useSessionStore } from '../../../shared/session/store';

/**
 * Admin's stale-while-revalidate cache, the infoCache pattern of useRoomInfo: a section opened again shows what it
 * had at once and refreshes in the background. Module level, so it outlives the screens, and emptied when the
 * member signs out, another member signs in or the viewed role changes (every answer depends on it).
 * Keys: applications, yearRequests, members, channels, channel:<id>, events, announcements, invites, reports:<status>.
 * 管理后台的「先显示旧数据、后台再刷新」缓存，即 useRoomInfo 的 infoCache 模式：再次打开某个板块时立即显示已有内容，并在后台刷新。
 * 位于模块层，因而比各界面存在得更久；成员退出、换了一个成员登录或当前视角的身份改变时清空（每个结果都取决于身份）。
 * 键：applications、yearRequests、members、channels、channel:<id>、events、announcements、invites、reports:<状态>。
 */

export interface AdminQueryState<T> {
  data: T | undefined;
  /** The last failure, cleared by the next success. Data from before it stays. */
  /** 最近一次失败，下一次成功时清除。失败之前的数据保留。 */
  error: unknown;
  loading: boolean;
  /** When the data arrived, by the cache clock; 0 when there is none. */
  /** 数据到达的时间（按缓存的时钟）；没有数据时为 0。 */
  fetchedAt: number;
  /** Marked out of date by a change elsewhere; the next load fetches again. */
  /** 因别处的改动被标为过期；下一次加载会重新获取。 */
  stale: boolean;
}

export interface LoadOptions {
  /** Fetch even when the data is fresh. A load already in flight is reused unless `force`. */
  /** 即使数据未过期也重新获取。除非 `force`，否则沿用正在进行的请求。 */
  force?: boolean;
  staleMs?: number;
}

export const DEFAULT_STALE_MS = 30_000;

const IDLE: AdminQueryState<never> = { data: undefined, error: null, loading: false, fetchedAt: 0, stale: false };

interface Entry {
  state: AdminQueryState<unknown>;
  promise: Promise<unknown> | null;
  /** Bumped by every forced load and every mutate, so an older answer cannot overwrite a newer one. */
  /** 每次强制加载和每次 mutate 都会递增，较早的结果因此不会覆盖较新的数据。 */
  version: number;
}

export function createAdminCache(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  let generation = 0;

  function entry(key: string): Entry {
    let found = entries.get(key);
    if (!found) {
      found = { state: IDLE, promise: null, version: 0 };
      entries.set(key, found);
    }
    return found;
  }

  function notify(key: string): void {
    for (const listener of listeners.get(key) ?? []) listener();
  }

  function set(key: string, patch: Partial<AdminQueryState<unknown>>): void {
    const target = entry(key);
    target.state = { ...target.state, ...patch };
    notify(key);
  }

  function isFresh(key: string, staleMs: number): boolean {
    const found = entries.get(key);
    if (!found || found.state.data === undefined || found.state.stale) return false;
    return now() - found.state.fetchedAt < staleMs;
  }

  function load<T>(key: string, loader: () => Promise<T>, options: LoadOptions = {}): Promise<T | undefined> {
    const { force = false, staleMs = DEFAULT_STALE_MS } = options;
    const target = entry(key);
    if (!force && target.promise) return target.promise as Promise<T | undefined>;
    if (!force && isFresh(key, staleMs)) return Promise.resolve(target.state.data as T);
    const startGeneration = generation;
    target.version += 1;
    const startVersion = target.version;
    set(key, { loading: true });
    const promise: Promise<T | undefined> = loader().then(
      (data) => {
        const current = entries.get(key);
        // Signed out, or a newer load or a local change since: this answer is out of date.
        // 已退出登录，或之后有更新的加载或本地改动：这个结果已经过时。
        if (startGeneration !== generation || !current || current.version !== startVersion) return current?.state.data as T | undefined;
        current.promise = null;
        set(key, { data, error: null, loading: false, fetchedAt: now(), stale: false });
        return data;
      },
      (error: unknown) => {
        const current = entries.get(key);
        if (startGeneration !== generation || !current || current.version !== startVersion) return current?.state.data as T | undefined;
        current.promise = null;
        set(key, { error, loading: false });
        return current.state.data as T | undefined;
      },
    );
    target.promise = promise;
    return promise;
  }

  return {
    read<T>(key: string): AdminQueryState<T> {
      return (entries.get(key)?.state ?? IDLE) as AdminQueryState<T>;
    },

    subscribe(key: string, listener: () => void): () => void {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },

    isFresh,
    load,

    /**
     * Changes the data locally, for an optimistic update or the answer of a mutation. A load in flight started
     * before it, so its answer is dropped and the next load fetches again.
     * 在本地修改数据，用于乐观更新或某个修改请求的结果。正在进行的加载早于这次修改，因此其结果被丢弃，下一次加载会重新获取。
     */
    mutate<T>(key: string, update: (current: T | undefined) => T | undefined): void {
      const target = entry(key);
      const data = update(target.state.data as T | undefined);
      if (target.promise) {
        target.version += 1;
        target.promise = null;
        set(key, { data, loading: false, stale: true, fetchedAt: target.state.fetchedAt || now() });
        return;
      }
      set(key, { data, fetchedAt: target.state.fetchedAt || now() });
    },

    /** Marks keys out of date, by exact key or by a test on the key; screens on them refetch when next loaded. */
    /** 将键标为过期，可按完整的键或按对键的判断；显示它们的界面下次加载时重新获取。 */
    invalidate(match: string | ((key: string) => boolean)): void {
      for (const [key, found] of entries) {
        const hit = typeof match === 'string' ? key === match : match(key);
        if (!hit) continue;
        // A load in flight may have started before the change, so its answer is dropped as well.
        // 正在进行的加载可能早于这次改动，因此它的结果同样被丢弃。
        if (found.promise) {
          found.version += 1;
          found.promise = null;
          set(key, { loading: false, stale: true });
        } else if (found.state.data !== undefined && !found.state.stale) {
          set(key, { stale: true });
        }
      }
    },

    /** Empties everything and drops every answer still on its way. */
    /** 清空所有内容，并丢弃所有仍在途中的结果。 */
    clear(): void {
      generation += 1;
      const keys = [...entries.keys()];
      entries.clear();
      for (const key of keys) notify(key);
    },
  };
}

export type AdminCache = ReturnType<typeof createAdminCache>;

/**
 * Empties the cache when the member signs out, another member signs in, or the viewed role changes, such as a
 * system admin starting or ending a test identity. Returns the unsubscribe function.
 * 成员退出、换了一个成员登录，或当前视角的身份改变（例如系统管理员开始或结束测试身份）时清空缓存。返回取消订阅的函数。
 */
export function bindAdminCacheToSession(cache: AdminCache): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    const roleChanged = prev.member !== null && state.member !== null && prev.member.role !== state.member.role;
    if (signedOut || switched || roleChanged) cache.clear();
  });
}

export const adminCache = createAdminCache();
bindAdminCacheToSession(adminCache);

export interface AdminQuery<T> extends AdminQueryState<T> {
  /** Fetches again now, whatever the age of the data. */
  /** 立即重新获取，不论数据新旧。 */
  refresh: () => Promise<T | undefined>;
  mutate: (update: (current: T | undefined) => T | undefined) => void;
}

/**
 * One cached admin list or record. Renders cached data at once; fetches when there is none or it is older than
 * `staleMs`. A null key (or enabled false) loads nothing, for a role that may not see the data.
 * 一份缓存的管理列表或记录。立即显示缓存的数据；没有数据或数据比 `staleMs` 更旧时重新获取。键为 null（或 enabled 为 false）时
 * 不加载任何内容，用于无权查看该数据的身份。
 */
export function useAdminQuery<T>(
  key: string | null,
  loader: () => Promise<T>,
  { staleMs = DEFAULT_STALE_MS, enabled = true, cache = adminCache }: { staleMs?: number; enabled?: boolean; cache?: AdminCache } = {},
): AdminQuery<T> {
  const active = enabled && key !== null ? key : null;
  const loaderRef = useRef(loader);
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });

  const subscribe = useCallback((listener: () => void) => (active ? cache.subscribe(active, listener) : () => undefined), [active, cache]);
  const getSnapshot = useCallback(() => (active ? cache.read<T>(active) : (IDLE as AdminQueryState<T>)), [active, cache]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (!active) return;
    void cache.load(active, () => loaderRef.current(), { staleMs });
  }, [active, cache, staleMs, state.stale, state.fetchedAt]);

  const refresh = useCallback(() => (active ? cache.load(active, () => loaderRef.current(), { force: true }) : Promise.resolve(undefined)), [active, cache]);
  const mutate = useCallback(
    (update: (current: T | undefined) => T | undefined) => {
      if (active) cache.mutate(active, update);
    },
    [active, cache],
  );

  // No data yet and nothing failed counts as loading, so the first paint shows skeleton rows, never an empty state.
  // 尚无数据且没有失败时视为加载中，因此第一次绘制显示骨架行，而不是空状态。
  const loading = state.loading || (active !== null && state.data === undefined && !state.error);
  return { ...state, loading, refresh, mutate };
}
