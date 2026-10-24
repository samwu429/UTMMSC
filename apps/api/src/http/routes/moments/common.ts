import type { Context } from 'hono';
import { canSeeMomentInteraction, canSeeMomentPost, decideMomentModeration, type MomentViewer, type Role } from '@utmmsc/shared';
import { decodeMomentCursor, encodeMomentCursor, type MomentCursor } from '../../../domain/moments/cursor';
import { MomentInputError } from '../../../domain/moments/input';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { listFriendIds } from '../../../infrastructure/d1/friends';
import { viewedRole, type MemberRow } from '../../../infrastructure/d1/members';
import type { MomentCommentRecord } from '../../../infrastructure/d1/moment-interactions';
import { findMomentAccess, type MomentAccess, type MomentReader } from '../../../infrastructure/d1/moments';
import { notifyMomentEvent, type MomentPushEvent } from '../../../infrastructure/push/moments';
import type { AppEnv } from '../../context';
import { ApiHttpError, badRequest, conflict, forbidden, serviceUnavailable } from '../../errors';

/** Window of every per-member limit in the moments routes. */
/** 好友动态接口中每个按成员限制的时间窗口。 */
export const MINUTE = 60_000;
/** The durable caps count what the member wrote over the last 24 hours. */
/** 持久上限统计成员在过去 24 小时内写入的内容。 */
export const DAY_MS = 24 * 60 * 60 * 1000;
export const MOMENT_DAILY_POSTS = 30;
export const MOMENT_DAILY_COMMENTS = 300;
export const MOMENT_DAILY_REPORTS = 20;

/** The §4 error table. Messages are Chinese; the web app adds the English in shared/api/errors.ts. */
/** 第 4 节的错误表。提示为中文；网页端在 shared/api/errors.ts 中补上英文。 */
export const momentUnavailable = () => new ApiHttpError(404, 'moment_unavailable', '这条动态已删除或无法查看');
export const commentUnavailable = () => new ApiHttpError(404, 'comment_unavailable', '这条评论已删除或无法查看');
export const reportUnavailable = () => new ApiHttpError(404, 'report_unavailable', '这条投诉不存在');
export const replyUnavailable = () => badRequest('reply_unavailable', '无法回复这条评论');
export const invalidCursor = () => badRequest('invalid_cursor', '分页参数无效');
export const invalidReportStatus = () => badRequest('invalid_status', '投诉状态无效');
export const selfReport = () => badRequest('self_report', '不能投诉自己的内容');
export const selfRelation = () => badRequest('self_relation', '不能对自己设置动态权限');
export const clientIdConflict = () => conflict('client_id_conflict', '这条内容已经发过了');
export const momentRemoved = () => conflict('moment_removed', '这条动态已被管理员移除');
export const dailyLimit = () => new ApiHttpError(429, 'daily_limit', '今天发得太多了，明天再来吧');
/** A publish named an upload that expired (the cron deleted it after a day) or was never recorded. */
/** 发表时用到的上传已过期（定时任务在一天后删除了它）或从未记录。 */
export const mediaGone = () => badRequest('invalid_media', '有照片或视频无法使用，请重新选择');
export const outranked = () => new ApiHttpError(403, 'outranked', '不能处理职位不低于你的成员的内容');
export const momentsUnavailable = () => serviceUnavailable('moments_unavailable', '好友动态正在升级，请稍后再试');

/** The member a D1 query answers for, acting as their viewed role. */
/** D1 查询所服务的成员，按其当前查看的身份。 */
export function readerOf(member: MemberRow): MomentReader {
  return { id: member.id, role: viewedRole(member) };
}

/** Runs a domain reader and turns its refusal into a 400 with the same code and text. */
/** 执行领域层的读取函数，把它的拒绝转换成错误码和文字都相同的 400。 */
export function readInput<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof MomentInputError) throw badRequest(error.code, error.message);
    throw error;
  }
}

/** ?cursor: missing means page 1, and a value that is present but unreadable is a 400. */
/** ?cursor：缺失表示第一页；有值却无法读取时返回 400。 */
export function readCursor(raw: string | undefined): MomentCursor | null {
  if (raw === undefined || raw === '') return null;
  const cursor = decodeMomentCursor(raw);
  if (!cursor) throw invalidCursor();
  return cursor;
}

export function cursorOut(cursor: MomentCursor | null): string | null {
  return cursor ? encodeMomentCursor(cursor) : null;
}

export function mediaToken(c: Context<AppEnv>): Promise<string> {
  return issueProfileMediaToken(c.env.SESSION_SECRET);
}

/** The start of the 24 hours the daily caps count. */
/** 每日上限统计的 24 小时的起点。 */
export function dayAgo(now: number = Date.now()): string {
  return new Date(now - DAY_MS).toISOString();
}

export interface VisiblePost {
  access: MomentAccess;
  /** The reader with all their friends, for the interaction rules. */
  /** 带上全部好友的读者，用于互动规则。 */
  viewer: MomentViewer;
}

/**
 * The post's permission facts and the reader as a MomentViewer, or null when the post does not exist or the
 * reader may not see it. Both cases look the same to the caller, so nobody learns they were hidden from.
 * 这条动态的权限信息和作为 MomentViewer 的读者；动态不存在或读者无权查看时为 null。两种情况对调用方看起来一样，
 * 因此没有人能得知自己被设置了「不让TA看」。
 */
export async function loadVisiblePost(db: D1Database, memberId: string, postId: string): Promise<VisiblePost | null> {
  const [friendIds, access] = await Promise.all([listFriendIds(db, memberId), findMomentAccess(db, memberId, postId)]);
  if (!access) return null;
  const viewer: MomentViewer = { id: memberId, friendIds: new Set(friendIds) };
  return canSeeMomentPost(viewer, access.facts) ? { access, viewer } : null;
}

/** loadVisiblePost, answering 404 moment_unavailable instead of null. */
/** 与 loadVisiblePost 相同，但以 404 moment_unavailable 代替 null。 */
export async function requireVisiblePost(db: D1Database, memberId: string, postId: string): Promise<VisiblePost> {
  const visible = await loadVisiblePost(db, memberId, postId);
  if (!visible) throw momentUnavailable();
  return visible;
}

/**
 * Whether the viewer, who can see the post, can also see this comment on it: by an active member, not removed
 * unless it is their own, and passing the interaction rule for its author and the member it answered.
 * 能看到动态的查看者能否看到其中这条评论：作者仍在用，未被移除（自己的除外），并且评论作者和被回复者都满足互动可见规则。
 */
export function canSeeMomentComment(visible: VisiblePost, comment: MomentCommentRecord): boolean {
  const { access, viewer } = visible;
  if (comment.facts.postId !== access.postId || !comment.facts.authorActive) return false;
  if (comment.facts.removed && comment.facts.authorId !== viewer.id) return false;
  return canSeeMomentInteraction(viewer, access.facts, comment.facts.authorId, comment.facts.replyToId);
}

/**
 * The moderation tier rule for content by `author`: 403 forbidden without chat.moderate, 403 outranked when the
 * author is not in a lower tier. A moderator's own content goes through the author's delete, so it is refused
 * the same way as a peer's.
 * 针对 `author` 内容的管理档位规则：没有 chat.moderate 时返回 403 forbidden；作者的档位不低于管理员时返回 403 outranked。
 * 管理员自己的内容按作者身份删除，因此与同级成员的内容一样被拒绝。
 */
export function requireOutranks(moderator: MemberRow, author: { id: string; role: Role | null }): void {
  const decision = decideMomentModeration(viewedRole(moderator), author.role);
  if (decision === 'no_permission') throw forbidden();
  if (decision === 'outranked' || moderator.id === author.id) throw outranked();
}

/** Sends a moments push after the response, logging instead of failing the request. */
/** 在响应之后发送好友动态推送；出错只记录日志，不影响请求。 */
export function sendMomentPush(c: Context<AppEnv>, event: MomentPushEvent): void {
  const push = (async () => notifyMomentEvent(c.env, event))();
  c.executionCtx.waitUntil(
    push.catch((err: unknown) => {
      console.error(`push: moments ${event.type} for ${event.postId} failed`, err instanceof Error ? err.message : String(err));
    }),
  );
}

/**
 * Deletes R2 objects after the response, in calls of at most 1000 keys (R2's limit). The rows are already gone,
 * so a failure only leaves files behind and is logged. Without a bucket nothing was ever stored.
 * 在响应之后删除 R2 对象，每次最多 1000 个键（R2 的上限）。记录已经删除，失败只会留下文件，记录日志即可。没有存储桶时从未存过文件。
 */
export function deleteObjectsLater(c: Context<AppEnv>, keys: readonly string[]): void {
  const bucket = c.env.FILES;
  const unique = [...new Set(keys)];
  if (!bucket || unique.length === 0) return;
  const calls: Promise<void>[] = [];
  for (let start = 0; start < unique.length; start += 1000) calls.push(bucket.delete(unique.slice(start, start + 1000)));
  c.executionCtx.waitUntil(
    Promise.all(calls).catch((err: unknown) => {
      console.error(`moments: could not delete ${unique.length} objects`, err instanceof Error ? err.message : String(err));
    }),
  );
}
