import type { MomentAlbumOwner, MomentAudience, MomentComment, MomentMediaInput, MomentPerson, MomentPost } from '@utmmsc/shared';

/**
 * The web state of 好友动态 and the contract between its parts: the feed store keeps FeedState, the cards render
 * MomentView, the composer hands the store a PublishRequest with its UploadBatch. Plain data and pure helpers
 * only; nothing here touches window or document at import time, so state/feedModel.ts can be tested in Node.
 * 好友动态网页端的状态，以及各部分之间的约定：动态 store 保存 FeedState，卡片渲染 MomentView，编辑器把带有 UploadBatch 的
 * PublishRequest 交给 store。这里只有普通数据和纯函数；导入时不访问 window 或 document，因此 state/feedModel.ts 可以在 Node 中测试。
 */

/** Message type the service worker posts to open windows after any moments push. */
/** 任何好友动态推送之后，Service Worker 发给已打开窗口的消息类型。 */
export const MOMENTS_PUSH_MESSAGE = 'utmmsc:moments';

/* Lists */
/* 列表 */

/** Which list: the home feed, one member's album, or the detail page of one post. */
/** 哪个列表：动态首页、某位成员的相册，或某条动态的详情页。 */
export type FeedKey = 'home' | `album:${string}` | `post:${string}`;

export const HOME_FEED: FeedKey = 'home';

export function albumFeedKey(memberId: string): FeedKey {
  return `album:${memberId}`;
}

export function postFeedKey(postId: string): FeedKey {
  return `post:${postId}`;
}

export type FeedKeyParts = { kind: 'home' } | { kind: 'album'; memberId: string } | { kind: 'post'; postId: string };

export function parseFeedKey(key: FeedKey): FeedKeyParts {
  if (key.startsWith('album:')) return { kind: 'album', memberId: key.slice('album:'.length) };
  if (key.startsWith('post:')) return { kind: 'post', postId: key.slice('post:'.length) };
  return { kind: 'home' };
}

/** A request that runs in place, such as 展开其余 N 条评论 or the next page. */
/** 就地运行的请求，例如「展开其余 N 条评论」或下一页。 */
export type LoadState = 'idle' | 'loading' | 'failed';

/**
 * idle: never loaded. loading: page 1 is loading and nothing is on screen yet. ready: shown. error: page 1
 * failed with nothing to show. unavailable: the detail post or the album is gone or not visible (404).
 * idle：从未加载。loading：正在加载第一页，屏幕上还没有内容。ready：已显示。error：第一页加载失败且没有可显示的内容。
 * unavailable：详情页的动态或相册已不存在或无法查看（404）。
 */
export type FeedListStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

export interface FeedList {
  key: FeedKey;
  /** Server post ids in display order, newest first; the detail list holds its one post. */
  /** 按显示顺序排列的服务器动态 id，最新的在前；详情页列表只有那一条动态。 */
  ids: string[];
  /** Continues after the last id; null once the end is reached. */
  /** 从最后一个 id 之后继续；到达末尾后为 null。 */
  nextCursor: string | null;
  status: FeedListStatus;
  /** A pull or a retry is loading page 1 again while the list stays on screen. */
  /** 下拉刷新或重试正在重新加载第一页，列表仍保留在屏幕上。 */
  refreshing: boolean;
  /** The ids came from the device cache and page 1 has not answered yet. */
  /** 这些 id 来自设备缓存，第一页尚未返回。 */
  fromCache: boolean;
  more: LoadState;
  /** Already localized; set with status error, or when a refresh failed over cached content. */
  /** 已按当前语言翻译；status 为 error，或在缓存内容之上刷新失败时设置。 */
  error: string | null;
  /** Newer posts fetched in the background, newest first, waiting behind 有 N 条新动态. Home only. */
  /** 后台取到的更新动态，最新的在前，等在「有 N 条新动态」后面。仅用于动态首页。 */
  incoming: string[];
  /** Posts whose text is open (全文). */
  /** 正文已展开（全文）的动态。 */
  expanded: Record<string, true>;
  /** window.scrollY to restore on return; null before the first save. */
  /** 返回时要恢复的 window.scrollY；首次保存之前为 null。 */
  scrollY: number | null;
  /** The album header; null for the home feed and the detail page. */
  /** 相册头部信息；动态首页和详情页为 null。 */
  owner: MomentAlbumOwner | null;
  /** Album only: the viewer sees club posts alone (只显示对全社团公开的动态). */
  /** 仅相册：查看者只能看到全社团可见的动态（只显示对全社团公开的动态）。 */
  clubOnly: boolean;
  /** Date.now() when page 1 last answered. */
  /** 第一页上次返回时的 Date.now()。 */
  loadedAt: number | null;
}

export function emptyFeedList(key: FeedKey): FeedList {
  return {
    key,
    ids: [],
    nextCursor: null,
    status: 'idle',
    refreshing: false,
    fromCache: false,
    more: 'idle',
    error: null,
    incoming: [],
    expanded: {},
    scrollY: null,
    owner: null,
    clubOnly: false,
    loadedAt: null,
  };
}

/* Media and uploads */
/* 媒体与上传 */

/** This device's copy of a picked photo or video, shown until the server's copy has loaded. */
/** 选中的照片或视频在本设备上的副本，在服务器的副本加载完成之前显示。 */
export interface LocalMedia {
  kind: 'image' | 'video';
  contentType: string;
  /** Object URL of the file to upload: the prepared photo, or the video itself. */
  /** 要上传的文件的对象地址：处理后的照片，或视频本身。 */
  fileUrl: string;
  /** Object URL of the 720px JPEG preview or the video's first frame; null when it could not be made. */
  /** 720px JPEG 预览图或视频首帧的对象地址；无法生成时为 null。 */
  previewUrl: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/**
 * preparing: being resized or measured. queued: waiting for a free upload slot (three run at once), or for the
 * network. uploading: sending. done: stored. failed: still failing after its retries; tap the tile to retry.
 * preparing：正在缩放或读取信息。queued：等待空闲的上传位置（同时最多三个）或等待网络。uploading：正在发送。done：已保存。
 * failed：重试后仍然失败；轻触图块重试。
 */
export type UploadStatus = 'preparing' | 'queued' | 'uploading' | 'done' | 'failed';

export interface UploadItem {
  /** Stable id for React keys and reordering. */
  /** 稳定的 id，用作 React key 和排序依据。 */
  id: string;
  local: LocalMedia;
  status: UploadStatus;
  /** 0 to 1 across the file and its preview. */
  /** 文件及其预览图合计的进度，0 到 1。 */
  progress: number;
  /** The stored media, ready for CreateMomentBody.media; set when done. */
  /** 已保存的媒体，可直接放进 CreateMomentBody.media；done 时设置。 */
  uploaded: MomentMediaInput | null;
  /** Already localized; set when failed. */
  /** 已按当前语言翻译；failed 时设置。 */
  failure: string | null;
}

/**
 * The uploads of one composer session, started the moment files are picked. The composer edits it while it is
 * open; on 发表 it hands it to the feed store, which waits on whenUploaded() and calls release() once the
 * server's copies are on screen or the post is discarded.
 * 一次编辑的全部上传，从选中文件的那一刻开始。编辑器打开期间由它修改；发表时交给动态 store，store 等待 whenUploaded()，
 * 在服务器的副本显示出来或动态被删除后调用 release()。
 */
export interface UploadBatch {
  readonly id: string;
  /** The items in post order; a new array whenever anything changes. */
  /** 按发表顺序排列的项目；任何变化都会返回新的数组。 */
  items(): readonly UploadItem[];
  /** Calls back after every change. Returns the unsubscribe function. */
  /** 每次变化后回调。返回取消订阅的函数。 */
  subscribe(listener: () => void): () => void;
  /**
   * A new promise for the current items: resolves with the media in post order once every item is done (at
   * once when they already are), stays pending while offline, and rejects when an item fails after its retries.
   * 针对当前项目的新 promise：所有项目完成后按发表顺序给出媒体（已全部完成时立即给出），离线期间保持等待，有项目重试后仍失败时拒绝。
   */
  whenUploaded(): Promise<MomentMediaInput[]>;
  /** Uploads the failed items again; the done ones keep their keys. */
  /** 重新上传失败的项目；已完成的保留它们的键。 */
  retry(): void;
  /** Aborts unfinished uploads. Object URLs stay until release(). */
  /** 中止未完成的上传。对象地址保留到 release() 为止。 */
  cancel(): void;
  /** Aborts anything unfinished and revokes every object URL; the batch must not be shown after this. */
  /** 中止所有未完成的上传并释放全部对象地址；此后不能再显示这个批次。 */
  release(): void;
}

/**
 * What 保留 keeps of an unfinished post. Text, audience and location go to localStorage; the media stay in memory
 * for the session, so after a reload mediaCount > 0 means 照片需要重新选择.
 * 「保留」为未完成的动态保存的内容。正文、可见范围和位置存入 localStorage；媒体只在本次会话的内存中，因此重新加载后 mediaCount > 0
 * 表示「照片需要重新选择」。
 */
export interface ComposeDraft {
  text: string;
  audience: MomentAudience;
  location: string | null;
  mediaCount: number;
  savedAt: string;
}

/** What 发表 hands the feed store. The composer has already closed. */
/** 「发表」交给动态 store 的内容。此时编辑器已经关闭。 */
export interface PublishRequest {
  clientId: string;
  text: string;
  audience: MomentAudience;
  location: string | null;
  /** Null for a text-only post. */
  /** 纯文字动态为 null。 */
  uploads: UploadBatch | null;
}

/* Pending work of this device */
/* 本设备尚未完成的操作 */

/**
 * uploading: media still uploading (rings). sending: POST /moments/posts is out (发送中…). waiting: offline
 * (等待网络). failed: 发送失败 [重试] [删除].
 * uploading：媒体仍在上传（显示进度环）。sending：已发出 POST /moments/posts（发送中…）。waiting：离线（等待网络）。
 * failed：发送失败 [重试] [删除]。
 */
export type LocalPostStatus = 'uploading' | 'sending' | 'waiting' | 'failed';

export interface LocalPostState {
  clientId: string;
  status: LocalPostStatus;
  /** Upload progress over all media, 0 to 1; 1 for a text-only post. */
  /** 全部媒体的上传进度，0 到 1；纯文字动态为 1。 */
  progress: number;
  /** Already localized; set when failed. */
  /** 已按当前语言翻译；failed 时设置。 */
  failure: string | null;
}

/** An own post this device is publishing, shown above the home feed and the own album. */
/** 本设备正在发表的自己的动态，显示在动态首页和自己的相册顶部。 */
export interface LocalPost {
  /** The post as it will look, built from the request and the signed-in member; its id is localPostKey(clientId). */
  /** 由请求和当前成员组装出的动态外观；其 id 为 localPostKey(clientId)。 */
  post: MomentPost;
  request: PublishRequest;
  state: LocalPostState;
  /** This device's copies of the media, in post order. */
  /** 本设备上的媒体副本，按发表顺序排列。 */
  media: LocalMedia[];
}

/** Ids of posts that exist only on this device so far. */
/** 目前只存在于本设备上的动态的 id。 */
export function localPostKey(clientId: string): string {
  return `local:${clientId}`;
}

export function isLocalPostKey(id: string): boolean {
  return id.startsWith('local:');
}

/** The member answered, and their comment. */
/** 被回复的成员及其评论。 */
export interface CommentReplyTarget {
  commentId: string;
  person: MomentPerson;
}

/**
 * sending: 60% opacity, a spinner after 600 ms. waiting: offline (等待网络), sent again once on online.
 * failed: a red「!」with [重新发送, 删除].
 * sending：60% 不透明度，600 毫秒后显示转圈。waiting：离线（等待网络），联网后自动重发一次。failed：红色「!」，可选 [重新发送, 删除]。
 */
export type LocalCommentStatus = 'sending' | 'waiting' | 'failed';

export interface LocalComment {
  clientId: string;
  postId: string;
  replyTo: CommentReplyTarget | null;
  body: string;
  createdAt: string;
  status: LocalCommentStatus;
  /** Already localized; set when failed. */
  /** 已按当前语言翻译；failed 时设置。 */
  failure: string | null;
  /** Coming back online sends a waiting or failed comment again once; true after that happened. */
  /** 联网后会自动把等待中或失败的评论重发一次；重发过之后为 true。 */
  autoRetried: boolean;
}

/**
 * A like being settled with the server. Each tap flips desired; one request per post is in flight; when it
 * returns and desired still differs from confirmed, it is sent again, so the last tap wins.
 * 正在与服务器同步的赞。每次点击翻转 desired；每条动态同时只有一个请求；请求返回时如果 desired 仍与 confirmed 不同就再发一次，因此以最后一次点击为准。
 */
export interface LikeIntent {
  desired: boolean;
  /** What the server last said (likedByMe). */
  /** 服务器最近一次的结果（likedByMe）。 */
  confirmed: boolean;
  inFlight: boolean;
  /** Failed attempts for the current desired state; after two retries it reverts to confirmed. */
  /** 当前 desired 状态已失败的次数；重试两次后恢复为 confirmed。 */
  failures: number;
  /** Offline, waiting for the online event. */
  /** 离线，等待 online 事件。 */
  waiting: boolean;
}

/** A post taken off the screen before the server agreed, kept to put it back at the same place. */
/** 在服务器确认之前从屏幕上拿掉的动态，保留下来以便放回原处。 */
export interface DeletedPost {
  post: MomentPost;
  /** Its index in each list it was in. */
  /** 它在所在各列表中的位置。 */
  positions: Partial<Record<FeedKey, number>>;
}

/** A comment taken off the screen before the server agreed, kept to put it back at the same place. */
/** 在服务器确认之前从屏幕上拿掉的评论，保留下来以便放回原处。 */
export interface DeletedComment {
  postId: string;
  comment: MomentComment;
  index: number;
}

/**
 * Everything the feed store keeps. The store may hold private bookkeeping beside these fields; screens read
 * through its selectors, not this shape.
 * 动态 store 保存的全部内容。store 可以在这些字段之外保留私有的记录；页面通过 store 的选择器读取，而不是直接读这个结构。
 */
export interface FeedState {
  /** The signed-in member, as optimistic likes and comments show them; null when signed out. */
  /** 当前成员，乐观显示的赞和评论使用它；未登录时为 null。 */
  me: MomentPerson | null;
  /** Every server post this device knows, by id. Lists hold ids, so a like shows in every list at once. */
  /** 本设备知道的全部服务器动态，按 id 存放。列表只保存 id，因此一次点赞会同时显示在所有列表中。 */
  posts: Record<string, MomentPost>;
  lists: Partial<Record<FeedKey, FeedList>>;
  /** Own posts not confirmed yet, newest first. */
  /** 尚未确认的自己的动态，最新的在前。 */
  localPosts: LocalPost[];
  /** By post id. */
  /** 按动态 id 存放。 */
  likes: Record<string, LikeIntent>;
  /** By post id, oldest first. */
  /** 按动态 id 存放，最早的在前。 */
  pendingComments: Record<string, LocalComment[]>;
  /** 展开其余 N 条评论, by post id. */
  /** 「展开其余 N 条评论」的状态，按动态 id 存放。 */
  commentPaging: Record<string, LoadState>;
  /** Copies of media published from this device, by server post id, until the server previews have loaded. */
  /** 从本设备发表的媒体副本，按服务器动态 id 存放，直到服务器的预览图加载完成。 */
  localMedia: Record<string, LocalMedia[]>;
  /** Posts fading out (200 ms) after 删除, by id. */
  /** 删除后正在淡出（200 毫秒）的动态，按 id 存放。 */
  deleting: Record<string, true>;
  deletedPosts: Record<string, DeletedPost>;
  /** By comment id. */
  /** 按评论 id 存放。 */
  deletedComments: Record<string, DeletedComment>;
  mediaToken: string | null;
  online: boolean;
}

export function initialFeedState(): FeedState {
  return {
    me: null,
    posts: {},
    lists: {},
    localPosts: [],
    likes: {},
    pendingComments: {},
    commentPaging: {},
    localMedia: {},
    deleting: {},
    deletedPosts: {},
    deletedComments: {},
    mediaToken: null,
    online: true,
  };
}

/* What the cards render */
/* 卡片渲染的内容 */

export type CommentView =
  | { type: 'server'; key: string; comment: MomentComment }
  | { type: 'local'; key: string; comment: LocalComment };

/** A post as a card shows it: the server post with this device's pending changes laid over it. */
/** 卡片显示的动态：服务器的动态，叠加本设备尚未完成的修改。 */
export interface MomentView {
  /** React key, from momentViewKey, stable when a local post is swapped for the server's. */
  /** React key，来自 momentViewKey；本地动态换成服务器的动态时保持不变。 */
  key: string;
  /** For a local post, the post built by the store, whose id is localPostKey(clientId). */
  /** 本地动态为 store 组装的动态，其 id 为 localPostKey(clientId)。 */
  post: MomentPost;
  /** Set while this device is still publishing the post. */
  /** 本设备仍在发表这条动态时设置。 */
  local: LocalPostState | null;
  /** This device's copies, index for index with post.media, while they are still needed. */
  /** 本设备上的副本，与 post.media 逐项对应，在仍需要时提供。 */
  localMedia: readonly LocalMedia[] | null;
  /** As the last tap left it. */
  /** 按最后一次点击的结果显示。 */
  liked: boolean;
  likes: readonly MomentPerson[];
  likeCount: number;
  /** Server comments, then this device's pending ones, oldest first, with deleted ones left out. */
  /** 服务器的评论，然后是本设备尚未完成的评论，最早的在前，已删除的不包括在内。 */
  comments: readonly CommentView[];
  /** Visible comments not loaded yet, for 展开其余 N 条评论. */
  /** 尚未加载的可见评论数，用于「展开其余 N 条评论」。 */
  moreComments: number;
  commentPaging: LoadState;
  /** Text open (全文) in this list. */
  /** 在这个列表中正文已展开（全文）。 */
  expanded: boolean;
  /** Fading out after 删除. */
  /** 删除后正在淡出。 */
  deleting: boolean;
}

/**
 * A post the author published from a client id keeps localPostKey(clientId) as its key, before and after the
 * server confirms it, so the card is not remounted and its images do not flicker. Others use the server id.
 * 作者以 client id 发表的动态，在服务器确认前后都以 localPostKey(clientId) 作为 key，卡片不会重新挂载，图片也不会闪烁。其他动态使用服务器 id。
 */
export function momentViewKey(post: Pick<MomentPost, 'id' | 'clientId'>): string {
  return post.clientId ? localPostKey(post.clientId) : post.id;
}

/** Same idea for comments: the author's own comment keeps its client id across the swap. */
/** 评论同理：作者自己的评论在替换前后保持其 client id。 */
export function commentViewKey(comment: Pick<MomentComment, 'id' | 'clientId'> | Pick<LocalComment, 'clientId'>): string {
  if ('id' in comment && !comment.clientId) return comment.id;
  return `local:${comment.clientId}`;
}

/** Opening the viewer or the player from a media cell. */
/** 从媒体格子打开图片查看器或视频播放器。 */
export interface MediaOpenRequest {
  /** post.id of the view, local or server. */
  /** 该视图的 post.id，本地或服务器的都可以。 */
  postId: string;
  index: number;
  /** Where the tapped cell is now, for the zoom. */
  /** 被点击的格子当前的位置，用于缩放动画。 */
  rect: DOMRect | null;
}

/**
 * Every media cell carries data-moment-cell="<postId>:<index>", so a viewer can find the cell to shrink back
 * into after the list re-rendered.
 * 每个媒体格子都带有 data-moment-cell="<postId>:<index>"，列表重新渲染后查看器仍能找到要缩回的格子。
 */
export const MEDIA_CELL_ATTRIBUTE = 'data-moment-cell';

export function mediaCellValue(postId: string, index: number): string {
  return `${postId}:${index}`;
}

/** The cell on screen now, or null. Only call this in the browser. */
/** 当前屏幕上的格子，没有时为 null。只能在浏览器中调用。 */
export function findMediaCell(postId: string, index: number): HTMLElement | null {
  const value = mediaCellValue(postId, index).replace(/["\\]/g, '\\$&');
  return document.querySelector<HTMLElement>(`[${MEDIA_CELL_ATTRIBUTE}="${value}"]`);
}

/**
 * A fresh id for a post or a comment: 22 url-safe characters, which isMomentClientId accepts. Only call this
 * in the browser or a test with crypto.
 * 为动态或评论生成的新 id：22 个可放进网址的字符，能通过 isMomentClientId。只能在浏览器或提供 crypto 的测试中调用。
 */
export function newMomentClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
