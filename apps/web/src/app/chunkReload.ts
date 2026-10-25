import { markUpdateReload, pageSessionStorage, type FlagStorage } from './pwa';

/**
 * Pages load as separate chunks. After a deploy the old chunks are gone from the server, so a page that has been
 * open since before it can fail to load the next screen. Reloading picks up the new build; the opening film is
 * skipped, as after any update.
 * 页面按分块加载。部署之后旧分块就从服务器上消失了，部署之前就打开的页面可能加载不出下一个界面。重新加载即可拿到新版本；
 * 与其他更新一样，不再播放开屏影片。
 */

/** When the last such reload happened; a second failure within the guard window is a real error, not a stale page. */
/** 上一次此类重新加载的时间；在保护时间内再次失败就是真正的错误，而不是页面过期。 */
export const CHUNK_RELOAD_AT = 'utmmsc.chunk-reload-at';
export const CHUNK_RELOAD_GUARD_MS = 10_000;

export interface ChunkReloadDeps {
  storage: FlagStorage | null;
  now: () => number;
  online: () => boolean;
  reload: () => void;
}

export interface ChunkReloader {
  /** True once a reload is under way; screens waiting for a chunk then simply keep waiting. */
  /** 重新加载开始后为 true；等待分块的界面这时只需继续等待。 */
  readonly reloading: boolean;
  /**
   * Reloads for a chunk that failed to load and says whether it did. It does not when offline (the reload itself
   * would fail), without session storage (nothing could stop a loop), or a second time within the guard window.
   * 因分块加载失败而重新加载，并返回是否这样做了。离线时不会（重新加载本身也会失败），没有会话存储时不会（无法阻止循环），
   * 在保护时间内也不会第二次重新加载。
   */
  reload(): boolean;
  /** Runs a preload whose failure must not reload the page, such as the idle preloading of likely next pages. */
  /** 运行一次失败时不应重新加载页面的预加载，例如空闲时预加载接下来可能打开的页面。 */
  inBackground<T>(load: () => Promise<T>): Promise<T | undefined>;
  /** Handler for Vite's vite:preloadError event. */
  /** Vite 的 vite:preloadError 事件处理函数。 */
  onPreloadError(): void;
}

export function createChunkReloader(deps: ChunkReloadDeps): ChunkReloader {
  let reloading = false;
  let background = 0;

  function reload(): boolean {
    if (reloading) return true;
    if (!deps.online()) return false;
    const storage = deps.storage;
    if (!storage) return false;
    const now = deps.now();
    try {
      const last = Number(storage.getItem(CHUNK_RELOAD_AT));
      if (Number.isFinite(last) && last > 0 && now >= last && now - last < CHUNK_RELOAD_GUARD_MS) return false;
      storage.setItem(CHUNK_RELOAD_AT, String(now));
    } catch {
      return false;
    }
    reloading = true;
    markUpdateReload(storage);
    deps.reload();
    return true;
  }

  return {
    get reloading() {
      return reloading;
    },
    reload,
    async inBackground<T>(load: () => Promise<T>): Promise<T | undefined> {
      background += 1;
      try {
        return await load();
      } catch {
        return undefined;
      } finally {
        background -= 1;
      }
    },
    onPreloadError() {
      // Vite reports the failure before the import rejects, so a background preload is still counted here.
      // Vite 在 import 失败之前就报告错误，所以这里仍能算上正在进行的后台预加载。
      if (background > 0) return;
      reload();
    },
  };
}

let pageReloader: ChunkReloader | null = null;

/** The reloader of this page, created on first use. */
/** 本页面的重新加载器，第一次使用时创建。 */
export function chunkReloader(): ChunkReloader {
  pageReloader ??= createChunkReloader({
    storage: pageSessionStorage(),
    now: () => Date.now(),
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    reload: () => window.location.reload(),
  });
  return pageReloader;
}
