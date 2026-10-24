import type { PlannedNotice } from '../../domain/moments/notices';
import { momentCommentPushPayload, momentRecallPushPayload, momentRemovedPushPayload } from '../../domain/notifications/payloads';
import type { Env } from '../../env';
import { listMomentsOptOut } from '../d1/notification-prefs';
import { sendToMembers, type DeliverySummary } from './send';

/**
 * What happened, as the routes report it after the write has committed.
 * comment: a new comment; only its comment and reply notices push (张三评论了你 / 张三回复了你), thread never does.
 * removed: a moderator removed the member's post or comment. recall: a comment was deleted or removed, so the
 * listed members' notice for it is replaced under the same tag (only those who see previews).
 * 写入提交之后由接口报告的事件。
 * comment：一条新评论；只有其中的 comment 和 reply 消息会推送（张三评论了你 / 张三回复了你），thread 从不推送。
 * removed：管理员移除了该成员的动态或评论。recall：一条评论被删除或移除，以相同 tag 替换所列成员收到的通知（只发给显示内容的成员）。
 */
export type MomentPushEvent =
  | { type: 'comment'; postId: string; commentId: string; actorName: string; text: string; notices: readonly PlannedNotice[] }
  | { type: 'removed'; postId: string; target: 'post' | 'comment'; memberId: string }
  | { type: 'recall'; postId: string; memberIds: readonly string[] };

const NOTHING_SENT: DeliverySummary = { devices: 0, sent: 0, failed: 0, recipients: 0 };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The pushing kind for each member a comment's notices name: reply wins over comment when one member is
 * named twice, and thread notices stay in the app.
 * 一条评论的消息所涉及的每位成员应收到的推送类型：同一成员出现两次时 reply 优先于 comment；thread 消息只留在应用内。
 */
export function commentPushKinds(notices: readonly PlannedNotice[]): Map<string, 'comment' | 'reply'> {
  const kinds = new Map<string, 'comment' | 'reply'>();
  for (const notice of notices) {
    if (notice.kind === 'thread') continue;
    if (kinds.get(notice.recipientId) !== 'reply') kinds.set(notice.recipientId, notice.kind);
  }
  return kinds;
}

/**
 * The members still to be pushed once those who turned 好友动态互动 off are left out. The switch is read on its
 * own, apart from the device join, so a database without migration 0016 reads as everyone on.
 * 去掉关闭了「好友动态互动」的成员之后仍要推送的人。这个开关单独读取，不在设备联表查询中，因此缺少迁移 0016 的数据库按全部开启处理。
 */
async function withoutOptOut(env: Env, memberIds: readonly string[]): Promise<string[]> {
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return [];
  const off = await listMomentsOptOut(env.DB, unique);
  return unique.filter((memberId) => !off.has(memberId));
}

async function sendMomentEvent(env: Env, event: MomentPushEvent): Promise<DeliverySummary> {
  const baseUrl = env.APP_BASE_URL;
  switch (event.type) {
    case 'comment': {
      const kinds = commentPushKinds(event.notices);
      const recipients = await withoutOptOut(env, [...kinds.keys()]);
      if (recipients.length === 0) return NOTHING_SENT;
      return sendToMembers(env, recipients, (memberId, prefs) => {
        const kind = kinds.get(memberId);
        if (!kind) return null;
        return momentCommentPushPayload({
          postId: event.postId,
          commentId: event.commentId,
          kind,
          actorName: event.actorName,
          text: event.text,
          preview: prefs.preview,
          baseUrl,
        });
      });
    }
    case 'removed': {
      const recipients = await withoutOptOut(env, [event.memberId]);
      if (recipients.length === 0) return NOTHING_SENT;
      return sendToMembers(env, recipients, (_memberId, prefs) =>
        momentRemovedPushPayload({ postId: event.postId, target: event.target, preview: prefs.preview, baseUrl }),
      );
    }
    case 'recall': {
      const recipients = await withoutOptOut(env, event.memberIds);
      if (recipients.length === 0) return NOTHING_SENT;
      const payload = momentRecallPushPayload({ postId: event.postId, baseUrl });
      // Members who hide previews were only shown 好友动态有新互动, which tells nothing about the comment.
      // 关闭了显示内容的成员只看到过「好友动态有新互动」，其中没有评论的任何内容。
      return sendToMembers(env, recipients, (_memberId, prefs) => (prefs.preview ? payload : null));
    }
  }
}

/**
 * Pushes one moments event. Recipients who turned 好友动态互动 off (listMomentsOptOut) get nothing. Always run in
 * waitUntil; it logs failures and never throws.
 * 推送一个好友动态事件。关闭了「好友动态互动」的收件人（listMomentsOptOut）不会收到。始终在 waitUntil 中运行；出错时记录日志，从不抛错。
 */
export async function notifyMomentEvent(env: Env, event: MomentPushEvent): Promise<void> {
  try {
    await sendMomentEvent(env, event);
  } catch (err) {
    console.error(`push: moments ${event.type} notification failed`, errorText(err));
  }
}
