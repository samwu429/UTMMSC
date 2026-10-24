import { Hono, type Context } from 'hono';
import { MOMENT_NOTICE_PAGE, MOMENT_REPORT_STATUSES, type MomentReportStatus, type MomentReportsResponse } from '@utmmsc/shared';
import { MOMENT_INPUT_MESSAGES, readModerationReason, readResolveReport } from '../../../domain/moments/input';
import { findMomentComment } from '../../../infrastructure/d1/moment-interactions';
import {
  dismissMomentReports,
  findMomentReport,
  listMomentReports,
  removeMomentComment,
  removeMomentPost,
  restoreMomentComment,
  restoreMomentPost,
} from '../../../infrastructure/d1/moment-safety';
import { findMomentAccess } from '../../../infrastructure/d1/moments';
import type { AppEnv } from '../../context';
import { badRequest } from '../../errors';
import { memberRateLimit } from '../../middleware/rate-limit';
import { requirePermission } from '../../middleware/session';
import { readJson } from '../../validation';
import {
  MINUTE,
  canSeeMomentComment,
  commentUnavailable,
  cursorOut,
  invalidReportStatus,
  loadVisiblePost,
  mediaToken,
  momentUnavailable,
  readCursor,
  readInput,
  readerOf,
  reportUnavailable,
  requireOutranks,
  requireVisiblePost,
  sendMomentPush,
} from './common';

/**
 * Reactive moderation by holders of chat.moderate (主席, 系统管理员) under the channel tier rule: the report queue,
 * and removing or restoring content. Removal is soft, logged in moment_actions, and tells the author.
 * 由持有 chat.moderate 的成员（主席、系统管理员）按频道档位规则进行的事后管理：投诉队列，以及移除或恢复内容。
 * 移除是软删除，记录在 moment_actions 中，并通知作者。
 */
export const moderationRoutes = new Hono<AppEnv>();

moderationRoutes.use('/moderation/*', requirePermission('chat.moderate'));

function readReportStatus(raw: string | undefined): MomentReportStatus {
  if (raw === undefined || raw === '') return 'open';
  if (!(MOMENT_REPORT_STATUSES as readonly string[]).includes(raw)) throw invalidReportStatus();
  return raw as MomentReportStatus;
}

/** Removes a post, then tells its author by push; the removed notice is written with the removal. */
/** 移除一条动态，再推送通知作者；removed 消息与移除一起写入。 */
async function removePost(c: Context<AppEnv>, postId: string, reason: string): Promise<void> {
  const removed = await removeMomentPost(c.env.DB, c.get('member').id, postId, reason);
  if (!removed) throw momentUnavailable();
  sendMomentPush(c, { type: 'removed', postId, target: 'post', memberId: removed.authorId });
}

/**
 * Removes a comment, tells its author, and replaces the pushes that showed its text with 一条评论已删除.
 * 移除一条评论，通知其作者，并把显示过其内容的推送替换为「一条评论已删除」。
 */
async function removeComment(c: Context<AppEnv>, commentId: string, reason: string): Promise<void> {
  const removed = await removeMomentComment(c.env.DB, c.get('member').id, commentId, reason);
  if (!removed) throw commentUnavailable();
  sendMomentPush(c, { type: 'removed', postId: removed.postId, target: 'comment', memberId: removed.authorId });
  if (removed.recallIds.length > 0) sendMomentPush(c, { type: 'recall', postId: removed.postId, memberIds: removed.recallIds });
}

moderationRoutes.get('/moderation/reports', memberRateLimit('moments:moderation-reports', 60, MINUTE), async (c) => {
  const status = readReportStatus(c.req.query('status'));
  const cursor = readCursor(c.req.query('cursor'));
  const page = await listMomentReports(c.env.DB, readerOf(c.get('member')), { status, cursor, limit: MOMENT_NOTICE_PAGE });
  const response: MomentReportsResponse = { reports: page.reports, nextCursor: cursorOut(page.nextCursor), mediaToken: await mediaToken(c) };
  return c.json(response);
});

/**
 * Settles a report and every other open report on the same post or comment. Moderators work from the snapshot,
 * so removing needs the tier rule but not sight of the post. Content that is already removed stays as it is,
 * so the author is not told twice.
 * 处理一条投诉，以及针对同一动态或评论的其他全部未处理投诉。管理员依据快照处理，因此移除需要满足档位规则，但不需要能看到这条动态。
 * 已被移除的内容保持原样，作者不会收到两次通知。
 */
moderationRoutes.post('/moderation/reports/:id/resolve', memberRateLimit('moments:moderation-resolve', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = readInput(() => readResolveReport(body));
  const member = c.get('member');
  const report = await findMomentReport(c.env.DB, c.req.param('id'));
  if (!report) throw reportUnavailable();
  requireOutranks(member, { id: report.targetMemberId, role: report.targetRole });
  const target = { postId: report.postId, commentId: report.commentId };
  if (input.action === 'dismiss') {
    await dismissMomentReports(c.env.DB, member.id, target);
    return c.json({ ok: true });
  }
  const reason = input.reason;
  if (!reason) throw badRequest('missing_moderation_reason', MOMENT_INPUT_MESSAGES.missing_moderation_reason);
  if (report.commentId) {
    const comment = await findMomentComment(c.env.DB, report.commentId);
    if (!comment) throw commentUnavailable();
    if (!comment.facts.removed) await removeComment(c, comment.id, reason);
  } else {
    const access = await findMomentAccess(c.env.DB, member.id, report.postId);
    if (!access) throw momentUnavailable();
    if (!access.facts.removed) await removePost(c, report.postId, reason);
  }
  return c.json({ ok: true });
});

/** Direct removal of a post the moderator can already see; moderators do not browse private circles. */
/** 直接移除管理员本来就能看到的动态；管理员不翻看别人的私人圈子。 */
moderationRoutes.post('/moderation/posts/:id/remove', memberRateLimit('moments:moderation-post', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const reason = readInput(() => readModerationReason(body));
  const member = c.get('member');
  const postId = c.req.param('id');
  const { access } = await requireVisiblePost(c.env.DB, member.id, postId);
  requireOutranks(member, { id: access.facts.authorId, role: access.authorRole });
  await removePost(c, postId, reason);
  return c.json({ ok: true });
});

/** Restoring a post that is not removed changes nothing and still answers ok. */
/** 恢复一条未被移除的动态不做任何改动，仍然返回成功。 */
moderationRoutes.post('/moderation/posts/:id/restore', memberRateLimit('moments:moderation-post', 60, MINUTE), async (c) => {
  const member = c.get('member');
  const postId = c.req.param('id');
  const access = await findMomentAccess(c.env.DB, member.id, postId);
  if (!access) throw momentUnavailable();
  requireOutranks(member, { id: access.facts.authorId, role: access.authorRole });
  await restoreMomentPost(c.env.DB, member.id, postId);
  return c.json({ ok: true });
});

/** Direct removal of a comment the moderator can see, on a post they can see. */
/** 直接移除管理员能看到的动态上、管理员能看到的评论。 */
moderationRoutes.post('/moderation/comments/:id/remove', memberRateLimit('moments:moderation-comment', 60, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const reason = readInput(() => readModerationReason(body));
  const member = c.get('member');
  const comment = await findMomentComment(c.env.DB, c.req.param('id'));
  if (!comment) throw commentUnavailable();
  const visible = await loadVisiblePost(c.env.DB, member.id, comment.facts.postId);
  if (!visible || !canSeeMomentComment(visible, comment)) throw commentUnavailable();
  requireOutranks(member, { id: comment.facts.authorId, role: comment.authorRole });
  await removeComment(c, comment.id, reason);
  return c.json({ ok: true });
});

/** Restoring a comment that is not removed changes nothing and still answers ok. */
/** 恢复一条未被移除的评论不做任何改动，仍然返回成功。 */
moderationRoutes.post('/moderation/comments/:id/restore', memberRateLimit('moments:moderation-comment', 60, MINUTE), async (c) => {
  const member = c.get('member');
  const comment = await findMomentComment(c.env.DB, c.req.param('id'));
  if (!comment) throw commentUnavailable();
  requireOutranks(member, { id: comment.facts.authorId, role: comment.authorRole });
  await restoreMomentComment(c.env.DB, member.id, comment.id);
  return c.json({ ok: true });
});
