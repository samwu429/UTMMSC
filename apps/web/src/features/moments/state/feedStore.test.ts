import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentComment, MomentMediaInput, MomentPerson, MomentPost } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { HOME_FEED, albumFeedKey, localPostKey, postFeedKey, type UploadBatch, type UploadItem } from '../model';
import type { CachedFeed } from './feedCache';
import {
  DELETE_FADE_MS,
  LIKE_RETRY_BASE_MS,
  LOCAL_MEDIA_RELEASE_MS,
  REOPEN_REFRESH_MS,
  createFeedStore,
  type FeedApi,
  type FeedStoreDeps,
} from './feedStore';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Method = keyof FeedApi;
interface Call {
  args: unknown[];
  reply: Deferred<unknown>;
}

const ME: MomentPerson = { id: 'mem_me', displayName: '我', avatarKey: null };
const ZHANG: MomentPerson = { id: 'mem_zhang', displayName: '张三', avatarKey: null };

function at(n: number): string {
  return new Date(Date.UTC(2026, 9, 24, 0, n)).toISOString();
}

function post(n: number, extra: Partial<MomentPost> = {}): MomentPost {
  return {
    id: `p${n}`,
    author: ZHANG,
    body: `动态 ${n}`,
    media: [],
    location: null,
    createdAt: at(n),
    clubWide: false,
    likes: [],
    likeCount: 0,
    likedByMe: false,
    comments: [],
    commentCount: 0,
    commentsCursor: null,
    canDelete: false,
    canModerate: false,
    canReport: true,
    canInteract: true,
    ...extra,
  };
}

function comment(id: string, n: number, extra: Partial<MomentComment> = {}): MomentComment {
  return { id, postId: 'p1', author: ZHANG, replyTo: null, replyToCommentId: null, body: id, createdAt: at(n), canDelete: false, canModerate: false, ...extra };
}

const page = (posts: MomentPost[], nextCursor: string | null = null) => ({ posts, nextCursor, mediaToken: 'tok' });
const apiError = (status: number, code: string, message = '出错了') => new ApiClientError(status, code, message);

/** A store over a fake API whose every call waits until the test answers it. */
/** 基于替身接口的 store，每次接口调用都等测试给出回复。 */
function harness(options: { cached?: CachedFeed | null } = {}) {
  const calls: Record<Method, Call[]> = {
    feed: [],
    album: [],
    post: [],
    comments: [],
    create: [],
    remove: [],
    like: [],
    comment: [],
    removeComment: [],
    moderatePost: [],
    moderateComment: [],
  };
  const fake = (method: Method) => (...args: unknown[]) => {
    const reply = deferred<unknown>();
    calls[method].push({ args, reply });
    return reply.promise;
  };
  const api = Object.fromEntries((Object.keys(calls) as Method[]).map((method) => [method, fake(method)])) as unknown as FeedApi;
  let online = true;
  let clientIds = 0;
  const deps: FeedStoreDeps = {
    api,
    me: () => ME,
    mediaToken: () => null,
    setMediaToken: vi.fn(),
    badge: { refresh: vi.fn(() => Promise.resolve()), markFeedSeen: vi.fn() },
    cache: { read: vi.fn(() => options.cached ?? null), write: vi.fn(), clear: vi.fn() },
    clearDrafts: vi.fn(),
    isOnline: () => online,
    makeClientId: () => `cli_${String((clientIds += 1)).padStart(8, '0')}`,
    now: () => Date.now(),
  };
  const store = createFeedStore(deps);
  const answer = (method: Method, index: number, value: unknown) => calls[method][index]?.reply.resolve(value);
  const fail = (method: Method, index: number, error: unknown) => calls[method][index]?.reply.reject(error);
  const goOffline = () => {
    online = false;
    store.getState().setOnline(false);
  };
  const goOnline = () => {
    online = true;
    store.getState().setOnline(true);
  };
  const views = (key = HOME_FEED) => store.memo.views(store.getState(), key);
  return { store, deps, calls, answer, fail, goOffline, goOnline, views };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

/** Opens home and answers page 1 with `posts`. */
/** 打开动态首页，并以 `posts` 回复第一页。 */
async function openHome(h: ReturnType<typeof harness>, posts: MomentPost[], nextCursor: string | null = null) {
  h.store.getState().open(HOME_FEED);
  h.answer('feed', h.calls.feed.length - 1, page(posts, nextCursor));
  await flush();
}

describe('feed store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('likes', () => {
    it('lets the last of five quick taps win against a slow server with one request', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      for (let tap = 0; tap < 5; tap += 1) h.store.getState().toggleLike('p1');
      expect(h.calls.like.map((c) => c.args)).toEqual([['p1', { liked: true }]]);
      expect(h.views()[0]).toMatchObject({ liked: true, likeCount: 1, likes: [ME] });
      h.answer('like', 0, { likedByMe: true, likes: [ME], likeCount: 1 });
      await flush();
      expect(h.calls.like).toHaveLength(1);
      expect(h.store.getState().likes.p1).toBeUndefined();
      expect(h.views()[0]).toMatchObject({ liked: true, likeCount: 1 });
    });

    it('sends once more when the taps end on the other state, so at most two requests', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      for (let tap = 0; tap < 4; tap += 1) h.store.getState().toggleLike('p1');
      expect(h.views()[0]?.liked).toBe(false);
      h.answer('like', 0, { likedByMe: true, likes: [ME], likeCount: 1 });
      await flush();
      expect(h.calls.like.map((c) => c.args[1])).toEqual([{ liked: true }, { liked: false }]);
      h.answer('like', 1, { likedByMe: false, likes: [], likeCount: 0 });
      await flush();
      expect(h.calls.like).toHaveLength(2);
      expect(h.views()[0]).toMatchObject({ liked: false, likeCount: 0 });
    });

    it('retries twice with backoff, then goes back to what the server said', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      h.store.getState().toggleLike('p1');
      h.fail('like', 0, apiError(500, 'server_error'));
      await flush();
      expect(h.calls.like).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(LIKE_RETRY_BASE_MS);
      expect(h.calls.like).toHaveLength(2);
      h.fail('like', 1, apiError(500, 'server_error'));
      await vi.advanceTimersByTimeAsync(LIKE_RETRY_BASE_MS);
      expect(h.calls.like).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(LIKE_RETRY_BASE_MS);
      expect(h.calls.like).toHaveLength(3);
      expect(h.views()[0]?.liked).toBe(true);
      h.fail('like', 2, apiError(500, 'server_error'));
      await vi.advanceTimersByTimeAsync(10 * LIKE_RETRY_BASE_MS);
      expect(h.calls.like).toHaveLength(3);
      expect(h.views()[0]).toMatchObject({ liked: false, likeCount: 0 });
    });

    it('waits while offline and sends the last wish when the network returns', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      h.goOffline();
      h.store.getState().toggleLike('p1');
      expect(h.calls.like).toHaveLength(0);
      expect(h.views()[0]?.liked).toBe(true);
      h.goOnline();
      expect(h.calls.like.map((c) => c.args[1])).toEqual([{ liked: true }]);
    });

    it('keeps a like and a comment the server confirmed after a reload of page 1 left', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      const stale = h.store.getState().refresh(HOME_FEED);
      h.store.getState().toggleLike('p1');
      h.answer('like', 0, { likedByMe: true, likes: [ME], likeCount: 1 });
      const clientId = h.store.getState().sendComment({ postId: 'p1', text: '好看', replyTo: null });
      h.answer('comment', 0, { comment: comment('c1', 5, { author: ME, clientId, body: '好看' }), commentCount: 1 });
      await flush();
      // Page 1 left before both were confirmed, so it has neither.
      // 第一页在两者确认之前就已发出，因此两者都没有。
      h.answer('feed', 1, page([post(1)]));
      await stale;
      expect(h.store.getState().posts.p1).toMatchObject({ likedByMe: true, likeCount: 1, likes: [ME], commentCount: 1 });
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1']);
      expect(h.views()[0]).toMatchObject({ liked: true, likeCount: 1 });

      // A reload that left after them is the server's word, here a like taken back on another device.
      // 在它们之后发出的重新加载以服务器为准，这里是在另一台设备上取消了赞。
      const fresh = h.store.getState().refresh(HOME_FEED);
      h.answer('feed', 2, page([post(1, { comments: [comment('c1', 5, { author: ME, clientId, body: '好看' })], commentCount: 1 })]));
      await fresh;
      expect(h.store.getState().posts.p1).toMatchObject({ likedByMe: false, likeCount: 0, likes: [], commentCount: 1 });
      expect(h.views()[0]?.liked).toBe(false);
    });

    it('drops a post that answers 404 from every list', async () => {
      const h = harness();
      await openHome(h, [post(2), post(1)]);
      h.store.getState().open(albumFeedKey('mem_zhang'));
      h.answer('album', 0, { member: { ...ZHANG, coverKey: null, headline: null }, posts: [post(1)], nextCursor: null, mediaToken: 'tok', clubOnly: true });
      await flush();
      expect(h.store.getState().lists[albumFeedKey('mem_zhang')]).toMatchObject({ ids: ['p1'], clubOnly: true, owner: { id: 'mem_zhang' } });
      h.store.getState().toggleLike('p1');
      h.fail('like', 0, apiError(404, 'moment_unavailable', '这条动态已删除或无法查看'));
      await flush();
      expect(h.store.getState().lists.home?.ids).toEqual(['p2']);
      expect(h.store.getState().lists[albumFeedKey('mem_zhang')]?.ids).toEqual([]);
      expect(h.store.getState().posts.p1).toBeUndefined();
    });
  });

  describe('comments', () => {
    it('goes pending, then confirmed under the same key', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      const clientId = h.store.getState().sendComment({ postId: 'p1', text: '  好看\n真的 ', replyTo: null });
      expect(h.calls.comment[0]?.args).toEqual(['p1', { clientId, text: '好看 真的', replyToCommentId: null }]);
      expect(h.views()[0]?.comments.map((c) => [c.type, c.key])).toEqual([['local', `local:${clientId}`]]);
      h.answer('comment', 0, { comment: comment('c1', 5, { author: ME, clientId, body: '好看 真的' }), commentCount: 1 });
      await flush();
      expect(h.views()[0]?.comments.map((c) => [c.type, c.key])).toEqual([['server', `local:${clientId}`]]);
      expect(h.store.getState().pendingComments).toEqual({});
    });

    it('marks a refused comment failed and sends it again with the same clientId', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      const clientId = h.store.getState().sendComment({ postId: 'p1', text: '回复', replyTo: { commentId: 'c0', person: ZHANG } });
      h.fail('comment', 0, apiError(400, 'reply_unavailable', '无法回复这条评论'));
      await flush();
      expect(h.store.getState().pendingComments.p1?.[0]).toMatchObject({ clientId, status: 'failed', failure: '无法回复这条评论' });
      h.store.getState().resendComment('p1', clientId);
      expect(h.calls.comment[1]?.args).toEqual(['p1', { clientId, text: '回复', replyToCommentId: 'c0' }]);
      expect(h.store.getState().pendingComments.p1?.[0]?.status).toBe('sending');
    });

    it('waits offline, then sends once on its own when the network returns', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      h.goOffline();
      const clientId = h.store.getState().sendComment({ postId: 'p1', text: '离线', replyTo: null });
      expect(h.calls.comment).toHaveLength(0);
      expect(h.store.getState().pendingComments.p1?.[0]?.status).toBe('waiting');
      h.goOnline();
      expect(h.calls.comment.map((c) => (c.args[1] as { clientId: string }).clientId)).toEqual([clientId]);
      h.fail('comment', 0, apiError(503, 'moments_unavailable'));
      await flush();
      expect(h.store.getState().pendingComments.p1?.[0]).toMatchObject({ status: 'failed', autoRetried: true });
      h.goOffline();
      h.goOnline();
      expect(h.calls.comment).toHaveLength(1);
    });

    it('sends a reply from 消息 for a post no list holds, without a pending row', async () => {
      const h = harness();
      h.store.getState().sendComment({ postId: 'p9', text: '你好', replyTo: null });
      expect(h.calls.comment).toHaveLength(1);
      expect(h.store.getState().pendingComments).toEqual({});
    });

    it('removes a comment at once, puts it back on refusal, and keeps it out of a reload that left before', async () => {
      const h = harness();
      const thread = post(1, { comments: [comment('c1', 1), comment('c2', 2), comment('c3', 3)], commentCount: 3 });
      await openHome(h, [thread]);
      const refused = h.store.getState().deleteComment('p1', 'c2');
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c3']);
      h.fail('removeComment', 0, apiError(403, 'no_permission'));
      expect(await refused).toBe(false);
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);

      const reload = h.store.getState().refresh(HOME_FEED);
      const done = h.store.getState().deleteComment('p1', 'c2');
      h.answer('removeComment', 1, { ok: true });
      expect(await done).toBe(true);
      h.answer('feed', 1, page([thread]));
      await reload;
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c3']);
      expect(h.store.getState().posts.p1?.commentCount).toBe(2);
    });

    it('loads the whole thread on the detail page', async () => {
      const h = harness();
      h.store.getState().open(postFeedKey('p1'));
      expect(h.store.getState().lists[postFeedKey('p1')]?.status).toBe('loading');
      h.answer('post', 0, { post: post(1, { comments: [comment('c1', 1)], commentCount: 3, commentsCursor: 'k1' }), mediaToken: 'tok' });
      await flush();
      expect(h.calls.comments[0]?.args).toEqual(['p1', 'k1']);
      h.answer('comments', 0, { comments: [comment('c2', 2)], nextCursor: 'k2' });
      await flush();
      h.answer('comments', 1, { comments: [comment('c3', 3)], nextCursor: null });
      await flush();
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
      expect(h.store.memo.views(h.store.getState(), postFeedKey('p1'))[0]?.moreComments).toBe(0);
    });

    it('follows the thread again when 加载失败，轻触重试 reloads a detail page whose comments stopped', async () => {
      const h = harness();
      const key = postFeedKey('p1');
      const thread = post(1, { comments: [comment('c1', 1)], commentCount: 3, commentsCursor: 'k1' });
      h.store.getState().open(key);
      h.answer('post', 0, { post: thread, mediaToken: 'tok' });
      await flush();
      h.fail('comments', 0, apiError(503, 'moments_unavailable'));
      await flush();
      expect(h.store.memo.views(h.store.getState(), key)[0]?.commentPaging).toBe('failed');

      const retry = h.store.getState().refresh(key);
      h.answer('post', 1, { post: thread, mediaToken: 'tok' });
      await retry;
      expect(h.calls.comments[1]?.args).toEqual(['p1', 'k1']);
      expect(h.store.getState().commentPaging.p1).toBe('loading');
      h.answer('comments', 1, { comments: [comment('c2', 2), comment('c3', 3)], nextCursor: null });
      await flush();
      expect(h.store.getState().posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
      expect(h.store.memo.views(h.store.getState(), key)[0]).toMatchObject({ commentPaging: 'idle', moreComments: 0 });
    });

    it('marks a detail page unavailable on 404', async () => {
      const h = harness();
      h.store.getState().open(postFeedKey('p1'));
      h.fail('post', 0, apiError(404, 'moment_unavailable'));
      await flush();
      expect(h.store.getState().lists[postFeedKey('p1')]?.status).toBe('unavailable');
    });
  });

  describe('publishing', () => {
    function fakeBatch(items: UploadItem[]) {
      const listeners = new Set<() => void>();
      let current = items;
      let uploaded = deferred<MomentMediaInput[]>();
      const batch: UploadBatch & { set(next: UploadItem[]): void; finish(media: MomentMediaInput[]): void; failUpload(error: unknown): void } = {
        id: 'batch_1',
        items: () => current,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        whenUploaded: () => uploaded.promise,
        retry: vi.fn(() => {
          uploaded = deferred<MomentMediaInput[]>();
        }),
        cancel: vi.fn(),
        release: vi.fn(),
        set: (next) => {
          current = next;
          for (const listener of listeners) listener();
        },
        finish: (media) => uploaded.resolve(media),
        failUpload: (error) => uploaded.reject(error),
      };
      return batch;
    }

    function item(status: UploadItem['status'], progress: number): UploadItem {
      return {
        id: 'u1',
        status,
        progress,
        local: { kind: 'image', contentType: 'image/jpeg', fileUrl: 'blob:file', previewUrl: 'blob:preview', width: 800, height: 600, durationMs: null },
        uploaded: null,
        failure: null,
      };
    }

    it('shows the local post at once, waits for its uploads, and swaps it for the server post under the same key', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      const batch = fakeBatch([item('uploading', 0.4)]);
      h.store.getState().publish({ clientId: 'cli_publish', text: '春天', audience: 'friends', location: null, uploads: batch });
      expect(h.views().map((v) => v.key)).toEqual([localPostKey('cli_publish'), 'p1']);
      expect(h.views()[0]?.local).toMatchObject({ status: 'uploading', progress: 0.4 });
      batch.set([item('uploading', 0.9)]);
      expect(h.views()[0]?.local?.progress).toBe(0.9);
      expect(h.calls.create).toHaveLength(0);

      const media = [{ key: 'moments/mem_me/a.jpg', contentType: 'image/jpeg', width: 800, height: 600, previewKey: 'moments/mem_me/a-p.jpg' }];
      batch.finish(media);
      await flush();
      expect(h.calls.create[0]?.args).toEqual([{ clientId: 'cli_publish', text: '春天', media, audience: 'friends', location: null }]);
      expect(h.views()[0]?.local?.status).toBe('sending');

      h.fail('create', 0, apiError(500, 'server_error', '服务器出错，请稍后再试'));
      await flush();
      expect(h.views()[0]?.local).toMatchObject({ status: 'failed', failure: '服务器出错，请稍后再试' });

      h.store.getState().retryPost('cli_publish');
      expect(batch.retry).toHaveBeenCalledTimes(1);
      batch.finish(media);
      await flush();
      expect((h.calls.create[1]?.args[0] as { clientId: string }).clientId).toBe('cli_publish');
      const server = post(2, { author: ME, clientId: 'cli_publish', canDelete: true, media: [{ key: 'moments/mem_me/a.jpg', contentType: 'image/jpeg', kind: 'image', width: 800, height: 600, previewKey: 'moments/mem_me/a-p.jpg', durationMs: null }] });
      h.answer('create', 1, { post: server, mediaToken: 'tok' });
      await flush();
      const card = h.views()[0];
      expect(card).toMatchObject({ key: localPostKey('cli_publish'), local: null });
      expect(card?.post.id).toBe('p2');
      expect(card?.localMedia?.[0]?.previewUrl).toBe('blob:preview');
      expect(batch.release).not.toHaveBeenCalled();
      h.store.getState().releaseLocalMedia('p2');
      expect(batch.release).toHaveBeenCalledTimes(1);
      expect(h.views()[0]?.localMedia).toBeNull();
    });

    const serverMedia = [{ key: 'moments/mem_me/a.jpg', contentType: 'image/jpeg', width: 800, height: 600, previewKey: 'moments/mem_me/a-p.jpg' }];

    function serverPost(clientId: string): MomentPost {
      return post(2, {
        author: ME,
        clientId,
        canDelete: true,
        media: [{ key: 'moments/mem_me/a.jpg', contentType: 'image/jpeg', kind: 'image', width: 800, height: 600, previewKey: 'moments/mem_me/a-p.jpg', durationMs: null }],
      });
    }

    /** Publishes one photo and has the server confirm it as p2. */
    /** 发表一张照片，并让服务器确认为 p2。 */
    async function publishPhoto(h: ReturnType<typeof harness>, clientId: string, beforeConfirm?: () => void) {
      const batch = fakeBatch([item('done', 1)]);
      h.store.getState().publish({ clientId, text: '', audience: 'friends', location: null, uploads: batch });
      beforeConfirm?.();
      batch.finish(serverMedia);
      await flush();
      h.answer('create', h.calls.create.length - 1, { post: serverPost(clientId), mediaToken: 'tok' });
      await flush();
      return batch;
    }

    it('keeps the local copies while a player or viewer holds the post, and releases them when the last one closes', async () => {
      const h = harness();
      await openHome(h, []);
      let player: () => void = () => undefined;
      // The player opened while the post was still sending, by its local id.
      // 播放器在动态仍在发送时打开，用的是本地 id。
      const batch = await publishPhoto(h, 'cli_pinned', () => {
        player = h.store.getState().pinLocalMedia(localPostKey('cli_pinned'));
      });
      const viewer = h.store.getState().pinLocalMedia('p2');
      h.store.getState().releaseLocalMedia('p2');
      await vi.advanceTimersByTimeAsync(LOCAL_MEDIA_RELEASE_MS);
      expect(batch.release).not.toHaveBeenCalled();
      expect(h.views()[0]?.localMedia?.[0]?.fileUrl).toBe('blob:file');

      player();
      player();
      expect(batch.release).not.toHaveBeenCalled();
      viewer();
      expect(batch.release).toHaveBeenCalledTimes(1);
      expect(h.views()[0]?.localMedia).toBeNull();
      viewer();
      expect(batch.release).toHaveBeenCalledTimes(1);
    });

    it('releases the uploads at once when a post published from the own album is confirmed', async () => {
      const h = harness();
      const album = albumFeedKey(ME.id);
      h.store.getState().open(album);
      h.answer('album', 0, { member: { ...ME, coverKey: null, headline: null }, posts: [], nextCursor: null, mediaToken: 'tok', clubOnly: false });
      await flush();
      const batch = await publishPhoto(h, 'cli_album');
      expect(h.store.getState().lists[album]?.ids).toEqual(['p2']);
      expect(batch.release).toHaveBeenCalledTimes(1);
      expect(h.store.getState().localMedia).toEqual({});
    });

    it('lets the local copies go after a while when no card loads the server previews', async () => {
      const h = harness();
      await openHome(h, []);
      const batch = await publishPhoto(h, 'cli_unseen');
      expect(h.views()[0]?.localMedia).not.toBeNull();
      await vi.advanceTimersByTimeAsync(LOCAL_MEDIA_RELEASE_MS - 1);
      expect(batch.release).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(batch.release).toHaveBeenCalledTimes(1);
      expect(h.views()[0]?.localMedia).toBeNull();
    });

    it('waits offline before sending and sends when the network returns', async () => {
      const h = harness();
      await openHome(h, []);
      h.goOffline();
      h.store.getState().publish({ clientId: 'cli_textonly', text: '只发文字', audience: 'club', location: '图书馆', uploads: null });
      await flush();
      expect(h.views()[0]?.local?.status).toBe('waiting');
      h.goOnline();
      await flush();
      expect(h.calls.create[0]?.args).toEqual([{ clientId: 'cli_textonly', text: '只发文字', audience: 'club', location: '图书馆' }]);
    });

    it('releases the uploads of a discarded post', async () => {
      const h = harness();
      await openHome(h, []);
      const batch = fakeBatch([item('failed', 0)]);
      h.store.getState().publish({ clientId: 'cli_discard', text: '', audience: 'friends', location: null, uploads: batch });
      batch.failUpload(new TypeError('Network request failed'));
      await flush();
      expect(h.views()[0]?.local?.status).toBe('failed');
      h.store.getState().discardPost('cli_discard');
      expect(h.views()).toEqual([]);
      expect(batch.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleting posts', () => {
    it('fades the post, takes it out, and puts it back at its place when the server refuses', async () => {
      const h = harness();
      await openHome(h, [post(3), post(2), post(1)]);
      const refused = h.store.getState().deletePost('p2');
      expect(h.views().find((v) => v.post.id === 'p2')?.deleting).toBe(true);
      await vi.advanceTimersByTimeAsync(DELETE_FADE_MS);
      expect(h.store.getState().lists.home?.ids).toEqual(['p3', 'p1']);
      h.fail('remove', 0, apiError(500, 'server_error'));
      expect(await refused).toBe(false);
      expect(h.store.getState().lists.home?.ids).toEqual(['p3', 'p2', 'p1']);
      expect(h.views().find((v) => v.post.id === 'p2')?.deleting).toBe(false);

      const accepted = h.store.getState().deletePost('p2');
      h.answer('remove', 1, { ok: true });
      expect(await accepted).toBe(true);
      expect(h.store.getState().lists.home?.ids).toEqual(['p3', 'p2', 'p1']);
      await vi.advanceTimersByTimeAsync(DELETE_FADE_MS);
      expect(h.store.getState().lists.home?.ids).toEqual(['p3', 'p1']);
      expect(h.store.getState().posts.p2).toBeUndefined();
    });
  });

  describe('lists', () => {
    it('shows the cached page at once, then page 1, and pages on from there', async () => {
      const h = harness({ cached: { posts: [post(1)], mediaToken: 'old', savedAt: Date.now() } });
      h.store.getState().open(HOME_FEED);
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p1'], status: 'ready', fromCache: true, more: 'loading' });
      expect(h.store.getState().mediaToken).toBe('old');
      // Paging waits for page 1 instead of asking for a cursor it does not have.
      // 翻页等待第一页，而不是请求一个它没有的 cursor。
      void h.store.getState().loadMore(HOME_FEED);
      expect(h.calls.feed).toHaveLength(1);
      h.answer('feed', 0, page([post(3), post(2)], 'after-p2'));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p3', 'p2'], fromCache: false, more: 'idle', nextCursor: 'after-p2' });
      expect(h.store.getState().mediaToken).toBe('tok');
      expect(h.deps.setMediaToken).toHaveBeenCalledWith('tok');
      expect(h.deps.badge.markFeedSeen).toHaveBeenCalledWith(at(3));

      void h.store.getState().loadMore(HOME_FEED);
      expect(h.calls.feed[1]?.args).toEqual(['after-p2']);
      expect(h.store.getState().lists.home?.more).toBe('loading');
      h.answer('feed', 1, page([post(2), post(1)], null));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p3', 'p2', 'p1'], more: 'idle', nextCursor: null });

      await vi.advanceTimersByTimeAsync(1000);
      expect(h.deps.cache.write).toHaveBeenCalledWith('mem_me', expect.objectContaining({ mediaToken: 'tok' }));
      const written = vi.mocked(h.deps.cache.write).mock.calls.at(-1)?.[1];
      expect(written?.posts.map((p) => p.id)).toEqual(['p3', 'p2', 'p1']);
    });

    it('pages on when a quiet reload of page 1 moved the cursor while the next page was out', async () => {
      const h = harness();
      await openHome(h, [post(5), post(4)], 'after-p4');
      void h.store.getState().loadMore(HOME_FEED);
      expect(h.calls.feed[1]?.args).toEqual(['after-p4']);
      await vi.advanceTimersByTimeAsync(REOPEN_REFRESH_MS);
      h.store.getState().open(HOME_FEED);
      h.answer('feed', 2, page([post(6), post(5), post(4)], 'after-p4-new'));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p6', 'p5', 'p4'], nextCursor: 'after-p4-new', more: 'loading' });

      // The old page no longer follows the list: it is dropped, and paging is not stuck.
      // 旧的一页已接不上列表：丢弃它，翻页也不会卡住。
      h.answer('feed', 1, page([post(3), post(2)], 'after-p2'));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p6', 'p5', 'p4'], nextCursor: 'after-p4-new', more: 'idle' });
      void h.store.getState().loadMore(HOME_FEED);
      expect(h.calls.feed[3]?.args).toEqual(['after-p4-new']);
    });

    it('keeps cached content when page 1 fails, and retries page 1 from the footer', async () => {
      const h = harness({ cached: { posts: [post(1)], mediaToken: null, savedAt: Date.now() } });
      h.store.getState().open(HOME_FEED);
      h.fail('feed', 0, new TypeError('Network request failed'));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p1'], status: 'ready', fromCache: true, more: 'failed' });
      expect(h.store.getState().lists.home?.error).toBeTruthy();
      void h.store.getState().loadMore(HOME_FEED);
      expect(h.calls.feed[1]?.args).toEqual([null]);
    });

    it('shows an error with nothing cached, and does not fetch again a list that just loaded', async () => {
      const h = harness();
      h.store.getState().open(HOME_FEED);
      expect(h.store.getState().lists.home?.status).toBe('loading');
      h.fail('feed', 0, apiError(503, 'moments_unavailable', '好友动态正在升级，请稍后再试'));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ status: 'error', error: '好友动态正在升级，请稍后再试' });
      h.store.getState().open(HOME_FEED);
      h.answer('feed', 1, page([post(1)]));
      await flush();
      h.store.getState().open(HOME_FEED);
      expect(h.calls.feed).toHaveLength(2);
    });

    it('holds new posts behind the pill, then merges them on refresh with the badge and the seen time', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      void h.store.getState().fetchIncoming();
      h.answer('feed', 1, page([post(2), post(1)]));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p1'], incoming: ['p2'] });
      vi.mocked(h.deps.badge.markFeedSeen).mockClear();

      const refreshing = h.store.getState().refresh(HOME_FEED);
      expect(h.store.getState().lists.home?.refreshing).toBe(true);
      h.answer('feed', 2, page([post(2), post(1)]));
      await refreshing;
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p2', 'p1'], incoming: [], refreshing: false });
      expect(h.deps.badge.markFeedSeen).toHaveBeenCalledWith(at(2));
      expect(h.deps.badge.refresh).toHaveBeenCalledWith({ force: true });
    });

    it('merges what waited when the feed opens again at the top, and holds new posts when it reopens further down', async () => {
      const h = harness();
      await openHome(h, [post(1)]);
      void h.store.getState().fetchIncoming();
      h.answer('feed', 1, page([post(2), post(1)]));
      await flush();
      h.store.getState().saveScroll(HOME_FEED, 0);
      h.store.getState().open(HOME_FEED);
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p2', 'p1'], incoming: [] });

      h.store.getState().saveScroll(HOME_FEED, 900);
      await vi.advanceTimersByTimeAsync(60_000);
      h.store.getState().open(HOME_FEED);
      h.answer('feed', h.calls.feed.length - 1, page([post(3), post(2), post(1)]));
      await flush();
      expect(h.store.getState().lists.home).toMatchObject({ ids: ['p2', 'p1'], incoming: ['p3'], scrollY: 900 });
    });

    it('marks an unknown album unavailable', async () => {
      const h = harness();
      h.store.getState().open(albumFeedKey('mem_gone'));
      h.fail('album', 0, apiError(404, 'not_found'));
      await flush();
      expect(h.store.getState().lists[albumFeedKey('mem_gone')]?.status).toBe('unavailable');
    });

    it('drops answers after a reset and clears drafts and the device cache', async () => {
      const h = harness();
      h.store.getState().open(HOME_FEED);
      h.store.getState().reset();
      h.answer('feed', 0, page([post(1)]));
      await flush();
      expect(h.store.getState().lists).toEqual({});
      expect(h.store.getState().posts).toEqual({});
      expect(h.deps.clearDrafts).toHaveBeenCalledTimes(1);
      expect(h.deps.cache.clear).toHaveBeenCalledTimes(1);
    });
  });
});
