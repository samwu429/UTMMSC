import type { MarkMomentFeedSeenBody, MomentBadgeResponse } from '@utmmsc/shared';
import { useEffect } from 'react';
import { create } from 'zustand';
import { isOnScreen, onScreenChange } from '../../../shared/native/onScreen';
import { useSessionStore } from '../../../shared/session/store';
import { momentsApi } from '../api';

export interface MomentsBadgeState extends MomentBadgeResponse {
  /** True once GET /moments/badge answered for this sign-in. */
  /** 本次登录中 GET /moments/badge 已返回过时为 true。 */
  loaded: boolean;
  /**
   * GET /moments/badge, at most once every few seconds unless forced. Failures keep the last values. Callers:
   * AppShell mount, visibility, focus, online, every /discover mount, the moments push message, and the home feed.
   * GET /moments/badge，除非 force，否则几秒内最多一次。失败时保留上次的值。调用方：AppShell 挂载、页面可见、获得焦点、恢复联网、
   * 每次打开 /discover、好友动态推送消息，以及动态首页。
   */
  refresh(options?: { force?: boolean }): Promise<void>;
  /** The notices list marked notices read; unread is what the server said is left. */
  /** 「消息」列表已标为已读；unread 为服务器返回的剩余未读数。 */
  setUnread(unread: number): void;
  /** The home feed showed posts up to `upTo`: POST /moments/seen, and newPosts goes to 0. */
  /** 动态首页已显示到 `upTo` 的动态：发出 POST /moments/seen，并把 newPosts 清零。 */
  markFeedSeen(upTo: string): void;
  /** Sign-out. */
  /** 退出登录。 */
  reset(): void;
}

/** Calls the badge needs; tests pass a fake. */
/** 角标需要的接口调用；测试时传入替身。 */
export interface MomentsBadgeApi {
  badge(): Promise<MomentBadgeResponse>;
  seen(body: MarkMomentFeedSeenBody): Promise<unknown>;
}

/** Unforced refreshes closer together than this share the last answer. */
/** 间隔短于此的非强制刷新沿用上一次的结果。 */
export const BADGE_MIN_GAP_MS = 5_000;
/** How often the home feed checks for new posts while it is on screen. */
/** 动态首页显示在屏幕上时检查新动态的间隔。 */
export const BADGE_POLL_MS = 60_000;

const EMPTY: MomentBadgeResponse = { unread: 0, latestActor: null, newPosts: 0, latestAuthor: null };

/** A POST /moments/seen: answers of GETs that started before it settled cannot know about it. */
/** 一次 POST /moments/seen：在它完成之前开始的 GET 不可能知道它。 */
interface SeenMark {
  settledSeq: number | null;
}

/** A local unread count from 消息: answers of GETs that started before it are older than it. */
/** 来自「消息」的本地未读数：在它之前开始的 GET 的结果比它旧。 */
interface UnreadMark {
  seq: number;
  unread: number;
}

/**
 * The 发现 tab badge and the 好友动态 row. Local changes (notices read, feed seen) show at once and win over any
 * GET that started before the server saw them, so a slow poll never brings an old dot back.
 * 「发现」标签的角标和「好友动态」一行。本地的变化（消息已读、首页已看）立即生效，并覆盖在服务器看到它们之前发出的 GET 的结果，
 * 慢一步的轮询不会把旧的红点带回来。
 */
export function createMomentsBadgeStore(api: MomentsBadgeApi, now: () => number = Date.now) {
  let generation = 0;
  let seq = 0;
  let inflight: Promise<void> | null = null;
  let again = false;
  let lastStartedAt: number | null = null;
  let seenMark: SeenMark | null = null;
  let unreadMark: UnreadMark | null = null;
  let lastSeenUpTo: string | null = null;

  return create<MomentsBadgeState>()((set, get) => {
    function overlay(res: MomentBadgeResponse, startSeq: number): MomentBadgeResponse {
      let next = res;
      if (seenMark && (seenMark.settledSeq === null || startSeq < seenMark.settledSeq)) next = { ...next, newPosts: 0, latestAuthor: null };
      if (unreadMark && startSeq < unreadMark.seq) {
        const unread = Math.min(next.unread, unreadMark.unread);
        next = { ...next, unread, latestActor: unread === 0 ? null : next.latestActor };
      }
      return next;
    }

    function load(): Promise<void> {
      const startGeneration = generation;
      const startSeq = seq;
      lastStartedAt = now();
      return api
        .badge()
        .then((res) => {
          if (startGeneration !== generation) return;
          const next = overlay(res, startSeq);
          const current = get();
          const same =
            current.loaded &&
            current.unread === next.unread &&
            current.newPosts === next.newPosts &&
            current.latestActor?.id === next.latestActor?.id &&
            current.latestActor?.avatarKey === next.latestActor?.avatarKey &&
            current.latestAuthor?.id === next.latestAuthor?.id &&
            current.latestAuthor?.avatarKey === next.latestAuthor?.avatarKey;
          if (!same) set({ unread: next.unread, latestActor: next.latestActor, newPosts: next.newPosts, latestAuthor: next.latestAuthor, loaded: true });
        })
        .catch(() => {
          // The badge keeps its last values; the next trigger tries again.
          // 角标保留上次的值；下一次触发时再试。
        })
        .finally(() => {
          if (startGeneration !== generation) return;
          inflight = null;
          if (again) {
            again = false;
            inflight = load();
          }
        });
    }

    function refresh(options: { force?: boolean } = {}): Promise<void> {
      if (!useSessionStore.getState().token) return Promise.resolve();
      if (inflight) {
        // A forced refresh follows something the request in flight may predate, such as a push, so it runs again.
        // 强制刷新针对的变化（例如一条推送）可能晚于正在进行的请求，所以之后再请求一次。
        if (options.force) again = true;
        return inflight;
      }
      if (!options.force && lastStartedAt !== null && get().loaded && now() - lastStartedAt < BADGE_MIN_GAP_MS) return Promise.resolve();
      inflight = load();
      return inflight;
    }

    return {
      ...EMPTY,
      loaded: false,
      refresh,
      setUnread: (unread) => {
        const value = Math.max(0, Math.floor(unread));
        seq += 1;
        unreadMark = { seq, unread: value };
        const current = get();
        if (current.unread !== value || (value === 0 && current.latestActor)) set({ unread: value, latestActor: value === 0 ? null : current.latestActor });
      },
      markFeedSeen: (upTo) => {
        if (!useSessionStore.getState().token || !upTo) return;
        // The server keeps the later time, so an older or equal one has nothing to say.
        // 服务器保留较晚的时间，更早或相同的时间没有意义。
        if (lastSeenUpTo !== null && upTo <= lastSeenUpTo) return;
        const previous = lastSeenUpTo;
        lastSeenUpTo = upTo;
        const startGeneration = generation;
        seq += 1;
        const mark: SeenMark = { settledSeq: null };
        seenMark = mark;
        if (get().newPosts !== 0 || get().latestAuthor) set({ newPosts: 0, latestAuthor: null });
        api
          .seen({ upTo })
          .catch(() => {
            // Not recorded: the next feed load sends it again.
            // 未记录：下一次加载首页时会再发一次。
            if (startGeneration === generation && lastSeenUpTo === upTo) lastSeenUpTo = previous;
          })
          .finally(() => {
            if (startGeneration !== generation) return;
            seq += 1;
            mark.settledSeq = seq;
          });
      },
      reset: () => {
        generation += 1;
        inflight = null;
        again = false;
        lastStartedAt = null;
        seenMark = null;
        unreadMark = null;
        lastSeenUpTo = null;
        set({ ...EMPTY, loaded: false });
      },
    };
  });
}

export type MomentsBadgeStore = ReturnType<typeof createMomentsBadgeStore>;

/**
 * Empties the badge when the member signs out or another member signs in. Returns the unsubscribe function.
 * 成员退出或换了一个成员登录时清空角标。返回取消订阅的函数。
 */
export function bindMomentsBadgeToSession(store: MomentsBadgeStore): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    if (signedOut || switched) store.getState().reset();
  });
}

/** The 发现 tab badge and the 好友动态 row: unread notices first, else a dot for new posts. */
/** 「发现」标签的角标和「好友动态」一行：优先显示未读消息数，否则在有新动态时显示红点。 */
export const useMomentsBadge = createMomentsBadgeStore(momentsApi);
bindMomentsBadgeToSession(useMomentsBadge);

/**
 * Keeps the badge fresh while mounted: on mount, when the page comes back on screen (including the Android app
 * returning to the foreground) or is focused, and when the network returns. Pushes are handled once, app-wide, by
 * NotificationBridge, so this does not listen to the service worker. AppShell mounts it once; the home feed passes
 * pollMs (BADGE_POLL_MS) to check every minute while it is on screen, which AppShell does not.
 * 挂载期间保持角标最新：挂载时、页面回到屏幕上（包括安卓 App 回到前台）或获得焦点时，以及网络恢复时。推送由 NotificationBridge
 * 在全应用范围内统一处理一次，因此这里不监听 Service Worker。由 AppShell 挂载一次；动态首页传入 pollMs（BADGE_POLL_MS），
 * 在显示期间每分钟检查一次，AppShell 不轮询。
 */
export function useMomentsBadgeSync(options: { pollMs?: number } = {}): void {
  const { pollMs } = options;
  useEffect(() => {
    const refresh = (force = false) => void useMomentsBadge.getState().refresh(force ? { force: true } : undefined);
    refresh();
    const stopScreen = onScreenChange((onScreen) => {
      if (onScreen) refresh();
    });
    const onFocus = () => refresh();
    const onOnline = () => refresh(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    let timer: ReturnType<typeof setInterval> | null = null;
    if (pollMs && pollMs > 0) {
      timer = setInterval(() => {
        if (isOnScreen()) refresh();
      }, pollMs);
    }
    return () => {
      stopScreen();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      if (timer) clearInterval(timer);
    };
  }, [pollMs]);
}
