import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@utmmsc/shared';

export interface MessageRecipient {
  memberId: string;
  /** Named in the message, or covered by @所有人. */
  /** 消息中 @ 了此人，或被 @所有人 覆盖。 */
  mentioned: boolean;
}

export interface RecipientInput {
  /** Members who can read the room now. */
  /** 当前能阅读该房间的成员。 */
  readers: readonly string[];
  authorId: string;
  /** Members with an open socket in the room; they see the message live. */
  /** 在房间里有打开连接的成员；他们会实时看到消息。 */
  connected: ReadonlySet<string>;
  /** Members who set 消息免打扰 for this room. */
  /** 对该房间设置了「消息免打扰」的成员。 */
  muted: ReadonlySet<string>;
  prefs: ReadonlyMap<string, NotificationPrefs>;
  mentions: readonly string[];
  mentionAll: boolean;
}

/**
 * Who gets a push for a new message. Readers other than the author who are not watching the room,
 * whose message switch is on, and who have not muted it; as in WeChat, an @ reaches a muted chat.
 * 新消息推送给谁：除发送人以外、没有正在看该房间、开启了新消息通知、且没有设置免打扰的阅读者；与微信一致，@ 可以穿透免打扰。
 */
export function selectMessageRecipients(input: RecipientInput): MessageRecipient[] {
  const named = new Set(input.mentions);
  const seen = new Set<string>();
  const recipients: MessageRecipient[] = [];
  for (const memberId of input.readers) {
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    if (memberId === input.authorId || input.connected.has(memberId)) continue;
    const prefs = input.prefs.get(memberId) ?? DEFAULT_NOTIFICATION_PREFS;
    if (!prefs.messages) continue;
    const mentioned = input.mentionAll || named.has(memberId);
    if (input.muted.has(memberId) && !mentioned) continue;
    recipients.push({ memberId, mentioned });
  }
  return recipients;
}
