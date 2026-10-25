import { normalizeMomentComment, type MemberSelf, type MomentAlbumOwner, type MomentMediaInput, type MomentPerson, type MomentPost } from '@utmmsc/shared';
import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import { holdAppUpdate } from '../../../app/pwa';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { tr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { announce } from '../announce';
import { momentsApi, type MomentsApi } from '../api';
import { clearCommentDrafts } from '../comment/useCommentBar';
import {
  HOME_FEED,
  albumFeedKey,
  emptyFeedList,
  initialFeedState,
  isLocalPostKey,
  localPostKey,
  newMomentClientId,
  parseFeedKey,
  postFeedKey,
  type CommentReplyTarget,
  type FeedKey,
  type FeedList,
  type FeedState,
  type LocalComment,
  type MomentView,
  type PublishRequest,
  type UploadBatch,
} from '../model';
import { BADGE_POLL_MS, useMomentsBadge, useMomentsBadgeSync } from './badgeStore';
import { FEED_CACHE_POSTS, clearFeedCache, readFeedCache, writeFeedCache, type CachedFeed } from './feedCache';
import {
  addLocalPost,
  addPendingComment,
  appendCommentPage,
  appendPage,
  applyFirstPage,
  buildLocalPost,
  confirmComment,
  confirmLocalPost,
  createViewMemo,
  findLocalPost,
  findPendingComment,
  forgetHiddenComment,
  hideComment,
  hidePost,
  holdIncoming,
  keepConfirmedActivity,
  likeFailed,
  likeSettled,
  likeStarted,
  mergeIncomingPosts,
  newestShown,
  removeLocalPost,
  removePendingComment,
  removePost,
  restoreHiddenComment,
  restoreHiddenPost,
  setCommentPaging,
  setDeleting,
  setExpandedIn,
  setLocalPostState,
  syncLocalUploads,
  tapLike,
  updatePendingComment,
  upsertPosts,
  wakeLikes,
  withList,
} from './feedModel';

export interface SendCommentInput {
  postId: string;
  /** As typed; the store trims it, and the server normalizes it. */
  /** 按输入原样；store 去掉首尾空白，服务器再做规范化。 */
  text: string;
  replyTo: CommentReplyTarget | null;
}

export interface FeedActions {
  /**
   * Shows what memory or the device cache has for the list at once, then loads page 1 quietly. Safe to call on
   * every mount; a list that loaded moments ago is not fetched again. On home, posts waiting in incoming join the
   * list when the saved scroll is at the top (a page that starts a visit at the top calls saveScroll(key, 0)
   * first); a quiet reload while the saved scroll is past the cover holds new posts in incoming.
   * 立即显示内存或设备缓存中该列表的内容，然后安静地加载第一页。每次挂载都可以调用；刚加载过的列表不会再请求。在动态首页，
   * 若保存的滚动位置在顶部，incoming 中的动态会并入列表（从顶部开始浏览的页面先调用 saveScroll(key, 0)）；
   * 保存的滚动位置已过封面时，安静的重新加载会把新动态留在 incoming 中。
   */
  open(key: FeedKey): void;
  /** Pull to refresh or retry: a fresh page 1. On home it also merges incoming, refreshes the badge and marks the feed seen. */
  /** 下拉刷新或重试：重新加载第一页。在动态首页还会合并新动态、刷新角标，并标记首页已看。 */
  refresh(key: FeedKey): Promise<void>;
  /**
   * The next page, from the list's cursor. While the list still shows cached content, or after page 1 failed over
   * it (more: 'failed'), this loads page 1 instead, so the footer's 加载失败，轻触重试 always does something.
   * 根据列表的 cursor 加载下一页。列表仍显示缓存内容时，或第一页在缓存内容之上加载失败后（more 为 'failed'），改为加载第一页，
   * 因此底部的「加载失败，轻触重试」总是有效。
   */
  loadMore(key: FeedKey): Promise<void>;
  /** The badge reported new posts: fetches home page 1 silently into incoming, behind 有 N 条新动态. */
  /** 角标报告有新动态：安静地把首页第一页取到 incoming 中，等在「有 N 条新动态」后面。 */
  fetchIncoming(): Promise<void>;
  /** Moves incoming posts into the home list: the pill was tapped, the member pulled, or the feed opened again. */
  /** 把 incoming 中的动态并入首页列表：点击了提示条、下拉刷新，或再次打开首页时。 */
  mergeIncoming(): void;
  saveScroll(key: FeedKey, scrollY: number): void;
  setExpanded(key: FeedKey, postId: string, expanded: boolean): void;
  /** 赞 / 取消: flips the desired state; one request per post in flight, the last tap wins, 404 drops the post. */
  /** 赞 / 取消：翻转想要的状态；每条动态同时只有一个请求，以最后一次点击为准，404 时移除这条动态。 */
  toggleLike(postId: string): void;
  /** Puts the local post at the top at once, waits for its uploads, then sends POST /moments/posts with its clientId. */
  /** 立即把本地动态放在顶部，等上传完成后带着 clientId 发出 POST /moments/posts。 */
  publish(request: PublishRequest): void;
  /** 重试 on a failed local post: retries failed uploads, then the same clientId. */
  /** 失败的本地动态上的「重试」：重新上传失败的文件，再以同一个 clientId 发表。 */
  retryPost(clientId: string): void;
  /** 删除 on a failed local post: drops it and releases its uploads. */
  /** 失败的本地动态上的「删除」：移除它并释放其上传。 */
  discardPost(clientId: string): void;
  /**
   * The server previews of a post published here have loaded; the local copies can go. While a viewer or player
   * holds the post (pinLocalMedia), the release waits until the last hold lets go.
   * 从本设备发表的动态，其服务器预览图已加载完成；本地副本可以释放。查看器或播放器占用这条动态期间（pinLocalMedia），
   * 释放会等到最后一个占用解除之后。
   */
  releaseLocalMedia(postId: string): void;
  /**
   * An open viewer or player holds this device's copies of the post's media (by its local or server id), so a blob
   * URL it shows is not revoked under it. Returns the function that lets go; calling it twice does nothing.
   * 已打开的查看器或播放器占用这条动态在本设备上的媒体副本（按本地或服务器 id），它正在显示的 blob URL 不会被中途撤销。
   * 返回解除占用的函数；调用两次也只生效一次。
   */
  pinLocalMedia(postId: string): () => void;
  /** Removes the post at once and restores it at the same place, with a toast, if the server refuses. Resolves true on success. */
  /** 立即移除这条动态；服务器拒绝时放回原处并提示。成功时返回 true。 */
  deletePost(postId: string): Promise<boolean>;
  /**
   * Adds a pending comment and sends it; returns its clientId. Works when the post is not loaded in any list
   * (a reply from 消息): the comment is then sent without a pending row.
   * 添加一条待发送的评论并发出；返回其 clientId。动态不在任何列表中时（从「消息」回复）也可以使用，此时直接发送，不显示待发送行。
   */
  sendComment(input: SendCommentInput): string;
  /** 重新发送, with the same clientId. */
  /** 「重新发送」，使用同一个 clientId。 */
  resendComment(postId: string, clientId: string): void;
  discardComment(postId: string, clientId: string): void;
  /** Removes the comment at once and restores it at the same index, with a toast, if the server refuses. */
  /** 立即移除这条评论；服务器拒绝时放回原位置并提示。 */
  deleteComment(postId: string, commentId: string): Promise<boolean>;
  /** 展开其余 N 条评论: loads the next page of comments in place. */
  /** 「展开其余 N 条评论」：就地加载下一页评论。 */
  loadMoreComments(postId: string): Promise<void>;
  /** 删除（管理员）: removes someone else's post, or one comment on it, with a reason. */
  /** 「删除（管理员）」：带着原因移除别人的动态，或其中的一条评论。 */
  removeAsModerator(target: { postId: string; commentId?: string | null }, reason: string): Promise<boolean>;
  /** A 404 on any action: the post leaves every list. */
  /** 任何操作返回 404：这条动态从所有列表中移除。 */
  dropPost(postId: string): void;
  /** Back online sends what waited: likes, comments once, and posts. */
  /** 恢复联网后发送等待中的内容：赞、评论（自动一次）和动态。 */
  setOnline(online: boolean): void;
  /** Sign-out: clears memory, drafts of comments and the device cache. */
  /** 退出登录：清空内存、评论草稿和设备缓存。 */
  reset(): void;
}

export type FeedStore = FeedState & FeedActions;

/** A list that answered page 1 more recently than this is not fetched again by open(). */
/** 第一页的返回时间比这更近的列表，open() 不会再次请求。 */
export const REOPEN_REFRESH_MS = 30_000;
/** The fade of a deleted card before it leaves the list. */
/** 被删除的卡片在离开列表之前的淡出时间。 */
export const DELETE_FADE_MS = 200;
/** First like retry after this; the second after twice this. */
/** 第一次重试赞在此之后；第二次在两倍时间之后。 */
export const LIKE_RETRY_BASE_MS = 1_000;
/**
 * A saved scroll beyond this is past the 192px cover under the 44px header, where 有 N 条新动态 shows, so a quiet
 * reload holds new posts back instead of moving the content.
 * 保存的滚动位置超过这个值时，已滚过 44px 标题栏下方 192px 的封面，「有 N 条新动态」在此时显示，因此安静的重新加载会留住新动态而不移动内容。
 */
export const READING_SCROLL_Y = 192 - 44;
/** The device cache of the home feed is written this long after the last change. */
/** 动态首页的设备缓存在最后一次变化之后这么久写入。 */
export const CACHE_WRITE_DELAY_MS = 500;
/** The detail page fetches the rest of a long thread page by page, at most this many pages. */
/** 详情页逐页取回长讨论剩下的评论，最多这么多页。 */
export const DETAIL_COMMENT_PAGES = 40;
/**
 * The local copies of a post published here go this long after it is confirmed, in case no card ever loads the
 * server previews (the card was never mounted, or left before they loaded).
 * 从本设备发表的动态确认之后过这么久释放本地副本，以防没有卡片去加载服务器的预览图（卡片从未挂载，或在加载完成之前离开）。
 */
export const LOCAL_MEDIA_RELEASE_MS = 60_000;

/** Calls the store needs; tests pass a fake. */
/** store 需要的接口调用；测试时传入替身。 */
export type FeedApi = Pick<
  MomentsApi,
  'feed' | 'album' | 'post' | 'comments' | 'create' | 'remove' | 'like' | 'comment' | 'removeComment' | 'moderatePost' | 'moderateComment'
>;

/** Everything outside the store, so it can be tested in Node. */
/** store 之外的一切依赖，以便在 Node 中测试。 */
export interface FeedStoreDeps {
  api: FeedApi;
  /** The signed-in member as cards show them; null when signed out. */
  /** 卡片中显示的当前成员；未登录时为 null。 */
  me(): MomentPerson | null;
  /** The session's media token, which also signs avatars and covers. */
  /** 会话的媒体令牌，头像和封面也使用它。 */
  mediaToken(): string | null;
  setMediaToken(token: string): void;
  badge: { refresh(options?: { force?: boolean }): Promise<void>; markFeedSeen(upTo: string): void };
  cache: { read(memberId: string): CachedFeed | null; write(memberId: string, feed: CachedFeed): void; clear(): void };
  clearDrafts(): void;
  /** False while the device is known to be offline. */
  /** 设备已知离线时为 false。 */
  isOnline(): boolean;
  makeClientId(): string;
  now(): number;
  /** Keeps a waiting app update from reloading the page (pwa.ts) and returns the release. */
  /** 阻止等待中的应用更新重新加载页面（pwa.ts），并返回释放函数。 */
  holdUpdate(): () => void;
}

interface FirstAnswer {
  posts: MomentPost[];
  nextCursor: string | null;
  mediaToken: string;
  owner?: MomentAlbumOwner;
  clubOnly?: boolean;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 404;
}

/** A 404 about the post itself, not about one comment on it. */
/** 关于动态本身的 404，而不是关于其中某条评论的。 */
function isPostGone(error: unknown): boolean {
  return isNotFound(error) && (error as ApiClientError).code !== 'comment_unavailable';
}

function isReading(list: FeedList | undefined): boolean {
  return (list?.scrollY ?? 0) > READING_SCROLL_Y;
}

function samePerson(a: MomentPerson | null, b: MomentPerson | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.displayName === b.displayName && a.avatarKey === b.avatarKey;
}

/**
 * The feed data of 好友动态 with the optimistic model of 5.11. Lists hold ids into one record of posts, so a like or
 * a comment shows in every list at once; this device's pending likes, comments and posts are laid over the server's
 * data by the view selectors, and every async answer is ignored after a sign-out (generation).
 * 好友动态的信息流数据，采用 5.11 的乐观更新模型。列表只保存 id，指向同一份动态记录，因此一次点赞或评论会同时显示在所有列表中；
 * 本设备尚未完成的赞、评论和动态由视图选择器叠加在服务器数据之上；退出登录后，所有异步返回都会被忽略（generation）。
 */
export function createFeedStore(deps: FeedStoreDeps) {
  let generation = 0;
  /** Orders fetches against deletions, so an answer that left before a delete cannot bring the item back. */
  /** 给请求和删除排序，删除之前发出的请求返回时不会把内容带回来。 */
  let seq = 0;
  let loadToken = 0;
  const firstLoads = new Map<FeedKey, { token: number; promise: Promise<void> }>();
  /** Bumped when a list is replaced by page 1, so a next page asked for before cannot land on it. */
  /** 列表被第一页替换时递增，替换之前请求的下一页不会落到新列表上。 */
  const epochs = new Map<FeedKey, number>();
  /** Posts and comments deleted here, by id, with the seq of the deletion. */
  /** 在本设备删除的动态和评论，按 id 记录删除时的 seq。 */
  const tombstones = new Map<string, number>();
  /** Posts whose like or comment from here the server confirmed, by id, with the seq of the latest confirmation. */
  /** 本设备的赞或评论已被服务器确认的动态，按 id 记录最近一次确认时的 seq。 */
  const touched = new Map<string, number>();
  /** Holds of open viewers and players on a post's local copies, by the id they opened (local or server), counted. */
  /** 已打开的查看器和播放器对动态本地副本的占用，按打开时的 id（本地或服务器的）计数。 */
  const pins = new Map<string, number>();
  /** Server post ids whose releaseLocalMedia waits for the last hold to let go. */
  /** 释放本地副本需要等最后一个占用解除的服务器动态 id。 */
  const deferredReleases = new Set<string>();
  const commentLoads = new Map<string, Promise<void>>();
  /** Upload batches of local posts, by clientId. */
  /** 本地动态的上传批次，按 clientId 存放。 */
  const uploads = new Map<string, { batch: UploadBatch; stop: () => void }>();
  /** Upload batches of confirmed posts, by server id, released with releaseLocalMedia. */
  /** 已确认动态的上传批次，按服务器 id 存放，由 releaseLocalMedia 释放。 */
  const releasable = new Map<string, UploadBatch>();
  /** Where publishing stands: waiting for uploads, POST out, or stopped (failed or offline). */
  /** 发表进行到哪一步：等待上传、已发出 POST，或已停止（失败或离线）。 */
  const phases = new Map<string, 'uploads' | 'post' | 'idle'>();
  const attempts = new Map<string, number>();
  /** Local posts discarded while their POST was out; the server's copy is deleted when it answers. */
  /** 在 POST 已发出时被删除的本地动态；服务器返回后删除服务器上的那一份。 */
  const discarded = new Set<string>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let incomingInflight: Promise<void> | null = null;
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let listening = false;
  const memo = createViewMemo();

  const store = create<FeedStore>()((set, get) => {
    const update = (change: (state: FeedStore) => FeedStore) => {
      const current = get();
      const next = change(current);
      if (next !== current) set(next);
    };
    const alive = (startGeneration: number) => startGeneration === generation;
    const later = (run: () => void, ms: number) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        run();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const cancel = (timer: ReturnType<typeof setTimeout>) => {
      clearTimeout(timer);
      timers.delete(timer);
    };
    const nowIso = () => new Date(deps.now()).toISOString();
    const offlineFailure = (error: unknown) => error instanceof TypeError && (!deps.isOnline() || !get().online);
    const epochOf = (key: FeedKey) => epochs.get(key) ?? 0;
    const tombstoned = (id: string, startSeq: number) => {
      const at = tombstones.get(id);
      return at !== undefined && at > startSeq;
    };
    /** The server confirmed a like or comment here: a fetch that left before cannot take it back. */
    /** 服务器确认了本设备的赞或评论：在此之前发出的请求不能把它撤回。 */
    const touch = (postId: string) => {
      seq += 1;
      touched.set(postId, seq);
    };
    /** A viewer or player holds the post, by its server id or by the local id it was opened on. */
    /** 有查看器或播放器占用这条动态：按服务器 id，或按打开时的本地 id。 */
    const pinned = (postId: string) => {
      if (pins.has(postId)) return true;
      const clientId = get().posts[postId]?.clientId;
      return !!clientId && pins.has(localPostKey(clientId));
    };

    function syncMe(): MomentPerson | null {
      const me = deps.me();
      if (!samePerson(get().me, me)) set({ me });
      return me;
    }

    function takeToken(token: string) {
      if (!token) return;
      if (get().mediaToken !== token) set({ mediaToken: token });
      if (deps.mediaToken() !== token) deps.setMediaToken(token);
    }

    /**
     * Leaves out what this device is deleting or deleted after the fetch started, and keeps the likes and comments
     * the server confirmed here after it started.
     * 去掉本设备正在删除的内容，以及在请求发出之后删除的内容；并保留请求发出之后服务器确认的本设备的赞和评论。
     */
    function filterFetched(posts: readonly MomentPost[], startSeq: number): MomentPost[] {
      const state = get();
      const kept: MomentPost[] = [];
      for (const post of posts) {
        if (state.deletedPosts[post.id] || tombstoned(post.id, startSeq)) continue;
        const comments = post.comments.filter((comment) => !state.deletedComments[comment.id] && !tombstoned(comment.id, startSeq));
        const dropped = post.comments.length - comments.length;
        const fetched = dropped ? { ...post, comments, commentCount: Math.max(0, post.commentCount - dropped) } : post;
        const stored = state.posts[post.id];
        kept.push(stored && (touched.get(post.id) ?? -1) > startSeq ? keepConfirmedActivity(fetched, stored) : fetched);
      }
      return kept;
    }

    function releaseMedia(postId: string) {
      deferredReleases.delete(postId);
      const batch = releasable.get(postId);
      if (!batch) return;
      releasable.delete(postId);
      batch.release();
    }

    /** The cards stop drawing this device's copies of the post, and the batch's object URLs go. */
    /** 卡片不再显示这条动态在本设备上的副本，批次的 object URL 随之释放。 */
    function dropLocalMedia(postId: string) {
      update((state) => {
        if (!state.localMedia[postId]) return state;
        const localMedia = { ...state.localMedia };
        delete localMedia[postId];
        return { ...state, localMedia };
      });
      releaseMedia(postId);
    }

    /**
     * After a post published here is confirmed: only the cards of home and the detail page draw its local copies, and
     * they release them once the server previews load. With neither list loaded (a post from the own album, whose rows
     * draw the server's thumb once it is confirmed) nothing would, so they go now; otherwise a timer lets them go in
     * case no card ever loads the previews.
     * 从本设备发表的动态确认之后：只有动态首页和详情页的卡片会显示它的本地副本，并在服务器预览图加载完成后释放。两个列表都没有加载时
     * （从自己的相册发表，确认后相册行显示服务器的缩略图）就没有谁会释放，因此立即释放；否则用计时器兜底，以防没有卡片去加载预览图。
     */
    function releaseWhenUndrawn(postId: string) {
      const state = get();
      if (!state.lists[HOME_FEED] && !state.lists[postFeedKey(postId)]) {
        get().releaseLocalMedia(postId);
        return;
      }
      later(() => get().releaseLocalMedia(postId), LOCAL_MEDIA_RELEASE_MS);
    }

    /** The post answered 404: it leaves every list, with the server's message. */
    /** 动态返回了 404：它从所有列表中移除，并显示服务器的提示。 */
    function gone(postId: string, error: unknown) {
      update((state) => removePost(state, postId));
      releaseMedia(postId);
      toast(errorMessage(error));
    }

    function markSeen() {
      const upTo = newestShown(get(), HOME_FEED);
      if (upTo) deps.badge.markFeedSeen(upTo);
    }

    function listen() {
      if (listening || typeof window === 'undefined') return;
      listening = true;
      window.addEventListener('online', () => get().setOnline(true));
      window.addEventListener('offline', () => get().setOnline(false));
    }

    async function fetchFirst(key: FeedKey): Promise<FirstAnswer> {
      const parts = parseFeedKey(key);
      if (parts.kind === 'home') return deps.api.feed(null);
      if (parts.kind === 'album') {
        const res = await deps.api.album(parts.memberId, null);
        return { posts: res.posts, nextCursor: res.nextCursor, mediaToken: res.mediaToken, owner: res.member, clubOnly: res.clubOnly };
      }
      const res = await deps.api.post(parts.postId);
      return { posts: [res.post], nextCursor: null, mediaToken: res.mediaToken };
    }

    function fetchMore(key: FeedKey, cursor: string): Promise<{ posts: MomentPost[]; nextCursor: string | null; mediaToken: string }> {
      const parts = parseFeedKey(key);
      if (parts.kind === 'album') return deps.api.album(parts.memberId, cursor);
      return deps.api.feed(cursor);
    }

    /** Page 1 of `key`. Only the latest load of a list applies its answer. */
    /** 加载 `key` 的第一页。只有一个列表最近一次的加载会应用其返回。 */
    function loadFirst(key: FeedKey, mode: 'replace' | 'reconcile', options: { refreshing?: boolean } = {}): Promise<void> {
      const startGeneration = generation;
      const token = ++loadToken;
      const startSeq = seq;
      const parts = parseFeedKey(key);
      update((state) =>
        withList(state, key, (list) => {
          if (list.status === 'ready') return options.refreshing && !list.refreshing ? { ...list, refreshing: true } : list;
          return { ...list, status: 'loading', error: null, refreshing: false };
        }),
      );
      const latest = () => alive(startGeneration) && firstLoads.get(key)?.token === token;
      const promise = fetchFirst(key)
        .then((res) => {
          if (!latest()) return;
          takeToken(res.mediaToken);
          const posts = filterFetched(res.posts, startSeq);
          const holdNew = key === HOME_FEED && mode === 'reconcile' && isReading(get().lists[key]);
          update((state) => {
            let next = applyFirstPage(state, key, { posts, nextCursor: res.nextCursor }, { mode: parts.kind === 'post' ? 'replace' : mode, holdNew, now: deps.now() });
            if (res.owner) {
              const owner = res.owner;
              next = withList(next, key, (list) => ({ ...list, owner, clubOnly: res.clubOnly === true }));
            }
            return next;
          });
          if (mode === 'replace') epochs.set(key, epochOf(key) + 1);
          if (key === HOME_FEED) markSeen();
          if (parts.kind === 'post') {
            // A page of comments that failed stopped the thread; this reload (加载失败，轻触重试) follows the cursor again.
            // 某一页评论加载失败后讨论就停住了；这次重新加载（「加载失败，轻触重试」）重新沿着 cursor 往下加载。
            if (get().commentPaging[parts.postId] === 'failed') update((state) => setCommentPaging(state, parts.postId, 'idle'));
            void loadAllComments(parts.postId, startGeneration);
          }
        })
        .catch((error: unknown) => {
          if (!latest()) return;
          if (isNotFound(error) && parts.kind === 'post') {
            update((state) => withList(removePost(state, parts.postId), key, (list) => ({ ...list, ids: [], status: 'unavailable', refreshing: false, error: null, loadedAt: deps.now() })));
            releaseMedia(parts.postId);
            return;
          }
          if (isNotFound(error) && parts.kind === 'album') {
            update((state) =>
              withList(state, key, (list) => ({
                ...list,
                ids: [],
                incoming: [],
                nextCursor: null,
                status: 'unavailable',
                refreshing: false,
                fromCache: false,
                more: 'idle',
                error: null,
                owner: null,
                loadedAt: deps.now(),
              })),
            );
            return;
          }
          const message = errorMessage(error);
          update((state) =>
            withList(state, key, (list) =>
              list.status === 'ready'
                ? { ...list, refreshing: false, error: message, more: list.fromCache ? 'failed' : list.more }
                : { ...list, status: 'error', refreshing: false, error: message },
            ),
          );
        })
        .finally(() => {
          if (firstLoads.get(key)?.token === token) firstLoads.delete(key);
        });
      firstLoads.set(key, { token, promise });
      return promise;
    }

    /** The detail page shows every comment: the rest of a long thread follows page by page. */
    /** 详情页显示全部评论：长讨论剩下的评论逐页跟上。 */
    async function loadAllComments(postId: string, startGeneration: number) {
      for (let page = 0; page < DETAIL_COMMENT_PAGES; page += 1) {
        const post = get().posts[postId];
        if (!alive(startGeneration) || !post?.commentsCursor || get().commentPaging[postId] === 'failed') return;
        await get().loadMoreComments(postId);
      }
    }

    function sendLike(postId: string) {
      const intent = get().likes[postId];
      if (!intent || intent.inFlight) return;
      if (!get().online) {
        update((state) => likeFailed(state, postId, true).state);
        return;
      }
      const startGeneration = generation;
      update((state) => likeStarted(state, postId));
      deps.api
        .like(postId, { liked: intent.desired })
        .then((res) => {
          if (!alive(startGeneration)) return;
          touch(postId);
          const result = likeSettled(get(), postId, res);
          set(result.state);
          if (result.resend) sendLike(postId);
        })
        .catch((error: unknown) => {
          if (!alive(startGeneration)) return;
          if (isPostGone(error)) {
            gone(postId, error);
            return;
          }
          const result = likeFailed(get(), postId, offlineFailure(error));
          set(result.state);
          if (result.retry) {
            const failures = result.state.likes[postId]?.failures ?? 1;
            later(() => sendLike(postId), LIKE_RETRY_BASE_MS * 2 ** (failures - 1));
          }
          if (result.reverted) toast(tr('操作失败，请重试', "That didn't work. Try again."));
        });
    }

    function deliverComment(postId: string, clientId: string) {
      const pending = findPendingComment(get(), postId, clientId);
      if (!pending) return;
      if (!get().online) {
        update((state) => updatePendingComment(state, postId, clientId, { status: 'waiting', failure: null }));
        return;
      }
      const startGeneration = generation;
      update((state) => updatePendingComment(state, postId, clientId, { status: 'sending', failure: null }));
      deps.api
        .comment(postId, { clientId, text: pending.body, replyToCommentId: pending.replyTo?.commentId ?? null })
        .then((res) => {
          if (!alive(startGeneration)) return;
          touch(postId);
          update((state) => confirmComment(state, postId, clientId, res));
        })
        .catch((error: unknown) => {
          if (!alive(startGeneration) || !findPendingComment(get(), postId, clientId)) return;
          if (isPostGone(error)) {
            gone(postId, error);
            return;
          }
          if (offlineFailure(error)) {
            update((state) => updatePendingComment(state, postId, clientId, { status: 'waiting', failure: null }));
            return;
          }
          update((state) => updatePendingComment(state, postId, clientId, { status: 'failed', failure: errorMessage(error) }));
          announce(tr('评论发送失败', "Couldn't send the comment"));
        });
    }

    /** A reply from 消息 to a post no list holds: no pending row, so a failure is a toast. */
    /** 从「消息」回复一条不在任何列表中的动态：没有待发送行，因此失败时用提示显示。 */
    function sendDetached(comment: LocalComment) {
      const startGeneration = generation;
      deps.api
        .comment(comment.postId, { clientId: comment.clientId, text: comment.body, replyToCommentId: comment.replyTo?.commentId ?? null })
        .then((res) => {
          if (!alive(startGeneration)) return;
          touch(comment.postId);
          update((state) => confirmComment(state, comment.postId, comment.clientId, res));
        })
        .catch((error: unknown) => {
          if (!alive(startGeneration)) return;
          if (isPostGone(error)) update((state) => removePost(state, comment.postId));
          toast(errorMessage(error));
          announce(tr('评论发送失败', "Couldn't send the comment"));
        });
    }

    async function runPublish(clientId: string): Promise<void> {
      const local = findLocalPost(get(), clientId);
      if (!local) return;
      const startGeneration = generation;
      const attempt = (attempts.get(clientId) ?? 0) + 1;
      attempts.set(clientId, attempt);
      const current = () => alive(startGeneration) && attempts.get(clientId) === attempt && !!findLocalPost(get(), clientId);
      const fail = (failure: string) => {
        phases.set(clientId, 'idle');
        update((state) => setLocalPostState(state, clientId, { status: 'failed', failure }));
        announce(tr('发送失败', "Couldn't send"));
      };

      let media: MomentMediaInput[] = [];
      const entry = uploads.get(clientId);
      if (entry) {
        phases.set(clientId, 'uploads');
        update((state) => setLocalPostState(state, clientId, { status: state.online ? 'uploading' : 'waiting', failure: null }));
        try {
          media = await entry.batch.whenUploaded();
        } catch (error) {
          if (current()) fail(errorMessage(error));
          return;
        }
        if (!current()) return;
      }
      if (!get().online) {
        phases.set(clientId, 'idle');
        update((state) => setLocalPostState(state, clientId, { status: 'waiting', failure: null }));
        return;
      }

      phases.set(clientId, 'post');
      update((state) => setLocalPostState(state, clientId, { status: 'sending', progress: 1, failure: null }));
      const { request } = local;
      try {
        const res = await deps.api.create({
          clientId,
          ...(request.text ? { text: request.text } : {}),
          ...(media.length ? { media } : {}),
          audience: request.audience,
          location: request.location,
        });
        if (!alive(startGeneration)) return;
        if (discarded.delete(clientId)) {
          // 删除 was pressed while the post was on its way: the member does not want it, so the server's copy goes too.
          // 发表途中按了「删除」：成员不想要这条动态，因此把服务器上的那一份也删掉。
          void deps.api.remove(res.post.id).catch(() => undefined);
          return;
        }
        if (!findLocalPost(get(), clientId)) {
          // Another attempt with the same clientId already confirmed it.
          // 使用同一 clientId 的另一次尝试已经确认过了。
          update((state) => ({ ...state, posts: upsertPosts(state.posts, [res.post]) }));
          return;
        }
        phases.delete(clientId);
        attempts.delete(clientId);
        takeToken(res.mediaToken);
        const me = get().me;
        update((state) => confirmLocalPost(state, clientId, res.post, me ? [HOME_FEED, albumFeedKey(me.id)] : [HOME_FEED]));
        const done = uploads.get(clientId);
        if (done) {
          done.stop();
          uploads.delete(clientId);
          if (res.post.media.length) {
            releasable.set(res.post.id, done.batch);
            releaseWhenUndrawn(res.post.id);
          } else {
            done.batch.release();
          }
        }
        announce(tr('已发表', 'Posted'));
      } catch (error) {
        discarded.delete(clientId);
        if (!current()) return;
        if (offlineFailure(error)) {
          phases.set(clientId, 'idle');
          update((state) => setLocalPostState(state, clientId, { status: 'waiting', failure: null }));
          return;
        }
        fail(errorMessage(error));
      }
    }

    return {
      ...initialFeedState(),
      online: deps.isOnline(),

      open: (key) => {
        listen();
        const me = syncMe();
        if (!me) return;
        const state = get();
        const parts = parseFeedKey(key);
        const list = state.lists[key];
        if (!list) {
          let next: FeedStore = withList(state, key, (created) => created);
          const cached = key === HOME_FEED ? deps.cache.read(me.id) : null;
          if (cached) {
            // Shown at once; page 1 replaces it when it answers, and paging waits for that (more: 'loading').
            // 立即显示；第一页返回后替换它，翻页要等到那时（more 为 'loading'）。
            const posts = upsertPosts(next.posts, cached.posts);
            const ids = cached.posts.map((post) => post.id);
            next = withList({ ...next, posts }, key, (created) => ({ ...created, ids, status: 'ready', fromCache: true, more: 'loading' }));
          } else if (parts.kind === 'post' && state.posts[parts.postId]) {
            next = withList(next, key, (created) => ({ ...created, ids: [parts.postId], status: 'ready' }));
          }
          const token = next.mediaToken ?? deps.mediaToken() ?? cached?.mediaToken ?? null;
          if (token !== next.mediaToken) next = { ...next, mediaToken: token };
          set(next);
          void loadFirst(key, parts.kind === 'post' ? 'replace' : 'reconcile');
          return;
        }
        if (key === HOME_FEED && list.incoming.length && !isReading(list)) get().mergeIncoming();
        if (firstLoads.has(key)) return;
        const stale = list.loadedAt === null || deps.now() - list.loadedAt >= REOPEN_REFRESH_MS;
        if (list.status !== 'ready') void loadFirst(key, 'replace');
        else if (stale) void loadFirst(key, parts.kind === 'post' ? 'replace' : 'reconcile');
      },

      refresh: async (key) => {
        if (!syncMe()) return;
        if (!get().lists[key]) {
          get().open(key);
          await firstLoads.get(key)?.promise;
        } else {
          await loadFirst(key, 'replace', { refreshing: true });
        }
        if (key === HOME_FEED) await deps.badge.refresh({ force: true });
      },

      loadMore: async (key) => {
        const list = get().lists[key];
        if (!list || list.status !== 'ready') return;
        if (list.fromCache) {
          await (firstLoads.get(key)?.promise ?? loadFirst(key, 'replace'));
          return;
        }
        const cursor = list.nextCursor;
        if (!cursor || list.more === 'loading' || parseFeedKey(key).kind === 'post') return;
        const startGeneration = generation;
        const epoch = epochOf(key);
        const startSeq = seq;
        update((state) => withList(state, key, (current) => ({ ...current, more: 'loading' })));
        try {
          const res = await fetchMore(key, cursor);
          if (!alive(startGeneration) || epochOf(key) !== epoch) return;
          if (get().lists[key]?.nextCursor !== cursor) {
            // A quiet reload of page 1 moved the cursor meanwhile, so this page no longer follows the list; the footer
            // pages on from the new cursor. No other loadMore of this list can be out while more is 'loading'.
            // 期间第一页的安静重新加载移动了 cursor，这一页已接不上列表；底部从新的 cursor 继续翻页。more 为 'loading' 时，
            // 这个列表不会有别的 loadMore 在进行。
            update((state) => withList(state, key, (list) => (list.more === 'loading' ? { ...list, more: 'idle' } : list)));
            return;
          }
          takeToken(res.mediaToken);
          update((state) => appendPage(state, key, { posts: filterFetched(res.posts, startSeq), nextCursor: res.nextCursor }));
        } catch {
          if (!alive(startGeneration) || epochOf(key) !== epoch) return;
          update((state) => withList(state, key, (current) => ({ ...current, more: 'failed' })));
        }
      },

      fetchIncoming: () => {
        const list = get().lists[HOME_FEED];
        if (!list || list.status !== 'ready' || list.fromCache || firstLoads.has(HOME_FEED)) return Promise.resolve();
        if (incomingInflight) return incomingInflight;
        const startGeneration = generation;
        const startSeq = seq;
        const epoch = epochOf(HOME_FEED);
        const run = deps.api
          .feed(null)
          .then((res) => {
            if (!alive(startGeneration) || firstLoads.has(HOME_FEED) || epochOf(HOME_FEED) !== epoch) return;
            takeToken(res.mediaToken);
            update((state) => holdIncoming(state, { posts: filterFetched(res.posts, startSeq), nextCursor: res.nextCursor }));
          })
          .catch(() => {
            // The next check tries again.
            // 下一次检查时再试。
          })
          .finally(() => {
            if (incomingInflight === run) incomingInflight = null;
          });
        incomingInflight = run;
        return run;
      },

      mergeIncoming: () => {
        if (!get().lists[HOME_FEED]?.incoming.length) return;
        update(mergeIncomingPosts);
        markSeen();
      },

      saveScroll: (key, scrollY) => {
        const y = Math.max(0, Math.round(scrollY));
        update((state) => {
          const list = state.lists[key];
          if (!list || list.scrollY === y) return state;
          return withList(state, key, (current) => ({ ...current, scrollY: y }));
        });
      },

      setExpanded: (key, postId, expanded) => update((state) => setExpandedIn(state, key, postId, expanded)),

      toggleLike: (postId) => {
        const post = get().posts[postId];
        if (!post || !post.canInteract || isLocalPostKey(postId)) return;
        syncMe();
        const result = tapLike(get(), postId);
        set(result.state);
        const liked = result.state.likes[postId]?.desired ?? result.state.posts[postId]?.likedByMe ?? false;
        announce(liked ? tr('已赞', 'Liked') : tr('已取消赞', 'Like removed'));
        if (result.send) sendLike(postId);
      },

      publish: (request) => {
        const me = syncMe();
        if (!me) {
          request.uploads?.release();
          return;
        }
        const batch = request.uploads;
        update((state) => addLocalPost(state, buildLocalPost(request, me, batch?.items() ?? [], nowIso())));
        if (batch) {
          const stop = batch.subscribe(() => update((state) => syncLocalUploads(state, request.clientId, batch.items())));
          uploads.set(request.clientId, { batch, stop });
        }
        void runPublish(request.clientId);
      },

      retryPost: (clientId) => {
        const local = findLocalPost(get(), clientId);
        if (!local || local.state.status === 'sending' || local.state.status === 'uploading') return;
        uploads.get(clientId)?.batch.retry();
        void runPublish(clientId);
      },

      discardPost: (clientId) => {
        if (phases.get(clientId) === 'post') discarded.add(clientId);
        phases.delete(clientId);
        attempts.delete(clientId);
        update((state) => removeLocalPost(state, clientId));
        const entry = uploads.get(clientId);
        if (entry) {
          entry.stop();
          uploads.delete(clientId);
          entry.batch.release();
        }
      },

      releaseLocalMedia: (postId) => {
        if (pinned(postId)) {
          deferredReleases.add(postId);
          return;
        }
        dropLocalMedia(postId);
      },

      pinLocalMedia: (postId) => {
        const startGeneration = generation;
        pins.set(postId, (pins.get(postId) ?? 0) + 1);
        let held = true;
        return () => {
          // A reset dropped every hold already.
          // 重置时已清除了全部占用。
          if (!held || !alive(startGeneration)) return;
          held = false;
          const left = (pins.get(postId) ?? 1) - 1;
          if (left > 0) pins.set(postId, left);
          else pins.delete(postId);
          for (const id of [...deferredReleases]) {
            if (pinned(id)) continue;
            deferredReleases.delete(id);
            dropLocalMedia(id);
          }
        };
      },

      deletePost: async (postId) => {
        if (isLocalPostKey(postId)) {
          const clientId = postId.slice(localPostKey('').length);
          if (!findLocalPost(get(), clientId)) return false;
          get().discardPost(clientId);
          announce(tr('已删除', 'Deleted'));
          return true;
        }
        const state = get();
        if (!state.posts[postId] || state.deleting[postId] || state.deletedPosts[postId]) return false;
        const startGeneration = generation;
        let hidden = false;
        let confirmed = false;
        const finish = () => {
          seq += 1;
          tombstones.set(postId, seq);
          update((current) => removePost(current, postId));
          releaseMedia(postId);
        };
        update((current) => setDeleting(current, postId, true));
        const fade = later(() => {
          hidden = true;
          if (confirmed) finish();
          else update((current) => hidePost(current, postId));
        }, DELETE_FADE_MS);
        try {
          await deps.api.remove(postId);
        } catch (error) {
          if (!alive(startGeneration)) return false;
          // A 404 means it is already gone, which is what was asked.
          // 404 表示它已经不在了，正是想要的结果。
          if (!isNotFound(error)) {
            cancel(fade);
            update((current) => (hidden ? restoreHiddenPost(current, postId) : setDeleting(current, postId, false)));
            toast(errorMessage(error));
            return false;
          }
        }
        if (!alive(startGeneration)) return false;
        confirmed = true;
        if (hidden) finish();
        announce(tr('已删除', 'Deleted'));
        return true;
      },

      sendComment: (input) => {
        const body = normalizeMomentComment(input.text);
        if (!body) return '';
        syncMe();
        const clientId = deps.makeClientId();
        const comment: LocalComment = {
          clientId,
          postId: input.postId,
          replyTo: input.replyTo,
          body,
          createdAt: nowIso(),
          status: get().online ? 'sending' : 'waiting',
          failure: null,
          autoRetried: false,
        };
        announce(tr('评论已发送', 'Comment sent'));
        const state = get();
        const shown = !!state.posts[input.postId] && Object.values(state.lists).some((list) => list?.ids.includes(input.postId));
        if (!shown) {
          sendDetached(comment);
          return clientId;
        }
        update((current) => addPendingComment(current, comment));
        deliverComment(input.postId, clientId);
        return clientId;
      },

      resendComment: (postId, clientId) => {
        const pending = findPendingComment(get(), postId, clientId);
        if (!pending || pending.status === 'sending') return;
        deliverComment(postId, clientId);
      },

      discardComment: (postId, clientId) => update((state) => removePendingComment(state, postId, clientId)),

      deleteComment: async (postId, commentId) => {
        const state = get();
        if (!state.posts[postId]?.comments.some((comment) => comment.id === commentId) || state.deletedComments[commentId]) return false;
        const startGeneration = generation;
        update((current) => hideComment(current, postId, commentId));
        try {
          await deps.api.removeComment(commentId);
        } catch (error) {
          if (!alive(startGeneration)) return false;
          if (isPostGone(error)) {
            gone(postId, error);
            return false;
          }
          // comment_unavailable: it is already gone, which is what was asked.
          // comment_unavailable：评论已经不在了，正是想要的结果。
          if (!isNotFound(error)) {
            update((current) => restoreHiddenComment(current, commentId));
            toast(errorMessage(error));
            return false;
          }
        }
        if (!alive(startGeneration)) return false;
        seq += 1;
        tombstones.set(commentId, seq);
        update((current) => forgetHiddenComment(current, commentId));
        announce(tr('已删除', 'Deleted'));
        return true;
      },

      loadMoreComments: (postId) => {
        const running = commentLoads.get(postId);
        if (running) return running;
        const post = get().posts[postId];
        const cursor = post?.commentsCursor;
        if (!cursor) return Promise.resolve();
        const startGeneration = generation;
        const startSeq = seq;
        update((state) => setCommentPaging(state, postId, 'loading'));
        const run = deps.api
          .comments(postId, cursor)
          .then((res) => {
            if (!alive(startGeneration)) return;
            const comments = res.comments.filter((comment) => !get().deletedComments[comment.id] && !tombstoned(comment.id, startSeq));
            update((state) => {
              // A reload replaced the post meanwhile; its own cursor decides what comes next.
              // 期间重新加载替换了这条动态；接下来加载什么由它自己的 cursor 决定。
              const next = state.posts[postId]?.commentsCursor === cursor ? appendCommentPage(state, postId, comments, res.nextCursor) : state;
              return setCommentPaging(next, postId, 'idle');
            });
          })
          .catch((error: unknown) => {
            if (!alive(startGeneration)) return;
            if (isPostGone(error)) {
              gone(postId, error);
              return;
            }
            update((state) => setCommentPaging(state, postId, 'failed'));
          })
          .finally(() => {
            if (commentLoads.get(postId) === run) commentLoads.delete(postId);
          });
        commentLoads.set(postId, run);
        return run;
      },

      removeAsModerator: async ({ postId, commentId }, reason) => {
        const startGeneration = generation;
        try {
          if (commentId) await deps.api.moderateComment(commentId, { reason });
          else await deps.api.moderatePost(postId, { reason });
        } catch (error) {
          if (!alive(startGeneration)) return false;
          if (!commentId && isNotFound(error)) update((state) => removePost(state, postId));
          toast(errorMessage(error));
          return false;
        }
        if (!alive(startGeneration)) return false;
        seq += 1;
        if (commentId) {
          tombstones.set(commentId, seq);
          update((state) => forgetHiddenComment(hideComment(state, postId, commentId), commentId));
        } else {
          tombstones.set(postId, seq);
          update((state) => removePost(state, postId));
          releaseMedia(postId);
        }
        announce(tr('已删除', 'Deleted'));
        return true;
      },

      dropPost: (postId) => {
        update((state) => removePost(state, postId));
        releaseMedia(postId);
      },

      setOnline: (online) => {
        if (get().online === online) return;
        set({ online });
        if (!online) {
          // Uploads pause by themselves; the cards say 等待网络 meanwhile.
          // 上传会自行暂停；期间卡片显示「等待网络」。
          for (const local of get().localPosts) {
            if (local.state.status === 'uploading') update((state) => setLocalPostState(state, local.state.clientId, { status: 'waiting' }));
          }
          return;
        }
        const woken = wakeLikes(get());
        set(woken.state);
        for (const postId of woken.send) sendLike(postId);
        for (const [postId, pending] of Object.entries(get().pendingComments)) {
          for (const comment of pending) {
            if (comment.autoRetried || (comment.status !== 'waiting' && comment.status !== 'failed')) continue;
            update((state) => updatePendingComment(state, postId, comment.clientId, { autoRetried: true }));
            deliverComment(postId, comment.clientId);
          }
        }
        for (const local of get().localPosts) {
          if (local.state.status !== 'waiting') continue;
          const clientId = local.state.clientId;
          if (phases.get(clientId) === 'uploads') update((state) => setLocalPostState(state, clientId, { status: 'uploading' }));
          else void runPublish(clientId);
        }
        for (const [key, list] of Object.entries(get().lists) as [FeedKey, FeedList | undefined][]) {
          if (!list || firstLoads.has(key)) continue;
          if (list.status === 'error' || (list.status === 'ready' && list.fromCache)) void loadFirst(key, 'replace');
        }
      },

      reset: () => {
        generation += 1;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        if (cacheTimer) clearTimeout(cacheTimer);
        cacheTimer = null;
        for (const { batch, stop } of uploads.values()) {
          stop();
          batch.release();
        }
        uploads.clear();
        for (const batch of releasable.values()) batch.release();
        releasable.clear();
        firstLoads.clear();
        epochs.clear();
        tombstones.clear();
        touched.clear();
        pins.clear();
        deferredReleases.clear();
        commentLoads.clear();
        phases.clear();
        attempts.clear();
        discarded.clear();
        incomingInflight = null;
        set({ ...initialFeedState(), online: deps.isOnline() });
        deps.clearDrafts();
        deps.cache.clear();
      },
    };
  });

  /** The home list's first page goes to the device cache shortly after it changes. */
  /** 动态首页列表的第一页在变化后不久写入设备缓存。 */
  function writeCache() {
    const state = store.getState();
    const list = state.lists[HOME_FEED];
    if (!state.me || !list || list.status !== 'ready' || list.fromCache) return;
    const posts: MomentPost[] = [];
    for (const id of list.ids.slice(0, FEED_CACHE_POSTS)) {
      const post = state.posts[id];
      if (post) posts.push(post);
    }
    deps.cache.write(state.me.id, { posts, mediaToken: state.mediaToken, savedAt: deps.now() });
  }

  store.subscribe((state, prev) => {
    if (cacheTimer || (state.lists[HOME_FEED] === prev.lists[HOME_FEED] && state.posts === prev.posts)) return;
    const startGeneration = generation;
    cacheTimer = setTimeout(() => {
      cacheTimer = null;
      if (startGeneration === generation) writeCache();
    }, CACHE_WRITE_DELAY_MS);
  });

  // A post or a comment written here lives only in memory until the server has it, so from 发表 or 发送 until it lands
  // a waiting app update must not reload the page. A failed one waits for the member (重试 or 重新发送 holds again);
  // 删除 or a sign-out lets go.
  // 本设备发表的动态和发出的评论在服务器收到之前只保存在内存中，所以从「发表」或「发送」到成功，等待中的应用更新都不能重新加载页面。
  // 失败的动态或评论等成员处理（「重试」或「重新发送」会再次占用）；「删除」或退出登录时释放。
  let releaseUpdate: (() => void) | null = null;
  store.subscribe((state, prev) => {
    if (state.localPosts === prev.localPosts && state.pendingComments === prev.pendingComments) return;
    const busy =
      state.localPosts.some((local) => local.state.status !== 'failed') ||
      Object.values(state.pendingComments).some((pending) => pending.some((comment) => comment.status !== 'failed'));
    if (busy && !releaseUpdate) {
      releaseUpdate = deps.holdUpdate();
    } else if (!busy && releaseUpdate) {
      const release = releaseUpdate;
      releaseUpdate = null;
      release();
    }
  });

  return Object.assign(store, { memo });
}

export type FeedStoreHook = ReturnType<typeof createFeedStore>;

/** The member's name and avatar as moments show them. */
/** 好友动态中显示的成员姓名和头像。 */
function personOf(member: MemberSelf | null): MomentPerson | null {
  return member ? { id: member.id, displayName: member.displayName, avatarKey: member.avatarKey } : null;
}

/**
 * Clears the store when the member signs out or another member signs in, and follows a new name or avatar of the
 * signed-in member. Returns the unsubscribe function.
 * 成员退出或换了一个成员登录时清空 store，并跟随当前成员新的姓名或头像。返回取消订阅的函数。
 */
export function bindFeedToSession(store: FeedStoreHook): () => void {
  return useSessionStore.subscribe((state, prev) => {
    const signedOut = prev.token !== null && state.token === null;
    const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
    if (signedOut || switched) {
      store.getState().reset();
      return;
    }
    const me = store.getState().me;
    const next = personOf(state.member);
    if (me && next && !samePerson(me, next)) store.setState({ me: next });
  });
}

const defaultDeps: FeedStoreDeps = {
  api: momentsApi,
  me: () => personOf(useSessionStore.getState().member),
  mediaToken: () => useSessionStore.getState().mediaToken,
  setMediaToken: (token) => useSessionStore.getState().setMediaToken(token),
  badge: {
    refresh: (options) => useMomentsBadge.getState().refresh(options),
    markFeedSeen: (upTo) => useMomentsBadge.getState().markFeedSeen(upTo),
  },
  cache: {
    read: (memberId) => readFeedCache(memberId),
    write: (memberId, feed) => void writeFeedCache(memberId, feed),
    clear: () => clearFeedCache(),
  },
  clearDrafts: clearCommentDrafts,
  isOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  makeClientId: newMomentClientId,
  now: () => Date.now(),
  holdUpdate: holdAppUpdate,
};

export const useFeedStore = createFeedStore(defaultDeps);
bindFeedToSession(useFeedStore);

/** Empty lists by key, so a list that is not open yet still selects one stable object. */
/** 按 key 存放的空列表，尚未打开的列表也能选到同一个稳定的对象。 */
const emptyLists = new Map<FeedKey, FeedList>();

function emptyListOf(key: FeedKey): FeedList {
  let list = emptyLists.get(key);
  if (!list) {
    list = emptyFeedList(key);
    emptyLists.set(key, list);
  }
  return list;
}

/** The list's state; an empty idle list before it is opened. */
/** 列表的状态；打开之前为空的 idle 列表。 */
export function useFeedList(key: FeedKey): FeedList {
  return useFeedStore((state) => state.lists[key] ?? emptyListOf(key));
}

/**
 * The cards of a list in display order: local posts first on home and on the own album, then the server posts.
 * The array keeps its identity until something in it changes.
 * 列表中按显示顺序排列的卡片：动态首页和自己的相册先显示本地动态，再显示服务器的动态。数组在内容变化之前保持同一引用。
 */
export function useMomentViews(key: FeedKey): readonly MomentView[] {
  const select = useCallback((state: FeedStore) => useFeedStore.memo.views(state, key), [key]);
  return useFeedStore(select);
}

/**
 * One card by post.id, local or server, for the viewer and the detail page; null when unknown. A viewer opened on a
 * local post keeps it after the server confirms it.
 * 按 post.id（本地或服务器的）取一张卡片，供查看器和详情页使用；未知时为 null。在本地动态上打开的查看器，在服务器确认之后仍能取到它。
 */
export function useMomentView(postId: string): MomentView | null {
  const select = useCallback((state: FeedStore) => useFeedStore.memo.view(state, postId), [postId]);
  return useFeedStore(select);
}

/**
 * Holds this device's copies of the post's media while the calling viewer or player is mounted, so releaseLocalMedia
 * waits until it closes. Pass the id the viewer was opened on (local or server); null holds nothing.
 * 调用它的查看器或播放器挂载期间，占用这条动态在本设备上的媒体副本，releaseLocalMedia 会等到它关闭之后。传入打开时的 id
 * （本地或服务器的）；为 null 时不占用。
 */
export function usePinnedLocalMedia(postId: string | null): void {
  useEffect(() => {
    if (!postId) return undefined;
    return useFeedStore.getState().pinLocalMedia(postId);
  }, [postId]);
}

/**
 * The home feed's background check (5.8): the badge on focus, visibility, online, the moments push message and every
 * BADGE_POLL_MS while on screen; whenever it reports new posts, page 1 is fetched quietly into incoming behind
 * 有 N 条新动态, so nothing moves under the reader. MomentsPage mounts it once, beside open(HOME_FEED).
 * 动态首页的后台检查（5.8）：在获得焦点、页面可见、恢复联网、收到好友动态推送消息时，以及显示期间每隔 BADGE_POLL_MS 刷新角标；
 * 每当角标报告有新动态，就安静地把第一页取到 incoming 中，等在「有 N 条新动态」后面，读者眼前的内容不会移动。由 MomentsPage 挂载一次，
 * 与 open(HOME_FEED) 一起使用。
 */
export function useHomeFeedSync(): void {
  useMomentsBadgeSync({ pollMs: BADGE_POLL_MS });
  useEffect(() => {
    const check = () => {
      if (useMomentsBadge.getState().newPosts > 0) void useFeedStore.getState().fetchIncoming();
    };
    check();
    return useMomentsBadge.subscribe((state, prev) => {
      if (state.newPosts !== prev.newPosts || state.latestAuthor?.id !== prev.latestAuthor?.id) check();
    });
  }, []);
}
