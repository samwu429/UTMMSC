import { Hono } from 'hono';
import { canReportMoment, type MomentBlocksResponse, type MomentRelation } from '@utmmsc/shared';
import { readMomentRelationPatch, readMomentReport } from '../../../domain/moments/input';
import { findMemberById } from '../../../infrastructure/d1/members';
import { findMomentComment } from '../../../infrastructure/d1/moment-interactions';
import {
  countReportsSince,
  findMomentRelation,
  insertMomentReport,
  listMomentBlocks,
  updateMomentRelation,
} from '../../../infrastructure/d1/moment-safety';
import type { AppEnv } from '../../context';
import { notFound } from '../../errors';
import { memberRateLimit } from '../../middleware/rate-limit';
import { readJson } from '../../validation';
import {
  MINUTE,
  MOMENT_DAILY_REPORTS,
  canSeeMomentComment,
  commentUnavailable,
  dailyLimit,
  dayAgo,
  readInput,
  requireVisiblePost,
  selfReport,
  selfRelation,
} from './common';

/** 不让TA看 and 不看TA, and reports. */
/** 「不让TA看」与「不看TA」，以及投诉。 */
export const safetyRoutes = new Hono<AppEnv>();

/** 动态设置: both lists of the member's own settings. */
/** 动态设置：成员自己的两份名单。 */
safetyRoutes.get('/blocks', memberRateLimit('moments:blocks', 60, MINUTE), async (c) => {
  const response: MomentBlocksResponse = await listMomentBlocks(c.env.DB, c.get('member').id);
  return c.json(response);
});

/** The member's own settings for one person, for the switches on that person's profile. */
/** 成员自己对某个人的设置，用于对方资料页上的开关。 */
safetyRoutes.get('/blocks/:memberId', memberRateLimit('moments:relation', 60, MINUTE), async (c) => {
  const response: MomentRelation = await findMomentRelation(c.env.DB, c.get('member').id, c.req.param('memberId'));
  return c.json(response);
});

/** Only the fields sent change. The other person must be an active member and not the member themselves. */
/** 只修改发来的字段。对方须为在用成员，且不能是自己。 */
safetyRoutes.patch('/blocks/:memberId', memberRateLimit('moments:relation-update', 30, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const patch = readInput(() => readMomentRelationPatch(body));
  const member = c.get('member');
  const targetId = c.req.param('memberId');
  if (targetId === member.id) throw selfRelation();
  const target = await findMemberById(c.env.DB, targetId);
  if (!target || target.status !== 'active') throw notFound('成员不存在');
  const response: MomentRelation = await updateMomentRelation(c.env.DB, member.id, targetId, patch);
  return c.json(response);
});

/**
 * A report on a post, or on one comment of it, that the member can see and did not write. Content the member
 * cannot see is the same 404 as missing content. Reporting the same item twice still answers ok.
 * 对成员能看到、且不是自己写的动态或其中一条评论的投诉。成员看不到的内容与不存在的内容一样返回 404。对同一内容重复投诉仍然返回成功。
 */
safetyRoutes.post('/reports', memberRateLimit('moments:report', 10, MINUTE), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = readInput(() => readMomentReport(body));
  const member = c.get('member');
  const [visible, comment, recent] = await Promise.all([
    requireVisiblePost(c.env.DB, member.id, input.postId),
    input.commentId ? findMomentComment(c.env.DB, input.commentId) : Promise.resolve(null),
    countReportsSince(c.env.DB, member.id, dayAgo()),
  ]);
  let targetMemberId = visible.access.facts.authorId;
  if (input.commentId) {
    if (!comment || !canSeeMomentComment(visible, comment)) throw commentUnavailable();
    targetMemberId = comment.facts.authorId;
  }
  if (!canReportMoment(member.id, targetMemberId, true)) throw selfReport();
  if (recent >= MOMENT_DAILY_REPORTS) throw dailyLimit();
  await insertMomentReport(c.env.DB, {
    reporterId: member.id,
    postId: input.postId,
    commentId: input.commentId,
    targetMemberId,
    reason: input.reason,
    note: input.note,
  });
  return c.json({ ok: true });
});
