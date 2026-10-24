import { describe, expect, it } from 'vitest';
import type { MomentPost } from '@utmmsc/shared';
import {
  FEED_CACHE_MAX_AGE_MS,
  FEED_CACHE_MAX_BYTES,
  FEED_CACHE_POSTS,
  clearFeedCache,
  feedCacheKey,
  readCachedPost,
  readFeedCache,
  serializeFeedCache,
  writeFeedCache,
  type CacheStorage,
} from './feedCache';

/** In-memory Storage with the parts the cache uses. */
/** 只实现缓存所需部分的内存 Storage。 */
function memoryStorage(initial: Record<string, string> = {}): CacheStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const NOW = Date.parse('2026-10-24T12:00:00.000Z');

function post(id: string, extra: Partial<MomentPost> = {}): MomentPost {
  return {
    id,
    author: { id: 'mem_a', displayName: '张三', avatarKey: null },
    body: `正文 ${id}`,
    media: [{ key: `moments/mem_a/${id}.jpg`, contentType: 'image/jpeg', kind: 'image', width: 1080, height: 720, previewKey: null, durationMs: null }],
    location: null,
    createdAt: '2026-10-24T11:00:00.000Z',
    clubWide: false,
    likes: [{ id: 'mem_b', displayName: '李四', avatarKey: null }],
    likeCount: 1,
    likedByMe: false,
    comments: [
      {
        id: `c_${id}`,
        postId: id,
        author: { id: 'mem_b', displayName: '李四', avatarKey: null },
        replyTo: null,
        replyToCommentId: null,
        body: '好看',
        createdAt: '2026-10-24T11:05:00.000Z',
        canDelete: false,
        canModerate: false,
      },
    ],
    commentCount: 1,
    commentsCursor: null,
    canDelete: false,
    canModerate: false,
    canReport: true,
    canInteract: true,
    ...extra,
  };
}

describe('feed cache', () => {
  it('reads back what it wrote for the same member', () => {
    const storage = memoryStorage();
    const posts = [post('p2'), post('p1', { audience: 'club', clientId: 'client_123456', removed: { at: '2026-10-24T11:30:00.000Z', reason: '广告' } })];
    expect(writeFeedCache('mem_me', { posts, mediaToken: 'tok', savedAt: NOW }, storage)).toBe(true);
    expect(storage.data.has('utmmsc.moments.v1.mem_me')).toBe(true);
    expect(readFeedCache('mem_me', NOW + 1000, storage)).toEqual({ posts, mediaToken: 'tok', savedAt: NOW });
  });

  it('keeps one entry per member and never returns another member\'s', () => {
    const storage = memoryStorage();
    writeFeedCache('mem_a', { posts: [post('pa')], mediaToken: null, savedAt: NOW }, storage);
    writeFeedCache('mem_b', { posts: [post('pb')], mediaToken: null, savedAt: NOW }, storage);
    expect(readFeedCache('mem_a', NOW, storage)?.posts.map((p) => p.id)).toEqual(['pa']);
    expect(readFeedCache('mem_b', NOW, storage)?.posts.map((p) => p.id)).toEqual(['pb']);
    expect(readFeedCache('mem_c', NOW, storage)).toBeNull();
    // An entry copied under another member's key is refused and removed.
    // 被复制到其他成员键下的记录会被拒绝并删除。
    storage.setItem(feedCacheKey('mem_c'), storage.getItem(feedCacheKey('mem_a')) as string);
    expect(readFeedCache('mem_c', NOW, storage)).toBeNull();
    expect(storage.getItem(feedCacheKey('mem_c'))).toBeNull();
  });

  it('drops another version, unreadable JSON and entries too old', () => {
    const storage = memoryStorage({
      [feedCacheKey('mem_v')]: JSON.stringify({ v: 2, memberId: 'mem_v', savedAt: NOW, mediaToken: null, posts: [] }),
      [feedCacheKey('mem_j')]: '{not json',
      [feedCacheKey('mem_o')]: JSON.stringify({ v: 1, memberId: 'mem_o', savedAt: NOW - FEED_CACHE_MAX_AGE_MS - 1, mediaToken: null, posts: [] }),
      [feedCacheKey('mem_f')]: JSON.stringify({ v: 1, memberId: 'mem_f', savedAt: NOW + FEED_CACHE_MAX_AGE_MS + 1, mediaToken: null, posts: [] }),
      [feedCacheKey('mem_s')]: JSON.stringify({ v: 1, memberId: 'mem_s', savedAt: NOW, mediaToken: 3, posts: [] }),
    });
    for (const id of ['mem_v', 'mem_j', 'mem_o', 'mem_f', 'mem_s']) {
      expect(readFeedCache(id, NOW, storage)).toBeNull();
      expect(storage.getItem(feedCacheKey(id))).toBeNull();
    }
  });

  it('skips broken and repeated posts but keeps the rest, at most one page', () => {
    const good = Array.from({ length: FEED_CACHE_POSTS + 2 }, (_, i) => post(`p${i}`));
    const broken = [
      { ...post('x1'), likeCount: -1 },
      { ...post('x2'), author: { id: 'mem_a' } },
      { ...post('x3'), media: [{ key: 'k', contentType: 'image/jpeg', kind: 'audio' }] },
      { ...post('x4'), comments: [{ id: 'c' }] },
      'not a post',
    ];
    const storage = memoryStorage({
      [feedCacheKey('mem_me')]: JSON.stringify({ v: 1, memberId: 'mem_me', savedAt: NOW, mediaToken: null, posts: [good[0], ...broken, good[0], ...good.slice(1)] }),
    });
    const read = readFeedCache('mem_me', NOW, storage);
    expect(read?.posts.map((p) => p.id)).toEqual(good.slice(0, FEED_CACHE_POSTS).map((p) => p.id));
  });

  it('reads media posted before sizes were recorded', () => {
    const legacy = { ...post('old'), media: [{ key: 'moments/mem_a/old.jpg', contentType: 'image/jpeg', kind: 'image' }] };
    expect(readCachedPost(legacy)?.id).toBe('old');
    expect(readCachedPost({ ...legacy, audience: 'everyone' })).toBeNull();
  });

  it('drops posts from the end until the entry fits, and stores nothing when one post is too large', () => {
    const big = (id: string) => post(id, { body: '长'.repeat(30_000) });
    const posts = [big('p1'), big('p2'), big('p3')];
    const text = serializeFeedCache('mem_me', { posts, mediaToken: null, savedAt: NOW });
    expect(text).not.toBeNull();
    const stored = JSON.parse(text as string) as { posts: MomentPost[] };
    // Each body is 90 000 bytes in UTF-8, so two fit in 200 KB and three do not.
    // 每段正文的 UTF-8 为 90 000 字节，200 KB 放得下两段，放不下三段。
    expect(stored.posts.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(new TextEncoder().encode(text as string).length).toBeLessThanOrEqual(FEED_CACHE_MAX_BYTES);

    const storage = memoryStorage();
    writeFeedCache('mem_me', { posts: [post('small')], mediaToken: null, savedAt: NOW }, storage);
    expect(writeFeedCache('mem_me', { posts: [post('huge', { body: '长'.repeat(80_000) })], mediaToken: null, savedAt: NOW }, storage)).toBe(false);
    // The older page is removed rather than left behind.
    // 更早的那一页会被删除，不会留下。
    expect(storage.getItem(feedCacheKey('mem_me'))).toBeNull();
  });

  it('counts characters outside the BMP as four bytes', () => {
    const emoji = post('e', { body: '\u{1F600}'.repeat(1000) });
    const plain = post('e', { body: '' });
    const withEmoji = serializeFeedCache('mem_me', { posts: [emoji], mediaToken: null, savedAt: NOW }) as string;
    const without = serializeFeedCache('mem_me', { posts: [plain], mediaToken: null, savedAt: NOW }) as string;
    expect(new TextEncoder().encode(withEmoji).length - new TextEncoder().encode(without).length).toBe(4000);
    expect(serializeFeedCache('mem_me', { posts: [emoji], mediaToken: null, savedAt: NOW }, new TextEncoder().encode(withEmoji).length)).toBe(withEmoji);
    expect(serializeFeedCache('mem_me', { posts: [emoji], mediaToken: null, savedAt: NOW }, new TextEncoder().encode(withEmoji).length - 1)).not.toBe(withEmoji);
  });

  it('treats broken storage as no cache', () => {
    const throwing: CacheStorage = {
      length: 1,
      key: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readFeedCache('mem_me', NOW, throwing)).toBeNull();
    expect(writeFeedCache('mem_me', { posts: [post('p')], mediaToken: null, savedAt: NOW }, throwing)).toBe(false);
    expect(() => clearFeedCache(throwing)).not.toThrow();
    expect(readFeedCache('mem_me', NOW, null)).toBeNull();
    expect(writeFeedCache('mem_me', { posts: [], mediaToken: null, savedAt: NOW }, null)).toBe(false);
  });

  it('removes a full write instead of keeping an older page', () => {
    const storage = memoryStorage();
    writeFeedCache('mem_me', { posts: [post('old')], mediaToken: null, savedAt: NOW }, storage);
    const full: CacheStorage = { ...storage, length: storage.length, key: storage.key, getItem: storage.getItem, removeItem: storage.removeItem, setItem: () => { throw new Error('quota'); } };
    expect(writeFeedCache('mem_me', { posts: [post('new')], mediaToken: null, savedAt: NOW }, full)).toBe(false);
    expect(storage.getItem(feedCacheKey('mem_me'))).toBeNull();
  });

  it('clears every member and every version on sign-out, and nothing else', () => {
    const storage = memoryStorage({
      'utmmsc.moments.v1.mem_a': '{}',
      'utmmsc.moments.v1.mem_b': '{}',
      'utmmsc.moments.v0.mem_a': '{}',
      'utmmsc.session': '{"token":"t"}',
      'utmmsc.chat.drafts.v1': '{}',
    });
    clearFeedCache(storage);
    expect([...storage.data.keys()].sort()).toEqual(['utmmsc.chat.drafts.v1', 'utmmsc.session']);
  });
});
