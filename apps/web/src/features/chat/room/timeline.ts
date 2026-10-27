import { QUOTE_EXCERPT_MAX, STICKER_TEXT, withinRecallWindow, type FloorReason, type MessageKind, type NormalizedChatMessage, type QuotePreview } from '@utmmsc/shared';
import { formatDividerTime, showChatTimeDivider } from '../../../shared/format/time';
import type { Locale } from '../../../shared/i18n/locale';
import { imageLabel, joinText, legacyDeletedText, moderatorDeletedText, recallText, selfJoinTip, stickerLabel, type Translate } from '../format/systemText';
import type { PendingMessage } from './types';

/**
 * Pure model of the message list: what is drawn, in which order, under which stable key.
 * 消息列表的纯数据模型：画什么、按什么顺序、使用哪个稳定的 key。
 */

export type TimelineItem =
  | { type: 'join_tip'; key: string; text: string }
  | { type: 'divider'; key: string; text: string }
  | { type: 'unread'; key: string }
  | { type: 'system'; key: string; id: number; text: string }
  | { type: 'recall'; key: string; id: number; text: string; reEdit: boolean }
  | { type: 'removed'; key: string; id: number; text: string }
  | { type: 'message'; key: string; message: NormalizedChatMessage; own: boolean; showName: boolean }
  | { type: 'pending'; key: string; pending: PendingMessage };

export type BubbleItem = Extract<TimelineItem, { type: 'message' | 'pending' }>;

export interface TimelineInput {
  messages: readonly NormalizedChatMessage[];
  pending: readonly PendingMessage[];
  meId: string;
  kind: 'channel' | 'direct';
  hasMore: boolean;
  reachedFloor: boolean;
  floorReason: FloorReason | null;
  roomTitle: string | null;
  unreadMarkerBeforeId: number | null;
  canReEdit(id: number): boolean;
  locale: Locale;
  nowMs?: number;
}

export const JOIN_TIP_KEY = 'join-tip';
export const UNREAD_MARKER_KEY = 'unread';
/** Longest spoken preview of a new message. */
/** 新消息读屏预览的最大长度。 */
const PREVIEW_MAX = 80;

export function translatorFor(locale: Locale): Translate {
  return (zh, en) => (locale === 'en' ? en : zh);
}

/**
 * Own rows that carry a clientId share their key with the pending item they came from, so nothing
 * remounts when the server confirms a send.
 * 带 clientId 的自己的消息与其待发项共用 key，服务端确认发送时不会重新挂载。
 */
export function messageKey(message: NormalizedChatMessage, meId: string): string {
  return message.author.id === meId && message.clientId ? `c:${message.clientId}` : `m:${message.id}`;
}

export function pendingKey(clientId: string): string {
  return `c:${clientId}`;
}

function joinNamesMe(message: NormalizedChatMessage | undefined, meId: string): boolean {
  if (!message || message.kind !== 'system' || message.system?.type !== 'join') return false;
  return message.system.members.some((member) => member.id === meId);
}

function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.is(left[key], right[key]));
}

/**
 * Hands back the previous object for every item whose content did not change, and the previous array
 * when nothing changed at all, so memoized rows skip rendering.
 * 内容未变的项沿用上一次的对象，完全没有变化时沿用上一次的数组，记忆化的行因此可以跳过渲染。
 */
function reuseItems(next: TimelineItem[], previous: readonly TimelineItem[]): TimelineItem[] {
  if (previous.length === 0) return next;
  const byKey = new Map(previous.map((item) => [item.key, item]));
  let unchanged = next.length === previous.length;
  const merged = next.map((item, index) => {
    const old = byKey.get(item.key);
    const result = old && shallowEqual(old, item) ? old : item;
    if (unchanged && previous[index] !== result) unchanged = false;
    return result;
  });
  return unchanged ? (previous as TimelineItem[]) : merged;
}

export function buildTimeline(input: TimelineInput, previous: readonly TimelineItem[] = []): TimelineItem[] {
  const tr = translatorFor(input.locale);
  const nowMs = input.nowMs ?? Date.now();
  const items: TimelineItem[] = [];

  // WeChat shows nothing above the point where a floored member joined.
  // 微信在受限成员加入的位置之上不显示任何内容。
  if (!input.hasMore && input.reachedFloor && input.floorReason === 'join' && !joinNamesMe(input.messages[0], input.meId)) {
    items.push({ type: 'join_tip', key: JOIN_TIP_KEY, text: selfJoinTip(input.roomTitle, tr) });
  }

  const markerId = input.unreadMarkerBeforeId;
  let markerPlaced = markerId === null;
  let previousAt: string | undefined;

  function place(item: TimelineItem, at: string, id: number | null) {
    if (!markerPlaced && markerId !== null && id !== null && id >= markerId) {
      items.push({ type: 'unread', key: UNREAD_MARKER_KEY });
      markerPlaced = true;
    }
    if (showChatTimeDivider(at, previousAt)) items.push({ type: 'divider', key: `d:${item.key}`, text: formatDividerTime(at, nowMs, input.locale) });
    previousAt = at;
    items.push(item);
  }

  const confirmed = new Set<string>();
  for (const message of input.messages) {
    const own = message.author.id === input.meId;
    if (own && message.clientId) confirmed.add(message.clientId);
    const key = messageKey(message, input.meId);
    if (message.kind === 'system') {
      place({ type: 'system', key, id: message.id, text: message.system ? joinText(message.system, input.meId, tr) : message.text }, message.createdAt, message.id);
    } else if (message.recalled) {
      const text = recallText({ own, name: message.author.displayName }, tr);
      place({ type: 'recall', key, id: message.id, text, reEdit: own && input.canReEdit(message.id) }, message.createdAt, message.id);
    } else if (message.deleted) {
      // An author's own global delete leaves no trace, as in WeChat.
      // 作者自己的全局删除不留痕迹，与微信一致。
      if (message.deletedBy === 'author') continue;
      const text = message.deletedBy === 'moderator' ? moderatorDeletedText(tr) : legacyDeletedText(tr);
      place({ type: 'removed', key, id: message.id, text }, message.createdAt, message.id);
    } else {
      place({ type: 'message', key, message, own, showName: input.kind === 'channel' && !own }, message.createdAt, message.id);
    }
  }

  for (const pending of input.pending) {
    if (confirmed.has(pending.clientId)) continue;
    place({ type: 'pending', key: pendingKey(pending.clientId), pending }, pending.createdAt, null);
  }

  return reuseItems(items, previous);
}

/* Message actions */
/* 消息操作 */

export type MessageActionId = 'copy' | 'addSticker' | 'quote' | 'recall' | 'hide' | 'translate' | 'remove' | 'mute' | 'blockSticker';

export interface MessageActionInput {
  own: boolean;
  kind: MessageKind;
  text: string;
  redacted: boolean;
  pending: boolean;
  createdAt: string;
  capable: boolean;
  canPost: boolean | null;
  canModerate: boolean;
  /** Device time corrected by the server clock offset. */
  /** 经服务器时钟偏差校正后的设备时间。 */
  nowMs: number;
  /** The row shows a sticker. */
  /** 这一行显示的是表情。 */
  hasSticker: boolean;
  /** The row shows a photo. */
  /** 这一行显示的是图片。 */
  hasImage: boolean;
  /** 添加到表情 can be offered here: the room's server takes stickers. */
  /** 这里可以提供「添加到表情」：房间所在的服务端支持表情。 */
  canAddSticker: boolean;
  /** The viewer is the system administrator, who may block a sticker everywhere. */
  /** 观看者是系统管理员，可以在所有地方封禁一个表情。 */
  canBlockSticker: boolean;
}

/**
 * Whether the moderation items apply to one message. The room refuses moderation of members at or above
 * the viewer's tier, so their rows offer it only when they are the viewer's own.
 * 管理操作是否适用于某条消息。房间会拒绝处理档位不低于观看者的成员，所以这些成员的消息只有是观看者自己的才提供管理操作。
 */
export function canModerateAuthor(canModerate: boolean, own: boolean, authorId: string, exempt: ReadonlySet<string>): boolean {
  return canModerate && (own || !exempt.has(authorId));
}

/**
 * Popover items in WeChat order. Items that do not apply are left out, never greyed out. A sticker or a photo offers
 * 添加到表情 right after 复制; a sticker has no text, so it never offers 复制 or 翻译, and the system administrator gets
 * 封禁表情 last.
 * 按微信顺序排列的浮层操作。不适用的项直接省略，而不是置灰。表情或图片在「复制」之后紧接着提供「添加到表情」；表情没有文字，
 * 因此从不提供「复制」和「翻译」；系统管理员在最后多一项「封禁表情」。
 */
export function messageActions(input: MessageActionInput): MessageActionId[] {
  const hasText = !input.redacted && !input.hasSticker && input.text.trim().length > 0;
  const live = !input.pending && !input.redacted && input.kind === 'user';
  const ids: MessageActionId[] = [];
  if (hasText) ids.push('copy');
  if (input.pending) return ids;
  if (live && (input.hasSticker || input.hasImage) && input.canAddSticker) ids.push('addSticker');
  if (live && input.capable && input.canPost !== false) ids.push('quote');
  if (live && input.own && withinRecallWindow(input.createdAt, input.nowMs)) ids.push('recall');
  if (input.kind === 'user' && input.capable) ids.push('hide');
  if (hasText && input.kind === 'user') ids.push('translate');
  if (input.kind === 'user' && input.canModerate) ids.push('remove');
  if (input.kind === 'user' && input.canModerate && !input.own) ids.push('mute');
  if (live && input.hasSticker && input.canBlockSticker) ids.push('blockSticker');
  return ids;
}

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The quote a reply carries, built from a live row. A sticker quote has the shape the room builds: the fallback
 * excerpt for old clients and `hasSticker`, which this build shows as its own label.
 * 回复所携带的引用，由一条有效消息生成。表情的引用与房间生成的形式相同：给旧客户端的后备摘录，以及 `hasSticker`，本版本据此显示自己的标签。
 */
export function quoteFrom(message: NormalizedChatMessage): QuotePreview {
  const hasSticker = Boolean(message.sticker);
  const chars = Array.from(collapse(message.text));
  return {
    id: message.id,
    authorId: message.author.id,
    authorName: message.author.displayName,
    excerpt: hasSticker ? STICKER_TEXT : chars.slice(0, QUOTE_EXCERPT_MAX).join(''),
    hasImage: !hasSticker && message.imageKey !== null,
    state: 'ok',
    hasSticker,
  };
}

/** One-line preview of a live row for screen-reader announcements; empty for rows with no body. */
/** 供读屏播报的一行消息预览；没有正文的消息返回空串。 */
export function spokenPreview(message: NormalizedChatMessage, tr: Translate): string {
  if (message.kind !== 'user' || message.recalled || message.deleted) return '';
  if (message.sticker) return stickerLabel(tr);
  const text = collapse(message.text);
  if (text) return clip(text, PREVIEW_MAX);
  return message.imageKey ? imageLabel(tr) : '';
}
