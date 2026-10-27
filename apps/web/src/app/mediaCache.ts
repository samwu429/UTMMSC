import { MEDIA_CACHE_NAME, STICKER_FILE_CACHE_NAME, STICKER_THUMB_CACHE_NAME } from './swRoutes';

/** Every cache of member media, the two sticker caches included. */
/** 所有成员媒体缓存，包括两个表情缓存。 */
export const MEMBER_MEDIA_CACHES: readonly string[] = [MEDIA_CACHE_NAME, STICKER_THUMB_CACHE_NAME, STICKER_FILE_CACHE_NAME];

interface SessionView {
  token: string | null;
  member: { id: string } | null;
}

interface SessionSource<S extends SessionView> {
  getState(): S;
  subscribe(listener: (state: S, previous: S) => void): () => void;
}

/**
 * The media cache holds what the signed-in member could see, so it goes when that member signs out or another one
 * signs in on this device.
 * 媒体缓存里是当前登录成员能看到的内容，所以该成员退出登录、或者另一位成员在这台设备上登录时，缓存都要清空。
 */
export function mediaCacheOutlived(previous: SessionView, next: SessionView): boolean {
  if (previous.token && !next.token) return true;
  const before = previous.member?.id ?? null;
  const after = next.member?.id ?? null;
  return before !== null && after !== null && before !== after;
}

export async function clearMediaCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await Promise.all(MEMBER_MEDIA_CACHES.map((name) => caches.delete(name)));
  } catch {
    // Storage can be blocked (private windows, storage pressure); there is then nothing to clear.
    // 存储可能被禁用（无痕窗口、存储空间不足）；这时也就没有需要清空的东西。
  }
}

/**
 * Clears the cache on every sign-out or member switch, and once at startup when nobody is signed in, in case the
 * app closed before an earlier clear finished.
 * 每次退出登录或换成员时清空缓存；启动时如果没有人登录也清空一次，以防上次清空还没完成应用就关闭了。
 */
export function watchSessionForMediaCache<S extends SessionView>(session: SessionSource<S>, clear: () => Promise<void> = clearMediaCache): () => void {
  if (!session.getState().token) void clear();
  return session.subscribe((state, previous) => {
    if (mediaCacheOutlived(previous, state)) void clear();
  });
}
