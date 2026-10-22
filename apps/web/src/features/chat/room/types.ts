import type { FloorReason, NormalizedChatMessage, QuotePreview, RoomMeta } from '@utmmsc/shared';

/**
 * Contract between the room socket hook and the room screen, timeline and composer.
 * 房间连接 Hook 与房间页、消息列表、输入框之间的约定。
 */

export type RoomStatus = 'connecting' | 'catching_up' | 'open' | 'closed';

export interface PendingImage {
  localUrl: string;
  width: number;
  height: number;
  /** Upload progress from 0 to 1. */
  /** 上传进度，0 到 1。 */
  progress: number;
  /** Null until the upload finishes. */
  /** 上传完成前为 null。 */
  imageKey: string | null;
}

export interface PendingMessage {
  clientId: string;
  text: string;
  replyTo: QuotePreview | null;
  mentions: string[];
  mentionAll: boolean;
  image: PendingImage | null;
  status: 'queued' | 'uploading' | 'sending' | 'failed';
  /** Already localized. */
  /** 已按当前语言翻译。 */
  failure: string | null;
  createdAt: string;
}

/**
 * What a quote of a message would show now. 'unknown' means the row is not loaded and nothing is known
 * about it; 'hidden' means the member hid it; 'unavailable' covers rows below the floor and system rows.
 * 现在引用某条消息会显示什么。'unknown' 表示该消息未加载且一无所知；'hidden' 表示成员已隐藏；'unavailable' 包括低于下限的消息和系统消息。
 */
export type QuoteTargetState = 'ok' | 'recalled' | 'deleted' | 'hidden' | 'unavailable' | 'unknown';

/** Unread state as it was when the member entered the room, before anything was marked read. */
/** 成员进入房间时、尚未标记已读前的未读状态。 */
export interface RoomEntry {
  lastReadId: number;
  unreadCount: number;
  firstUnreadId: number | null;
  firstMentionId: number | null;
}

export interface RoomController {
  /**
   * True when the server speaks the current protocol (ready.rev is a number). Before the first ready it is
   * the last known answer, or true when none is known.
   * 服务端支持当前协议时为 true（ready.rev 为数字）。第一个 ready 帧到达之前取最近一次已知的结果，尚不知道时为 true。
   */
  capable: boolean;
  status: RoomStatus;
  /** True once the socket is open and this connection's first history result is applied. */
  /** 连接已打开且本次连接的第一个历史结果已应用后为 true。 */
  synced: boolean;
  retrying: boolean;
  /** Set when the member can no longer read this room; the screen stops reconnecting. */
  /** 成员已无法阅读此房间时设置；页面不再重连。 */
  fatalError: string | null;
  meta: RoomMeta | null;
  /** Normalized, redacted, ascending by id, with the member's own hidden rows removed. */
  /** 已规范化、已清理、按 id 升序，并去掉了成员自己隐藏的消息。 */
  messages: NormalizedChatMessage[];
  pending: PendingMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  olderFailed: boolean;
  reachedFloor: boolean;
  floorReason: FloorReason | null;
  visibleFromId: number;
  entry: RoomEntry | null;
  lastReadId: number;
  canPost: boolean | null;
  mutedUntil: string | null;
  mediaToken: string | null;
  /** Server clock minus device clock, in milliseconds. */
  /** 服务器时钟减去设备时钟，单位毫秒。 */
  clockSkewMs: number;
  /** Already localized. */
  /** 已按当前语言翻译。 */
  notice: string | null;

  loadOlder(): void;
  retryOlder(): void;
  /** Pages back until the message is loaded. Resolves false when it cannot be reached. */
  /** 向前翻页直到该消息已加载。无法定位时返回 false。 */
  loadUntil(id: number): Promise<boolean>;
  trimOldest(keep?: number): void;
  /** Returns the clientId of the queued message. */
  /** 返回已排队消息的 clientId。 */
  sendText(input: { text: string; replyTo?: QuotePreview | null; mentions?: string[]; mentionAll?: boolean }): string;
  sendImage(file: File, size: { width: number; height: number }): string;
  resend(clientId: string): void;
  discard(clientId: string): void;
  markRead(id: number): void;
  /** Hides a message for this member only, on all of their devices. */
  /** 只为本成员隐藏一条消息，在其所有设备上生效。 */
  hide(id: number): void;
  removeAsModerator(id: number): void;
  recall(id: number): void;
  /** The recalled text, for the author only, while the row is still recalled and the stash is fresh. */
  /** 被撤回的原文，仅作者可取，且仅在消息仍为撤回状态、暂存未过期时可取。 */
  reeditText(id: number): string | null;
  /** The current state of a message someone may be quoting. */
  /** 某条可能正被引用的消息的当前状态。 */
  quoteTarget(id: number): QuoteTargetState;
  mute(memberId: string, minutes: number): void;
  clearNotice(): void;
}

export interface MessageListProps {
  room: RoomController;
  kind: 'channel' | 'direct';
  meId: string;
  canModerate: boolean;
  onOpenProfile(id: string): void;
  onMentionAuthor(author: { id: string; displayName: string }): void;
  onQuote(quote: QuotePreview): void;
  onReEdit(text: string): void;
  onMute(memberId: string): void;
  onBackgroundTap(): void;
}

export interface MessageListHandle {
  scrollToBottom(smooth?: boolean): void;
  jumpTo(id: number): Promise<void>;
}

export interface ComposerProps {
  roomId: string;
  kind: 'channel' | 'direct';
  room: Pick<RoomController, 'sendText' | 'sendImage' | 'status' | 'capable' | 'quoteTarget'>;
  disabledNotice: string | null;
  canMentionAll: boolean;
  onSent(): void;
  onPanelChange?(open: boolean): void;
}

export interface ComposerHandle {
  focus(): void;
  collapse(): void;
  insertMention(member: { id: string; displayName: string }): void;
  setQuote(quote: QuotePreview): void;
  restoreText(text: string): void;
}
