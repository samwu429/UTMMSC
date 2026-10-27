import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { clearMediaCache, mediaCacheOutlived, watchSessionForMediaCache } from './mediaCache';
import { MEDIA_CACHE_NAME, STICKER_FILE_CACHE_NAME, STICKER_THUMB_CACHE_NAME } from './swRoutes';

interface Session {
  token: string | null;
  member: { id: string } | null;
  mediaToken: string | null;
}

const signedIn = (id: string, token = `tok-${id}`): Session => ({ token, member: { id }, mediaToken: 'm' });
const signedOut: Session = { token: null, member: null, mediaToken: null };

describe('mediaCacheOutlived', () => {
  it('ends with a sign-out', () => {
    expect(mediaCacheOutlived(signedIn('m_1'), signedOut)).toBe(true);
  });

  it('ends when another member signs in on the device', () => {
    expect(mediaCacheOutlived(signedIn('m_1'), signedIn('m_2'))).toBe(true);
  });

  it('survives a new session token or media token of the same member', () => {
    expect(mediaCacheOutlived(signedIn('m_1', 'a'), signedIn('m_1', 'b'))).toBe(false);
    const refreshed: Session = { ...signedIn('m_1'), mediaToken: 'n' };
    expect(mediaCacheOutlived(signedIn('m_1'), refreshed)).toBe(false);
  });

  it('survives signing in, and the member arriving after the token', () => {
    expect(mediaCacheOutlived(signedOut, signedIn('m_1'))).toBe(false);
    const tokenOnly: Session = { token: 't', member: null, mediaToken: null };
    expect(mediaCacheOutlived(tokenOnly, signedIn('m_1', 't'))).toBe(false);
  });
});

describe('watchSessionForMediaCache', () => {
  it('clears once at startup when nobody is signed in', () => {
    const clear = vi.fn(async () => undefined);
    watchSessionForMediaCache(createStore<Session>(() => signedOut), clear);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('keeps the cache at startup when a member is signed in, and clears it on sign-out', () => {
    const clear = vi.fn(async () => undefined);
    const store = createStore<Session>(() => signedIn('m_1'));
    watchSessionForMediaCache(store, clear);
    expect(clear).not.toHaveBeenCalled();
    store.setState({ mediaToken: 'refreshed' });
    expect(clear).not.toHaveBeenCalled();
    store.setState(signedOut);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('clears when the member changes, and stops when unsubscribed', () => {
    const clear = vi.fn(async () => undefined);
    const store = createStore<Session>(() => signedIn('m_1'));
    const stop = watchSessionForMediaCache(store, clear);
    store.setState(signedIn('m_2'));
    expect(clear).toHaveBeenCalledTimes(1);
    stop();
    store.setState(signedOut);
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe('clearMediaCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deletes the media cache and both sticker caches', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', { delete: vi.fn(async (name: string) => deleted.push(name) > 0) });
    await clearMediaCache();
    expect(deleted.sort()).toEqual([MEDIA_CACHE_NAME, STICKER_FILE_CACHE_NAME, STICKER_THUMB_CACHE_NAME].sort());
  });

  it('copes with blocked storage and with no Cache Storage at all', async () => {
    vi.stubGlobal('caches', { delete: vi.fn(async () => Promise.reject(new DOMException('blocked', 'SecurityError'))) });
    await expect(clearMediaCache()).resolves.toBeUndefined();
    vi.stubGlobal('caches', undefined);
    await expect(clearMediaCache()).resolves.toBeUndefined();
  });
});
