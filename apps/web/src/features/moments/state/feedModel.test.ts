import { describe, expect, it } from 'vitest';
import type { MomentComment, MomentLikeResponse, MomentPerson, MomentPost } from '@utmmsc/shared';
import {
  HOME_FEED,
  albumFeedKey,
  initialFeedState,
  localPostKey,
  momentViewKey,
  postFeedKey,
  type FeedKey,
  type FeedState,
  type LocalComment,
  type UploadBatch,
  type UploadItem,
} from '../model';
import {
  LIKE_RETRIES,
  addLocalPost,
  addPendingComment,
  appendCommentPage,
  appendPage,
  applyFirstPage,
  buildLocalPost,
  confirmComment,
  confirmLocalPost,
  createViewMemo,
  effectiveLike,
  hideComment,
  hidePost,
  holdIncoming,
  keepConfirmedActivity,
  likeFailed,
  likeSettled,
  likeStarted,
  mergeIncomingPosts,
  mergeServerPost,
  newestShown,
  removePost,
  restoreHiddenComment,
  restoreHiddenPost,
  sameData,
  setExpandedIn,
  syncLocalUploads,
  tapLike,
  updatePendingComment,
  uploadProgress,
  wakeLikes,
} from './feedModel';

const ME: MomentPerson = { id: 'mem_me', displayName: '我', avatarKey: null };
const ZHANG: MomentPerson = { id: 'mem_zhang', displayName: '张三', avatarKey: null };

/** Posts are numbered so a higher number is newer. */
/** 动态按编号排列，编号越大越新。 */
function at(n: number): string {
  return new Date(Date.UTC(2026, 9, 24, 0, n)).toISOString();
}

function comment(id: string, n: number, extra: Partial<MomentComment> = {}): MomentComment {
  return {
    id,
    postId: 'p',
    author: ZHANG,
    replyTo: null,
    replyToCommentId: null,
    body: `评论 ${id}`,
    createdAt: at(n),
    canDelete: false,
    canModerate: false,
    ...extra,
  };
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

function withPosts(posts: MomentPost[], lists: Partial<Record<FeedKey, string[]>> = {}): FeedState {
  let state: FeedState = { ...initialFeedState(), me: ME, posts: Object.fromEntries(posts.map((p) => [p.id, p])) };
  for (const [key, ids] of Object.entries(lists) as [FeedKey, string[]][]) {
    state = applyFirstPage(state, key, { posts: ids.map((id) => state.posts[id] as MomentPost), nextCursor: null }, { mode: 'replace', now: 1 });
  }
  return state;
}

function ids(state: FeedState, key: FeedKey = HOME_FEED): string[] {
  return state.lists[key]?.ids ?? [];
}

describe('likes', () => {
  const liked = (likes: MomentPerson[]): MomentLikeResponse => ({ likedByMe: likes.some((p) => p.id === ME.id), likes, likeCount: likes.length });

  it('shows the last tap at once, with me added at the end or taken out', () => {
    const base = post(1, { likes: [ZHANG], likeCount: 1 });
    expect(effectiveLike(base, undefined, ME)).toEqual({ liked: false, likes: [ZHANG], likeCount: 1 });
    expect(effectiveLike(base, { desired: true, confirmed: false, inFlight: true, failures: 0, waiting: false }, ME)).toEqual({ liked: true, likes: [ZHANG, ME], likeCount: 2 });
    const mine = post(1, { likes: [ME, ZHANG], likeCount: 2, likedByMe: true });
    expect(effectiveLike(mine, { desired: false, confirmed: true, inFlight: true, failures: 0, waiting: false }, ME)).toEqual({ liked: false, likes: [ZHANG], likeCount: 1 });
  });

  it('lets the last of five quick taps win against a slow server with one request', () => {
    let state = withPosts([post(1)], { home: ['p1'] });
    const sent: boolean[] = [];
    for (let tap = 0; tap < 5; tap += 1) {
      const result = tapLike(state, 'p1');
      state = result.state;
      if (result.send) {
        sent.push(state.likes.p1?.desired as boolean);
        state = likeStarted(state, 'p1');
      }
    }
    expect(sent).toEqual([true]);
    const settled = likeSettled(state, 'p1', liked([ME]));
    expect(settled.resend).toBe(false);
    expect(settled.state.likes.p1).toBeUndefined();
    expect(settled.state.posts.p1).toMatchObject({ likedByMe: true, likeCount: 1, likes: [ME] });
  });

  it('sends once more when the last tap differs from the answer, so at most two requests', () => {
    let state = withPosts([post(1)], { home: ['p1'] });
    let requests = 0;
    for (let tap = 0; tap < 4; tap += 1) {
      const result = tapLike(state, 'p1');
      state = result.state;
      if (result.send) {
        requests += 1;
        state = likeStarted(state, 'p1');
      }
    }
    expect(state.likes.p1?.desired).toBe(false);
    const first = likeSettled(state, 'p1', liked([ZHANG, ME]));
    expect(first.resend).toBe(true);
    // The server's list goes in, and the card still shows the last tap.
    // 写入服务器的列表，卡片仍显示最后一次点击的结果。
    expect(first.state.posts.p1?.likes).toEqual([ZHANG, ME]);
    expect(effectiveLike(first.state.posts.p1 as MomentPost, first.state.likes.p1, ME)).toEqual({ liked: false, likes: [ZHANG], likeCount: 1 });
    requests += 1;
    const second = likeSettled(likeStarted(first.state, 'p1'), 'p1', liked([ZHANG]));
    expect(second.resend).toBe(false);
    expect(second.state.likes.p1).toBeUndefined();
    expect(requests).toBe(2);
  });

  it('needs no request when two taps cancel out before anything is sent', () => {
    const offline = { ...withPosts([post(1)], { home: ['p1'] }), online: false };
    const once = tapLike(offline, 'p1');
    expect(once).toMatchObject({ send: false });
    expect(once.state.likes.p1).toMatchObject({ desired: true, waiting: true });
    const twice = tapLike(once.state, 'p1');
    expect(twice.state.likes.p1).toBeUndefined();
  });

  it('retries twice, then reverts to what the server said', () => {
    let state = likeStarted(tapLike(withPosts([post(1)], { home: ['p1'] }), 'p1').state, 'p1');
    for (let attempt = 1; attempt <= LIKE_RETRIES; attempt += 1) {
      const failed = likeFailed(state, 'p1', false);
      expect(failed).toMatchObject({ retry: true, reverted: false });
      expect(failed.state.likes.p1?.failures).toBe(attempt);
      state = likeStarted(failed.state, 'p1');
    }
    const last = likeFailed(state, 'p1', false);
    expect(last).toMatchObject({ retry: false, reverted: true });
    expect(last.state.likes.p1).toBeUndefined();
    expect(effectiveLike(last.state.posts.p1 as MomentPost, undefined, ME).liked).toBe(false);
  });

  it('waits offline and goes out again when the network returns', () => {
    const state = likeStarted(tapLike(withPosts([post(1)], { home: ['p1'] }), 'p1').state, 'p1');
    const failed = likeFailed({ ...state, online: false }, 'p1', true);
    expect(failed.state.likes.p1).toMatchObject({ inFlight: false, waiting: true, failures: 0 });
    const woken = wakeLikes({ ...failed.state, online: true });
    expect(woken.send).toEqual(['p1']);
    expect(woken.state.likes.p1?.waiting).toBe(false);
  });
});

describe('comments', () => {
  function pending(clientId: string, extra: Partial<LocalComment> = {}): LocalComment {
    return { clientId, postId: 'p1', replyTo: null, body: '我的评论', createdAt: at(30), status: 'sending', failure: null, autoRetried: false, ...extra };
  }

  it('goes pending, then confirmed, keeping its key across the swap', () => {
    const memo = createViewMemo();
    let state = withPosts([post(1, { comments: [comment('c1', 10, { postId: 'p1' })], commentCount: 1 })], { home: ['p1'] });
    state = addPendingComment(state, pending('cli_00000001'));
    const before = memo.views(state, HOME_FEED)[0];
    expect(before?.comments.map((c) => [c.type, c.key])).toEqual([
      ['server', 'c1'],
      ['local', 'local:cli_00000001'],
    ]);

    const server = comment('c2', 31, { postId: 'p1', author: ME, clientId: 'cli_00000001', canDelete: true });
    state = confirmComment(state, 'p1', 'cli_00000001', { comment: server, commentCount: 2 });
    const after = memo.views(state, HOME_FEED)[0];
    expect(after?.comments.map((c) => [c.type, c.key])).toEqual([
      ['server', 'c1'],
      ['server', 'local:cli_00000001'],
    ]);
    expect(state.pendingComments.p1).toBeUndefined();
    expect(state.posts.p1?.commentCount).toBe(2);
  });

  it('marks a failed comment, and sends it again under the same clientId', () => {
    let state = addPendingComment(withPosts([post(1)], { home: ['p1'] }), pending('cli_00000002'));
    state = updatePendingComment(state, 'p1', 'cli_00000002', { status: 'failed', failure: '评论不能超过 300 字' });
    expect(state.pendingComments.p1?.[0]).toMatchObject({ clientId: 'cli_00000002', status: 'failed', failure: '评论不能超过 300 字' });
    state = updatePendingComment(state, 'p1', 'cli_00000002', { status: 'sending', failure: null });
    const server = comment('c9', 31, { postId: 'p1', author: ME, clientId: 'cli_00000002' });
    state = confirmComment(state, 'p1', 'cli_00000002', { comment: server, commentCount: 1 });
    expect(state.posts.p1?.comments.map((c) => c.clientId)).toEqual(['cli_00000002']);
  });

  it('shows a comment once when a reload brought it before the send answered', () => {
    const memo = createViewMemo();
    let state = addPendingComment(withPosts([post(1)], { home: ['p1'] }), pending('cli_00000003'));
    const reloaded = post(1, { comments: [comment('c5', 31, { postId: 'p1', author: ME, clientId: 'cli_00000003' })], commentCount: 1 });
    state = applyFirstPage(state, HOME_FEED, { posts: [reloaded], nextCursor: null }, { mode: 'reconcile', now: 2 });
    expect(memo.views(state, HOME_FEED)[0]?.comments.map((c) => c.type)).toEqual(['server']);
    state = confirmComment(state, 'p1', 'cli_00000003', { comment: reloaded.comments[0] as MomentComment, commentCount: 1 });
    expect(state.posts.p1?.comments).toHaveLength(1);
  });

  it('removes a comment at once and puts it back at the same index', () => {
    const comments = [comment('c1', 1), comment('c2', 2), comment('c3', 3)];
    let state = withPosts([post(1, { comments, commentCount: 3 })], { home: ['p1'] });
    state = hideComment(state, 'p1', 'c2');
    expect(state.posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(state.posts.p1?.commentCount).toBe(2);
    expect(state.deletedComments.c2).toMatchObject({ postId: 'p1', index: 1 });
    state = restoreHiddenComment(state, 'c2');
    expect(state.posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(state.posts.p1?.commentCount).toBe(3);
    expect(state.deletedComments.c2).toBeUndefined();
  });

  it('loads more comments in time order without repeating any', () => {
    let state = withPosts([post(1, { comments: [comment('c1', 1), comment('c2', 2)], commentCount: 4, commentsCursor: 'cur1' })], { home: ['p1'] });
    const memo = createViewMemo();
    expect(memo.views(state, HOME_FEED)[0]?.moreComments).toBe(2);
    state = addPendingComment(state, pending('cli_00000004'));
    state = confirmComment(state, 'p1', 'cli_00000004', { comment: comment('c9', 9, { clientId: 'cli_00000004', author: ME }), commentCount: 5 });
    state = appendCommentPage(state, 'p1', [comment('c2', 2), comment('c3', 3), comment('c4', 4)], null);
    expect(state.posts.p1?.comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c9']);
    expect(memo.views(state, HOME_FEED)[0]?.moreComments).toBe(0);
  });

  it('keeps comments loaded in place over a quiet reload of the same thread', () => {
    const loaded = post(1, { comments: [comment('c1', 1), comment('c2', 2), comment('c3', 3)], commentCount: 3, commentsCursor: null });
    const inline = post(1, { comments: [comment('c1', 1)], commentCount: 3, commentsCursor: 'cur' });
    expect(mergeServerPost(loaded, inline)).toBe(loaded);
    // A new comment changes the count, so the server's shorter list is taken and 展开 shows again.
    // 新评论改变了总数，因此采用服务器较短的列表，「展开」重新出现。
    const grown = post(1, { comments: [comment('c1', 1)], commentCount: 4, commentsCursor: 'cur' });
    expect(mergeServerPost(loaded, grown)).toBe(grown);
    expect(mergeServerPost(inline, { ...inline })).toBe(inline);
  });

  it('keeps a confirmed like and comment over a copy fetched before they were confirmed', () => {
    const mine = comment('c9', 9, { postId: 'p1', author: ME, clientId: 'cli_00000005' });
    const stored = post(1, { likes: [ME], likedByMe: true, likeCount: 1, comments: [comment('c1', 1), mine], commentCount: 2 });
    // The stale copy also brings an edit of the body, which is newer than nothing here and is taken.
    // 过时的副本还带来了正文的修改，本设备没有更新的内容，因此采用它。
    const stale = post(1, { body: '改过的正文', comments: [comment('c1', 1)], commentCount: 1, commentsCursor: null });
    const kept = keepConfirmedActivity(stale, stored);
    expect(kept).toMatchObject({ body: '改过的正文', likedByMe: true, likeCount: 1, likes: [ME], commentCount: 2 });
    expect(kept.comments.map((c) => c.id)).toEqual(['c1', 'c9']);
    // A copy that already has all of it comes back as it is.
    // 已经包含这些内容的副本原样返回。
    const fresh = { ...stored, body: '改过的正文' };
    expect(keepConfirmedActivity(fresh, stored)).toBe(fresh);
  });
});

describe('deleting posts', () => {
  it('takes a post out of every list and puts it back at the same places', () => {
    let state = withPosts([post(3), post(2), post(1)], { home: ['p3', 'p2', 'p1'], [albumFeedKey('mem_zhang')]: ['p3', 'p2'] });
    state = hidePost(state, 'p2');
    expect(ids(state)).toEqual(['p3', 'p1']);
    expect(ids(state, albumFeedKey('mem_zhang'))).toEqual(['p3']);
    expect(state.deletedPosts.p2?.positions).toEqual({ home: 1, [albumFeedKey('mem_zhang')]: 1 });
    state = restoreHiddenPost(state, 'p2');
    expect(ids(state)).toEqual(['p3', 'p2', 'p1']);
    expect(ids(state, albumFeedKey('mem_zhang'))).toEqual(['p3', 'p2']);
    expect(state.deletedPosts.p2).toBeUndefined();
  });

  it('forgets a post that is gone and marks its detail page unavailable', () => {
    let state = withPosts([post(2), post(1)], { home: ['p2', 'p1'], [postFeedKey('p1')]: ['p1'] });
    state = { ...state, likes: { p1: { desired: true, confirmed: false, inFlight: true, failures: 0, waiting: false } } };
    state = removePost(state, 'p1');
    expect(ids(state)).toEqual(['p2']);
    expect(state.lists[postFeedKey('p1')]?.status).toBe('unavailable');
    expect(state.posts.p1).toBeUndefined();
    expect(state.likes.p1).toBeUndefined();
  });
});

describe('pages', () => {
  it('appends the next page without repeating posts already shown', () => {
    let state = withPosts([post(5), post(4)], { home: ['p5', 'p4'] });
    state = appendPage(state, HOME_FEED, { posts: [post(4), post(3), post(2)], nextCursor: 'next' });
    expect(ids(state)).toEqual(['p5', 'p4', 'p3', 'p2']);
    expect(state.lists.home?.nextCursor).toBe('next');
  });

  it('reconciles a quiet reload: updates in place, drops what left page 1, keeps deeper pages', () => {
    let state = withPosts([post(9), post(8), post(7), post(3), post(2)], { home: ['p9', 'p8', 'p7'] });
    state = appendPage(state, HOME_FEED, { posts: [post(3), post(2)], nextCursor: 'after-p2' });
    const liked = post(9, { likeCount: 4 });
    // Page 1 now holds p10 (new), p9 (changed) and p7; p8 was deleted. p3 and p2 are below its range.
    // 第一页现在有 p10（新）、p9（有变化）和 p7；p8 已被删除。p3 和 p2 在它的范围之下。
    state = applyFirstPage(state, HOME_FEED, { posts: [post(10), liked, post(7)], nextCursor: 'after-p7' }, { mode: 'reconcile', now: 5 });
    expect(ids(state)).toEqual(['p10', 'p9', 'p7', 'p3', 'p2']);
    expect(state.posts.p9?.likeCount).toBe(4);
    expect(state.lists.home?.nextCursor).toBe('after-p2');
    expect(state.lists.home?.loadedAt).toBe(5);
  });

  it('replaces the list on pull to refresh and drops what waited', () => {
    let state = withPosts([post(3), post(2), post(1)], { home: ['p2', 'p1'] });
    state = holdIncoming(state, { posts: [post(3), post(2)], nextCursor: null });
    expect(state.lists.home?.incoming).toEqual(['p3']);
    state = applyFirstPage(state, HOME_FEED, { posts: [post(3), post(2)], nextCursor: 'c' }, { mode: 'replace', now: 9 });
    expect(ids(state)).toEqual(['p3', 'p2']);
    expect(state.lists.home?.incoming).toEqual([]);
    expect(state.lists.home?.nextCursor).toBe('c');
  });

  it('replaces cached content with page 1 whatever the mode', () => {
    let state = withPosts([post(5), post(4)], { home: ['p5', 'p4'] });
    state = { ...state, lists: { ...state.lists, home: { ...(state.lists.home as NonNullable<FeedState['lists']['home']>), fromCache: true, more: 'loading' } } };
    state = applyFirstPage(state, HOME_FEED, { posts: [post(6), post(5)], nextCursor: 'c' }, { mode: 'reconcile', now: 3 });
    expect(ids(state)).toEqual(['p6', 'p5']);
    expect(state.lists.home).toMatchObject({ fromCache: false, more: 'idle', nextCursor: 'c' });
  });
});

describe('incoming', () => {
  it('holds only posts newer than the top, without touching posts on screen', () => {
    let state = withPosts([post(5), post(4)], { home: ['p5', 'p4'] });
    const before = state.posts.p5;
    state = holdIncoming(state, { posts: [post(7), post(6), post(5, { likeCount: 9 }), post(4)], nextCursor: 'c' });
    expect(state.lists.home?.incoming).toEqual(['p7', 'p6']);
    expect(ids(state)).toEqual(['p5', 'p4']);
    expect(state.posts.p5).toBe(before);
    // The same answer again changes nothing.
    // 同样的结果再来一次，什么也不变。
    expect(holdIncoming(state, { posts: [post(7), post(6)], nextCursor: 'c' })).toBe(state);
  });

  it('holds new posts on a quiet reload while the reader is past the cover', () => {
    let state = withPosts([post(5), post(4)], { home: ['p5', 'p4'] });
    state = applyFirstPage(state, HOME_FEED, { posts: [post(6), post(5), post(4)], nextCursor: null }, { mode: 'reconcile', holdNew: true, now: 2 });
    expect(ids(state)).toEqual(['p5', 'p4']);
    expect(state.lists.home?.incoming).toEqual(['p6']);
    expect(newestShown(state, HOME_FEED)).toBe(at(5));
    state = mergeIncomingPosts(state);
    expect(ids(state)).toEqual(['p6', 'p5', 'p4']);
    expect(state.lists.home?.incoming).toEqual([]);
    expect(newestShown(state, HOME_FEED)).toBe(at(6));
    expect(mergeIncomingPosts(state)).toBe(state);
  });
});

describe('local posts', () => {
  function item(id: string, status: UploadItem['status'], progress: number): UploadItem {
    return {
      id,
      status,
      progress,
      local: { kind: 'image', contentType: 'image/jpeg', fileUrl: `blob:${id}`, previewUrl: `blob:${id}-p`, width: 1200, height: 900, durationMs: null },
      uploaded: status === 'done' ? { key: `moments/mem_me/${id}.jpg`, contentType: 'image/jpeg', width: 1200, height: 900 } : null,
      failure: null,
    };
  }

  const uploads = { id: 'batch' } as unknown as UploadBatch;

  it('shows the local post at the top of home and the own album, and swaps it for the server post under the same key', () => {
    const memo = createViewMemo();
    const items = [item('a', 'uploading', 0.5), item('b', 'queued', 0)];
    const request = { clientId: 'cli_publish01', text: '  今天天气很好  ', audience: 'club' as const, location: '多伦多', uploads };
    const local = buildLocalPost(request, ME, items, at(50));
    expect(local.post).toMatchObject({ id: localPostKey('cli_publish01'), body: '今天天气很好', clubWide: true, audience: 'club', canInteract: false });
    expect(local.state).toMatchObject({ status: 'uploading', progress: 0.25 });
    expect(local.post.media.map((m) => m.key)).toEqual(['local:a', 'local:b']);

    const album = albumFeedKey(ME.id);
    let state = withPosts([post(40)], { home: ['p40'], [album]: [] });
    state = addLocalPost(state, local);
    state = setExpandedIn(state, HOME_FEED, local.post.id, true);
    const homeBefore = memo.views(state, HOME_FEED);
    expect(homeBefore.map((v) => v.key)).toEqual([localPostKey('cli_publish01'), 'p40']);
    expect(homeBefore[0]?.localMedia?.map((m) => m.fileUrl)).toEqual(['blob:a', 'blob:b']);
    expect(memo.views(state, album).map((v) => v.key)).toEqual([localPostKey('cli_publish01')]);
    // Someone else's album never shows my local posts.
    // 别人的相册不会显示我的本地动态。
    expect(memo.views({ ...state, lists: { ...state.lists, [albumFeedKey('mem_zhang')]: state.lists[album] } }, albumFeedKey('mem_zhang'))).toHaveLength(0);

    state = syncLocalUploads(state, 'cli_publish01', [item('a', 'done', 1), item('b', 'done', 1)]);
    expect(state.localPosts[0]?.state.progress).toBe(1);

    const server = post(51, { id: 'p51', author: ME, clientId: 'cli_publish01', canDelete: true, media: [
      { key: 'moments/mem_me/a.jpg', contentType: 'image/jpeg', kind: 'image', width: 1200, height: 900, previewKey: 'moments/mem_me/a-p.jpg', durationMs: null },
      { key: 'moments/mem_me/b.jpg', contentType: 'image/jpeg', kind: 'image', width: 1200, height: 900, previewKey: 'moments/mem_me/b-p.jpg', durationMs: null },
    ] });
    state = confirmLocalPost(state, 'cli_publish01', server, [HOME_FEED, album]);
    expect(state.localPosts).toEqual([]);
    expect(ids(state)).toEqual(['p51', 'p40']);
    expect(ids(state, album)).toEqual(['p51']);
    const homeAfter = memo.views(state, HOME_FEED);
    expect(homeAfter[0]?.key).toBe(homeBefore[0]?.key);
    expect(momentViewKey(server)).toBe(localPostKey('cli_publish01'));
    expect(homeAfter[0]).toMatchObject({ local: null, expanded: true });
    expect(homeAfter[0]?.localMedia?.map((m) => m.fileUrl)).toEqual(['blob:a', 'blob:b']);
    expect(state.lists.home?.expanded).toEqual({ p51: true });
    // A viewer opened on the local id still finds the post.
    // 用本地 id 打开的查看器仍能找到这条动态。
    expect(memo.view(state, localPostKey('cli_publish01'))?.post.id).toBe('p51');
  });

  it('shows a local post once when page 1 already brought its server copy', () => {
    const memo = createViewMemo();
    const local = buildLocalPost({ clientId: 'cli_publish02', text: 'hi', audience: 'friends', location: null, uploads: null }, ME, [], at(50));
    expect(local.state).toMatchObject({ status: 'sending', progress: 1 });
    let state = addLocalPost(withPosts([post(40)], { home: ['p40'] }), local);
    state = applyFirstPage(state, HOME_FEED, { posts: [post(51, { author: ME, clientId: 'cli_publish02' }), post(40)], nextCursor: null }, { mode: 'replace', now: 2 });
    expect(memo.views(state, HOME_FEED).map((v) => v.post.id)).toEqual(['p51', 'p40']);
  });

  it('counts progress over files and previews', () => {
    expect(uploadProgress([])).toBe(1);
    expect(uploadProgress([item('a', 'done', 0.2), item('b', 'uploading', 0.5), item('c', 'failed', 3)])).toBeCloseTo(2.5 / 3);
  });
});

describe('views', () => {
  it('keeps the same array and cards until something in them changes', () => {
    const memo = createViewMemo();
    let state = withPosts([post(2), post(1)], { home: ['p2', 'p1'] });
    const first = memo.views(state, HOME_FEED);
    expect(memo.views(state, HOME_FEED)).toBe(first);
    expect(memo.views({ ...state, mediaToken: 'tok' }, HOME_FEED)).toBe(first);

    state = tapLike(state, 'p1').state;
    const second = memo.views(state, HOME_FEED);
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1]?.liked).toBe(true);
    expect(memo.views(state, postFeedKey('nothing'))).toEqual([]);
  });

  it('marks a deleting card and leaves out a hidden one', () => {
    const memo = createViewMemo();
    let state = withPosts([post(2), post(1)], { home: ['p2', 'p1'] });
    state = { ...state, deleting: { p1: true } };
    expect(memo.views(state, HOME_FEED).map((v) => [v.post.id, v.deleting])).toEqual([
      ['p2', false],
      ['p1', true],
    ]);
    state = hidePost(state, 'p1');
    expect(memo.views(state, HOME_FEED).map((v) => v.post.id)).toEqual(['p2']);
    expect(state.deleting.p1).toBeUndefined();
  });

  it('compares server data deeply', () => {
    expect(sameData(post(1), post(1))).toBe(true);
    expect(sameData(post(1), post(1, { likeCount: 1 }))).toBe(false);
    expect(sameData([1, { a: [2] }], [1, { a: [2] }])).toBe(true);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1], { 0: 1 })).toBe(false);
  });
});
