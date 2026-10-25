import { describe, expect, it, vi } from 'vitest';
import { CHUNK_RELOAD_AT, CHUNK_RELOAD_GUARD_MS, createChunkReloader, type ChunkReloadDeps } from './chunkReload';
import { UPDATE_RELOAD_FLAG, type FlagStorage } from './pwa';

class MemoryStorage implements FlagStorage {
  readonly items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
}

function deps(overrides: Partial<ChunkReloadDeps> = {}) {
  const storage = new MemoryStorage();
  const reload = vi.fn();
  const base: ChunkReloadDeps = { storage, now: () => 50_000, online: () => true, reload, ...overrides };
  return { ...base, storage: base.storage, reload: base.reload as ReturnType<typeof vi.fn> };
}

describe('createChunkReloader', () => {
  it('reloads into the new build, flagged so the film is skipped', () => {
    const d = deps();
    const reloader = createChunkReloader(d);
    expect(reloader.reloading).toBe(false);
    expect(reloader.reload()).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(reloader.reloading).toBe(true);
    expect(d.storage?.getItem(UPDATE_RELOAD_FLAG)).toBe('1');
    expect(d.storage?.getItem(CHUNK_RELOAD_AT)).toBe('50000');
  });

  it('reloads only once per page, however many chunks fail', () => {
    const d = deps();
    const reloader = createChunkReloader(d);
    expect(reloader.reload()).toBe(true);
    expect(reloader.reload()).toBe(true);
    reloader.onPreloadError();
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('does not loop: a failure soon after the last reload is a real error', () => {
    const storage = new MemoryStorage();
    let now = 100_000;
    const first = createChunkReloader({ storage, now: () => now, online: () => true, reload: vi.fn() });
    expect(first.reload()).toBe(true);
    // The reloaded page: same session storage, a moment later.
    // 重新加载后的页面：同一个会话存储，稍后一点。
    now += CHUNK_RELOAD_GUARD_MS - 1;
    const reload = vi.fn();
    const second = createChunkReloader({ storage, now: () => now, online: () => true, reload });
    expect(second.reload()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    now += 1;
    expect(second.reload()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores a stored time from the future, such as after the clock was turned back', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHUNK_RELOAD_AT, String(10_000_000));
    const d = deps({ storage });
    expect(createChunkReloader(d).reload()).toBe(true);
  });

  it('does not reload while offline, where the reload itself would fail', () => {
    const d = deps({ online: () => false });
    expect(createChunkReloader(d).reload()).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('does not reload without session storage, which is what stops a loop', () => {
    const d = deps({ storage: null });
    expect(createChunkReloader(d).reload()).toBe(false);
    const throwing: FlagStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const e = deps({ storage: throwing });
    expect(createChunkReloader(e).reload()).toBe(false);
    expect(e.reload).not.toHaveBeenCalled();
  });

  it('reloads on vite:preloadError, except during a background preload', async () => {
    const d = deps();
    const reloader = createChunkReloader(d);
    let fail: (error: Error) => void = () => undefined;
    const preload = reloader.inBackground(() => new Promise((_resolve, reject) => (fail = reject)));
    reloader.onPreloadError();
    expect(d.reload).not.toHaveBeenCalled();
    fail(new Error('gone'));
    await expect(preload).resolves.toBeUndefined();
    reloader.onPreloadError();
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('passes a background preload result through', async () => {
    const reloader = createChunkReloader(deps());
    await expect(reloader.inBackground(async () => 'module')).resolves.toBe('module');
  });
});
