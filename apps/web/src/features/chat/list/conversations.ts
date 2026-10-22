import {
  channelRoomId,
  directRoomId,
  type ChannelSummary,
  type ChatOverviewResponse,
  type ChatPrefs,
  type DirectConversationSummary,
  type LastMessagePreview,
} from '@utmmsc/shared';
import { formatChatListTime } from '../../../shared/format/time';
import type { Locale } from '../../../shared/i18n/locale';
import { imageLabel, joinText, legacyDeletedText, moderatorDeletedText, recallText, type Translate } from '../format/systemText';
import { draftFor, type ChatDraft } from '../state/drafts';

/**
 * One merged conversation list for channels and direct messages, built the way WeChat's chat tab
 * shows it. Pure: the page passes the overview, the drafts map, the viewer and tr.
 * 频道与私聊合并成的一个会话列表，展示方式与微信的聊天页一致。纯函数：页面传入概览、草稿表、观看者和 tr。
 */

export type ConversationBadge = { type: 'count'; n: number } | { type: 'dot' } | null;

export type ConversationAvatar = { kind: 'channel'; name: string } | { kind: 'direct'; name: string; avatarKey: string | null };

/** A red or gray bracket tag in front of the preview, such as [有人@我], [草稿] or [3条]. */
/** 预览前面的红色或灰色方括号标记，例如 [有人@我]、[草稿] 或 [3条]。 */
export interface PreviewTag {
  text: string;
  tone: 'alert' | 'meta';
}

export interface ConversationPreview {
  tag: PreviewTag | null;
  text: string;
}

export interface Conversation {
  roomId: string;
  kind: 'channel' | 'direct';
  title: string;
  avatar: ConversationAvatar;
  timeLabel: string;
  preview: ConversationPreview;
  badge: ConversationBadge;
  pinned: boolean;
  muted: boolean;
  unreadCount: number;
  markedUnread: boolean;
  /** Sort key: the newest visible message, the channel's last activity, or the join time. */
  /** 排序依据：最新的可见消息、频道最后活动时间或加入时间。 */
  activityAt: string | null;
}

export function roomLink(roomId: string): string {
  return `/chat/room/${encodeURIComponent(roomId)}`;
}

export const DEFAULT_CHAT_PREFS: ChatPrefs = Object.freeze({ pinned: false, muted: false, markedUnread: false, hiddenAt: null });

export function prefsOf(summary: Pick<ChannelSummary, 'prefs'> | Pick<DirectConversationSummary, 'prefs'>): ChatPrefs {
  return summary.prefs ?? DEFAULT_CHAT_PREFS;
}

/**
 * 不显示该聊天: a row hidden at or after its newest visible message stays out of the list until a
 * newer message arrives. Both sides are ISO strings from toISOString, so they compare as text.
 * 不显示该聊天：在最新可见消息之时或之后被隐藏的会话，在有更新的消息之前不出现在列表里。
 * 两边都是 toISOString 生成的 ISO 字符串，可以直接按文本比较。
 */
export function isHiddenRoom(prefs: ChatPrefs, lastMessage: LastMessagePreview | null | undefined): boolean {
  if (!prefs.hiddenAt) return false;
  return prefs.hiddenAt >= (lastMessage?.at ?? '');
}

/** Muted rooms and rooms marked unread show a dot; everything else shows the count. */
/** 免打扰和标为未读的会话显示红点，其他显示数字。 */
export function badgeFor(unreadCount: number, prefs: ChatPrefs): ConversationBadge {
  if (prefs.muted) return unreadCount > 0 || prefs.markedUnread ? { type: 'dot' } : null;
  if (unreadCount > 0) return { type: 'count', n: unreadCount };
  return prefs.markedUnread ? { type: 'dot' } : null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** First character of a name for an initial tile, keeping surrogate pairs whole. */
/** 名称的第一个字符，用于首字头像；不会拆开代理对。 */
export function conversationInitial(name: string): string {
  return Array.from(name.trim())[0] ?? '';
}

interface PreviewInput {
  kind: 'channel' | 'direct';
  lastMessage: LastMessagePreview | null | undefined;
  unreadCount: number;
  mentionedMe: boolean;
  muted: boolean;
  draft: ChatDraft | null;
  meId: string | null;
  joinedAt: string | null;
  description: string | null;
  /** Chinese-only line from servers that do not send lastMessage yet. */
  /** 尚未发送 lastMessage 的旧服务端给出的仅中文预览。 */
  legacyPreview: string | null;
}

function messageBody(message: LastMessagePreview, meId: string | null, tr: Translate): string {
  switch (message.kind) {
    case 'image':
      return imageLabel(tr);
    case 'recalled':
      return recallText({ own: meId !== null && message.authorId === meId, name: message.authorName }, tr);
    case 'moderator_deleted':
      return moderatorDeletedText(tr);
    case 'deleted':
      return legacyDeletedText(tr);
    case 'system':
      return joinText(message.system ?? { type: 'join', actor: null, members: [], more: 0 }, meId, tr);
    default:
      return oneLine(message.text);
  }
}

function emptyBody(input: PreviewInput, tr: Translate): string {
  if (input.kind === 'direct') {
    if (input.lastMessage === undefined && input.legacyPreview) return oneLine(input.legacyPreview);
    return tr('开始聊天', 'Start chatting');
  }
  if (input.joinedAt) return tr('你已加入频道', 'You joined this channel');
  const description = input.description ? oneLine(input.description) : '';
  return description || tr('暂无消息', 'No messages yet');
}

/** The sender in front of a channel message, as in 「张三: 你好」. Never for your own messages. */
/** 频道消息前的发送者，例如「张三: 你好」。自己的消息不加。 */
function senderPrefix(input: PreviewInput, message: LastMessagePreview): string {
  if (input.kind !== 'channel') return '';
  if (message.kind !== 'text' && message.kind !== 'image') return '';
  if (input.meId !== null && message.authorId === input.meId) return '';
  const name = message.authorName.trim();
  return name ? `${name}: ` : '';
}

/**
 * Preview line, in WeChat's priority: [有人@我], then [草稿] with the draft text, then [N条] for a
 * muted chat with unread, then the sender prefix in channels, then the message itself.
 * 预览行，优先级与微信一致：[有人@我]，其次 [草稿] 加草稿内容，再次免打扰会话的 [N条]，然后是频道里的发送者前缀，最后是消息本身。
 */
export function previewFor(input: PreviewInput, tr: Translate): ConversationPreview {
  const message = input.lastMessage ?? null;
  const body = message ? `${senderPrefix(input, message)}${messageBody(message, input.meId, tr)}` : emptyBody(input, tr);
  if (input.mentionedMe && input.unreadCount > 0) return { tag: { text: tr('[有人@我]', '[Mentioned]'), tone: 'alert' }, text: body };
  if (input.draft) return { tag: { text: tr('[草稿]', '[Draft]'), tone: 'alert' }, text: oneLine(input.draft.text) };
  if (input.muted && input.unreadCount > 0) {
    const n = input.unreadCount;
    return { tag: { text: tr(`[${n}条]`, `[${n} ${n === 1 ? 'msg' : 'msgs'}]`), tone: 'meta' }, text: body };
  }
  return { tag: null, text: body };
}

function channelRow(channel: ChannelSummary, drafts: Record<string, ChatDraft>, meId: string | null, nowMs: number, tr: Translate, locale?: Locale): Conversation | null {
  const prefs = prefsOf(channel);
  if (isHiddenRoom(prefs, channel.lastMessage)) return null;
  const roomId = channelRoomId(channel.id);
  const joinedAt = channel.joinedAt ?? null;
  const activityAt = channel.lastMessage?.at ?? channel.lastMessageAt ?? joinedAt;
  return {
    roomId,
    kind: 'channel',
    title: channel.name,
    avatar: { kind: 'channel', name: channel.name },
    timeLabel: activityAt ? formatChatListTime(activityAt, nowMs, locale) : '',
    preview: previewFor(
      {
        kind: 'channel',
        lastMessage: channel.lastMessage,
        unreadCount: channel.unreadCount,
        mentionedMe: channel.mentionedMe === true,
        muted: prefs.muted,
        draft: meId ? draftFor({ drafts }, meId, roomId) : null,
        meId,
        joinedAt,
        description: channel.description,
        legacyPreview: null,
      },
      tr,
    ),
    badge: badgeFor(channel.unreadCount, prefs),
    pinned: prefs.pinned,
    muted: prefs.muted,
    unreadCount: channel.unreadCount,
    markedUnread: prefs.markedUnread,
    activityAt,
  };
}

function directRow(dm: DirectConversationSummary, drafts: Record<string, ChatDraft>, meId: string | null, nowMs: number, tr: Translate, locale?: Locale): Conversation | null {
  const prefs = prefsOf(dm);
  if (isHiddenRoom(prefs, dm.lastMessage)) return null;
  const roomId = directRoomId(dm.id);
  const activityAt = dm.lastMessage?.at ?? dm.lastMessageAt;
  return {
    roomId,
    kind: 'direct',
    title: dm.peer.displayName,
    avatar: { kind: 'direct', name: dm.peer.displayName, avatarKey: dm.peer.avatarKey ?? null },
    timeLabel: activityAt ? formatChatListTime(activityAt, nowMs, locale) : '',
    preview: previewFor(
      {
        kind: 'direct',
        lastMessage: dm.lastMessage,
        unreadCount: dm.unreadCount,
        mentionedMe: false,
        muted: prefs.muted,
        draft: meId ? draftFor({ drafts }, meId, roomId) : null,
        meId,
        joinedAt: null,
        description: null,
        legacyPreview: dm.lastPreview,
      },
      tr,
    ),
    badge: badgeFor(dm.unreadCount, prefs),
    pinned: prefs.pinned,
    muted: prefs.muted,
    unreadCount: dm.unreadCount,
    markedUnread: prefs.markedUnread,
    activityAt,
  };
}

/** Pinned first, then newest activity first; rows with no activity go last, by title. */
/** 置顶在前，然后按最近活动从新到旧；没有活动的排在最后，按名称排序。 */
export function compareConversations(a: Conversation, b: Conversation): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.activityAt && b.activityAt) {
    if (a.activityAt !== b.activityAt) return a.activityAt < b.activityAt ? 1 : -1;
  } else if (a.activityAt || b.activityAt) {
    return a.activityAt ? -1 : 1;
  }
  const byTitle = a.title.localeCompare(b.title);
  if (byTitle !== 0) return byTitle;
  return a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0;
}

export function buildConversations(
  overview: ChatOverviewResponse | null,
  drafts: Record<string, ChatDraft>,
  meId: string | null,
  nowMs: number,
  tr: Translate,
  locale?: Locale,
): Conversation[] {
  if (!overview) return [];
  const rows: Conversation[] = [];
  for (const channel of overview.channels) {
    const row = channelRow(channel, drafts, meId, nowMs, tr, locale);
    if (row) rows.push(row);
  }
  for (const dm of overview.direct) {
    const row = directRow(dm, drafts, meId, nowMs, tr, locale);
    if (row) rows.push(row);
  }
  return rows.sort(compareConversations);
}

function sameConversation(a: Conversation, b: Conversation): boolean {
  return (
    a.roomId === b.roomId &&
    a.kind === b.kind &&
    a.title === b.title &&
    a.timeLabel === b.timeLabel &&
    a.pinned === b.pinned &&
    a.muted === b.muted &&
    a.unreadCount === b.unreadCount &&
    a.markedUnread === b.markedUnread &&
    a.activityAt === b.activityAt &&
    a.avatar.kind === b.avatar.kind &&
    a.avatar.name === b.avatar.name &&
    (a.avatar.kind === 'direct' && b.avatar.kind === 'direct' ? a.avatar.avatarKey === b.avatar.avatarKey : true) &&
    a.preview.text === b.preview.text &&
    a.preview.tag?.text === b.preview.tag?.text &&
    a.preview.tag?.tone === b.preview.tag?.tone &&
    a.badge?.type === b.badge?.type &&
    (a.badge?.type === 'count' && b.badge?.type === 'count' ? a.badge.n === b.badge.n : true)
  );
}

/**
 * Keeps the previous object for every row that did not change, so memoized rows skip re-rendering
 * on each poll and each minute tick.
 * 对没有变化的行沿用之前的对象，这样每次轮询和每分钟刷新时，已记忆化的行无需重新渲染。
 */
export function reuseConversations(prev: readonly Conversation[], next: Conversation[]): Conversation[] {
  if (prev.length === 0) return next;
  const byRoom = new Map(prev.map((row) => [row.roomId, row]));
  let changed = prev.length !== next.length;
  const result = next.map((row, index) => {
    const old = byRoom.get(row.roomId);
    const kept = old && sameConversation(old, row) ? old : row;
    if (kept !== prev[index]) changed = true;
    return kept;
  });
  return changed ? result : (prev as Conversation[]);
}

export interface SearchTarget {
  roomId: string;
  kind: 'channel' | 'direct';
  title: string;
  avatar: ConversationAvatar;
}

/**
 * Every conversation whose title matches, hidden ones included, newest activity first. Search finds a
 * chat that 不显示该聊天 took off the list, as WeChat does.
 * 名称匹配的所有会话（包括被隐藏的），按最近活动排序。与微信一致，「不显示该聊天」移出列表的会话仍能搜到。
 */
export function searchConversations(overview: ChatOverviewResponse | null, query: string): SearchTarget[] {
  if (!overview || !query.trim()) return [];
  const found: (SearchTarget & { activityAt: string | null })[] = [];
  for (const channel of overview.channels) {
    if (!matchesQuery(channel.name, query)) continue;
    found.push({
      roomId: channelRoomId(channel.id),
      kind: 'channel',
      title: channel.name,
      avatar: { kind: 'channel', name: channel.name },
      activityAt: channel.lastMessage?.at ?? channel.lastMessageAt ?? channel.joinedAt ?? null,
    });
  }
  for (const dm of overview.direct) {
    if (!matchesQuery(dm.peer.displayName, query)) continue;
    found.push({
      roomId: directRoomId(dm.id),
      kind: 'direct',
      title: dm.peer.displayName,
      avatar: { kind: 'direct', name: dm.peer.displayName, avatarKey: dm.peer.avatarKey ?? null },
      activityAt: dm.lastMessage?.at ?? dm.lastMessageAt,
    });
  }
  found.sort((a, b) => {
    if (a.activityAt && b.activityAt && a.activityAt !== b.activityAt) return a.activityAt < b.activityAt ? 1 : -1;
    if (Boolean(a.activityAt) !== Boolean(b.activityAt)) return a.activityAt ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return found.map(({ roomId, kind, title, avatar }) => ({ roomId, kind, title, avatar }));
}

/** Case-insensitive substring match used by the search page. */
/** 搜索页使用的、不区分大小写的子串匹配。 */
export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return false;
  return text.toLocaleLowerCase().includes(q);
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/**
 * Splits text around every case-insensitive occurrence of the query, for highlighting results.
 * Lower-casing can change string length for a few scripts, so it falls back to no highlight then.
 * 按查询词（不区分大小写）的每次出现切分文字，用于高亮搜索结果。少数文字小写后长度会变化，此时不做高亮。
 */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  if (haystack.length !== text.length || needle.length !== q.length) return [{ text, match: false }];
  const parts: HighlightPart[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    if (at > from) parts.push({ text: text.slice(from, at), match: false });
    parts.push({ text: text.slice(at, at + needle.length), match: true });
    from = at + needle.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}
