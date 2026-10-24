import { Hono } from 'hono';
import {
  canDeleteMomentComment,
  canInteractWithMoment,
  canReplyToMomentComment,
  type CreateMomentCommentResponse,
  type MomentLikeResponse,
} from '@utmmsc/shared';
import { readMomentComment, readMomentLike } from '../../../domain/moments/input';
import { planCommentNotices, planLikeNotice } from '../../../domain/moments/notices';
import {
  countCommentsSince,
  deleteMomentComment,
  findMomentComment,
  insertMomentComment,
  setMomentLike,
  type MomentCommentRecord,
} from '../../../infrastructure/d1/moment-interactions';
import { latestCommentNoticeRecipients, loadCommentNoticeFacts } from '../../../infrastructure/d1/moment-notices';
import type { AppEnv } from '../../context';
import { memberRateLimit } from '../../middleware/rate-limit';
import { readJson } from '../../validation';
import {
  MINUTE,
  MOMENT_DAILY_COMMENTS,
  clientIdConflict,
  commentUnavailable,
  dailyLimit,
  dayAgo,
  momentRemoved,
  momentUnavailable,
  readInput,
  readerOf,
  replyUnavailable,
  requireVisiblePost,
  sendMomentPush,
  type VisiblePost,
} from './common';

/** Likes and comments. */
/** 点赞和评论。 */
export const interactionRoutes = new Hono<AppEnv>();

/**
 * The like the member wants, so the latest tap wins and a retry changes nothing. Liking also tells the author
 * in 消息 (never by push); unliking takes that notice back.
 * 成员想要的点赞状态，因此以最后一次点击为准，重试不会改变结果。点赞还会在「消息」中告诉作者（从不推送）；取消赞会撤回这条消息。
 */
interactionRoutes.post('/posts/:id/like', memberRateLimit('moments:like', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const liked = readInput(() => readMomentLike(body));
  const member = c.get('member');
  const { access, viewer } = await requireVisiblePost(c.env.DB, member.id, c.req.param('id'));
  if (!canInteractWithMoment(viewer, access.facts)) throw momentRemoved();
  const notice = liked ? planLikeNotice(access.facts.authorId, member.id) : null;
  const response: MomentLikeResponse | null = await setMomentLike(c.env.DB, readerOf(member), access, liked, notice);
  if (!response) throw momentUnavailable();
  return c.json(response);
});

/**
 * Who a new comment answers, from the stored comment and never from the client. Answering one's own comment
 * is stored as a plain comment; anything else must pass canReplyToMomentComment.
 * 新评论回复的是谁，取自已保存的评论，从不取自客户端。回复自己的评论按普通评论保存；其他情况须通过 canReplyToMomentComment。
 */
function replyTarget(visible: VisiblePost, memberId: string, target: MomentCommentRecord | null): { commentId: string; memberId: string } | null {
  if (!target || target.facts.postId !== visible.access.postId) throw replyUnavailable();
  if (target.facts.authorId === memberId) return null;
  if (!canReplyToMomentComment(visible.viewer, visible.access.postId, visible.access.facts, target.facts)) throw replyUnavailable();
  return { commentId: target.id, memberId: target.facts.authorId };
}

/**
 * A comment or a reply. The same clientId on the same post with the same text returns the stored comment with
 * 200 and pushes nothing; with a different post or text it is 409 client_id_conflict. The notices are written
 * in the comment's own batch, and the pushes go out after the response.
 * 评论或回复。同一 clientId 在同一条动态上、文字相同时以 200 返回已保存的评论，不再推送；动态或文字不同时返回 409 client_id_conflict。
 * 消息与评论在同一批次中写入，推送在响应之后发出。
 */
interactionRoutes.post('/posts/:id/comments', memberRateLimit('moments:comment', 20, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = readInput(() => readMomentComment(body));
  const member = c.get('member');
  const postId = c.req.param('id');
  const [visible, recent, target] = await Promise.all([
    requireVisiblePost(c.env.DB, member.id, postId),
    countCommentsSince(c.env.DB, member.id, dayAgo(), input.clientId),
    input.replyToCommentId ? findMomentComment(c.env.DB, input.replyToCommentId) : Promise.resolve(null),
  ]);
  const { access, viewer } = visible;
  if (!canInteractWithMoment(viewer, access.facts)) throw momentRemoved();
  if (recent >= MOMENT_DAILY_COMMENTS) throw dailyLimit();
  const replyTo = input.replyToCommentId ? replyTarget(visible, member.id, target) : null;

  const postAuthorId = access.facts.authorId;
  const replyToMemberId = replyTo?.memberId ?? null;
  const facts = await loadCommentNoticeFacts(c.env.DB, { postId, postAuthorId, actorId: member.id, replyToMemberId });
  const notices = planCommentNotices({
    postAuthorId,
    audience: access.facts.audience,
    actorId: member.id,
    replyToMemberId,
    replyTarget: facts.replyTarget,
    participants: facts.participants,
  });

  const result = await insertMomentComment(c.env.DB, readerOf(member), access, { clientId: input.clientId, body: input.text, replyTo, notices });
  if (result.status === 'conflict') throw clientIdConflict();
  if (result.status === 'post_gone') throw momentUnavailable();
  if (result.status === 'created') {
    sendMomentPush(c, { type: 'comment', postId, commentId: result.comment.id, actorName: member.display_name, text: result.comment.body, notices });
  }
  const response: CreateMomentCommentResponse = { comment: result.comment, commentCount: result.commentCount };
  return c.json(response, result.status === 'created' ? 201 : 200);
});

/**
 * Hard delete by the comment's author or the post's author. Anyone else gets the same 404 as for a missing
 * comment. Members whose newest push on the post showed this comment get it replaced with 一条评论已删除.
 * 由评论作者或动态作者彻底删除。其他人得到的 404 与评论不存在时相同。在这条动态上最新一条推送显示的正是这条评论的成员，
 * 会收到替换为「一条评论已删除」的通知。
 */
interactionRoutes.delete('/comments/:id', memberRateLimit('moments:delete-comment', 30, MINUTE), async (c) => {
  const member = c.get('member');
  const comment = await findMomentComment(c.env.DB, c.req.param('id'));
  if (!comment || !canDeleteMomentComment(member.id, { authorId: comment.facts.authorId }, { authorId: comment.postAuthorId })) {
    throw commentUnavailable();
  }
  const postId = comment.facts.postId;
  const recall = await latestCommentNoticeRecipients(c.env.DB, postId, comment.id);
  if (!(await deleteMomentComment(c.env.DB, comment.id))) throw commentUnavailable();
  if (recall.length > 0) sendMomentPush(c, { type: 'recall', postId, memberIds: recall });
  return c.json({ ok: true });
});
