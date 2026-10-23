import { parseRoomId } from '@utmmsc/shared';
import { canReadChannel } from '../../domain/authorization/channel-access';
import { messagePushPayload, retractionPushPayload, type Retraction } from '../../domain/notifications/payloads';
import { selectMessageRecipients, type MessageRecipient } from '../../domain/notifications/recipients';
import type { Env } from '../../env';
import { findChannel, listChannelMemberIds } from '../d1/channels';
import { listMutedMemberIds } from '../d1/chat-prefs';
import { findDirect } from '../d1/direct';
import { areFriends } from '../d1/friends';
import { viewedActor } from '../d1/members';
import { listPushableMembers } from '../d1/push-devices';
import { sendToMembers, type DeliverySummary } from './send';

export type { MessageRecipient } from '../../domain/notifications/recipients';

/**
 * Shortest gap between two message pushes for one member and one room. The room enforces it, since it
 * sees every message; the tag makes a later push replace the earlier one anyway.
 * 同一成员、同一房间两次消息推送之间的最短间隔。由房间负责执行，因为房间能看到每一条消息；而且 tag 会让较新的推送替换较旧的一条。
 */
export const MESSAGE_PUSH_INTERVAL_MS = 5_000;

export interface ChatMessageNotice {
  roomId: string;
  authorId: string;
  authorName: string;
  /** Trimmed message text as stored; may be empty for an image. */
  /** 已存储的去空白消息文本；纯图片时可以为空。 */
  text: string;
  hasImage: boolean;
  /** Member ids @-mentioned in the message, already sanitized by the room. */
  /** 消息中 @ 的成员 id，已由房间清理。 */
  mentions: readonly string[];
  mentionAll: boolean;
  /** Members looking at this room now, on a page that is on screen; they see the message live and get no push. */
  /** 此刻正在屏幕上查看该房间的成员；他们实时看到消息，不再推送。 */
  connectedMemberIds: Iterable<string>;
  /**
   * Called with everyone who would get a push; returns the member ids allowed now. The room keeps the
   * last push time per member and room and drops anyone pushed within MESSAGE_PUSH_INTERVAL_MS.
   * 以所有将收到推送的人调用；返回此刻允许推送的成员 id。房间按成员和房间记录上次推送时间，并去掉 MESSAGE_PUSH_INTERVAL_MS 内已推送过的人。
   */
  throttle?: (recipients: readonly MessageRecipient[]) => readonly string[] | Promise<readonly string[]>;
}

interface ResolvedRecipients {
  kind: 'channel' | 'direct';
  title: string;
  recipients: MessageRecipient[];
}

/**
 * Who should be pushed for this message, by the same access rules as tickets: channel readers by
 * audience or membership (and channel managers), or the other participant of a direct conversation
 * while the two are still friends. Only members with a live device are looked at.
 * 这条消息应推送给谁，权限规则与领取票据相同：频道按受众或成员名单（以及频道管理者）确定读者；私聊为另一位参与者，且双方仍是好友。只考虑有有效设备的成员。
 */
export async function resolveMessageRecipients(env: Env, notice: ChatMessageNotice): Promise<ResolvedRecipients | null> {
  const parsed = parseRoomId(notice.roomId);
  if (!parsed) return null;

  let kind: 'channel' | 'direct';
  let title: string;
  let readers: string[];
  let prefsSource: Awaited<ReturnType<typeof listPushableMembers>>;

  if (parsed.kind === 'channel') {
    const channel = await findChannel(env.DB, parsed.id);
    if (!channel) return null;
    const [members, memberIds] = await Promise.all([
      listPushableMembers(env.DB),
      channel.audience === 'custom' ? listChannelMemberIds(env.DB, channel.id) : Promise.resolve([] as string[]),
    ]);
    const inChannel = new Set(memberIds);
    prefsSource = members.filter((m) =>
      canReadChannel({ audience: channel.audience, postPolicy: channel.post_policy, isMember: inChannel.has(m.id) }, viewedActor(m)),
    );
    readers = prefsSource.map((m) => m.id);
    kind = 'channel';
    title = channel.name;
  } else {
    const conversation = await findDirect(env.DB, parsed.id);
    if (!conversation) return null;
    if (conversation.member_low !== notice.authorId && conversation.member_high !== notice.authorId) return null;
    const peerId = conversation.member_low === notice.authorId ? conversation.member_high : conversation.member_low;
    if (!(await areFriends(env.DB, notice.authorId, peerId))) return null;
    prefsSource = await listPushableMembers(env.DB, [peerId]);
    readers = prefsSource.map((m) => m.id);
    kind = 'direct';
    title = notice.authorName;
  }
  if (readers.length === 0) return { kind, title, recipients: [] };

  const muted = await listMutedMemberIds(env.DB, notice.roomId);
  const recipients = selectMessageRecipients({
    readers,
    authorId: notice.authorId,
    connected: new Set(notice.connectedMemberIds),
    muted,
    prefs: new Map(prefsSource.map((m) => [m.id, m.prefs])),
    mentions: notice.mentions,
    mentionAll: notice.mentionAll,
  });
  return { kind, title, recipients };
}

/**
 * Pushes a new chat message to everyone who should hear about it. Meant for ctx.waitUntil after the
 * message is stored and broadcast: it never throws, and errors are only logged.
 * 把新聊天消息推送给应当知道的人。用于消息存储并广播之后的 ctx.waitUntil：它从不抛出异常，错误只写日志。
 */
export async function notifyChatMessage(env: Env, notice: ChatMessageNotice): Promise<DeliverySummary | null> {
  try {
    const resolved = await resolveMessageRecipients(env, notice);
    if (!resolved || resolved.recipients.length === 0) return null;
    let recipients = resolved.recipients;
    if (notice.throttle) {
      const allowed = new Set(await notice.throttle(recipients));
      recipients = recipients.filter((r) => allowed.has(r.memberId));
    }
    if (recipients.length === 0) return null;
    const mentioned = new Map(recipients.map((r) => [r.memberId, r.mentioned]));
    return await sendToMembers(env, [...mentioned.keys()], (memberId, prefs) =>
      !prefs.messages ? null : messagePushPayload({
        roomId: notice.roomId,
        roomKind: resolved.kind,
        roomTitle: resolved.title,
        authorName: notice.authorName,
        text: notice.text,
        hasImage: notice.hasImage,
        mentioned: mentioned.get(memberId) ?? false,
        preview: prefs.preview,
        baseUrl: env.APP_BASE_URL,
      }),
    );
  } catch (err) {
    console.error('push: message notification failed', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export interface ChatRetractionNotice {
  roomId: string;
  authorName: string;
  reason: Retraction;
  /** Members whose latest push from this room was the withdrawn message. */
  /** 本房间最近一次推送给其的正是这条被撤回消息的成员。 */
  memberIds: readonly string[];
}

/**
 * Replaces the notice of a recalled or removed message on the devices it was pushed to, so its text
 * leaves the tray and lock screen and a copy still queued at the push service is overwritten. Members
 * who hide previews were only ever shown a generic line and get nothing. Never throws.
 * 在推送过的设备上替换已撤回或已删除消息的通知，使原文离开通知栏和锁屏，推送服务中仍在排队的副本也会被覆盖。
 * 关闭了显示内容的成员只看到过一句通用提示，不再发送。从不抛出异常。
 */
export async function notifyChatRetraction(env: Env, notice: ChatRetractionNotice): Promise<DeliverySummary | null> {
  try {
    if (notice.memberIds.length === 0) return null;
    const parsed = parseRoomId(notice.roomId);
    if (!parsed) return null;
    let roomTitle = '';
    if (parsed.kind === 'channel') {
      const channel = await findChannel(env.DB, parsed.id);
      if (!channel) return null;
      roomTitle = channel.name;
    }
    const payload = retractionPushPayload({
      roomId: notice.roomId,
      roomKind: parsed.kind,
      roomTitle,
      authorName: notice.authorName,
      reason: notice.reason,
      baseUrl: env.APP_BASE_URL,
    });
    return await sendToMembers(env, notice.memberIds, (_memberId, prefs) => (prefs.preview ? payload : null));
  } catch (err) {
    console.error('push: retraction notice failed', err instanceof Error ? err.message : String(err));
    return null;
  }
}
