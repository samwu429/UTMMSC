import {
  normalizeMomentText,
  type CreateMomentCommentResponse,
  type MomentComment,
  type MomentLikeResponse,
  type MomentMedia,
  type MomentPerson,
  type MomentPost,
} from '@utmmsc/shared';
import {
  HOME_FEED,
  albumFeedKey,
  commentViewKey,
  emptyFeedList,
  isLocalPostKey,
  localPostKey,
  momentViewKey,
  postFeedKey,
  type CommentView,
  type FeedKey,
  type FeedList,
  type FeedState,
  type LikeIntent,
  type LoadState,
  type LocalComment,
  type LocalMedia,
  type LocalPost,
  type LocalPostState,
  type MomentView,
  type PublishRequest,
  type UploadItem,
} from '../model';

/**
 * The pure half of the feed store: every optimistic change of 5.11 as a function from one FeedState to the next,
 * and the views the cards render. Nothing here sends a request, reads the clock or touches the browser, so the
 * whole of it is tested in Node; state/feedStore.ts decides when each one runs.
 * 动态 store 的纯函数部分：5.11 中每一种乐观更新都写成从一个 FeedState 到下一个的函数，另外是卡片渲染用的视图。这里不发请求、
 * 不读时钟、不访问浏览器，因此可以全部在 Node 中测试；何时调用由 state/feedStore.ts 决定。
 */

/** Retries of a like after the first failed attempt; after these it goes back to what the server said. */
/** 一次赞第一次失败后的重试次数；用完后恢复为服务器的状态。 */
export const LIKE_RETRIES = 2;

/* Ordering and equality */
/* 排序与比较 */

type Ordered = Pick<MomentPost, 'createdAt' | 'id'>;

/** Newest first by (createdAt, id), the keyset order of every list. */
/** 按 (createdAt, id) 从新到旧，所有列表的键集顺序。 */
export function compareNewestFirst(a: Ordered, b: Ordered): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

/** Oldest first by (createdAt, id), the order of comments. */
/** 按 (createdAt, id) 从旧到新，评论的顺序。 */
export function compareOldestFirst(a: Ordered, b: Ordered): number {
  return -compareNewestFirst(a, b);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Deep equality for JSON data from the server. A post that comes back unchanged keeps its old object, so cards
 * that select it do not render again.
 * 针对服务器 JSON 数据的深比较。没有变化的动态保留原来的对象，选择它的卡片不会重新渲染。
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !sameData(a[key], b[key])) return false;
  }
  return true;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

/** Ids of posts in the record, newest first, each once. */
/** 记录中存在的动态 id，从新到旧，每个只出现一次。 */
function sortIds(posts: Record<string, MomentPost>, ids: readonly string[]): string[] {
  const known = unique(ids).filter((id) => posts[id] !== undefined);
  return known.sort((a, b) => compareNewestFirst(posts[a] as MomentPost, posts[b] as MomentPost));
}

/* Server posts */
/* 服务器的动态 */

function isPrefixById(prefix: readonly MomentComment[], of: readonly MomentComment[]): boolean {
  if (prefix.length > of.length) return false;
  return prefix.every((comment, index) => of[index]?.id === comment.id);
}

/**
 * The stored copy after a fetch brought `incoming`. Comments loaded in place (展开其余 N 条评论) stay when the server
 * sent the start of the same list and the count did not change, so a quiet reload does not fold them away again.
 * An unchanged post keeps its old object.
 * 一次请求带回 `incoming` 之后保存的副本。若服务器发来的是同一列表的开头且总数没有变化，就地展开的评论（展开其余 N 条评论）会保留，
 * 安静的重新加载不会把它们再次收起。没有变化的动态保留原来的对象。
 */
export function mergeServerPost(existing: MomentPost | undefined, incoming: MomentPost): MomentPost {
  if (!existing) return incoming;
  let next = incoming;
  if (
    existing.comments.length > incoming.comments.length &&
    existing.commentCount === incoming.commentCount &&
    isPrefixById(incoming.comments, existing.comments)
  ) {
    next = {
      ...incoming,
      comments: [...incoming.comments, ...existing.comments.slice(incoming.comments.length)],
      commentsCursor: existing.commentsCursor,
    };
  }
  return sameData(existing, next) ? existing : next;
}

/** The record with `incoming` merged in; the same object when nothing changed. */
/** 合并 `incoming` 之后的记录；没有变化时返回同一个对象。 */
export function upsertPosts(posts: Record<string, MomentPost>, incoming: readonly MomentPost[]): Record<string, MomentPost> {
  let next = posts;
  for (const post of incoming) {
    const merged = mergeServerPost(next[post.id], post);
    if (merged === next[post.id]) continue;
    if (next === posts) next = { ...posts };
    next[post.id] = merged;
  }
  return next;
}

function withPost<S extends FeedState>(state: S, postId: string, update: (post: MomentPost) => MomentPost): S {
  const post = state.posts[postId];
  if (!post) return state;
  const next = update(post);
  if (next === post) return state;
  return { ...state, posts: { ...state.posts, [postId]: next } };
}

/* Lists */
/* 列表 */

/** The state with `key`'s list replaced by `update` of it (an empty list when it did not exist). */
/** 用 `update` 替换 `key` 列表之后的状态（列表不存在时从空列表开始）。 */
export function withList<S extends FeedState>(state: S, key: FeedKey, update: (list: FeedList) => FeedList): S {
  const current = state.lists[key];
  const next = update(current ?? emptyFeedList(key));
  if (current && next === current) return state;
  return { ...state, lists: { ...state.lists, [key]: next } };
}

function eachList<S extends FeedState>(state: S, update: (list: FeedList) => FeedList): S {
  let lists = state.lists;
  for (const [key, list] of Object.entries(state.lists) as [FeedKey, FeedList | undefined][]) {
    if (!list) continue;
    const next = update(list);
    if (next === list) continue;
    if (lists === state.lists) lists = { ...state.lists };
    lists[key] = next;
  }
  return lists === state.lists ? state : { ...state, lists };
}

export interface FirstPage {
  posts: readonly MomentPost[];
  nextCursor: string | null;
}

export interface FirstPageOptions {
  /**
   * replace: the list becomes page 1 (pull to refresh, retry, the first answer over cached content).
   * reconcile: a quiet reload of a list already on screen; posts further down stay, posts gone from page 1's range
   * leave, changed posts update in place.
   * replace：列表变为第一页（下拉刷新、重试、缓存内容之后的第一次返回）。reconcile：安静地重新加载已在屏幕上的列表；
   * 更靠下的动态保留，从第一页范围内消失的动态移除，有变化的动态就地更新。
   */
  mode: 'replace' | 'reconcile';
  /** Reconcile on home while the reader is past the cover: posts newer than the top wait in incoming. */
  /** 读者已滚过封面时在动态首页做 reconcile：比顶部更新的动态等在 incoming 中。 */
  holdNew?: boolean;
  now: number;
}

/** Page 1 of a list arrived. See FirstPageOptions for the two modes. */
/** 列表的第一页返回了。两种方式见 FirstPageOptions。 */
export function applyFirstPage<S extends FeedState>(state: S, key: FeedKey, page: FirstPage, options: FirstPageOptions): S {
  const posts = upsertPosts(state.posts, page.posts);
  const pageIds = unique(page.posts.map((post) => post.id));
  const list = state.lists[key] ?? emptyFeedList(key);
  const base: Omit<FeedList, 'ids' | 'nextCursor' | 'incoming'> = {
    ...list,
    status: 'ready',
    refreshing: false,
    fromCache: false,
    error: null,
    more: list.fromCache || options.mode === 'replace' ? 'idle' : list.more,
    loadedAt: options.now,
  };

  if (options.mode === 'replace' || list.fromCache || list.ids.length === 0) {
    const ids = sortIds(posts, pageIds);
    return { ...state, posts, lists: { ...state.lists, [key]: { ...base, ids, nextCursor: page.nextCursor, incoming: [] } } };
  }

  const inPage = new Set(pageIds);
  const oldest = page.posts.length ? page.posts.reduce((a, b) => (compareNewestFirst(a, b) > 0 ? a : b)) : null;
  // Page 1 is the whole list when it has no cursor; otherwise it covers everything down to its oldest post.
  // 第一页没有 cursor 时就是整个列表；否则它覆盖从最新到其中最旧那条之间的全部动态。
  const covered = (id: string) => {
    if (page.nextCursor === null) return true;
    const post = posts[id];
    return !!post && !!oldest && compareNewestFirst(post, oldest) <= 0;
  };
  const kept = list.ids.filter((id) => posts[id] && (inPage.has(id) || !covered(id)));
  const listed = new Set(list.ids);
  const newcomers = pageIds.filter((id) => !listed.has(id));
  const top = kept[0] ? posts[kept[0]] : undefined;
  const held = options.holdNew ? newcomers.filter((id) => !top || compareNewestFirst(posts[id] as MomentPost, top) < 0) : [];
  const ids = sortIds(posts, [...kept, ...newcomers.filter((id) => !held.includes(id))]);
  const shown = new Set(ids);
  const incoming = sortIds(posts, [...held, ...list.incoming]).filter((id) => !shown.has(id));
  const deeper = kept.some((id) => !covered(id));
  return {
    ...state,
    posts,
    lists: { ...state.lists, [key]: { ...base, ids, incoming, nextCursor: deeper ? list.nextCursor : page.nextCursor } },
  };
}

/** The next page arrived: new ids go at the end, ids already shown or waiting are skipped. */
/** 下一页返回了：新的 id 放在末尾，已显示或正在等待的 id 跳过。 */
export function appendPage<S extends FeedState>(state: S, key: FeedKey, page: FirstPage): S {
  const posts = upsertPosts(state.posts, page.posts);
  const list = state.lists[key] ?? emptyFeedList(key);
  const seen = new Set([...list.ids, ...list.incoming]);
  const added = unique(page.posts.map((post) => post.id)).filter((id) => !seen.has(id));
  const next: FeedList = { ...list, ids: [...list.ids, ...added], nextCursor: page.nextCursor, more: 'idle' };
  return { ...state, posts, lists: { ...state.lists, [key]: next } };
}

/**
 * A background check found page 1 on home: posts newer than the top wait in incoming behind 有 N 条新动态. Posts
 * already on screen are not touched, so nothing moves under the reader.
 * 后台检查取到了首页第一页：比顶部更新的动态等在 incoming 中，排在「有 N 条新动态」后面。已在屏幕上的动态不做改动，读者眼前的内容不会移动。
 */
export function holdIncoming<S extends FeedState>(state: S, page: FirstPage): S {
  const list = state.lists[HOME_FEED];
  if (!list || list.status !== 'ready') return state;
  const shown = new Set(list.ids);
  const top = list.ids[0] ? state.posts[list.ids[0]] : undefined;
  const fresh = page.posts.filter((post) => !shown.has(post.id) && (!top || compareNewestFirst(post, top) < 0));
  if (!fresh.length) return state;
  const posts = upsertPosts(state.posts, fresh);
  const incoming = sortIds(posts, [...fresh.map((post) => post.id), ...list.incoming]);
  if (sameData(incoming, list.incoming) && posts === state.posts) return state;
  return { ...state, posts, lists: { ...state.lists, [HOME_FEED]: { ...list, incoming } } };
}

/** The pill was tapped, the member pulled, or the feed opened again: incoming joins the list in order. */
/** 点击了提示条、下拉刷新或再次打开首页：incoming 按顺序并入列表。 */
export function mergeIncomingPosts<S extends FeedState>(state: S): S {
  const list = state.lists[HOME_FEED];
  if (!list || !list.incoming.length) return state;
  const ids = sortIds(state.posts, [...list.incoming, ...list.ids]);
  return { ...state, lists: { ...state.lists, [HOME_FEED]: { ...list, ids, incoming: [] } } };
}

/** The newest createdAt shown in a list, for POST /moments/seen; null when it shows nothing. */
/** 列表中显示的最新 createdAt，用于 POST /moments/seen；没有内容时为 null。 */
export function newestShown(state: FeedState, key: FeedKey): string | null {
  const list = state.lists[key];
  if (!list) return null;
  let newest: string | null = null;
  for (const id of list.ids) {
    const at = state.posts[id]?.createdAt;
    if (at && (newest === null || at > newest)) newest = at;
  }
  return newest;
}

export function setExpandedIn<S extends FeedState>(state: S, key: FeedKey, postId: string, expanded: boolean): S {
  return withList(state, key, (list) => {
    if ((list.expanded[postId] === true) === expanded) return list;
    const next = { ...list.expanded };
    if (expanded) next[postId] = true;
    else delete next[postId];
    return { ...list, expanded: next };
  });
}

/* Likes */
/* 赞 */

/** What a card shows for the like: the server's list with this device's last tap laid over it. */
/** 卡片显示的赞：服务器的列表，叠加本设备最后一次点击。 */
export function effectiveLike(
  post: Pick<MomentPost, 'likedByMe' | 'likes' | 'likeCount'>,
  intent: LikeIntent | undefined,
  me: MomentPerson | null,
): { liked: boolean; likes: readonly MomentPerson[]; likeCount: number } {
  if (!intent || intent.desired === post.likedByMe) return { liked: post.likedByMe, likes: post.likes, likeCount: post.likeCount };
  if (intent.desired) {
    const likes = me ? [...post.likes.filter((person) => person.id !== me.id), me] : post.likes;
    return { liked: true, likes, likeCount: post.likeCount + 1 };
  }
  const likes = me ? post.likes.filter((person) => person.id !== me.id) : post.likes;
  return { liked: false, likes, likeCount: Math.max(0, post.likeCount - 1) };
}

function withIntent<S extends FeedState>(state: S, postId: string, intent: LikeIntent | null): S {
  const likes = { ...state.likes };
  if (intent) likes[postId] = intent;
  else delete likes[postId];
  return { ...state, likes };
}

/**
 * One tap on 赞 / 取消: flips the desired state. `send` is true when a request should go out now: none is in flight,
 * the wish differs from what the server said, and the device is online. Offline, the intent waits for online.
 * 点击一次「赞」/「取消」：翻转想要的状态。`send` 为 true 表示现在应发出请求：没有进行中的请求、想要的状态与服务器不同，且设备在线。
 * 离线时这个意图等待联网。
 */
export function tapLike<S extends FeedState>(state: S, postId: string): { state: S; send: boolean } {
  const post = state.posts[postId];
  if (!post) return { state, send: false };
  const current: LikeIntent = state.likes[postId] ?? { desired: post.likedByMe, confirmed: post.likedByMe, inFlight: false, failures: 0, waiting: false };
  const desired = !current.desired;
  if (!current.inFlight && desired === current.confirmed) return { state: withIntent(state, postId, null), send: false };
  const intent: LikeIntent = { ...current, desired, failures: 0, waiting: !current.inFlight && !state.online };
  return { state: withIntent(state, postId, intent), send: !current.inFlight && state.online };
}

/** The like request for the current desired state went out. */
/** 针对当前想要状态的请求已发出。 */
export function likeStarted<S extends FeedState>(state: S, postId: string): S {
  const intent = state.likes[postId];
  if (!intent) return state;
  return withIntent(state, postId, { ...intent, inFlight: true, waiting: false });
}

/**
 * The server answered: its list goes into the post and becomes confirmed. When the last tap still differs,
 * `resend` asks for one more request; otherwise the intent is done and the card shows the server's list.
 * 服务器已回复：它的列表写入动态并成为 confirmed。如果最后一次点击仍与之不同，`resend` 要求再发一次；否则意图完成，卡片显示服务器的列表。
 */
export function likeSettled<S extends FeedState>(state: S, postId: string, res: MomentLikeResponse): { state: S; resend: boolean } {
  let next = withPost(state, postId, (post) => {
    const updated = { ...post, likedByMe: res.likedByMe, likes: res.likes, likeCount: res.likeCount };
    return sameData(post, updated) ? post : updated;
  });
  const intent = next.likes[postId];
  if (!intent) return { state: next, resend: false };
  if (intent.desired === res.likedByMe) return { state: withIntent(next, postId, null), resend: false };
  next = withIntent(next, postId, { ...intent, confirmed: res.likedByMe, inFlight: false, failures: 0, waiting: !next.online });
  return { state: next, resend: next.online };
}

/**
 * The like request failed. Offline it waits for online. Otherwise it is retried LIKE_RETRIES times (`retry`),
 * then goes back to what the server said (`reverted`, with a toast from the caller).
 * 赞的请求失败了。离线时等待联网。否则重试 LIKE_RETRIES 次（`retry`），之后恢复为服务器的状态（`reverted`，由调用方提示）。
 */
export function likeFailed<S extends FeedState>(state: S, postId: string, offline: boolean): { state: S; retry: boolean; reverted: boolean } {
  const intent = state.likes[postId];
  if (!intent) return { state, retry: false, reverted: false };
  if (offline) return { state: withIntent(state, postId, { ...intent, inFlight: false, waiting: true }), retry: false, reverted: false };
  const failures = intent.failures + 1;
  if (failures <= LIKE_RETRIES) return { state: withIntent(state, postId, { ...intent, inFlight: false, failures }), retry: true, reverted: false };
  return { state: withIntent(state, postId, null), retry: false, reverted: true };
}

/** Back online: the waiting likes that should go out now, each marked as no longer waiting. */
/** 恢复联网：现在应发出的等待中的赞，每个都标为不再等待。 */
export function wakeLikes<S extends FeedState>(state: S): { state: S; send: string[] } {
  const send: string[] = [];
  let likes = state.likes;
  for (const [postId, intent] of Object.entries(state.likes)) {
    if (!intent.waiting) continue;
    if (likes === state.likes) likes = { ...state.likes };
    if (intent.desired === intent.confirmed) {
      delete likes[postId];
      continue;
    }
    likes[postId] = { ...intent, waiting: false };
    if (!intent.inFlight) send.push(postId);
  }
  return { state: likes === state.likes ? state : { ...state, likes }, send };
}

/* Comments */
/* 评论 */

/** Comments merged in time order, each id once; an id already present keeps its object. */
/** 按时间顺序合并评论，每个 id 只出现一次；已有的 id 保留原来的对象。 */
export function mergeComments(existing: readonly MomentComment[], added: readonly MomentComment[]): MomentComment[] {
  const ids = new Set(existing.map((comment) => comment.id));
  const fresh = added.filter((comment) => {
    if (ids.has(comment.id)) return false;
    ids.add(comment.id);
    return true;
  });
  if (!fresh.length) return existing as MomentComment[];
  return [...existing, ...fresh].sort(compareOldestFirst);
}

function pendingOf(state: FeedState, postId: string): LocalComment[] {
  return state.pendingComments[postId] ?? [];
}

function withPending<S extends FeedState>(state: S, postId: string, pending: LocalComment[]): S {
  const pendingComments = { ...state.pendingComments };
  if (pending.length) pendingComments[postId] = pending;
  else delete pendingComments[postId];
  return { ...state, pendingComments };
}

export function addPendingComment<S extends FeedState>(state: S, comment: LocalComment): S {
  return withPending(state, comment.postId, [...pendingOf(state, comment.postId), comment]);
}

export function updatePendingComment<S extends FeedState>(state: S, postId: string, clientId: string, patch: Partial<LocalComment>): S {
  const pending = pendingOf(state, postId);
  const index = pending.findIndex((comment) => comment.clientId === clientId);
  if (index < 0) return state;
  const current = pending[index] as LocalComment;
  const next = { ...current, ...patch };
  if (sameData(current, next)) return state;
  return withPending(state, postId, pending.map((comment, i) => (i === index ? next : comment)));
}

export function removePendingComment<S extends FeedState>(state: S, postId: string, clientId: string): S {
  const pending = pendingOf(state, postId);
  if (!pending.some((comment) => comment.clientId === clientId)) return state;
  return withPending(state, postId, pending.filter((comment) => comment.clientId !== clientId));
}

export function findPendingComment(state: FeedState, postId: string, clientId: string): LocalComment | null {
  return pendingOf(state, postId).find((comment) => comment.clientId === clientId) ?? null;
}

/**
 * A fetched copy that left before the server confirmed this device's like or comment on the post: the stored likes
 * stay, and the stored comments join the fetched ones, so the confirmed tap or comment does not go back. Everything
 * else, the comment cursor among it, is the fetched copy's.
 * 在服务器确认本设备对这条动态的赞或评论之前就已发出的请求所取回的副本：保留已保存的赞，已保存的评论并入取回的评论，
 * 已确认的点赞或评论因此不会被撤回。其余内容（包括评论的 cursor）都以取回的副本为准。
 */
export function keepConfirmedActivity(fetched: MomentPost, stored: MomentPost): MomentPost {
  const next: MomentPost = {
    ...fetched,
    likes: stored.likes,
    likedByMe: stored.likedByMe,
    likeCount: stored.likeCount,
    comments: mergeComments(fetched.comments, stored.comments),
    commentCount: Math.max(fetched.commentCount, stored.commentCount),
  };
  return sameData(fetched, next) ? fetched : next;
}

/** The server stored a pending comment: its row takes the pending one's place, and the count is the server's. */
/** 服务器已保存一条待发送的评论：服务器的这一行替换待发送的那一行，评论数以服务器为准。 */
export function confirmComment<S extends FeedState>(state: S, postId: string, clientId: string, res: CreateMomentCommentResponse): S {
  const next = removePendingComment(state, postId, clientId);
  return withPost(next, postId, (post) => ({ ...post, comments: mergeComments(post.comments, [res.comment]), commentCount: res.commentCount }));
}

/** 展开其余 N 条评论 brought a page: it joins in time order, and the cursor moves on. */
/** 「展开其余 N 条评论」带回一页：按时间顺序并入，cursor 向后移动。 */
export function appendCommentPage<S extends FeedState>(state: S, postId: string, comments: readonly MomentComment[], nextCursor: string | null): S {
  return withPost(state, postId, (post) => ({ ...post, comments: mergeComments(post.comments, comments), commentsCursor: nextCursor }));
}

export function setCommentPaging<S extends FeedState>(state: S, postId: string, paging: LoadState): S {
  if ((state.commentPaging[postId] ?? 'idle') === paging) return state;
  const commentPaging = { ...state.commentPaging };
  if (paging === 'idle') delete commentPaging[postId];
  else commentPaging[postId] = paging;
  return { ...state, commentPaging };
}

/** 删除 on a comment: it leaves at once and the count drops; the snapshot and its index are kept to put it back. */
/** 删除一条评论：立即移除并减少评论数；保留快照和位置以便放回。 */
export function hideComment<S extends FeedState>(state: S, postId: string, commentId: string): S {
  const post = state.posts[postId];
  const index = post ? post.comments.findIndex((comment) => comment.id === commentId) : -1;
  if (!post || index < 0) return state;
  const comment = post.comments[index] as MomentComment;
  const next = withPost(state, postId, (current) => ({
    ...current,
    comments: current.comments.filter((item) => item.id !== commentId),
    commentCount: Math.max(0, current.commentCount - 1),
  }));
  return { ...next, deletedComments: { ...next.deletedComments, [commentId]: { postId, comment, index } } };
}

/** The server refused the delete: the comment goes back at its old index. */
/** 服务器拒绝了删除：评论放回原来的位置。 */
export function restoreHiddenComment<S extends FeedState>(state: S, commentId: string): S {
  const deleted = state.deletedComments[commentId];
  if (!deleted) return state;
  const next = forgetHiddenComment(state, commentId);
  return withPost(next, deleted.postId, (post) => {
    if (post.comments.some((comment) => comment.id === commentId)) return post;
    const comments = [...post.comments];
    comments.splice(Math.min(deleted.index, comments.length), 0, deleted.comment);
    return { ...post, comments, commentCount: post.commentCount + 1 };
  });
}

export function forgetHiddenComment<S extends FeedState>(state: S, commentId: string): S {
  if (!state.deletedComments[commentId]) return state;
  const deletedComments = { ...state.deletedComments };
  delete deletedComments[commentId];
  return { ...state, deletedComments };
}

/* Deleting posts */
/* 删除动态 */

export function setDeleting<S extends FeedState>(state: S, postId: string, deleting: boolean): S {
  if ((state.deleting[postId] === true) === deleting) return state;
  const next = { ...state.deleting };
  if (deleting) next[postId] = true;
  else delete next[postId];
  return { ...state, deleting: next };
}

/** The fade after 删除 ended: the post leaves every list, and its index in each is kept to put it back. */
/** 删除后的淡出结束：动态从所有列表中移除，并记下它在每个列表中的位置以便放回。 */
export function hidePost<S extends FeedState>(state: S, postId: string): S {
  const post = state.posts[postId];
  if (!post) return state;
  const positions: Partial<Record<FeedKey, number>> = {};
  const next = eachList(state, (list) => {
    const index = list.ids.indexOf(postId);
    const waiting = list.incoming.includes(postId);
    if (index < 0 && !waiting) return list;
    if (index >= 0) positions[list.key] = index;
    return { ...list, ids: list.ids.filter((id) => id !== postId), incoming: list.incoming.filter((id) => id !== postId) };
  });
  return { ...setDeleting(next, postId, false), deletedPosts: { ...next.deletedPosts, [postId]: { post, positions } } };
}

/** The server refused the delete: the post goes back where it was in each list. */
/** 服务器拒绝了删除：动态放回每个列表中原来的位置。 */
export function restoreHiddenPost<S extends FeedState>(state: S, postId: string): S {
  const deleted = state.deletedPosts[postId];
  let next = setDeleting(state, postId, false);
  if (!deleted) return next;
  const deletedPosts = { ...next.deletedPosts };
  delete deletedPosts[postId];
  next = { ...next, deletedPosts, posts: state.posts[postId] ? next.posts : { ...next.posts, [postId]: deleted.post } };
  return eachList(next, (list) => {
    const index = deleted.positions[list.key];
    if (index === undefined || list.ids.includes(postId)) return list;
    const ids = [...list.ids];
    ids.splice(Math.min(index, ids.length), 0, postId);
    return { ...list, ids };
  });
}

/**
 * The post is gone for good (deleted, removed by a moderator, or a 404): it leaves every list and everything this
 * device kept about it. A detail page showing it becomes unavailable.
 * 动态已彻底不在（被删除、被管理员移除或返回 404）：它从所有列表中移除，本设备关于它的记录也全部清除。显示它的详情页变为不可查看。
 */
export function removePost<S extends FeedState>(state: S, postId: string): S {
  let next = eachList(state, (list) => {
    const detail = list.key === postFeedKey(postId);
    if (!detail && !list.ids.includes(postId) && !list.incoming.includes(postId)) return list;
    return {
      ...list,
      ids: list.ids.filter((id) => id !== postId),
      incoming: list.incoming.filter((id) => id !== postId),
      status: detail ? 'unavailable' : list.status,
      refreshing: detail ? false : list.refreshing,
    };
  });
  const drop = <T>(record: Record<string, T>): Record<string, T> => {
    if (!(postId in record)) return record;
    const copy = { ...record };
    delete copy[postId];
    return copy;
  };
  const deletedComments = Object.fromEntries(Object.entries(next.deletedComments).filter(([, entry]) => entry.postId !== postId));
  next = {
    ...next,
    posts: drop(next.posts),
    likes: drop(next.likes),
    pendingComments: drop(next.pendingComments),
    commentPaging: drop(next.commentPaging),
    localMedia: drop(next.localMedia),
    deleting: drop(next.deleting),
    deletedPosts: drop(next.deletedPosts),
    deletedComments: Object.keys(deletedComments).length === Object.keys(next.deletedComments).length ? next.deletedComments : deletedComments,
  };
  return next;
}

/* Local posts */
/* 本地动态 */

/** This device's copies of the media, in post order. */
/** 本设备上的媒体副本，按发表顺序排列。 */
export function localMediaOf(items: readonly UploadItem[]): LocalMedia[] {
  return items.map((item) => item.local);
}

/** Progress over every file and its preview, 0 to 1; 1 for a text-only post. */
/** 全部文件及其预览图的进度，0 到 1；纯文字动态为 1。 */
export function uploadProgress(items: readonly UploadItem[]): number {
  if (!items.length) return 1;
  let total = 0;
  for (const item of items) total += item.status === 'done' ? 1 : Math.min(1, Math.max(0, item.progress));
  return total / items.length;
}

function placeholderMedia(items: readonly UploadItem[]): MomentMedia[] {
  return items.map((item) => ({
    key: localPostKey(item.id),
    contentType: item.local.contentType,
    kind: item.local.kind,
    width: item.local.width,
    height: item.local.height,
    previewKey: null,
    durationMs: item.local.durationMs,
  }));
}

/**
 * The card for a post this device is publishing, built from the request and the signed-in member. Its media keys
 * are placeholders (local:<item id>); the cards draw view.localMedia instead.
 * 本设备正在发表的动态的卡片，由请求和当前成员组装。媒体键只是占位（local:<项目 id>），卡片改为显示 view.localMedia。
 */
export function buildLocalPost(request: PublishRequest, me: MomentPerson, items: readonly UploadItem[], createdAt: string): LocalPost {
  const uploading = items.some((item) => item.status !== 'done');
  const post: MomentPost = {
    id: localPostKey(request.clientId),
    author: me,
    // The text the server will store, so the card does not change when the server's post replaces it.
    // 服务器将保存的正文，服务器的动态替换它时卡片不会变化。
    body: normalizeMomentText(request.text),
    media: placeholderMedia(items),
    location: request.location,
    createdAt,
    clubWide: request.audience === 'club',
    audience: request.audience,
    likes: [],
    likeCount: 0,
    likedByMe: false,
    comments: [],
    commentCount: 0,
    commentsCursor: null,
    canDelete: true,
    canModerate: false,
    canReport: false,
    canInteract: false,
    clientId: request.clientId,
  };
  const state: LocalPostState = { clientId: request.clientId, status: uploading ? 'uploading' : 'sending', progress: uploadProgress(items), failure: null };
  return { post, request, state, media: localMediaOf(items) };
}

export function findLocalPost(state: FeedState, clientId: string): LocalPost | null {
  return state.localPosts.find((local) => local.state.clientId === clientId) ?? null;
}

export function addLocalPost<S extends FeedState>(state: S, local: LocalPost): S {
  return { ...state, localPosts: [local, ...state.localPosts.filter((item) => item.state.clientId !== local.state.clientId)] };
}

/** The uploads changed: the card's media, sizes and progress follow them. */
/** 上传有了变化：卡片的媒体、尺寸和进度随之更新。 */
export function syncLocalUploads<S extends FeedState>(state: S, clientId: string, items: readonly UploadItem[]): S {
  return updateLocalPost(state, clientId, (local) => {
    const media = localMediaOf(items);
    const progress = uploadProgress(items);
    const placeholders = placeholderMedia(items);
    if (sameData(media, local.media) && progress === local.state.progress && sameData(placeholders, local.post.media)) return local;
    return { ...local, media, post: { ...local.post, media: placeholders }, state: { ...local.state, progress } };
  });
}

export function setLocalPostState<S extends FeedState>(state: S, clientId: string, patch: Partial<Omit<LocalPostState, 'clientId'>>): S {
  return updateLocalPost(state, clientId, (local) => {
    const next = { ...local.state, ...patch };
    return sameData(next, local.state) ? local : { ...local, state: next };
  });
}

export function updateLocalPost<S extends FeedState>(state: S, clientId: string, update: (local: LocalPost) => LocalPost): S {
  const index = state.localPosts.findIndex((local) => local.state.clientId === clientId);
  if (index < 0) return state;
  const current = state.localPosts[index] as LocalPost;
  const next = update(current);
  if (next === current) return state;
  return { ...state, localPosts: state.localPosts.map((local, i) => (i === index ? next : local)) };
}

export function removeLocalPost<S extends FeedState>(state: S, clientId: string): S {
  if (!state.localPosts.some((local) => local.state.clientId === clientId)) return state;
  return { ...state, localPosts: state.localPosts.filter((local) => local.state.clientId !== clientId) };
}

/**
 * The server stored a local post: the server's post takes its place at the top of `listKeys` (home and the own
 * album, where they are loaded), keeps its 全文 state, and keeps this device's media copies until the server
 * previews have loaded. The card's key does not change (momentViewKey), so nothing flickers.
 * 服务器已保存一条本地动态：服务器的动态替换它，出现在 `listKeys`（已加载的动态首页和自己的相册）顶部，保留其「全文」状态，
 * 并保留本设备的媒体副本，直到服务器的预览图加载完成。卡片的 key 不变（momentViewKey），因此不会闪烁。
 */
export function confirmLocalPost<S extends FeedState>(state: S, clientId: string, post: MomentPost, listKeys: readonly FeedKey[]): S {
  const local = findLocalPost(state, clientId);
  const localId = localPostKey(clientId);
  let next = removeLocalPost(state, clientId);
  next = { ...next, posts: upsertPosts(next.posts, [post]) };
  next = eachList(next, (list) => {
    const target = listKeys.includes(list.key);
    const expanded = list.expanded[localId] === true;
    if (!target && !expanded) return list;
    let updated = list;
    if (target && !list.ids.includes(post.id)) updated = { ...updated, ids: sortIds(next.posts, [post.id, ...updated.ids]) };
    if (expanded) {
      const flags = { ...updated.expanded, [post.id]: true as const };
      delete flags[localId];
      updated = { ...updated, expanded: flags };
    }
    return updated;
  });
  if (local && local.media.length && post.media.length) next = { ...next, localMedia: { ...next.localMedia, [post.id]: local.media } };
  return next;
}

/** Lists that show this device's local posts above the server's: home and the member's own album. */
/** 在服务器动态上方显示本设备本地动态的列表：动态首页和成员自己的相册。 */
export function showsLocalPosts(key: FeedKey, meId: string | null): boolean {
  return key === HOME_FEED || (meId !== null && key === albumFeedKey(meId));
}

/* Views */
/* 视图 */

const NO_COMMENTS: readonly CommentView[] = [];
const NO_PENDING: readonly LocalComment[] = [];

/** The card of a server post with this device's likes, pending comments and media copies laid over it. */
/** 服务器动态的卡片，叠加本设备的赞、待发送评论和媒体副本。 */
export function serverPostView(state: FeedState, post: MomentPost, list: FeedList | null): MomentView {
  const like = effectiveLike(post, state.likes[post.id], state.me);
  const pending = state.pendingComments[post.id] ?? NO_PENDING;
  const sentIds = new Set(post.comments.map((comment) => comment.clientId).filter((id): id is string => !!id));
  const comments: CommentView[] = post.comments.map((comment) => ({ type: 'server', key: commentViewKey(comment), comment }));
  for (const comment of pending) {
    if (!sentIds.has(comment.clientId)) comments.push({ type: 'local', key: commentViewKey(comment), comment });
  }
  return {
    key: momentViewKey(post),
    post,
    local: null,
    localMedia: state.localMedia[post.id] ?? null,
    liked: like.liked,
    likes: like.likes,
    likeCount: like.likeCount,
    comments: comments.length ? comments : NO_COMMENTS,
    moreComments: post.commentsCursor ? Math.max(0, post.commentCount - post.comments.length) : 0,
    commentPaging: state.commentPaging[post.id] ?? 'idle',
    expanded: list?.expanded[post.id] === true,
    deleting: state.deleting[post.id] === true,
  };
}

/** The card of a post this device is still publishing. */
/** 本设备仍在发表的动态的卡片。 */
export function localPostView(local: LocalPost, list: FeedList | null): MomentView {
  return {
    key: momentViewKey(local.post),
    post: local.post,
    local: local.state,
    localMedia: local.media,
    liked: false,
    likes: local.post.likes,
    likeCount: 0,
    comments: NO_COMMENTS,
    moreComments: 0,
    commentPaging: 'idle',
    expanded: list?.expanded[local.post.id] === true,
    deleting: false,
  };
}

interface ServerMemo {
  post: MomentPost;
  intent: LikeIntent | undefined;
  pending: readonly LocalComment[] | undefined;
  paging: LoadState | undefined;
  media: readonly LocalMedia[] | undefined;
  deleting: boolean;
  expanded: boolean;
  me: MomentPerson | null;
  view: MomentView;
}

interface LocalMemo {
  local: LocalPost;
  expanded: boolean;
  view: MomentView;
}

type Memo = ServerMemo | LocalMemo;

function sameServerInputs(memo: ServerMemo, state: FeedState, post: MomentPost, list: FeedList | null): boolean {
  return (
    memo.post === post &&
    memo.intent === state.likes[post.id] &&
    memo.pending === state.pendingComments[post.id] &&
    memo.paging === state.commentPaging[post.id] &&
    memo.media === state.localMedia[post.id] &&
    memo.deleting === (state.deleting[post.id] === true) &&
    memo.expanded === (list?.expanded[post.id] === true) &&
    (memo.intent === undefined || memo.me === state.me)
  );
}

function memoServer(cache: Map<string, Memo>, previous: Map<string, Memo> | null, state: FeedState, post: MomentPost, list: FeedList | null): MomentView {
  const found = previous?.get(post.id);
  if (found && 'post' in found && sameServerInputs(found, state, post, list)) {
    cache.set(post.id, found);
    return found.view;
  }
  const view = serverPostView(state, post, list);
  cache.set(post.id, {
    post,
    intent: state.likes[post.id],
    pending: state.pendingComments[post.id],
    paging: state.commentPaging[post.id],
    media: state.localMedia[post.id],
    deleting: state.deleting[post.id] === true,
    expanded: list?.expanded[post.id] === true,
    me: state.me,
    view,
  });
  return view;
}

function memoLocal(cache: Map<string, Memo>, previous: Map<string, Memo> | null, local: LocalPost, list: FeedList | null): MomentView {
  const id = local.post.id;
  const expanded = list?.expanded[id] === true;
  const found = previous?.get(id);
  if (found && 'local' in found && found.local === local && found.expanded === expanded) {
    cache.set(id, found);
    return found.view;
  }
  const view = localPostView(local, list);
  cache.set(id, { local, expanded, view });
  return view;
}

const NO_VIEWS: readonly MomentView[] = [];

function sameViews(a: readonly MomentView[], b: readonly MomentView[]): boolean {
  return a.length === b.length && a.every((view, index) => view === b[index]);
}

export interface ViewMemo {
  /**
   * The cards of a list in display order: local posts first on home and the own album, then the server posts.
   * Returns the previous array while nothing in it changed, so it is safe as a store selector.
   * 列表中按显示顺序排列的卡片：动态首页和自己的相册先显示本地动态，再显示服务器的动态。内容没有变化时返回上一次的数组，可以直接用作 store 选择器。
   */
  views(state: FeedState, key: FeedKey): readonly MomentView[];
  /** One card by post.id, local or server; null when unknown. Stable in the same way. */
  /** 按 post.id（本地或服务器的）取一张卡片；未知时为 null。同样保持稳定。 */
  view(state: FeedState, postId: string): MomentView | null;
}

/** Memoized view selectors; each store keeps one. */
/** 带缓存的视图选择器；每个 store 各有一个。 */
export function createViewMemo(): ViewMemo {
  const lists = new Map<FeedKey, { views: readonly MomentView[]; cache: Map<string, Memo> }>();
  const singles = new Map<string, Memo>();

  return {
    views(state, key) {
      const list = state.lists[key] ?? null;
      const previous = lists.get(key) ?? null;
      if (!list) {
        if (previous) lists.delete(key);
        return NO_VIEWS;
      }
      const cache = new Map<string, Memo>();
      const views: MomentView[] = [];
      const listed = new Set<string>();
      for (const id of list.ids) {
        const post = state.posts[id];
        if (!post) continue;
        if (post.clientId) listed.add(post.clientId);
        views.push(memoServer(cache, previous?.cache ?? null, state, post, list));
      }
      if (showsLocalPosts(key, state.me?.id ?? null)) {
        const locals = state.localPosts
          .filter((local) => !listed.has(local.state.clientId))
          .map((local) => memoLocal(cache, previous?.cache ?? null, local, list));
        views.unshift(...locals);
      }
      const result = previous && sameViews(previous.views, views) ? previous.views : views.length ? views : NO_VIEWS;
      lists.set(key, { views: result, cache });
      return result;
    },
    view(state, postId) {
      const previous = singles.get(postId);
      const before = previous ? new Map<string, Memo>([[postId, previous]]) : null;
      const cache = new Map<string, Memo>();
      let view: MomentView | null = null;
      let memoKey = postId;
      const local = state.localPosts.find((item) => item.post.id === postId);
      if (local) {
        view = memoLocal(cache, before, local, null);
      } else {
        const post = state.posts[postId] ?? confirmedPostOf(state, postId);
        if (post) {
          view = memoServer(cache, before && post.id !== postId ? new Map([[post.id, previous as Memo]]) : before, state, post, state.lists[postFeedKey(post.id)] ?? null);
          memoKey = post.id;
        }
      }
      const memo = cache.get(memoKey);
      if (memo) singles.set(postId, memo);
      else singles.delete(postId);
      return view;
    },
  };
}

/**
 * The server's copy of a post that was local when a viewer opened it: an open viewer keeps its post across the
 * swap instead of losing it.
 * 查看器打开时还是本地动态、之后换成的服务器副本：已打开的查看器在替换前后都能找到这条动态，不会丢失。
 */
function confirmedPostOf(state: FeedState, postId: string): MomentPost | undefined {
  if (!isLocalPostKey(postId)) return undefined;
  const clientId = postId.slice(localPostKey('').length);
  return Object.values(state.posts).find((post) => post.clientId === clientId);
}
