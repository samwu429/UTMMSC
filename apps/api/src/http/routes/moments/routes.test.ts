import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentAudience, MomentPost, Role } from '@utmmsc/shared';
import { encodeMomentCursor } from '../../../domain/moments/cursor';
import type { Env } from '../../../env';
import { listFriendIds } from '../../../infrastructure/d1/friends';
import { findMemberById, type MemberRow } from '../../../infrastructure/d1/members';
import {
  countCommentsSince,
  deleteMomentComment,
  findMomentComment,
  insertMomentComment,
  listMomentComments,
  setMomentLike,
  type MomentCommentRecord,
} from '../../../infrastructure/d1/moment-interactions';
import {
  latestCommentNoticeRecipients,
  listMomentNotices,
  loadCommentNoticeFacts,
  markMomentFeedSeen,
  markMomentNoticesRead,
  readMomentBadge,
} from '../../../infrastructure/d1/moment-notices';
import {
  countReportsSince,
  dismissMomentReports,
  findMomentReport,
  insertMomentReport,
  listMomentReports,
  removeMomentComment,
  removeMomentPost,
  restoreMomentPost,
  updateMomentRelation,
} from '../../../infrastructure/d1/moment-safety';
import {
  countMomentsSince,
  deleteMoment,
  findAlbumOwner,
  findMomentAccess,
  findMomentByClientId,
  findMomentPost,
  insertMoment,
  listAlbum,
  listHomeFeed,
  type MomentAccess,
} from '../../../infrastructure/d1/moments';
import { notifyMomentEvent } from '../../../infrastructure/push/moments';
import { createApp } from '../../app';
import { momentRoutes } from './index';

/** Members the stand-in session knows, by the id sent in x-member. */
/** 替身会话认识的成员，按 x-member 中的 id 查找。 */
const session = vi.hoisted(() => ({ members: new Map<string, unknown>() }));

vi.mock('../../middleware/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/session')>();
  const { unauthorized } = await import('../../errors');
  return {
    ...actual,
    requireSession: async (c: { req: { header(name: string): string | undefined }; set(key: string, value: unknown): void }, next: () => Promise<void>) => {
      const member = session.members.get(c.req.header('x-member') ?? '');
      if (!member) throw unauthorized();
      c.set('member', member);
      c.set('sessionId', 'session-1');
      await next();
    },
  };
});
vi.mock('../../../infrastructure/d1/moments');
vi.mock('../../../infrastructure/d1/moment-interactions');
vi.mock('../../../infrastructure/d1/moment-notices');
vi.mock('../../../infrastructure/d1/moment-safety');
vi.mock('../../../infrastructure/d1/friends');
vi.mock('../../../infrastructure/push/moments');
vi.mock('../../../infrastructure/d1/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../infrastructure/d1/members')>()),
  findMemberById: vi.fn(),
}));

/** Every route of the design's API table, as Hono lists them under /moments. */
/** 设计中接口表的每一个接口，按 Hono 在 /moments 下列出的写法。 */
const TABLE = [
  'GET /feed',
  'GET /members/:id',
  'GET /posts/:id',
  'GET /posts/:id/comments',
  'POST /posts',
  'DELETE /posts/:id',
  'POST /posts/:id/like',
  'POST /posts/:id/comments',
  'DELETE /comments/:id',
  'GET /notices',
  'POST /notices/read',
  'DELETE /notices',
  'GET /badge',
  'POST /seen',
  'GET /audience',
  'GET /blocks',
  'GET /blocks/:memberId',
  'PATCH /blocks/:memberId',
  'POST /reports',
  'GET /moderation/reports',
  'POST /moderation/reports/:id/resolve',
  'POST /moderation/posts/:id/remove',
  'POST /moderation/posts/:id/restore',
  'POST /moderation/comments/:id/remove',
  'POST /moderation/comments/:id/restore',
];

/** Handlers registered for real requests; middleware added with use() is listed as ALL. */
/** 为实际请求注册的处理器；use() 添加的中间件列为 ALL。 */
const handlers = momentRoutes.routes.filter((route) => route.method !== 'ALL');
const registered = [...new Set(handlers.map((route) => `${route.method} ${route.path}`))];

function patternOf(path: string): RegExp {
  const parts = path.split('/').map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return new RegExp(`^${parts.join('/')}$`);
}

const paramCount = (path: string) => path.split('/').filter((part) => part.startsWith(':')).length;

describe('moments routes table', () => {
  it('registers every route of the design and nothing else', () => {
    expect([...registered].sort()).toEqual([...TABLE].sort());
  });

  it('has no PUT, which CORS does not allow, and no bare /:id at the root', () => {
    expect(momentRoutes.routes.some((route) => route.method === 'PUT')).toBe(false);
    for (const route of handlers) expect(route.path).not.toMatch(/^\/:[^/]+$/);
  });

  it('never lets a parameter route shadow a more specific one', () => {
    const order = handlers.map((route) => `${route.method} ${route.path}`);
    for (const a of registered) {
      for (const b of registered) {
        if (a === b) continue;
        const [methodA, pathA = ''] = a.split(' ');
        const [methodB, pathB = ''] = b.split(' ');
        if (methodA !== methodB) continue;
        const sampleB = pathB.replace(/:[^/]+/g, 'x1');
        if (!patternOf(pathA).test(sampleB)) continue;
        // a can answer b's requests, so the more specific b must come first.
        // a 能匹配 b 的请求，因此更具体的 b 必须排在前面。
        expect(paramCount(pathB)).toBeLessThan(paramCount(pathA));
        expect(order.indexOf(b)).toBeLessThan(order.indexOf(a));
      }
    }
  });

  it('puts the session first, the moderator check before moderation, and a limiter before each handler', () => {
    expect(momentRoutes.routes[0]).toMatchObject({ method: 'ALL', path: '/*' });
    expect(momentRoutes.routes.some((route) => route.method === 'ALL' && route.path === '/moderation/*')).toBe(true);
    for (const route of TABLE) {
      expect(handlers.filter((handler) => `${handler.method} ${handler.path}` === route).length, route).toBeGreaterThanOrEqual(2);
    }
  });

  it('is mounted at /moments', () => {
    const paths = createApp().routes.map((route) => `${route.method} ${route.path}`);
    for (const route of TABLE) {
      const [method, path] = route.split(' ');
      expect(paths).toContain(`${method} /moments${path}`);
    }
  });
});

let seq = 0;

/** A signed-in member with a fresh id, so per-member limits never leak between tests. */
/** 一位使用新 id 的已登录成员，按成员的频率限制因此不会在测试之间相互影响。 */
function signIn(role: Role = 'student', over: Partial<MemberRow> = {}): MemberRow {
  seq += 1;
  const row = {
    id: `mem_${seq}`,
    email: `m${seq}@mail.utoronto.ca`,
    display_name: `成员${seq}`,
    status: 'active',
    role,
    acting_role: null,
    enrollment_status: 'student',
    graduation_year: 2026,
    avatar_key: null,
    cover_key: null,
    ...over,
  } as MemberRow;
  session.members.set(row.id, row);
  return row;
}

function accessOf(post: { authorId: string; audience?: MomentAudience; removed?: boolean; hidden?: boolean; authorRole?: Role; postId?: string }): MomentAccess {
  return {
    postId: post.postId ?? 'post_1',
    facts: {
      authorId: post.authorId,
      authorActive: true,
      audience: post.audience ?? 'club',
      removed: post.removed ?? false,
      hiddenFromViewer: post.hidden ?? false,
    },
    authorRole: post.authorRole ?? 'student',
    friends: false,
    createdAt: '2026-10-24T10:00:00.000Z',
  };
}

function commentOf(over: { id?: string; postId?: string; authorId: string; postAuthorId?: string; removed?: boolean; authorRole?: Role; replyToId?: string | null }): MomentCommentRecord {
  return {
    id: over.id ?? 'cmt_1',
    facts: { postId: over.postId ?? 'post_1', authorId: over.authorId, authorActive: true, replyToId: over.replyToId ?? null, removed: over.removed ?? false },
    authorRole: over.authorRole ?? 'student',
    postAuthorId: over.postAuthorId ?? 'author',
    replyToMemberId: over.replyToId ?? null,
    body: '早上好',
    clientId: 'client-earlier',
    createdAt: '2026-10-24T10:05:00.000Z',
  };
}

const deletedObjects: string[][] = [];
const env = {
  DB: {} as D1Database,
  SESSION_SECRET: 'test-secret',
  APP_BASE_URL: 'https://example.test/UTMMSC/',
  FILES: {
    delete: async (keys: string | string[]) => {
      deletedObjects.push(Array.isArray(keys) ? keys : [keys]);
    },
  },
} as unknown as Env;

/** One request, waiting for everything it handed to waitUntil before returning. */
/** 发出一个请求，并在返回前等待它交给 waitUntil 的全部任务完成。 */
async function send(member: MemberRow | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const headers: Record<string, string> = {};
  if (member) headers['x-member'] = member.id;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await momentRoutes.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
  await Promise.all(pending);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

const codeOf = (result: { json: Record<string, unknown> }) => (result.json.error as { code?: string } | undefined)?.code;
const POST = { id: 'post_1' } as MomentPost;
const CLIENT_ID = 'client-0001';

beforeEach(() => {
  vi.resetAllMocks();
  deletedObjects.length = 0;
  vi.mocked(listFriendIds).mockResolvedValue([]);
  vi.mocked(notifyMomentEvent).mockResolvedValue(undefined);
});

describe('session and schema', () => {
  it('answers 401 without a session', async () => {
    expect((await send(null, 'GET', '/feed')).status).toBe(401);
  });

  it('answers 503 moments_unavailable before migration 0016', async () => {
    vi.mocked(listHomeFeed).mockRejectedValue(new Error('D1_ERROR: no such table: post_likes: SQLITE_ERROR'));
    const result = await send(signIn(), 'GET', '/feed');
    expect(result.status).toBe(503);
    expect(result.json).toEqual({ error: { code: 'moments_unavailable', message: '好友动态正在升级，请稍后再试' } });
  });

  it('answers 503 through the mounted app too', async () => {
    vi.mocked(readMomentBadge).mockRejectedValue(new Error('D1_ERROR: no such table: moment_notices'));
    const member = signIn();
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
    const response = await createApp().request('/moments/badge', { headers: { 'x-member': member.id } }, env, ctx);
    expect(response.status).toBe(503);
  });
});

describe('reading', () => {
  it('reads the feed as the viewed role and encodes the next cursor', async () => {
    const member = signIn('superadmin', { acting_role: 'student' });
    const next = { at: '2026-10-24T09:00:00.000Z', id: 'post_9' };
    vi.mocked(listHomeFeed).mockResolvedValue({ posts: [POST], nextCursor: next });
    const result = await send(member, 'GET', '/feed');
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ posts: [POST], nextCursor: encodeMomentCursor(next) });
    expect(typeof result.json.mediaToken).toBe('string');
    expect(vi.mocked(listHomeFeed)).toHaveBeenCalledWith(env.DB, { id: member.id, role: 'student' }, null, 10);
  });

  it('passes a cursor through and refuses an unreadable one', async () => {
    const member = signIn();
    const cursor = { at: '2026-10-24T09:00:00.000Z', id: 'post_9' };
    vi.mocked(listHomeFeed).mockResolvedValue({ posts: [], nextCursor: null });
    expect((await send(member, 'GET', `/feed?cursor=${encodeMomentCursor(cursor)}`)).json.nextCursor).toBeNull();
    expect(vi.mocked(listHomeFeed).mock.calls[0]?.[2]).toEqual(cursor);
    const bad = await send(member, 'GET', '/feed?cursor=not*a*cursor');
    expect(bad.status).toBe(400);
    expect(codeOf(bad)).toBe('invalid_cursor');
    expect(vi.mocked(listHomeFeed)).toHaveBeenCalledTimes(1);
  });

  it('answers 404 for an unknown album and fills a known one', async () => {
    const member = signIn();
    vi.mocked(listAlbum).mockResolvedValue({ posts: [POST], nextCursor: null });
    vi.mocked(findAlbumOwner).mockResolvedValue(null);
    expect((await send(member, 'GET', '/members/nobody')).status).toBe(404);
    const owner = { id: 'author', displayName: '张三', avatarKey: null, coverKey: null, headline: null };
    vi.mocked(findAlbumOwner).mockResolvedValue({ owner, clubOnly: true });
    const result = await send(member, 'GET', '/members/author');
    expect(result.json).toMatchObject({ member: owner, posts: [POST], nextCursor: null, clubOnly: true });
  });

  it('gives the detail page up to 200 comments and hides what cannot be seen', async () => {
    const member = signIn();
    vi.mocked(findMomentPost).mockResolvedValue(POST);
    expect((await send(member, 'GET', '/posts/post_1')).json.post).toEqual(POST);
    expect(vi.mocked(findMomentPost).mock.calls[0]?.[3]).toBe(200);
    vi.mocked(findMomentPost).mockResolvedValue(null);
    const gone = await send(member, 'GET', '/posts/post_1');
    expect(gone.status).toBe(404);
    expect(codeOf(gone)).toBe('moment_unavailable');
  });

  it('pages comments only on a post the member may see', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'friends' }));
    expect(codeOf(await send(member, 'GET', '/posts/post_1/comments'))).toBe('moment_unavailable');
    expect(vi.mocked(listMomentComments)).not.toHaveBeenCalled();

    vi.mocked(listFriendIds).mockResolvedValue(['author']);
    vi.mocked(listMomentComments).mockResolvedValue({ comments: [], nextCursor: { at: '2026-10-24T10:00:00.000Z', id: 'cmt_50' } });
    const result = await send(member, 'GET', '/posts/post_1/comments');
    expect(result.json.nextCursor).toBe(encodeMomentCursor({ at: '2026-10-24T10:00:00.000Z', id: 'cmt_50' }));
    expect(vi.mocked(listMomentComments).mock.calls[0]?.[4]).toBe(50);
  });

  it('treats a post hidden from the member exactly like a missing one', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', hidden: true }));
    const hidden = await send(member, 'GET', '/posts/post_1/comments');
    vi.mocked(findMomentAccess).mockResolvedValue(null);
    const missing = await send(member, 'GET', '/posts/post_1/comments');
    expect(hidden).toEqual(missing);
  });
});

describe('publishing', () => {
  const body = { clientId: CLIENT_ID, text: '今天天气很好', audience: 'friends' };

  it('turns a refused body into its own 400', async () => {
    const result = await send(signIn(), 'POST', '/posts', { ...body, audience: 'everyone' });
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: { code: 'invalid_audience', message: '请选择谁可以看' } });
  });

  it('returns 201 for a new post', async () => {
    const member = signIn();
    vi.mocked(findMomentByClientId).mockResolvedValue(null);
    vi.mocked(countMomentsSince).mockResolvedValue(0);
    vi.mocked(insertMoment).mockResolvedValue({ status: 'created', post: POST });
    const result = await send(member, 'POST', '/posts', body);
    expect(result.status).toBe(201);
    expect(result.json.post).toEqual(POST);
    expect(vi.mocked(insertMoment).mock.calls[0]?.[2]).toEqual({ clientId: CLIENT_ID, text: '今天天气很好', media: [], audience: 'friends', location: null });
  });

  it('returns the first post with 200 on a repeated clientId, before counting the daily cap', async () => {
    vi.mocked(findMomentByClientId).mockResolvedValue(POST);
    const result = await send(signIn(), 'POST', '/posts', body);
    expect(result.status).toBe(200);
    expect(result.json.post).toEqual(POST);
    expect(vi.mocked(countMomentsSince)).not.toHaveBeenCalled();
    expect(vi.mocked(insertMoment)).not.toHaveBeenCalled();
  });

  it('returns 200 when a concurrent publish with the same clientId won the race', async () => {
    vi.mocked(findMomentByClientId).mockResolvedValue(null);
    vi.mocked(countMomentsSince).mockResolvedValue(0);
    vi.mocked(insertMoment).mockResolvedValue({ status: 'existing', post: POST });
    expect((await send(signIn(), 'POST', '/posts', body)).status).toBe(200);
  });

  it('refuses with 400 invalid_media when an upload expired before the post was stored', async () => {
    vi.mocked(findMomentByClientId).mockResolvedValue(null);
    vi.mocked(countMomentsSince).mockResolvedValue(0);
    vi.mocked(insertMoment).mockResolvedValue({ status: 'media_gone' });
    const result = await send(signIn(), 'POST', '/posts', body);
    expect(result.status).toBe(400);
    expect(result.json).toEqual({ error: { code: 'invalid_media', message: '有照片或视频无法使用，请重新选择' } });
  });

  it('stops at 30 posts in 24 hours', async () => {
    vi.mocked(findMomentByClientId).mockResolvedValue(null);
    vi.mocked(countMomentsSince).mockResolvedValue(30);
    const result = await send(signIn(), 'POST', '/posts', body);
    expect(result.status).toBe(429);
    expect(result.json).toEqual({ error: { code: 'daily_limit', message: '今天发得太多了，明天再来吧' } });
    const since = Date.parse(vi.mocked(countMomentsSince).mock.calls[0]?.[2] ?? '');
    expect(Math.abs(Date.now() - 24 * 60 * 60 * 1000 - since)).toBeLessThan(5000);
  });

  it('allows 8 publishes a minute per member', async () => {
    const member = signIn();
    vi.mocked(findMomentByClientId).mockResolvedValue(POST);
    for (let i = 0; i < 8; i += 1) expect((await send(member, 'POST', '/posts', body)).status).toBe(200);
    const refused = await send(member, 'POST', '/posts', body);
    expect(refused.status).toBe(429);
    expect(codeOf(refused)).toBe('rate_limited');
    expect((await send(signIn(), 'POST', '/posts', body)).status).toBe(200);
  });

  it('deletes only the author post and its files', async () => {
    const member = signIn();
    vi.mocked(deleteMoment).mockResolvedValue(null);
    expect(codeOf(await send(member, 'DELETE', '/posts/post_1'))).toBe('moment_unavailable');
    expect(deletedObjects).toEqual([]);
    vi.mocked(deleteMoment).mockResolvedValue(['moments/a/1.jpg', 'moments/a/1-preview.jpg']);
    expect((await send(member, 'DELETE', '/posts/post_1')).json).toEqual({ ok: true });
    expect(vi.mocked(deleteMoment).mock.calls[1]?.slice(1)).toEqual([member.id, 'post_1']);
    expect(deletedObjects).toEqual([['moments/a/1.jpg', 'moments/a/1-preview.jpg']]);
  });
});

describe('likes', () => {
  const likes = { likedByMe: true, likes: [], likeCount: 1 };

  it('answers 404 for a friends post of a non-friend and never writes', async () => {
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'friends' }));
    expect(codeOf(await send(signIn(), 'POST', '/posts/post_1/like', { liked: true }))).toBe('moment_unavailable');
    expect(vi.mocked(setMomentLike)).not.toHaveBeenCalled();
  });

  it('refuses the author on their own removed post with 409 moment_removed', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: member.id, removed: true }));
    const result = await send(member, 'POST', '/posts/post_1/like', { liked: true });
    expect(result.status).toBe(409);
    expect(codeOf(result)).toBe('moment_removed');
  });

  it('plans a like notice for the author only when someone else likes', async () => {
    const member = signIn();
    vi.mocked(setMomentLike).mockResolvedValue(likes);
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    expect((await send(member, 'POST', '/posts/post_1/like', { liked: true })).json).toEqual(likes);
    expect(vi.mocked(setMomentLike).mock.calls[0]?.slice(3)).toEqual([true, { recipientId: 'author', kind: 'like' }]);
    await send(member, 'POST', '/posts/post_1/like', { liked: false });
    expect(vi.mocked(setMomentLike).mock.calls[1]?.slice(3)).toEqual([false, null]);
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: member.id }));
    await send(member, 'POST', '/posts/post_1/like', { liked: true });
    expect(vi.mocked(setMomentLike).mock.calls[2]?.slice(3)).toEqual([true, null]);
    expect(vi.mocked(notifyMomentEvent)).not.toHaveBeenCalled();
  });

  it('needs a boolean and answers 404 when the post went away meanwhile', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    expect(codeOf(await send(member, 'POST', '/posts/post_1/like', { liked: 'yes' }))).toBe('invalid_like');
    vi.mocked(setMomentLike).mockResolvedValue(null);
    expect(codeOf(await send(member, 'POST', '/posts/post_1/like', { liked: true }))).toBe('moment_unavailable');
  });
});

describe('comments', () => {
  const stored = {
    id: 'cmt_new',
    postId: 'post_1',
    author: { id: 'x', displayName: 'x', avatarKey: null },
    replyTo: null,
    replyToCommentId: null,
    body: '早上好',
    createdAt: '2026-10-24T11:00:00.000Z',
    canDelete: true,
    canModerate: false,
  };

  function readyFor(postAuthor: string, audience: MomentAudience = 'club') {
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: postAuthor, audience }));
    vi.mocked(countCommentsSince).mockResolvedValue(0);
    vi.mocked(loadCommentNoticeFacts).mockResolvedValue({ replyTarget: null, participants: [] });
    vi.mocked(insertMomentComment).mockResolvedValue({ status: 'created', comment: stored, commentCount: 3 });
  }

  it('stores a plain comment with 201, tells the author and pushes after the response', async () => {
    const member = signIn();
    readyFor('author');
    const result = await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: '  早上\n好  ' });
    expect(result.status).toBe(201);
    expect(result.json).toEqual({ comment: stored, commentCount: 3 });
    const notices = [{ recipientId: 'author', kind: 'comment' }];
    expect(vi.mocked(insertMomentComment).mock.calls[0]?.[3]).toEqual({ clientId: CLIENT_ID, body: '早上 好', replyTo: null, notices });
    expect(vi.mocked(notifyMomentEvent)).toHaveBeenCalledWith(env, {
      type: 'comment',
      postId: 'post_1',
      commentId: 'cmt_new',
      actorName: member.display_name,
      text: '早上好',
      notices,
    });
  });

  it('answers a repeat with 200 and pushes nothing', async () => {
    readyFor('author');
    vi.mocked(insertMomentComment).mockResolvedValue({ status: 'existing', comment: stored, commentCount: 3 });
    expect((await send(signIn(), 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'hi' })).status).toBe(200);
    expect(vi.mocked(notifyMomentEvent)).not.toHaveBeenCalled();
  });

  it('maps a reused clientId to 409 and a vanished post to 404', async () => {
    readyFor('author');
    vi.mocked(insertMomentComment).mockResolvedValue({ status: 'conflict' });
    const conflict = await send(signIn(), 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'hi' });
    expect(conflict.status).toBe(409);
    expect(codeOf(conflict)).toBe('client_id_conflict');
    vi.mocked(insertMomentComment).mockResolvedValue({ status: 'post_gone' });
    expect(codeOf(await send(signIn(), 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'hi' }))).toBe('moment_unavailable');
  });

  it('takes the member answered from the stored comment and tells both people', async () => {
    const member = signIn();
    readyFor('author');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ id: 'cmt_c', authorId: 'carol' }));
    vi.mocked(loadCommentNoticeFacts).mockResolvedValue({
      replyTarget: { memberId: 'carol', lastAt: '2026-10-24T10:05:00.000Z', friendOfActor: false, friendOfReplyTo: false, friendOfAuthor: false, hiddenFrom: false },
      participants: [],
    });
    await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: '同意', replyToCommentId: 'cmt_c' });
    expect(vi.mocked(loadCommentNoticeFacts).mock.calls[0]?.[1]).toEqual({ postId: 'post_1', postAuthorId: 'author', actorId: member.id, replyToMemberId: 'carol' });
    expect(vi.mocked(insertMomentComment).mock.calls[0]?.[3]).toMatchObject({
      replyTo: { commentId: 'cmt_c', memberId: 'carol' },
      notices: [
        { recipientId: 'carol', kind: 'reply' },
        { recipientId: 'author', kind: 'comment' },
      ],
    });
  });

  it('stores an answer to one\'s own comment as a plain comment', async () => {
    const member = signIn();
    readyFor('author');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: member.id }));
    await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: '补充', replyToCommentId: 'cmt_1' });
    expect(vi.mocked(insertMomentComment).mock.calls[0]?.[3]).toMatchObject({ replyTo: null });
  });

  it('refuses replies to a missing comment, one on another post, and one the member cannot see', async () => {
    const member = signIn();
    readyFor('author', 'friends');
    vi.mocked(listFriendIds).mockResolvedValue(['author']);
    const reply = (id: string) => send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: '嗯', replyToCommentId: id });

    vi.mocked(findMomentComment).mockResolvedValue(null);
    expect(codeOf(await reply('cmt_x'))).toBe('reply_unavailable');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ postId: 'post_2', authorId: 'author' }));
    expect(codeOf(await reply('cmt_1'))).toBe('reply_unavailable');
    // A stranger's comment on a friends post is invisible to the member, so it cannot be answered.
    // 好友动态上陌生人的评论对成员不可见，因此不能回复。
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'stranger' }));
    expect(codeOf(await reply('cmt_1'))).toBe('reply_unavailable');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'author', removed: true }));
    expect(codeOf(await reply('cmt_1'))).toBe('reply_unavailable');
    expect(vi.mocked(insertMomentComment)).not.toHaveBeenCalled();

    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'author' }));
    expect((await reply('cmt_1')).status).toBe(201);
  });

  it('refuses a removed post, an invisible post and the 301st comment of the day', async () => {
    const member = signIn();
    readyFor(member.id);
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: member.id, removed: true }));
    expect(codeOf(await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'a' }))).toBe('moment_removed');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'private' }));
    expect(codeOf(await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'a' }))).toBe('moment_unavailable');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    vi.mocked(countCommentsSince).mockResolvedValue(300);
    expect(codeOf(await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'a' }))).toBe('daily_limit');
    expect(codeOf(await send(member, 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: '   ' }))).toBe('empty_comment');
  });

  it('lets the comment author and the post author delete, and replaces the pushes that showed it', async () => {
    const member = signIn();
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'someone', postAuthorId: 'author' }));
    expect(codeOf(await send(member, 'DELETE', '/comments/cmt_1'))).toBe('comment_unavailable');
    expect(vi.mocked(deleteMomentComment)).not.toHaveBeenCalled();

    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'someone', postAuthorId: member.id }));
    vi.mocked(latestCommentNoticeRecipients).mockResolvedValue([member.id]);
    vi.mocked(deleteMomentComment).mockResolvedValue(true);
    expect((await send(member, 'DELETE', '/comments/cmt_1')).json).toEqual({ ok: true });
    expect(vi.mocked(notifyMomentEvent)).toHaveBeenCalledWith(env, { type: 'recall', postId: 'post_1', memberIds: [member.id] });

    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: member.id, postAuthorId: 'author' }));
    vi.mocked(latestCommentNoticeRecipients).mockResolvedValue([]);
    expect((await send(member, 'DELETE', '/comments/cmt_1')).status).toBe(200);
    expect(vi.mocked(notifyMomentEvent)).toHaveBeenCalledTimes(1);

    vi.mocked(deleteMomentComment).mockResolvedValue(false);
    expect(codeOf(await send(member, 'DELETE', '/comments/cmt_1'))).toBe('comment_unavailable');
  });

  it('keeps answering when a push fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    readyFor('author');
    vi.mocked(notifyMomentEvent).mockRejectedValue(new Error('push down'));
    expect((await send(signIn(), 'POST', '/posts/post_1/comments', { clientId: CLIENT_ID, text: 'hi' })).status).toBe(201);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('notices and the badge', () => {
  it('lists unread notices only with ?unread=1', async () => {
    const member = signIn();
    vi.mocked(listMomentNotices).mockResolvedValue({ notices: [], nextCursor: null, unread: 4 });
    expect((await send(member, 'GET', '/notices?unread=1')).json).toMatchObject({ notices: [], nextCursor: null, unread: 4 });
    expect(vi.mocked(listMomentNotices).mock.calls[0]?.[2]).toEqual({ cursor: null, unreadOnly: true, limit: 30 });
    await send(member, 'GET', '/notices');
    expect(vi.mocked(listMomentNotices).mock.calls[1]?.[2]).toMatchObject({ unreadOnly: false });
  });

  it('marks notices read up to a time and reports what stays unread', async () => {
    const member = signIn();
    vi.mocked(markMomentNoticesRead).mockResolvedValue(1);
    expect(codeOf(await send(member, 'POST', '/notices/read', { upTo: 'yesterday' }))).toBe('invalid_time');
    expect((await send(member, 'POST', '/notices/read', { upTo: '2026-10-24T10:00:00Z' })).json).toEqual({ unread: 1 });
    expect(vi.mocked(markMomentNoticesRead)).toHaveBeenCalledWith(env.DB, member.id, '2026-10-24T10:00:00.000Z');
  });

  it('never stores a seen time ahead of the server clock', async () => {
    const member = signIn();
    await send(member, 'POST', '/seen', { upTo: '2026-01-02T10:00:00.000Z' });
    expect(vi.mocked(markMomentFeedSeen).mock.calls[0]?.[2]).toBe('2026-01-02T10:00:00.000Z');
    await send(member, 'POST', '/seen', { upTo: '2999-01-01T00:00:00.000Z' });
    const stored = vi.mocked(markMomentFeedSeen).mock.calls[1]?.[2] ?? '';
    expect(Date.parse(stored)).toBeLessThanOrEqual(Date.now());
  });

  it('reads the badge as the viewed role', async () => {
    const member = signIn('superadmin', { acting_role: 'head_events' });
    const badge = { unread: 2, latestActor: null, newPosts: 0, latestAuthor: null };
    vi.mocked(readMomentBadge).mockResolvedValue(badge);
    expect((await send(member, 'GET', '/badge')).json).toEqual(badge);
    expect(vi.mocked(readMomentBadge)).toHaveBeenCalledWith(env.DB, { id: member.id, role: 'head_events' });
  });
});

describe('blocks', () => {
  it('refuses the member themselves, unknown members and an empty patch', async () => {
    const member = signIn();
    expect(codeOf(await send(member, 'PATCH', `/blocks/${member.id}`, { hideFrom: true }))).toBe('self_relation');
    vi.mocked(findMemberById).mockResolvedValue(null);
    expect((await send(member, 'PATCH', '/blocks/ghost', { hideFrom: true })).status).toBe(404);
    expect(codeOf(await send(member, 'PATCH', '/blocks/ghost', {}))).toBe('invalid_relation');
    expect(vi.mocked(updateMomentRelation)).not.toHaveBeenCalled();
  });

  it('changes only the fields sent', async () => {
    const member = signIn();
    const other = signIn();
    vi.mocked(findMemberById).mockResolvedValue(other);
    vi.mocked(updateMomentRelation).mockResolvedValue({ hideFrom: false, mute: true });
    expect((await send(member, 'PATCH', `/blocks/${other.id}`, { mute: true })).json).toEqual({ hideFrom: false, mute: true });
    expect(vi.mocked(updateMomentRelation)).toHaveBeenCalledWith(env.DB, member.id, other.id, { mute: true });
  });
});

describe('reports', () => {
  it('reports a visible post of someone else', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    vi.mocked(countReportsSince).mockResolvedValue(0);
    expect((await send(member, 'POST', '/reports', { postId: 'post_1', reason: 'spam', note: '  广告  ' })).json).toEqual({ ok: true });
    expect(vi.mocked(insertMomentReport)).toHaveBeenCalledWith(env.DB, {
      reporterId: member.id,
      postId: 'post_1',
      commentId: null,
      targetMemberId: 'author',
      reason: 'spam',
      note: '广告',
    });
  });

  it('targets the comment author for a comment report', async () => {
    const member = signIn();
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: member.id }));
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'troll', postAuthorId: member.id }));
    vi.mocked(countReportsSince).mockResolvedValue(0);
    await send(member, 'POST', '/reports', { postId: 'post_1', commentId: 'cmt_1', reason: 'harassment' });
    expect(vi.mocked(insertMomentReport).mock.calls[0]?.[1]).toMatchObject({ commentId: 'cmt_1', targetMemberId: 'troll' });
  });

  it('refuses one\'s own content, invisible content and the 21st report of the day', async () => {
    const member = signIn();
    vi.mocked(countReportsSince).mockResolvedValue(0);
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: member.id }));
    expect(codeOf(await send(member, 'POST', '/reports', { postId: 'post_1', reason: 'spam' }))).toBe('self_report');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', hidden: true }));
    expect(codeOf(await send(member, 'POST', '/reports', { postId: 'post_1', reason: 'spam' }))).toBe('moment_unavailable');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'friends' }));
    vi.mocked(listFriendIds).mockResolvedValue(['author']);
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'stranger' }));
    expect(codeOf(await send(member, 'POST', '/reports', { postId: 'post_1', commentId: 'cmt_1', reason: 'spam' }))).toBe('comment_unavailable');
    vi.mocked(countReportsSince).mockResolvedValue(20);
    expect(codeOf(await send(member, 'POST', '/reports', { postId: 'post_1', reason: 'spam' }))).toBe('daily_limit');
    expect(codeOf(await send(member, 'POST', '/reports', { postId: 'post_1', reason: 'boring' }))).toBe('invalid_report_reason');
    expect(vi.mocked(insertMomentReport)).not.toHaveBeenCalled();
  });
});

describe('moderation', () => {
  it('is closed to members without chat.moderate', async () => {
    const result = await send(signIn('head_events'), 'GET', '/moderation/reports');
    expect(result.status).toBe(403);
    expect(codeOf(result)).toBe('forbidden');
  });

  it('lists one status of the queue and refuses an unknown one', async () => {
    const moderator = signIn('president');
    vi.mocked(listMomentReports).mockResolvedValue({ reports: [], nextCursor: null });
    expect((await send(moderator, 'GET', '/moderation/reports')).status).toBe(200);
    expect(vi.mocked(listMomentReports).mock.calls[0]?.[2]).toEqual({ status: 'open', cursor: null, limit: 30 });
    await send(moderator, 'GET', '/moderation/reports?status=dismissed');
    expect(vi.mocked(listMomentReports).mock.calls[1]?.[2]).toMatchObject({ status: 'dismissed' });
    expect(codeOf(await send(moderator, 'GET', '/moderation/reports?status=all'))).toBe('invalid_status');
  });

  it('removes a visible post of a lower tier and tells its author', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', authorRole: 'student' }));
    vi.mocked(removeMomentPost).mockResolvedValue({ authorId: 'author' });
    expect((await send(moderator, 'POST', '/moderation/posts/post_1/remove', { reason: '广告' })).json).toEqual({ ok: true });
    expect(vi.mocked(removeMomentPost)).toHaveBeenCalledWith(env.DB, moderator.id, 'post_1', '广告');
    expect(vi.mocked(notifyMomentEvent)).toHaveBeenCalledWith(env, { type: 'removed', postId: 'post_1', target: 'post', memberId: 'author' });
  });

  it('refuses peers, the moderator\'s own post, posts out of sight and a missing reason', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'vp', authorRole: 'vp_finance' }));
    const peer = await send(moderator, 'POST', '/moderation/posts/post_1/remove', { reason: 'x' });
    expect(peer.status).toBe(403);
    expect(peer.json).toEqual({ error: { code: 'outranked', message: '不能处理职位不低于你的成员的内容' } });
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: moderator.id, authorRole: 'president' }));
    expect(codeOf(await send(moderator, 'POST', '/moderation/posts/post_1/remove', { reason: 'x' }))).toBe('outranked');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'friends' }));
    expect(codeOf(await send(moderator, 'POST', '/moderation/posts/post_1/remove', { reason: 'x' }))).toBe('moment_unavailable');
    expect(codeOf(await send(moderator, 'POST', '/moderation/posts/post_1/remove', { reason: '  ' }))).toBe('missing_moderation_reason');
    expect(vi.mocked(removeMomentPost)).not.toHaveBeenCalled();
  });

  it('lets the system admin act on anyone else', async () => {
    const admin = signIn('superadmin');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'boss', authorRole: 'president' }));
    vi.mocked(removeMomentPost).mockResolvedValue({ authorId: 'boss' });
    expect((await send(admin, 'POST', '/moderation/posts/post_1/remove', { reason: 'x' })).status).toBe(200);
  });

  it('removes a visible comment, telling its author and replacing pushes that showed it', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'troll' }));
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    vi.mocked(removeMomentComment).mockResolvedValue({ postId: 'post_1', authorId: 'troll', recallIds: ['author'] });
    expect((await send(moderator, 'POST', '/moderation/comments/cmt_1/remove', { reason: '辱骂' })).status).toBe(200);
    expect(vi.mocked(notifyMomentEvent).mock.calls.map((call) => call[1])).toEqual([
      { type: 'removed', postId: 'post_1', target: 'comment', memberId: 'troll' },
      { type: 'recall', postId: 'post_1', memberIds: ['author'] },
    ]);
  });

  it('refuses a comment the moderator cannot see', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'troll', removed: true }));
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author' }));
    expect(codeOf(await send(moderator, 'POST', '/moderation/comments/cmt_1/remove', { reason: 'x' }))).toBe('comment_unavailable');
    expect(vi.mocked(removeMomentComment)).not.toHaveBeenCalled();
  });

  it('resolves a report by dismissing or removing, under the tier rule', async () => {
    const moderator = signIn('president');
    const report = { id: 'rpt_1', postId: 'post_1', commentId: null, targetMemberId: 'author', targetRole: 'student' as Role, status: 'open' as const };
    vi.mocked(findMomentReport).mockResolvedValue(report);
    expect((await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'dismiss' })).json).toEqual({ ok: true });
    expect(vi.mocked(dismissMomentReports)).toHaveBeenCalledWith(env.DB, moderator.id, { postId: 'post_1', commentId: null });

    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'private' }));
    vi.mocked(removeMomentPost).mockResolvedValue({ authorId: 'author' });
    expect((await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'remove', reason: '违规' })).status).toBe(200);
    expect(vi.mocked(removeMomentPost)).toHaveBeenCalledWith(env.DB, moderator.id, 'post_1', '违规');

    vi.mocked(findMomentReport).mockResolvedValue({ ...report, targetRole: 'vp_audit' });
    expect(codeOf(await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'dismiss' }))).toBe('outranked');
    vi.mocked(findMomentReport).mockResolvedValue(null);
    expect(codeOf(await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'dismiss' }))).toBe('report_unavailable');
    expect(codeOf(await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'ban' }))).toBe('invalid_resolve_action');
  });

  it('does not remove content twice when resolving a report', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentReport).mockResolvedValue({ id: 'rpt_1', postId: 'post_1', commentId: 'cmt_1', targetMemberId: 'troll', targetRole: 'student', status: 'removed' });
    vi.mocked(findMomentComment).mockResolvedValue(commentOf({ authorId: 'troll', removed: true }));
    expect((await send(moderator, 'POST', '/moderation/reports/rpt_1/resolve', { action: 'remove', reason: 'x' })).status).toBe(200);
    expect(vi.mocked(removeMomentComment)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyMomentEvent)).not.toHaveBeenCalled();
  });

  it('restores under the tier rule without needing sight of the post', async () => {
    const moderator = signIn('president');
    vi.mocked(findMomentAccess).mockResolvedValue(accessOf({ authorId: 'author', audience: 'friends', removed: true }));
    vi.mocked(restoreMomentPost).mockResolvedValue(true);
    expect((await send(moderator, 'POST', '/moderation/posts/post_1/restore')).json).toEqual({ ok: true });
    expect(vi.mocked(restoreMomentPost)).toHaveBeenCalledWith(env.DB, moderator.id, 'post_1');
    vi.mocked(findMomentAccess).mockResolvedValue(null);
    expect(codeOf(await send(moderator, 'POST', '/moderation/posts/post_1/restore'))).toBe('moment_unavailable');
  });
});
