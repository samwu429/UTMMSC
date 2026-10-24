import type { MomentComment, MomentMedia, MomentPerson, MomentPost } from '@utmmsc/shared';

/**
 * The first page of each member's home feed on this device, so 好友动态 renders at once on the next visit and then
 * refreshes quietly. One key per member (utmmsc.moments.v1.<memberId>), at most FEED_CACHE_MAX_BYTES, read field
 * by field so a broken or old entry is dropped instead of crashing, and removed on sign-out. Storage that is
 * blocked or full only means there is no cache.
 * 每位成员在这台设备上的动态首页第一页，下次打开时立即显示，再安静地刷新。每位成员一个键（utmmsc.moments.v1.<memberId>），
 * 最多 FEED_CACHE_MAX_BYTES；逐字段读取，损坏或旧版本的记录会被丢弃而不会导致崩溃；退出登录时删除。存储被禁用或已满只意味着没有缓存。
 */

export const FEED_CACHE_VERSION = 1;
export const FEED_CACHE_PREFIX = `utmmsc.moments.v${FEED_CACHE_VERSION}.`;
/** UTF-8 size of one member's entry. Posts are dropped from the end until it fits. */
/** 单个成员记录的 UTF-8 大小上限。超出时从末尾开始去掉动态，直到放得下。 */
export const FEED_CACHE_MAX_BYTES = 200 * 1024;
/** Older entries are dropped: their media token has expired, so their images would not load. */
/** 更早的记录会被丢弃：其中的媒体令牌已过期，图片无法加载。 */
export const FEED_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Posts kept per member, one page. */
/** 每位成员保存的动态数，即一页。 */
export const FEED_CACHE_POSTS = 10;

export interface CachedFeed {
  posts: MomentPost[];
  /** The media token the posts were loaded with; tokens last a UTC day plus seven days. */
  /** 加载这些动态时的媒体令牌；令牌有效期为当天（UTC）再加七天。 */
  mediaToken: string | null;
  /** Date.now() of the write. */
  /** 写入时的 Date.now()。 */
  savedAt: number;
}

export type CacheStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** localStorage, looked up on every call and never at import time; null when it cannot be reached. */
/** localStorage，每次调用时获取，导入时不访问；无法访问时为 null。 */
function defaultStorage(): CacheStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function feedCacheKey(memberId: string): string {
  return `${FEED_CACHE_PREFIX}${memberId}`;
}

/* Reading field by field */
/* 逐字段读取 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isPerson(value: unknown): value is MomentPerson {
  return isRecord(value) && isString(value.id) && isString(value.displayName) && isNullableString(value.avatarKey);
}

function isRemoval(value: unknown): boolean {
  return value === undefined || (isRecord(value) && isString(value.at) && isNullableString(value.reason));
}

function isMedia(value: unknown): value is MomentMedia {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isString(value.contentType) &&
    (value.kind === 'image' || value.kind === 'video') &&
    isNullableNumber(value.width ?? null) &&
    isNullableNumber(value.height ?? null) &&
    isNullableString(value.previewKey ?? null) &&
    isNullableNumber(value.durationMs ?? null)
  );
}

function isComment(value: unknown): value is MomentComment {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.postId) &&
    isPerson(value.author) &&
    (value.replyTo === null || isPerson(value.replyTo)) &&
    isNullableString(value.replyToCommentId) &&
    isString(value.body) &&
    isString(value.createdAt) &&
    typeof value.canDelete === 'boolean' &&
    typeof value.canModerate === 'boolean' &&
    (value.clientId === undefined || isString(value.clientId)) &&
    isRemoval(value.removed)
  );
}

/** A post as the cards need it, or null when any field is missing or of the wrong type. */
/** 卡片所需的动态；任一字段缺失或类型不对时为 null。 */
export function readCachedPost(value: unknown): MomentPost | null {
  if (!isRecord(value)) return null;
  const ok =
    isString(value.id) &&
    isPerson(value.author) &&
    isString(value.body) &&
    Array.isArray(value.media) &&
    value.media.every(isMedia) &&
    isNullableString(value.location) &&
    isString(value.createdAt) &&
    typeof value.clubWide === 'boolean' &&
    (value.audience === undefined || value.audience === 'friends' || value.audience === 'club' || value.audience === 'private') &&
    Array.isArray(value.likes) &&
    value.likes.every(isPerson) &&
    isCount(value.likeCount) &&
    typeof value.likedByMe === 'boolean' &&
    Array.isArray(value.comments) &&
    value.comments.every(isComment) &&
    isCount(value.commentCount) &&
    isNullableString(value.commentsCursor) &&
    typeof value.canDelete === 'boolean' &&
    typeof value.canModerate === 'boolean' &&
    typeof value.canReport === 'boolean' &&
    typeof value.canInteract === 'boolean' &&
    (value.clientId === undefined || isString(value.clientId)) &&
    isRemoval(value.removed);
  return ok ? (value as unknown as MomentPost) : null;
}

/* Size */
/* 大小 */

function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte character; skip its second half.
      // 代理对是一个 4 字节字符；跳过它的后半部分。
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

interface StoredFeed {
  v: number;
  memberId: string;
  savedAt: number;
  mediaToken: string | null;
  posts: MomentPost[];
}

/**
 * The entry as stored: at most FEED_CACHE_POSTS posts, dropping from the end until it is at most maxBytes;
 * null when not even one post fits.
 * 存储时的记录：最多 FEED_CACHE_POSTS 条动态，从末尾开始去掉直到不超过 maxBytes；连一条动态都放不下时为 null。
 */
export function serializeFeedCache(memberId: string, feed: CachedFeed, maxBytes: number = FEED_CACHE_MAX_BYTES): string | null {
  let posts = feed.posts.slice(0, FEED_CACHE_POSTS);
  for (;;) {
    const stored: StoredFeed = { v: FEED_CACHE_VERSION, memberId, savedAt: feed.savedAt, mediaToken: feed.mediaToken, posts };
    const text = JSON.stringify(stored);
    if (utf8Bytes(text) <= maxBytes) return text;
    // An empty page would show 朋友们还没有发动态 for a feed that has posts, so nothing is stored instead.
    // 空的一页会让有动态的首页显示「朋友们还没有发动态」，因此改为什么都不保存。
    if (posts.length <= 1) return null;
    posts = posts.slice(0, -1);
  }
}

/* Reading and writing */
/* 读写 */

/**
 * The member's cached first page, or null: nothing stored, another version, another member's entry, too old,
 * unreadable, or storage blocked. A broken entry is removed.
 * 该成员缓存的第一页；以下情况为 null：没有记录、版本不同、属于其他成员、过旧、无法解析，或存储被禁用。损坏的记录会被删除。
 */
export function readFeedCache(memberId: string, now: number = Date.now(), storage: CacheStorage | null = defaultStorage()): CachedFeed | null {
  if (!storage) return null;
  const key = feedCacheKey(memberId);
  let text: string | null;
  try {
    text = storage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  const stored = readStored(value, memberId);
  // Too old, or saved under a clock far ahead of this one.
  // 过旧，或者是在比现在快很多的时钟下保存的。
  if (!stored || Math.abs(now - stored.savedAt) > FEED_CACHE_MAX_AGE_MS) {
    removeKey(storage, key);
    return null;
  }
  const posts: MomentPost[] = [];
  const seen = new Set<string>();
  for (const item of stored.posts) {
    const post = readCachedPost(item);
    if (post && !seen.has(post.id)) {
      seen.add(post.id);
      posts.push(post);
    }
    if (posts.length >= FEED_CACHE_POSTS) break;
  }
  return { posts, mediaToken: stored.mediaToken, savedAt: stored.savedAt };
}

/** The envelope of an entry, with its posts still unchecked; null for another version or member. */
/** 记录的外层结构，其中的动态尚未检查；版本或成员不符时为 null。 */
function readStored(value: unknown, memberId: string): { savedAt: number; mediaToken: string | null; posts: unknown[] } | null {
  if (!isRecord(value) || value.v !== FEED_CACHE_VERSION || value.memberId !== memberId) return null;
  const { savedAt, mediaToken, posts } = value;
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || !isNullableString(mediaToken) || !Array.isArray(posts)) return null;
  return { savedAt, mediaToken, posts };
}

/** Saves the member's first page; false when it could not be stored (too large, storage full or blocked). */
/** 保存该成员的第一页；无法保存时（过大、存储已满或被禁用）返回 false。 */
export function writeFeedCache(memberId: string, feed: CachedFeed, storage: CacheStorage | null = defaultStorage()): boolean {
  if (!storage) return false;
  const key = feedCacheKey(memberId);
  const text = serializeFeedCache(memberId, feed);
  if (text === null) {
    removeKey(storage, key);
    return false;
  }
  try {
    storage.setItem(key, text);
    return true;
  } catch {
    // A full quota must not leave an older first page behind.
    // 空间已满时不能留下更旧的第一页。
    removeKey(storage, key);
    return false;
  }
}

function removeKey(storage: CacheStorage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage has nothing to remove.
    // 存储被禁用时没有可删除的内容。
  }
}

/** Sign-out: removes every member's entry, including entries of older versions. */
/** 退出登录：删除所有成员的记录，包括旧版本的记录。 */
export function clearFeedCache(storage: CacheStorage | null = defaultStorage()): void {
  if (!storage) return;
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key && /^utmmsc\.moments\.v\d+\./.test(key)) keys.push(key);
    }
  } catch {
    return;
  }
  for (const key of keys) removeKey(storage, key);
}
