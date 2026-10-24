import { Hono } from 'hono';
import {
  MOMENT_COMMENT_PAGE,
  MOMENT_DETAIL_COMMENTS,
  MOMENT_PAGE_SIZE,
  type CreateMomentResponse,
  type MomentAlbumResponse,
  type MomentAudienceCounts,
  type MomentCommentsResponse,
  type MomentFeedResponse,
  type MomentPostResponse,
} from '@utmmsc/shared';
import { readCreateMoment } from '../../../domain/moments/input';
import { listMomentComments } from '../../../infrastructure/d1/moment-interactions';
import {
  countMomentAudience,
  countMomentsSince,
  deleteMoment,
  findAlbumOwner,
  findMomentByClientId,
  findMomentPost,
  insertMoment,
  listAlbum,
  listHomeFeed,
} from '../../../infrastructure/d1/moments';
import type { AppEnv } from '../../context';
import { notFound } from '../../errors';
import { memberRateLimit } from '../../middleware/rate-limit';
import { readJson } from '../../validation';
import {
  MINUTE,
  MOMENT_DAILY_POSTS,
  cursorOut,
  dailyLimit,
  dayAgo,
  deleteObjectsLater,
  mediaGone,
  mediaToken,
  momentUnavailable,
  readCursor,
  readInput,
  readerOf,
  requireVisiblePost,
} from './common';

/** Reading lists of posts, one post, its comments, and publishing or deleting a post. */
/** 读取动态列表、单条动态及其评论，以及发表或删除动态。 */
export const postRoutes = new Hono<AppEnv>();

postRoutes.get('/feed', memberRateLimit('moments:feed', 120, MINUTE), async (c) => {
  const cursor = readCursor(c.req.query('cursor'));
  const page = await listHomeFeed(c.env.DB, readerOf(c.get('member')), cursor, MOMENT_PAGE_SIZE);
  const response: MomentFeedResponse = { posts: page.posts, nextCursor: cursorOut(page.nextCursor), mediaToken: await mediaToken(c) };
  return c.json(response);
});

/** An album: unknown and inactive members are 404, and an album with nothing visible is just empty. */
/** 相册：成员不存在或已停用时返回 404；没有可见动态的相册只是为空。 */
postRoutes.get('/members/:id', memberRateLimit('moments:album', 120, MINUTE), async (c) => {
  const cursor = readCursor(c.req.query('cursor'));
  const reader = readerOf(c.get('member'));
  const memberId = c.req.param('id');
  const [owner, page] = await Promise.all([
    findAlbumOwner(c.env.DB, reader, memberId),
    listAlbum(c.env.DB, reader, memberId, cursor, MOMENT_PAGE_SIZE),
  ]);
  if (!owner) throw notFound('成员不存在');
  const response: MomentAlbumResponse = {
    member: owner.owner,
    posts: page.posts,
    nextCursor: cursorOut(page.nextCursor),
    mediaToken: await mediaToken(c),
    clubOnly: owner.clubOnly,
  };
  return c.json(response);
});

postRoutes.get('/posts/:id', memberRateLimit('moments:post', 120, MINUTE), async (c) => {
  const post = await findMomentPost(c.env.DB, readerOf(c.get('member')), c.req.param('id'), MOMENT_DETAIL_COMMENTS);
  if (!post) throw momentUnavailable();
  const response: MomentPostResponse = { post, mediaToken: await mediaToken(c) };
  return c.json(response);
});

postRoutes.get('/posts/:id/comments', memberRateLimit('moments:comments', 120, MINUTE), async (c) => {
  const cursor = readCursor(c.req.query('cursor'));
  const member = c.get('member');
  const { access } = await requireVisiblePost(c.env.DB, member.id, c.req.param('id'));
  const page = await listMomentComments(c.env.DB, readerOf(member), access, cursor, MOMENT_COMMENT_PAGE);
  const response: MomentCommentsResponse = { comments: page.comments, nextCursor: cursorOut(page.nextCursor) };
  return c.json(response);
});

/**
 * Publishing. A clientId already used by this member returns that post with 200 before the daily cap is
 * counted, so a retry after a lost response never fails or posts twice. A UNIQUE race in insertMoment also
 * returns the first post with 200. A photo, video or preview whose upload is no longer recorded is a 400
 * invalid_media, and nothing is stored.
 * 发表动态。该成员已用过的 clientId 会在统计每日上限之前以 200 返回那条动态，因此响应丢失后的重试既不会失败也不会重复发表。
 * insertMoment 中的唯一约束竞争同样以 200 返回第一条动态。照片、视频或预览图的上传记录已不存在时返回 400 invalid_media，什么也不保存。
 */
postRoutes.post('/posts', memberRateLimit('moments:create', 8, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const member = c.get('member');
  const input = readInput(() => readCreateMoment(member.id, body));
  const reader = readerOf(member);
  const existing = await findMomentByClientId(c.env.DB, reader, input.clientId);
  if (existing) {
    const replay: CreateMomentResponse = { post: existing, mediaToken: await mediaToken(c) };
    return c.json(replay, 200);
  }
  if ((await countMomentsSince(c.env.DB, member.id, dayAgo())) >= MOMENT_DAILY_POSTS) throw dailyLimit();
  const result = await insertMoment(c.env.DB, reader, input);
  if (result.status === 'media_gone') throw mediaGone();
  const response: CreateMomentResponse = { post: result.post, mediaToken: await mediaToken(c) };
  return c.json(response, result.status === 'created' ? 201 : 200);
});

/** The author's hard delete. Likes, comments and notices cascade; the files go after the response. */
/** 作者彻底删除。赞、评论和消息级联删除；文件在响应之后删除。 */
postRoutes.delete('/posts/:id', memberRateLimit('moments:delete', 30, MINUTE), async (c) => {
  const keys = await deleteMoment(c.env.DB, c.get('member').id, c.req.param('id'));
  if (!keys) throw momentUnavailable();
  deleteObjectsLater(c, keys);
  return c.json({ ok: true });
});

/** 谁可以看: how many friends and active members a post would reach. */
/** 谁可以看：一条动态能让多少好友和在用成员看到。 */
postRoutes.get('/audience', memberRateLimit('moments:audience', 60, MINUTE), async (c) => {
  const response: MomentAudienceCounts = await countMomentAudience(c.env.DB, c.get('member').id);
  return c.json(response);
});
