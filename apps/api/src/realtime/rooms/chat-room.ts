import { DurableObject } from 'cloudflare:workers';
import {
  CHANGED_MAX,
  CLIENT_FRAME_MAX,
  HISTORY_PAGE_SIZE,
  IMAGE_DIMENSION_MAX,
  MESSAGE_TEXT_MAX,
  REQUEST_ID_MAX,
  STICKER_MESSAGES,
  STICKER_TEXT,
  SYSTEM_AUTHOR_ID,
  canModerateRoom,
  decideModeration,
  decideRecall,
  hasPermission,
  isStickerAliasName,
  parseClientFrame,
  parseRoomId,
  redactChatMessage,
  stickerAliasKey,
  type ChatAuthor,
  type ChatMessage,
  type ClientFrame,
  type ErrorFrame,
  type FloorReason,
  type HistoryDirection,
  type HistoryFrame,
  type HistoryResultFrame,
  type ModerationDecision,
  type Role,
  type RoomAccess,
  type RoomMemberSummary,
  type SendFrame,
  type ServerFrame,
  type StickerRef,
  type SystemMemberRef,
} from '@utmmsc/shared';
import type { Env } from '../../env';
import { conversationPreview, lastMessagePreview, parseSystemEvent } from '../../domain/messaging/preview';
import { OPEN_ACCESS, coerceRoomAccess } from '../../domain/messaging/visibility';
import { touchChannel } from '../../infrastructure/d1/channels';
import { findAuthorCards, findMemberRole, type AuthorCard } from '../../infrastructure/d1/members';
import { touchDirect } from '../../infrastructure/d1/direct';
import { findStickerRef } from '../../infrastructure/d1/sticker-refs';
import type { Retraction } from '../../domain/notifications/payloads';
import { MESSAGE_PUSH_INTERVAL_MS, notifyChatMessage, notifyChatRetraction, type MessageRecipient } from '../../infrastructure/push/chat';
import { isRoomImageKey } from '../../infrastructure/r2/objects';
import {
  buildQuotePreview,
  capList,
  decideFloor,
  joinEvent,
  joinFallbackText,
  parseStickerJson,
  quoteForViewer,
  sanitizeMentions,
  slicePage,
  unreadBaseline,
  type QuoteTarget,
} from './history';
import { AuthorCache } from './author-cache';
import { recordPushedMessage, takePushedMembers } from './push-sent';
import { claimPushSlots } from './push-throttle';
import { currentRev, ensureRoomSchema, nextRev } from './room-schema';
import { StickerLookup, type StickerDescription } from './sticker-lookup';

/**
 * Identity attached to each socket; survives hibernation through serializeAttachment. The floor is
 * computed once at connect and raised by a clear, so every later frame on this socket respects it.
 * 附着在每个连接上的身份；通过 serializeAttachment 在休眠后保留。下限在连接时计算一次、清空时上调，此连接之后的每一帧都遵守它。
 */
export interface SocketIdentity {
  memberId: string;
  displayName: string;
  role: Role;
  canPost: boolean;
  avatarKey?: string | null;
  access?: RoomAccess;
  floorId?: number;
  floorReason?: FloorReason | null;
  /** Random per connection; keys the history rate window for clients that send no requestId. */
  /** 每个连接随机生成；用于不带 requestId 的客户端的历史查询频率窗口。 */
  socketId?: string;
  /** The page holding this socket said it is off screen; such a socket does not stop pushes. */
  /** 持有此连接的页面声明自己不在屏幕上；这样的连接不会挡住推送。 */
  hidden?: boolean;
}

/** Row shape of the `messages` table; the index signature satisfies SqlStorage's generic bound. */
/** `messages` 表的行结构；索引签名用于满足 SqlStorage 的泛型约束。 */
interface MessageRow extends Record<string, SqlStorageValue> {
  id: number;
  author_id: string;
  author_name: string;
  text: string;
  image_key: string | null;
  created_at: string;
  deleted: number;
  recalled: number;
  avatar_key: string | null;
  kind: string;
  system_json: string | null;
  reply_to_id: number | null;
  mention_all: number;
  client_id: string | null;
  image_w: number | null;
  image_h: number | null;
  deleted_by: string | null;
  rev: number;
  /** Schema 6: the image's 360 px preview, under the same room prefix. */
  /** 结构版本 6：图片的 360px 预览图，位于同一房间前缀下。 */
  thumb_key: string | null;
  /** Schema 8: the sticker this row shows (StickerRef as JSON), as read from D1 when it was sent; null otherwise. */
  /** 结构版本 8：这一行显示的表情（StickerRef 的 JSON），即发送时从 D1 读取的描述；其他行为 null。 */
  sticker_json: string | null;
}

type QuoteRow = QuoteTarget & Record<string, SqlStorageValue>;

/** A catch-up row, flagged when the viewer hid it for themselves. */
/** 补齐返回的行，观看者为自己隐藏过时带有标记。 */
type ChangedRow = MessageRow & { hidden_by_viewer: number };

interface Viewer {
  memberId: string;
  floorId: number;
}

interface ViewerState {
  floorId: number;
  floorReason: FloorReason | null;
  baseline: number;
}

type ErrorExtras = Pick<ErrorFrame, 'clientId' | 'requestId' | 'messageId' | 'mutedUntil'>;

const SEND_WINDOW_MS = 10_000;
const SEND_WINDOW_MAX = 12;
/**
 * Sends one member may have waiting in their queue at once. An honest client never gets near it: this many sends at
 * once would go over the rate limit anyway.
 * 一位成员的队列中同时等待的发送数上限。正常客户端不会接近这个数：同时有这么多发送，本来就会超过限流。
 */
export const SEND_QUEUE_MAX = SEND_WINDOW_MAX * 2;
const HISTORY_WINDOW_MS = 10_000;
const HISTORY_WINDOW_MAX = 20;
/** Catch-up pages stay small so a reply with its changed rows stays well under the 1 MiB frame limit. */
/** 补齐页保持较小，带上变更行后仍远低于 1 MiB 的单帧上限。 */
const CATCH_UP_PAGE_MAX = HISTORY_PAGE_SIZE;
const SYSTEM_AUTHOR_NAME = '系统';
const CLIENT_ID_MAX = 64;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
/** Ids bound in one IN list, kept below the storage limit on bound parameters. */
/** 单个 IN 列表绑定的 id 数，低于存储层对绑定参数数量的限制。 */
const IDS_PER_QUERY = 90;

/** Rows this member hid for themselves. Used inside queries whose outer table is `messages`. */
/** 该成员为自己隐藏的消息。用于外层表为 `messages` 的查询。 */
const NOT_HIDDEN = 'NOT EXISTS (SELECT 1 FROM hidden_messages h WHERE h.member_id = ? AND h.message_id = messages.id)';

/** Rows that count toward unread: live user messages from someone else that the member has not hidden. */
/** 计入未读的行：别人发的、未删除未撤回、且该成员未隐藏的普通消息。 */
const UNREAD_WHERE = `id > ? AND kind = 'user' AND deleted = 0 AND recalled = 0 AND author_id != ? AND ${NOT_HIDDEN}`;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * One instance per channel or direct conversation. Holds message history and read cursors in its
 * own SQLite storage, fans out to connected sockets, and sleeps between messages.
 * 每个频道或私聊一个实例。消息历史与已读游标存于自身 SQLite，向在线连接广播，消息间隙休眠。
 */
export class ChatRoom extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private roomId: string | null = null;
  private readonly sendWindows = new Map<string, number[]>();
  private readonly historyWindows = new Map<string, number[]>();
  private readonly legacyHistoryWindows = new Map<string, number[]>();
  /** Message pushes still being sent, by message id; a recall waits for its message's push before replacing it. */
  /** 仍在发送中的消息推送，按消息 id 记录；撤回要等原消息的推送发完再替换它。 */
  private readonly pushesInFlight = new Map<number, Promise<void>>();
  /** Current author names and avatars for history pages, so most pages read nothing from D1. */
  /** 历史页使用的作者当前名字和头像，大多数页面因此无需读取 D1。 */
  private readonly authors: AuthorCache;
  /** Sticker descriptions read from D1, so a sticker sent again is checked without a round trip. */
  /** 从 D1 读取过的表情描述，再次发送同一表情时无需往返即可校验。 */
  private readonly stickerLookup: StickerLookup;
  /**
   * The last send still running for each member, by member id. A send that has to wait for D1 holds the member's
   * later sends behind it, so every member's messages are stored in the order they were sent.
   * 每位成员仍在进行中的最后一次发送，按成员 id 记录。需要等待 D1 的发送会让该成员之后的发送排在它后面，因此每位成员的消息都按发送顺序保存。
   */
  private readonly sendQueues = new Map<string, Promise<void>>();
  /** How many of each member's sends are in their queue and not finished, by member id; a member with none has no entry. */
  /** 每位成员队列中尚未完成的发送数，按成员 id 记录；没有这样的发送的成员不占条目。 */
  private readonly sendsWaiting = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.authors = new AuthorCache((ids) => findAuthorCards(this.env.DB, ids));
    this.stickerLookup = new StickerLookup((id) => findStickerRef(this.env.DB, id, new Date().toISOString()));
    ensureRoomSchema(this.sql);
    // Heartbeats are answered by the runtime without waking the object, so idle rooms can hibernate.
    // 心跳由运行时直接应答，不唤醒对象，空闲房间才能真正休眠。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(JSON.stringify({ type: 'ping' }), JSON.stringify({ type: 'pong' })));
    ctx.blockConcurrencyWhile(async () => {
      this.roomId = (await ctx.storage.get<string>('roomId')) ?? null;
    });
  }

  /* RPC used by the Worker */

  /**
   * Unread count, first unread and first mention, and the newest visible row for one member, using
   * the same floor and baseline as the socket's ready frame.
   * 某成员的未读数、第一条未读、第一条 @ 以及最新可见的一行，与连接 ready 帧使用相同的下限和基线。
   */
  async summaryFor(input: { memberId: string; access: RoomAccess }): Promise<RoomMemberSummary> {
    const access = coerceRoomAccess(input.access);
    const state = this.viewerState(input.memberId, access);
    const unread = this.unreadOf(input.memberId, state.baseline);
    const last = this.sql
      .exec<MessageRow>(
        `SELECT * FROM messages
         WHERE id >= ? AND NOT (deleted = 1 AND COALESCE(deleted_by, '') = 'author') AND ${NOT_HIDDEN}
         ORDER BY id DESC LIMIT 1`,
        state.floorId,
        input.memberId,
      )
      .toArray()[0];
    return { ...unread, lastMessage: last ? lastMessagePreview(last) : null, joinedAt: access.joinedAt };
  }

  /** Kept for one release so a Worker deployed before summaryFor keeps working. */
  /** 保留一个版本，使 summaryFor 之前部署的 Worker 仍能工作。 */
  async getUnread(memberId: string): Promise<number> {
    return (await this.summaryFor({ memberId, access: OPEN_ACCESS })).unreadCount;
  }

  async markAllRead(memberId: string): Promise<void> {
    this.markRead(memberId, this.latestId());
  }

  /**
   * Clears the room for one member only: everything up to now disappears on all of their devices,
   * while other members are unaffected. Returns the first id they can still see.
   * 只为一个成员清空房间：到目前为止的内容在其所有设备上消失，其他成员不受影响。返回其仍能看到的第一个 id。
   */
  async clearFor(memberId: string): Promise<number> {
    const latest = this.latestId();
    this.sql.exec(
      `INSERT INTO member_state (member_id, clear_id) VALUES (?, ?)
       ON CONFLICT(member_id) DO UPDATE SET clear_id = MAX(clear_id, excluded.clear_id)`,
      memberId,
      latest,
    );
    this.markRead(memberId, latest);
    const beforeId = this.clearIdOf(memberId) + 1;
    const rev = nextRev(this.sql);
    const payload = JSON.stringify({ type: 'cleared', beforeId, rev } satisfies ServerFrame);
    for (const socket of this.ctx.getWebSockets(memberId)) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity && (identity.floorId ?? 0) <= beforeId) {
        socket.serializeAttachment({ ...identity, floorId: beforeId, floorReason: 'clear' } satisfies SocketIdentity);
      }
      this.trySend(socket, payload);
    }
    return beforeId;
  }

  /**
   * Writes one join notice for members an admin added. The row is stamped no earlier than `at`, the
   * moment the memberships were written, so it lands at or above each new member's floor even when
   * the Worker and this object disagree slightly about the time.
   * 为管理员添加的成员写一条入群提示。该行的时间不早于 `at`（写入成员记录的时刻），即使 Worker 与本对象的时钟略有偏差，它也会落在每位新成员的下限上或之上。
   */
  async recordJoins(input: { roomId?: string; actor: SystemMemberRef | null; members: SystemMemberRef[]; at?: string }): Promise<void> {
    if (input.members.length === 0) return;
    // A channel created a moment ago has had no socket yet, so the room learns its id here and can record activity.
    // 刚创建的频道还没有任何连接，房间在这里得知自己的 id，之后才能记录活动时间。
    if (!this.roomId && input.roomId && parseRoomId(input.roomId)) {
      this.roomId = input.roomId;
      await this.ctx.storage.put('roomId', input.roomId);
    }
    const event = joinEvent(input.actor, input.members);
    const atMs = input.at ? Date.parse(input.at) : Number.NaN;
    const createdAt = new Date(Number.isFinite(atMs) ? Math.max(Date.now(), atMs) : Date.now()).toISOString();
    const row = this.sql
      .exec<MessageRow>(
        `INSERT INTO messages (author_id, author_name, text, image_key, created_at, avatar_key, kind, system_json, rev)
         VALUES (?, ?, ?, NULL, ?, NULL, 'system', ?, ?) RETURNING *`,
        SYSTEM_AUTHOR_ID,
        SYSTEM_AUTHOR_NAME,
        joinFallbackText(event),
        createdAt,
        JSON.stringify(event),
        nextRev(this.sql),
      )
      .one();
    this.broadcastMessage(row);
    this.ctx.waitUntil(this.recordActivity());
  }

  /**
   * Closes every socket of one member, or of everyone when memberId is omitted. The Worker calls
   * this when access changes; clients then ask for a fresh ticket, which re-checks access.
   * 关闭某个成员（未指定时为所有人）的全部连接。权限变化时由 Worker 调用；客户端随后重新领取票据，届时重新校验权限。
   */
  async revoke(memberId?: string): Promise<void> {
    const sockets = memberId ? this.ctx.getWebSockets(memberId) : this.ctx.getWebSockets();
    for (const socket of sockets) {
      try {
        socket.close(4003, 'access changed');
      } catch {
        // Already closing.
        // 已在关闭中。
      }
    }
  }

  /**
   * Called after a member changes their avatar. Old uploaded avatars are deleted from storage, so
   * stored rows, open sockets, and on-screen messages all move to the new one. The rows take a new
   * revision so a reconnecting client refreshes names it already holds. The author cache takes the new
   * values too, so the next history page shows them without reading D1.
   * 成员更换头像后调用。旧的上传头像会从存储中删除，因此已存的消息、打开的连接和屏幕上的消息都要换成新头像。这些行会取新的版本号，重连的客户端据此刷新已有的名字。
   * 作者缓存也同时更新，下一页历史无需读取 D1 就能显示新信息。
   */
  async refreshAuthor(author: ChatAuthor): Promise<void> {
    const avatarKey = author.avatarKey ?? null;
    this.authors.put(author.id, { displayName: author.displayName, avatarKey });
    const hasRows = this.sql.exec<{ e: number }>('SELECT EXISTS(SELECT 1 FROM messages WHERE author_id = ?) AS e', author.id).one().e === 1;
    const rev = hasRows ? nextRev(this.sql) : currentRev(this.sql);
    if (hasRows) {
      this.sql.exec('UPDATE messages SET author_name = ?, avatar_key = ?, rev = ? WHERE author_id = ?', author.displayName, avatarKey, rev, author.id);
    }
    for (const socket of this.ctx.getWebSockets(author.id)) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity) socket.serializeAttachment({ ...identity, displayName: author.displayName, avatarKey });
    }
    this.broadcast({ type: 'author', author: { id: author.id, displayName: author.displayName, avatarKey }, rev });
  }

  /* WebSocket upgrade */

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const identityHeader = request.headers.get('x-room-identity');
    const roomIdHeader = request.headers.get('x-room-id');
    const ticketId = request.headers.get('x-room-ticket-id');
    const ticketExp = Number(request.headers.get('x-room-ticket-exp'));
    if (!identityHeader || !roomIdHeader || !ticketId || !Number.isFinite(ticketExp)) {
      return new Response('missing identity', { status: 400 });
    }
    let claimed: SocketIdentity;
    try {
      claimed = JSON.parse(identityHeader) as SocketIdentity;
    } catch {
      return new Response('missing identity', { status: 400 });
    }

    // Each ticket opens one socket; a replayed URL is refused.
    // 每张票据只能打开一个连接；重放的链接会被拒绝。
    this.sql.exec('DELETE FROM used_tickets WHERE exp <= ?', Date.now());
    const fresh = this.sql.exec('INSERT OR IGNORE INTO used_tickets (jti, exp) VALUES (?, ?)', ticketId, ticketExp).rowsWritten;
    if (!fresh) return new Response('ticket already used', { status: 401 });

    if (this.roomId !== roomIdHeader) {
      this.roomId = roomIdHeader;
      await this.ctx.storage.put('roomId', roomIdHeader);
    }

    const access = coerceRoomAccess(claimed.access);
    const state = this.viewerState(claimed.memberId, access);
    const identity: SocketIdentity = {
      memberId: claimed.memberId,
      displayName: claimed.displayName,
      role: claimed.role,
      canPost: claimed.canPost === true,
      avatarKey: claimed.avatarKey ?? null,
      access,
      floorId: state.floorId,
      floorReason: state.floorReason,
      socketId: crypto.randomUUID(),
    };

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [identity.memberId]);
    server.serializeAttachment(identity);

    const unread = this.unreadOf(identity.memberId, state.baseline);
    const ready: ServerFrame = {
      type: 'ready',
      roomId: roomIdHeader,
      memberId: identity.memberId,
      lastReadId: state.baseline,
      onlineCount: this.onlineCount(),
      visibleFromId: state.floorId,
      floorReason: state.floorReason,
      joinedAt: access.joinedAt,
      unreadCount: unread.unreadCount,
      firstUnreadId: unread.firstUnreadId,
      firstMentionId: unread.firstMentionId,
      mutedUntil: this.mutedUntil(identity.memberId),
      serverTime: new Date().toISOString(),
      rev: currentRev(this.sql),
      visibility: true,
      stickers: true,
    };
    server.send(JSON.stringify(ready));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) {
      ws.close(1008, 'no identity');
      return;
    }
    if ((typeof raw === 'string' ? raw.length : raw.byteLength) > CLIENT_FRAME_MAX) {
      this.sendError(ws, 'invalid_frame', '消息过大');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      this.sendError(ws, 'invalid_frame', '消息格式错误');
      return;
    }
    const frame = parseClientFrame(parsed);
    if (!frame) {
      this.rejectFrame(ws, parsed);
      return;
    }
    await this.handleFrame(ws, identity, frame);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (identity?.socketId) this.legacyHistoryWindows.delete(identity.socketId);
    // Finish the close handshake; 1005/1006 are reserved and cannot be sent back.
    // 完成关闭握手；1005/1006 为保留码，不能回发。
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
      // 已关闭。
    }
  }

  /* Frame handling */

  private async handleFrame(ws: WebSocket, identity: SocketIdentity, frame: ClientFrame): Promise<void> {
    switch (frame.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' } satisfies ServerFrame));
        return;
      case 'history':
        await this.sendHistory(ws, identity, frame);
        return;
      case 'read':
        // Never past the newest message, or a bad client would hide all future unread counts.
        // 不能超过最新消息，否则异常客户端会让之后的未读数永远为零。
        this.markRead(identity.memberId, Math.min(frame.messageId, this.latestId()));
        return;
      case 'send':
        await this.queueSend(ws, identity, frame);
        return;
      case 'delete':
        await this.handleDelete(ws, identity, frame.messageId);
        return;
      case 'recall':
        await this.handleRecall(ws, identity, frame.messageId);
        return;
      case 'hide':
        this.handleHide(ws, identity, frame.messageId);
        return;
      case 'mute':
        await this.handleMute(ws, identity, frame.memberId, frame.minutes);
        return;
      case 'visibility':
        this.handleVisibility(ws, frame.visible);
        return;
    }
  }

  /** Re-read here: another frame may have updated the attachment since this one was parsed. */
  /** 在这里重新读取：解析本帧之后，其他帧可能已经更新过附件。 */
  private handleVisibility(ws: WebSocket, visible: boolean): void {
    const current = ws.deserializeAttachment() as SocketIdentity | null;
    if (!current || (current.hidden === true) === !visible) return;
    ws.serializeAttachment({ ...current, hidden: !visible } satisfies SocketIdentity);
  }

  /**
   * A frame the protocol rejected still echoes the identifiers it carried, so the client can fail
   * the right outbox item or history request instead of waiting for a timeout.
   * 被协议拒绝的帧仍会回带其中的标识，客户端据此让对应的待发项或历史请求失败，而不必等待超时。
   */
  private rejectFrame(ws: WebSocket, parsed: unknown): void {
    const record = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const extras: ErrorExtras = {};
    let message = '消息格式错误';
    if (record.type === 'send') {
      if (typeof record.clientId === 'string' && record.clientId.length > 0 && record.clientId.length <= CLIENT_ID_MAX) extras.clientId = record.clientId;
      if ((record.imageWidth !== undefined || record.imageHeight !== undefined) && !this.validDimensions(record)) message = '图片尺寸无效';
    }
    if (record.type === 'history' && typeof record.requestId === 'string' && record.requestId.length <= REQUEST_ID_MAX && REQUEST_ID_PATTERN.test(record.requestId)) {
      extras.requestId = record.requestId;
    }
    if ((record.type === 'recall' || record.type === 'delete' || record.type === 'hide') && typeof record.messageId === 'number' && Number.isInteger(record.messageId) && record.messageId > 0) {
      extras.messageId = record.messageId;
    }
    this.sendError(ws, 'invalid_frame', message, extras);
  }

  private validDimensions(frame: { imageKey?: unknown; imageWidth?: unknown; imageHeight?: unknown }): boolean {
    const inRange = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= IMAGE_DIMENSION_MAX;
    if (frame.imageWidth === undefined && frame.imageHeight === undefined) return true;
    return typeof frame.imageKey === 'string' && inRange(frame.imageWidth) && inRange(frame.imageHeight);
  }

  /**
   * Runs every send through its author's queue. This object takes other frames while it waits on D1, and the
   * outbox sends its next item without waiting for an ack, so a sticker whose lookup misses the cache could otherwise
   * be stored after a text sent right behind it. A send that needs no D1 read (text, an image, or a sticker already
   * in the lookup cache) runs at once, exactly as before, when nothing of this member's is waiting; anything else is
   * chained behind the member's last send. Other members' sends never wait for this queue, and a failing send never
   * stops the ones behind it. The rate limit and every other check run only when a send reaches the head, so the queue
   * itself is bounded: with SEND_QUEUE_MAX of a member's sends waiting, the next one is refused at once and not held,
   * and a lookup stuck on a slow D1 cannot make the member's queue, and the frames it keeps, grow without end.
   * 每次发送都经过其作者的队列。本对象等待 D1 时会处理其他帧，而发件箱发送下一项时不等确认，所以缓存未命中的表情有可能被保存在紧随其后发送的文字之后。
   * 不需要读取 D1 的发送（文字、图片，或已在缓存中的表情）在该成员没有等待中的发送时立即执行，与以前完全相同；其他情况排在该成员上一次发送之后。
   * 其他成员的发送从不等待这个队列，某次发送失败也不会挡住排在后面的发送。限流和其他检查都要等发送排到最前面才执行，所以队列本身有上限：
   * 该成员已有 SEND_QUEUE_MAX 次发送在等待时，下一次会被立即拒绝且不被保留，卡在缓慢 D1 上的查询也就不会让该成员的队列及其保留的帧无限增长。
   */
  private queueSend(ws: WebSocket, identity: SocketIdentity, frame: SendFrame): Promise<void> {
    const memberId = identity.memberId;
    const tail = this.sendQueues.get(memberId);
    const cached = frame.sticker !== undefined ? this.stickerLookup.peek(frame.sticker) : undefined;
    if (!tail && (frame.sticker === undefined || cached)) return this.handleSend(ws, identity, frame, cached);

    // The refusal names the clientId, so the client fails only this item and the member can send it again. A resend
    // of a message already stored is answered from its row instead, as handleSend would, so a lost ack is never refused.
    // 拒绝时带上 clientId，客户端只让这一项失败，成员之后可以再发一次。已保存消息的重发则像 handleSend 那样用已存的行回复，确认丢失后的重发不会被拒绝。
    const waiting = this.sendsWaiting.get(memberId) ?? 0;
    if (waiting >= SEND_QUEUE_MAX) {
      const existing = identity.canPost ? this.findOwnRow(memberId, frame.clientId) : undefined;
      if (existing) this.echoOwnRow(ws, identity, existing, frame.clientId);
      else this.sendError(ws, 'rate_limited', '发送太快，请稍候', { clientId: frame.clientId });
      return Promise.resolve();
    }
    this.sendsWaiting.set(memberId, waiting + 1);
    // The place is given back however the send ends, a throw included, so a member is never left refused.
    // 无论发送如何结束（包括抛出异常）都会归还名额，成员不会因此一直被拒绝。
    const release = () => {
      const left = (this.sendsWaiting.get(memberId) ?? 1) - 1;
      if (left > 0) this.sendsWaiting.set(memberId, left);
      else this.sendsWaiting.delete(memberId);
    };
    const step = () => this.handleSend(ws, identity, frame);
    const run = (tail ? tail.then(step) : step())
      .catch((err: unknown) => {
        console.error('chat: a queued send failed', errorText(err));
      })
      .finally(release);
    this.sendQueues.set(memberId, run);
    void run.then(() => {
      if (this.sendQueues.get(memberId) === run) this.sendQueues.delete(memberId);
    });
    return run;
  }

  /**
   * Checks run in a fixed order and every rejection names the clientId. A repeated clientId is
   * answered from the stored row before mute or rate limits, so a resend after a lost ack never
   * costs quota or creates a second row. A sticker is stored as D1 describes it, never as the client
   * does; only the sender's still comes from the frame. `cached` is the description queueSend already
   * found in memory.
   * 检查按固定顺序进行，每次拒绝都带上 clientId。重复的 clientId 会在禁言和限流之前直接用已存的行回复，因此确认丢失后的重发既不消耗额度也不会产生第二行。
   * 表情按 D1 中的描述保存，从不采用客户端的说法；只有发送者的静态图取自帧。`cached` 是 queueSend 已在内存中找到的描述。
   */
  private async handleSend(ws: WebSocket, identity: SocketIdentity, frame: SendFrame, cached?: StickerDescription): Promise<void> {
    const { clientId } = frame;
    const imageKey = frame.sticker === undefined ? (frame.imageKey ?? null) : null;
    if (!identity.canPost) {
      this.sendError(ws, 'forbidden', '此频道不允许你发言', { clientId });
      return;
    }
    const trimmed = frame.text.trim();
    if (!trimmed && !imageKey && frame.sticker === undefined) {
      this.sendError(ws, 'invalid_frame', '消息不能为空', { clientId });
      return;
    }
    if (trimmed.length > MESSAGE_TEXT_MAX) {
      this.sendError(ws, 'text_too_long', `消息最多 ${MESSAGE_TEXT_MAX} 字`, { clientId });
      return;
    }
    if (!this.validDimensions(frame)) {
      this.sendError(ws, 'invalid_frame', '图片尺寸无效', { clientId });
      return;
    }

    const existing = this.findOwnRow(identity.memberId, clientId);
    if (existing) {
      this.echoOwnRow(ws, identity, existing, clientId);
      return;
    }

    const mutedUntil = this.mutedUntil(identity.memberId);
    if (mutedUntil) {
      this.sendError(ws, 'muted', '你已被禁言', { clientId, mutedUntil });
      return;
    }
    if (!this.allowIn(this.sendWindows, identity.memberId, SEND_WINDOW_MS, SEND_WINDOW_MAX)) {
      this.sendError(ws, 'rate_limited', '发送太快，请稍候', { clientId });
      return;
    }
    if (imageKey && this.roomId && !isRoomImageKey(this.roomId, imageKey)) {
      this.sendError(ws, 'invalid_frame', '图片无效', { clientId });
      return;
    }
    // The thumbnail is checked like the image, since rows show it in its place. One that names the image itself
    // adds nothing and is dropped, so a withdrawal never deletes the same object twice.
    // 缩略图与图片一样检查，因为消息行用它代替图片显示。与图片本身相同的缩略图没有意义，会被丢弃，撤回时就不会把同一个对象删除两次。
    const thumbKey = imageKey && frame.thumbKey && frame.thumbKey !== imageKey ? frame.thumbKey : null;
    if (thumbKey && this.roomId && !isRoomImageKey(this.roomId, thumbKey)) {
      this.sendError(ws, 'invalid_frame', '图片无效', { clientId });
      return;
    }
    // Sticker aliases exist only in what the room sends old clients, and the media route serves a sticker for one.
    // A photo naming one would show a sticker the room never checked, so no alias is ever stored as a key.
    // 表情别名只出现在房间发给旧客户端的内容里，媒体接口会为它提供表情文件。以别名作为图片的消息会显示一个房间从未校验过的表情，
    // 因此别名永远不会作为键被保存。
    if ((imageKey && isStickerAliasName(imageKey)) || (thumbKey && isStickerAliasName(thumbKey))) {
      this.sendError(ws, 'invalid_frame', '图片无效', { clientId });
      return;
    }
    // Upload keys are random, go back only to the uploader, and are never sent twice (a resend is answered above
    // from the stored row). So a key another message already names is someone else's photo: naming it would let
    // the sender delete it by withdrawing their own message, or put their picture in its row as the thumbnail.
    // 上传的键是随机的，只返回给上传者，也从不会发送两次（重发已在上面由已存的行回复）。因此已被其他消息使用的键是别人的照片：
    // 若允许使用，发送者就能通过撤回或删除自己的消息把它删掉，或者把自己的图片作为缩略图放进那条消息的行里。
    if (imageKey && this.rowsNamingKeys([imageKey, thumbKey]).length > 0) {
      this.sendError(ws, 'invalid_frame', '图片无效', { clientId });
      return;
    }

    let sticker: StickerRef | null = null;
    if (frame.sticker !== undefined) {
      let found = cached ?? this.stickerLookup.peek(frame.sticker);
      if (found === undefined) {
        const loaded = await this.stickerLookup.load(frame.sticker);
        // Other frames ran during the lookup, so a moderator may have muted the member meanwhile.
        // 查询期间其他帧可以执行，管理员可能已在此期间禁言了该成员。
        const mutedNow = this.mutedUntil(identity.memberId);
        if (mutedNow) {
          this.sendError(ws, 'muted', '你已被禁言', { clientId, mutedUntil: mutedNow });
          return;
        }
        if (loaded === 'unavailable') {
          this.sendError(ws, 'invalid_frame', STICKER_MESSAGES.unavailable, { clientId });
          return;
        }
        found = loaded ?? undefined;
      }
      if (!found) {
        this.sendError(ws, 'invalid_frame', STICKER_MESSAGES.notFound, { clientId });
        return;
      }
      sticker = { ...found, thumb: frame.stickerThumb ?? null };
    }

    let replyToId: number | null = null;
    if (frame.replyToId !== undefined) {
      const target = this.findRow(frame.replyToId);
      const live = target && target.kind === 'user' && target.deleted === 0 && target.recalled === 0;
      if (!target || !live || target.id < (identity.floorId ?? 0)) {
        this.sendError(ws, 'invalid_frame', '引用的消息不存在', { clientId });
        return;
      }
      replyToId = target.id;
    }

    const roomKind = (this.roomId ? parseRoomId(this.roomId)?.kind : null) ?? 'channel';
    if (frame.mentionAll && (roomKind !== 'channel' || !hasPermission(identity.role, 'chat.moderate'))) {
      this.sendError(ws, 'forbidden', '只有管理员可以@所有人', { clientId });
      return;
    }
    const mentions = sanitizeMentions(frame.mentions, identity.memberId, roomKind);

    const createdAt = new Date().toISOString();
    const avatarKey = typeof identity.avatarKey === 'string' && identity.avatarKey.length > 0 && identity.avatarKey.length <= 300 ? identity.avatarKey : null;
    let inserted: MessageRow;
    try {
      // A sticker row stores the fallback text '[表情]' and no image keys: builds and Workers that predate stickers
      // show the text, and nothing a withdrawal deletes ever points at the shared sticker file.
      // 表情行保存备用文字 '[表情]'，不保存图片键：早于表情功能的版本和 Worker 显示这段文字，撤回时要删除的内容也永远不会指向共用的表情文件。
      inserted = this.sql
        .exec<MessageRow>(
          `INSERT INTO messages (author_id, author_name, text, image_key, thumb_key, created_at, avatar_key, kind, reply_to_id, mention_all, client_id, image_w, image_h, sticker_json, rev)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          identity.memberId,
          identity.displayName,
          sticker ? STICKER_TEXT : trimmed,
          imageKey,
          thumbKey,
          createdAt,
          avatarKey,
          replyToId,
          frame.mentionAll ? 1 : 0,
          clientId,
          sticker ? null : (frame.imageWidth ?? null),
          sticker ? null : (frame.imageHeight ?? null),
          sticker ? JSON.stringify(sticker) : null,
          nextRev(this.sql),
        )
        .one();
    } catch (err) {
      const again = /UNIQUE constraint/i.test(errorText(err)) ? this.findOwnRow(identity.memberId, clientId) : null;
      if (!again) throw err;
      this.echoOwnRow(ws, identity, again, clientId);
      return;
    }
    for (const memberId of mentions) {
      this.sql.exec('INSERT OR IGNORE INTO mentions (member_id, message_id) VALUES (?, ?)', memberId, inserted.id);
    }
    this.markRead(identity.memberId, inserted.id);
    this.broadcastMessage(inserted, clientId);
    this.ctx.waitUntil(this.recordActivity());
    this.notifyOffline(identity, inserted, mentions);
  }

  /**
   * Pushes a new message to readers who are not looking at the room, after it has been stored and
   * broadcast. A member counts as looking only with a socket on a page that is on screen, so a room left
   * open in a background tab or a backgrounded app still notifies. Nothing here can fail or delay the
   * send. Just before the push goes out, members who opened the room meanwhile are dropped, and a message
   * withdrawn meanwhile is not pushed at all.
   * 消息存储并广播之后，推送给没有在看该房间的读者。只有页面显示在屏幕上的连接才算在看，因此留在后台标签页或后台 App 中的房间仍会通知。
   * 这里的任何问题都不会让发送失败或变慢。推送发出之前，会去掉期间打开了房间的成员；期间被撤回或删除的消息则完全不推送。
   */
  private notifyOffline(identity: SocketIdentity, row: MessageRow, mentions: readonly string[]): void {
    const roomId = this.roomId;
    if (!roomId) return;
    try {
      const throttle = (recipients: readonly MessageRecipient[]): string[] => {
        const current = this.findRow(row.id);
        if (!current || current.deleted === 1 || current.recalled === 1) return [];
        const away = recipients.filter((r) => !this.isWatching(r.memberId));
        const allowed = claimPushSlots(this.sql, away, Date.now(), MESSAGE_PUSH_INTERVAL_MS);
        recordPushedMessage(this.sql, allowed, row.id);
        return allowed;
      };
      const delivery: Promise<void> = notifyChatMessage(this.env, {
        roomId,
        authorId: identity.memberId,
        authorName: identity.displayName,
        text: row.sticker_json ? '' : row.text,
        hasImage: row.image_key !== null,
        hasSticker: Boolean(row.sticker_json),
        mentions,
        mentionAll: row.mention_all === 1,
        connectedMemberIds: this.watchingMemberIds(),
        throttle,
      })
        .then((summary) => {
          if (summary && summary.failed > 0) {
            console.warn(`push: message ${row.id} in ${roomId} reached ${summary.recipients} members; ${summary.failed} of ${summary.devices} devices failed`);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (this.pushesInFlight.get(row.id) === delivery) this.pushesInFlight.delete(row.id);
        });
      this.pushesInFlight.set(row.id, delivery);
      this.ctx.waitUntil(delivery);
    } catch (err) {
      console.error('push: could not start message notification', errorText(err));
    }
  }

  /**
   * After a recall or removal, replaces the message's notice on every device it reached, once its own
   * push has finished, so the text does not stay on lock screens or arrive later from a push service
   * queue. Never fails or delays the recall.
   * 撤回或删除之后，等该消息本身的推送发完，再替换它在每台设备上的通知，原文因此不会留在锁屏上，也不会稍后从推送服务的队列中送达。
   * 不会让撤回失败或变慢。
   */
  private retractPush(row: MessageRow, reason: Retraction): void {
    const roomId = this.roomId;
    if (!roomId || row.kind !== 'user') return;
    try {
      const pending = this.pushesInFlight.get(row.id) ?? Promise.resolve();
      const work = pending
        .then(async () => {
          const memberIds = takePushedMembers(this.sql, row.id);
          if (memberIds.length === 0) return;
          await notifyChatRetraction(this.env, { roomId, authorName: row.author_name, reason, memberIds });
        })
        .catch((err: unknown) => console.error('push: could not replace a withdrawn notice', errorText(err)));
      this.ctx.waitUntil(work);
    } catch (err) {
      console.error('push: could not start replacing a withdrawn notice', errorText(err));
    }
  }

  private findOwnRow(memberId: string, clientId: string): MessageRow | undefined {
    return this.sql.exec<MessageRow>('SELECT * FROM messages WHERE author_id = ? AND client_id = ?', memberId, clientId).toArray()[0];
  }

  /** Answers a duplicate send to the sending socket only, redacted if the original was recalled since. */
  /** 只向发送的连接回复重复的发送；原消息此后已撤回时回复的是清理后的内容。 */
  private echoOwnRow(ws: WebSocket, identity: SocketIdentity, row: MessageRow, clientId: string): void {
    const viewer: Viewer = { memberId: identity.memberId, floorId: identity.floorId ?? 0 };
    const message = this.toMessage(row, undefined, this.loadQuoteTargets([row]), viewer);
    this.trySend(ws, JSON.stringify({ type: 'message', message, clientId } satisfies ServerFrame));
  }

  /**
   * Withdrawal uses the row's stored timestamp and Date.now() on this object, never a client clock.
   * The broadcast and later history omit the original text.
   * 撤回只用本对象上的当前时间和行里存的时间，不信客户端时钟。广播和之后的历史都不再带原文。
   */
  private async handleRecall(ws: WebSocket, identity: SocketIdentity, messageId: number): Promise<void> {
    const row = this.visibleRow(identity, messageId);
    if (!row) {
      this.sendError(ws, 'not_found', '消息不存在', { messageId });
      return;
    }
    if (row.kind === 'system') {
      this.sendError(ws, 'forbidden', '这条消息不能删除', { messageId });
      return;
    }
    const decision = decideRecall({
      authorId: row.author_id,
      actorId: identity.memberId,
      createdAtMs: Date.parse(row.created_at),
      nowMs: Date.now(),
      deleted: row.deleted === 1,
      recalled: row.recalled === 1,
    });
    if (decision === 'not_author') {
      this.sendError(ws, 'forbidden', '只能撤回自己的消息', { messageId });
      return;
    }
    if (decision === 'expired') {
      this.sendError(ws, 'recall_expired', '已超过 3 分钟，无法撤回', { messageId });
      return;
    }
    if (decision !== 'ok') {
      this.sendError(ws, 'forbidden', '这条消息不能撤回', { messageId });
      return;
    }
    const rev = nextRev(this.sql);
    this.sql.exec(
      "UPDATE messages SET recalled = 1, text = '', image_key = NULL, thumb_key = NULL, image_w = NULL, image_h = NULL, sticker_json = NULL, rev = ? WHERE id = ?",
      rev,
      messageId,
    );
    this.touchReplies(messageId, rev);
    this.broadcastFrom(messageId, { type: 'recalled', messageId, rev });
    this.discardImage(row);
    this.ctx.waitUntil(this.recordActivity());
    this.retractPush(row, 'recalled');
  }

  private async handleDelete(ws: WebSocket, identity: SocketIdentity, messageId: number): Promise<void> {
    const found = this.visibleRow(identity, messageId);
    if (!found) {
      this.sendError(ws, 'not_found', '消息不存在', { messageId });
      return;
    }
    if (found.kind === 'system') {
      this.sendError(ws, 'forbidden', '这条消息不能删除', { messageId });
      return;
    }
    const ownMessage = found.author_id === identity.memberId;
    if (!ownMessage) {
      const decision = await this.moderationOf(identity, found.author_id);
      if (decision !== 'ok') {
        const message = decision === 'outranked' ? '不能删除这位成员的消息' : decision === 'unavailable' ? '出错了，请稍后再试' : '只能删除自己的消息';
        this.sendError(ws, 'forbidden', message, { messageId });
        return;
      }
    }
    // Other frames can run while the target's role is read, so the row is read again before it changes.
    // 读取对方身份期间其他帧可能已经执行，所以修改之前重新读取该行。
    const row = this.visibleRow(identity, messageId) ?? found;
    // A row that is already gone keeps its first outcome, so a late delete cannot relabel a recall or a moderator removal.
    // 已经消失的行保持最初的结果，迟到的删除不会改写撤回或管理员删除的标记。
    if (row.recalled === 1) {
      this.trySend(ws, JSON.stringify({ type: 'recalled', messageId, rev: row.rev } satisfies ServerFrame));
      return;
    }
    if (row.deleted === 1) {
      const previous = row.deleted_by === 'author' || row.deleted_by === 'moderator' ? row.deleted_by : undefined;
      this.trySend(ws, JSON.stringify({ type: 'deleted', messageId, ...(previous ? { by: previous } : {}), rev: row.rev } satisfies ServerFrame));
      return;
    }
    const by = ownMessage ? 'author' : 'moderator';
    const rev = nextRev(this.sql);
    this.sql.exec(
      "UPDATE messages SET deleted = 1, deleted_by = ?, text = '', image_key = NULL, thumb_key = NULL, image_w = NULL, image_h = NULL, sticker_json = NULL, rev = ? WHERE id = ?",
      by,
      rev,
      messageId,
    );
    this.touchReplies(messageId, rev);
    this.broadcastFrom(messageId, { type: 'deleted', messageId, by, rev });
    this.discardImage(row);
    this.ctx.waitUntil(this.recordActivity());
    this.retractPush(row, by === 'author' ? 'deleted' : 'removed');
  }

  /** WeChat's delete: the message disappears for this member on all of their devices, and for nobody else. */
  /** 微信式删除：消息只对该成员消失，在其所有设备上生效，其他人不受影响。 */
  private handleHide(ws: WebSocket, identity: SocketIdentity, messageId: number): void {
    const row = this.visibleRow(identity, messageId);
    if (!row) {
      this.sendError(ws, 'not_found', '消息不存在', { messageId });
      return;
    }
    if (row.kind === 'system') {
      this.sendError(ws, 'forbidden', '这条消息不能删除', { messageId });
      return;
    }
    const existing = this.sql
      .exec<{ rev: number }>('SELECT rev FROM hidden_messages WHERE member_id = ? AND message_id = ?', identity.memberId, messageId)
      .toArray()[0];
    let rev = existing?.rev;
    if (rev === undefined) {
      rev = nextRev(this.sql);
      this.sql.exec('INSERT OR IGNORE INTO hidden_messages (member_id, message_id, rev) VALUES (?, ?, ?)', identity.memberId, messageId, rev);
    }
    const payload = JSON.stringify({ type: 'hidden', messageId, rev } satisfies ServerFrame);
    for (const socket of this.ctx.getWebSockets(identity.memberId)) this.trySend(socket, payload);
  }

  /**
   * A row this socket may act on. Rows below its floor answer exactly like missing ones, so recall,
   * delete and hide cannot be used to learn anything about history the member cannot see.
   * 此连接可以操作的行。低于其下限的行与不存在的行回复完全相同，撤回、删除和隐藏因此无法用来探知成员看不到的历史。
   */
  private visibleRow(identity: SocketIdentity, messageId: number): MessageRow | undefined {
    const row = this.findRow(messageId);
    return row && row.id >= (identity.floorId ?? 0) ? row : undefined;
  }

  /**
   * Replies show a quote of the row, so they take the same revision as its recall or removal. A
   * reconnecting client then receives them again, with the quote rebuilt without the withdrawn text,
   * even when the quoted row itself is outside the range it holds.
   * 回复中显示了该行的引用，因此在该行被撤回或删除时取相同的版本号。重连的客户端会再次收到这些回复，引用已重新生成且不含被撤回的内容，即使被引用的行本身不在其已加载的范围内。
   */
  private touchReplies(messageId: number, rev: number): void {
    this.sql.exec('UPDATE messages SET rev = ? WHERE reply_to_id = ?', rev, messageId);
  }

  /**
   * A withdrawn image and its thumbnail must stop being downloadable, not just disappear from history. It runs
   * after the row's keys are cleared. Rows sent before keys were checked against each other may share an object,
   * and the first row that names one is its uploader's (nobody else had the key before that row went out). So an
   * object stays while an earlier row or another row by the same author still names it: a borrower's withdrawal
   * never deletes the uploader's photo, and the uploader's withdrawal still deletes it from under a borrower.
   * 撤回或删除的图片及其缩略图要真正不可下载，而不只是从历史里隐藏。它在该行的键清空之后执行。在键互相核对之前发送的行可能共用同一个对象，
   * 而最早使用某个对象的行属于上传者（在那一行发出之前没有别人知道这个键）。因此只要更早的行或同一作者的其他行仍在使用，对象就会保留：
   * 借用者撤回不会删掉上传者的照片，上传者撤回时照片仍会被删除，借用者的消息里也随之失效。
   * A sticker row names no object of its own: its file is shared, and only the sweep or a block deletes it.
   * 表情行没有属于自己的对象：表情文件是共用的，只有清理任务或封禁才会删除它。
   */
  private discardImage(row: Pick<MessageRow, 'id' | 'author_id' | 'image_key' | 'thumb_key' | 'sticker_json'>): void {
    if (row.sticker_json) return;
    if (!this.env.FILES) return;
    const keys = [...new Set([row.image_key, row.thumb_key].filter((key): key is string => typeof key === 'string' && key.length > 0))];
    if (keys.length === 0) return;
    const kept = new Set(
      this.rowsNamingKeys(keys)
        .filter((other) => other.id < row.id || other.author_id === row.author_id)
        .map((other) => other.key),
    );
    const gone = keys.filter((key) => !kept.has(key));
    if (gone.length === 0) return;
    this.ctx.waitUntil(this.env.FILES.delete(gone).catch(() => undefined));
  }

  /** The stored messages that name any of these keys as their image or their thumbnail, one entry per key named. */
  /** 把这些键中任意一个用作图片或缩略图的已存消息，每个被使用的键一条。 */
  private rowsNamingKeys(keys: readonly (string | null)[]): { key: string; id: number; author_id: string }[] {
    const named = [...new Set(keys.filter((key): key is string => typeof key === 'string' && key.length > 0))];
    if (named.length === 0) return [];
    const marks = named.map(() => '?').join(', ');
    return this.sql
      .exec<{ key: string; id: number; author_id: string }>(
        `SELECT image_key AS key, id, author_id FROM messages WHERE image_key IN (${marks})
         UNION ALL SELECT thumb_key AS key, id, author_id FROM messages WHERE thumb_key IN (${marks})`,
        ...named,
        ...named,
      )
      .toArray();
  }

  /**
   * Whether this socket may remove another member's message or mute them. The target's real role is read
   * only when the room and the actor's role allow moderation at all.
   * 此连接能否删除另一成员的消息或禁言对方。只有在房间和操作者的身份允许管理操作时，才读取对方的真实身份。
   */
  private async moderationOf(identity: SocketIdentity, targetId: string): Promise<ModerationDecision | 'unavailable'> {
    const roomKind = (this.roomId ? parseRoomId(this.roomId)?.kind : null) ?? 'channel';
    let targetRole: Role | null = null;
    if (canModerateRoom(roomKind, identity.role)) {
      try {
        targetRole = await findMemberRole(this.env.DB, targetId);
      } catch (err) {
        console.error('moderation target lookup failed', errorText(err));
        return 'unavailable';
      }
    }
    return decideModeration({ roomKind, actorRole: identity.role, targetRole });
  }

  private async handleMute(ws: WebSocket, identity: SocketIdentity, memberId: string, minutes: number): Promise<void> {
    const decision = await this.moderationOf(identity, memberId);
    if (decision !== 'ok') {
      const message =
        decision === 'outranked' ? '不能禁言这位成员' : decision === 'direct' ? '私聊中不能禁言' : decision === 'unavailable' ? '出错了，请稍后再试' : '没有禁言权限';
      this.sendError(ws, 'forbidden', message);
      return;
    }
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    this.sql.exec('INSERT INTO mutes (member_id, until) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET until = excluded.until', memberId, until);
    for (const socket of this.ctx.getWebSockets(memberId)) {
      this.sendError(socket, 'muted', `你已被禁言 ${minutes} 分钟`, { mutedUntil: until });
    }
  }

  /* History */

  /**
   * Serves the latest page, an older page, or a forward catch-up page, never below the socket's floor
   * and never including rows the member hid. A catch-up with sinceRev also returns rows that changed
   * and hides made on other devices, each capped so the frame stays small.
   * 提供最新页、更早页或向后补齐页，不会低于连接的下限，也不包含成员隐藏的行。带 sinceRev 的补齐还会返回变更过的行和在其他设备上的隐藏，每项都有上限以控制帧大小。
   */
  private async sendHistory(ws: WebSocket, identity: SocketIdentity, frame: HistoryFrame): Promise<void> {
    if (!this.allowHistory(ws, identity, frame)) return;
    const memberId = identity.memberId;
    const floor = identity.floorId ?? 0;
    const direction: HistoryDirection = frame.afterId !== undefined ? 'newer' : frame.beforeId !== undefined ? 'older' : 'latest';
    const requested = frame.limit ?? HISTORY_PAGE_SIZE;
    const limit = direction === 'newer' ? Math.min(requested, CATCH_UP_PAGE_MAX) : requested;
    // Read the revision before the rows: anything that changes later carries a higher revision and is picked up next time.
    // 先读版本号再读行：之后发生的变更版本号更高，下次补齐时会被取到。
    const rev = currentRev(this.sql);

    let rows: MessageRow[];
    if (direction === 'newer') {
      rows = this.sql
        .exec<MessageRow>(`SELECT * FROM messages WHERE id > ? AND id >= ? AND ${NOT_HIDDEN} ORDER BY id ASC LIMIT ?`, frame.afterId ?? 0, floor, memberId, limit + 1)
        .toArray();
    } else if (direction === 'older') {
      rows = this.sql
        .exec<MessageRow>(`SELECT * FROM messages WHERE id < ? AND id >= ? AND ${NOT_HIDDEN} ORDER BY id DESC LIMIT ?`, frame.beforeId ?? 0, floor, memberId, limit + 1)
        .toArray();
    } else {
      rows = this.sql.exec<MessageRow>(`SELECT * FROM messages WHERE id >= ? AND ${NOT_HIDDEN} ORDER BY id DESC LIMIT ?`, floor, memberId, limit + 1).toArray();
    }
    const slice = slicePage(rows, limit, direction);
    const hasMore = direction === 'newer' ? frame.oldestId !== undefined && this.hasVisibleBelow(memberId, frame.oldestId, floor) : slice.hasMore;
    const reachedFloor = !hasMore && floor > 1 && this.sql.exec<{ e: number }>('SELECT EXISTS(SELECT 1 FROM messages WHERE id < ?) AS e', floor).one().e === 1;

    let changed: { items: MessageRow[]; overflow: boolean } | null = null;
    let hidden: { items: number[]; overflow: boolean } | null = null;
    if (direction === 'newer' && frame.sinceRev !== undefined) {
      const lower = Math.max(frame.oldestId ?? floor, floor);
      // A withdrawn or removed row is returned even when the member hid it, so quotes of it are redacted
      // on every device. Its id is also listed as hidden, so no device shows it again.
      // 已撤回或已删除的行即使被成员隐藏也会返回，使各设备上对它的引用都被清理。它的 id 同时列入隐藏列表，任何设备都不会再显示它。
      const changedRows = capList(
        this.sql
          .exec<ChangedRow>(
            `SELECT messages.*, EXISTS (SELECT 1 FROM hidden_messages h WHERE h.member_id = ? AND h.message_id = messages.id) AS hidden_by_viewer
             FROM messages
             WHERE id >= ? AND id <= ? AND rev > ? AND (recalled = 1 OR deleted = 1 OR ${NOT_HIDDEN})
             ORDER BY id ASC LIMIT ?`,
            memberId,
            lower,
            frame.afterId ?? 0,
            frame.sinceRev,
            memberId,
            CHANGED_MAX + 1,
          )
          .toArray(),
        CHANGED_MAX,
      );
      const hiddenRows = this.sql
        .exec<{ message_id: number }>('SELECT message_id FROM hidden_messages WHERE member_id = ? AND rev > ? ORDER BY rev ASC LIMIT ?', memberId, frame.sinceRev, CHANGED_MAX + 1)
        .toArray()
        .map((r) => r.message_id);
      const hiddenChanged = changedRows.items.filter((r) => r.hidden_by_viewer === 1).map((r) => r.id);
      changed = changedRows;
      hidden = capList([...new Set([...hiddenRows, ...hiddenChanged])], CHANGED_MAX);
    }

    const served = changed ? [...slice.page, ...changed.items] : slice.page;
    const firstQuotes = this.loadQuoteTargets(served);
    const authors = await this.currentAuthors([...served.map((r) => r.author_id), ...[...firstQuotes.values()].map((q) => q.author_id)]);

    // Other frames run during the await above, so a row or a quoted row may have been recalled or removed
    // meanwhile. Both are read again, synchronously, and the reply is built only from their current state.
    // 上面的 await 期间其他帧可以执行，某行或被引用的行可能已被撤回或删除。两者都会同步重新读取，回复只按其当前状态生成。
    const current = new Map(this.selectByIds<MessageRow>('*', served.map((r) => r.id)).map((r) => [r.id, r]));
    const fresh = (list: MessageRow[]) => list.flatMap((r) => current.get(r.id) ?? []);
    const page = fresh(slice.page);
    const changedPage = changed ? fresh(changed.items) : null;
    const quotes = this.loadQuoteTargets([...page, ...(changedPage ?? [])]);
    for (const quote of quotes.values()) {
      const card = authors.get(quote.author_id);
      if (card) quote.author_name = card.displayName;
    }
    const viewer: Viewer = { memberId, floorId: floor };
    const toWire = (r: MessageRow) => this.toMessage(r, authors.get(r.author_id), quotes, viewer);

    const result: HistoryResultFrame = {
      type: 'history_result',
      messages: page.map(toWire),
      hasMore,
      direction,
      hasNewer: slice.hasNewer,
      reachedFloor,
      floorReason: identity.floorReason ?? null,
      rev,
    };
    if (frame.requestId) result.requestId = frame.requestId;
    if (changed && changedPage && hidden) {
      result.changed = changedPage.map(toWire);
      result.hiddenIds = hidden.items;
      result.changedOverflow = changed.overflow || hidden.overflow;
    }
    // The socket may have closed while authors were loading.
    // 加载作者信息期间连接可能已关闭。
    this.trySend(ws, JSON.stringify(result));
  }

  /**
   * Current clients name each request, so they are limited per member across devices and an error with
   * the requestId unlocks them. Older clients send no requestId and unlock only on a history result, so
   * they are limited per connection and receive an empty page that keeps hasMore, which they retry later.
   * 当前客户端为每个请求编号，因此按成员跨设备限流，带 requestId 的错误即可解锁。旧客户端不带 requestId，只在收到历史结果时解锁，
   * 因此按连接限流，并收到一个保留 hasMore 的空页，之后会再次请求。
   */
  private allowHistory(ws: WebSocket, identity: SocketIdentity, frame: HistoryFrame): boolean {
    if (frame.requestId !== undefined) {
      if (this.allowIn(this.historyWindows, identity.memberId, HISTORY_WINDOW_MS, HISTORY_WINDOW_MAX)) return true;
      this.sendError(ws, 'rate_limited', '查询过于频繁，请稍候', { requestId: frame.requestId });
      return false;
    }
    if (this.allowIn(this.legacyHistoryWindows, identity.socketId ?? identity.memberId, HISTORY_WINDOW_MS, HISTORY_WINDOW_MAX)) return true;
    this.trySend(ws, JSON.stringify({ type: 'history_result', messages: [], hasMore: true } satisfies ServerFrame));
    return false;
  }

  private hasVisibleBelow(memberId: string, beforeId: number, floor: number): boolean {
    return (
      this.sql.exec<{ e: number }>(`SELECT EXISTS(SELECT 1 FROM messages WHERE id < ? AND id >= ? AND ${NOT_HIDDEN}) AS e`, beforeId, floor, memberId).one().e === 1
    );
  }

  /**
   * Rows keep the avatar from send time, which may point at a deleted upload. History is served with
   * each author's current name and avatar, kept in memory for a few minutes (AuthorCache) so most pages
   * read nothing from D1; if D1 is unreachable the stored values are used.
   * 消息行保存的是发送时的头像，可能指向已删除的上传文件。下发历史时使用作者当前的名字和头像，并在内存中保留几分钟（AuthorCache），
   * 大多数页面因此无需读取 D1；D1 不可用时退回已存的值。
   */
  private async currentAuthors(authorIds: string[]): Promise<Map<string, AuthorCard>> {
    const ids = authorIds.filter((id) => id !== SYSTEM_AUTHOR_ID);
    if (ids.length === 0) return new Map();
    return this.authors.cards(ids);
  }

  /** Batch-loads the rows that replies point at, so quotes are built from their current state. */
  /** 批量读取回复所引用的行，引用内容据其当前状态生成。 */
  private loadQuoteTargets(rows: MessageRow[]): Map<number, QuoteRow> {
    const ids = rows.map((r) => r.reply_to_id).filter((id): id is number => typeof id === 'number' && id > 0);
    const targets = this.selectByIds<QuoteRow>('id, kind, author_id, author_name, text, image_key, deleted, recalled, sticker_json', ids);
    return new Map(targets.map((t) => [t.id, { ...t }]));
  }

  private selectByIds<T extends Record<string, SqlStorageValue>>(columns: string, ids: readonly number[]): T[] {
    const unique = [...new Set(ids)];
    const rows: T[] = [];
    for (let i = 0; i < unique.length; i += IDS_PER_QUERY) {
      const chunk = unique.slice(i, i + IDS_PER_QUERY);
      rows.push(...this.sql.exec<T>(`SELECT ${columns} FROM messages WHERE id IN (${chunk.map(() => '?').join(', ')})`, ...chunk).toArray());
    }
    return rows;
  }

  private toMessage(row: MessageRow, current: AuthorCard | undefined, quotes: Map<number, QuoteTarget>, viewer: Viewer): ChatMessage {
    const system = row.kind === 'system';
    const author: ChatAuthor = system
      ? { id: SYSTEM_AUTHOR_ID, displayName: row.author_name, avatarKey: null }
      : {
          id: row.author_id,
          displayName: current?.displayName ?? row.author_name,
          avatarKey: current ? current.avatarKey : typeof row.avatar_key === 'string' ? row.avatar_key : null,
        };
    const live = row.deleted === 0 && row.recalled === 0;
    // A sticker shows only on a live user row, so a row withdrawn by a Worker that left sticker_json behind still
    // reads as withdrawn. Old clients get the sticker as a photo: its alias under this room, with its own size. A
    // malformed sticker_json leaves the stored text '[表情]' showing as text.
    // 只有有效的用户行才显示表情，因此被留下了 sticker_json 的旧 Worker 撤回或删除的行仍显示为已撤回或已删除。
    // 旧客户端把表情当作图片显示：本房间下的别名，加上表情自己的尺寸。sticker_json 格式不对时，这一行以文字显示保存的 '[表情]'。
    const sticker = live && !system ? parseStickerJson(row.sticker_json) : null;
    return redactChatMessage({
      id: row.id,
      roomId: this.roomId ?? '',
      author,
      text: sticker ? '' : row.text,
      imageKey: sticker ? (this.roomId ? stickerAliasKey(this.roomId, sticker) : null) : row.image_key,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
      recalled: row.recalled === 1,
      kind: system ? 'system' : 'user',
      system: system ? parseSystemEvent(row.system_json) : null,
      replyTo: row.reply_to_id ? buildQuotePreview(row.reply_to_id, quotes.get(row.reply_to_id), viewer.floorId) : null,
      imageWidth: sticker ? sticker.width : (row.image_w ?? null),
      imageHeight: sticker ? sticker.height : (row.image_h ?? null),
      // Only beside a live photo: a withdrawn row has neither, and a sticker's still travels inside the sticker.
      // 只与有效的图片一同出现：已撤回或删除的行两者都没有，而表情的静态图放在表情的描述里。
      thumbKey: !sticker && row.image_key !== null && live ? (row.thumb_key ?? null) : null,
      clientId: row.author_id === viewer.memberId ? (row.client_id ?? null) : null,
      deletedBy: row.deleted_by === 'author' || row.deleted_by === 'moderator' ? row.deleted_by : null,
      rev: row.rev ?? 0,
      ...(sticker ? { sticker } : {}),
    });
  }

  /* Floors and unread */

  private viewerState(memberId: string, access: RoomAccess): ViewerState {
    const joinFirstId = access.joinedAt ? this.firstIdFrom(access.joinedAt) : null;
    const clearId = this.clearIdOf(memberId);
    const floor = decideFloor({ floorApplies: access.floorApplies, joinFirstId, clearId });
    return { ...floor, baseline: unreadBaseline({ cursor: this.lastReadOf(memberId), joinFirstId, clearId }) };
  }

  /** First message at or after the instant, or the next id to be written when there is none yet. */
  /** 该时刻及之后的第一条消息；还没有时为下一条将写入的 id。 */
  private firstIdFrom(iso: string): number {
    const at = new Date(iso).toISOString();
    const row = this.sql.exec<{ id: number | null }>('SELECT MIN(id) AS id FROM messages WHERE created_at >= ?', at).one();
    return row.id ?? this.latestId() + 1;
  }

  private unreadOf(memberId: string, baseline: number): Pick<RoomMemberSummary, 'unreadCount' | 'firstUnreadId' | 'firstMentionId'> {
    const counts = this.sql
      .exec<{ n: number; first: number | null }>(`SELECT COUNT(*) AS n, MIN(id) AS first FROM messages WHERE ${UNREAD_WHERE}`, baseline, memberId, memberId)
      .one();
    const mention = this.sql
      .exec<{ first: number | null }>(
        `SELECT MIN(id) AS first FROM messages
         WHERE ${UNREAD_WHERE} AND (mention_all = 1 OR EXISTS (SELECT 1 FROM mentions x WHERE x.member_id = ? AND x.message_id = messages.id))`,
        baseline,
        memberId,
        memberId,
        memberId,
      )
      .one();
    return { unreadCount: counts.n, firstUnreadId: counts.first ?? null, firstMentionId: mention.first ?? null };
  }

  /* Storage helpers */

  private findRow(id: number): MessageRow | undefined {
    return this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', id).toArray()[0];
  }

  private latestId(): number {
    return this.sql.exec<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM messages').one().m;
  }

  private lastReadOf(memberId: string): number {
    const row = this.sql.exec<{ last_read_id: number }>('SELECT last_read_id FROM read_cursors WHERE member_id = ?', memberId).toArray()[0];
    return row?.last_read_id ?? 0;
  }

  private clearIdOf(memberId: string): number {
    const row = this.sql.exec<{ clear_id: number }>('SELECT clear_id FROM member_state WHERE member_id = ?', memberId).toArray()[0];
    return row?.clear_id ?? 0;
  }

  private markRead(memberId: string, messageId: number): void {
    this.sql.exec(
      `INSERT INTO read_cursors (member_id, last_read_id) VALUES (?, ?)
       ON CONFLICT(member_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
      memberId,
      messageId,
    );
  }

  /** End of the member's current mute, or null when they may post. Expired mutes are cleaned up here. */
  /** 成员当前禁言的结束时间；可以发言时为 null。过期的禁言在这里清理。 */
  private mutedUntil(memberId: string): string | null {
    const row = this.sql.exec<{ until: string }>('SELECT until FROM mutes WHERE member_id = ?', memberId).toArray()[0];
    if (!row) return null;
    if (new Date(row.until).getTime() <= Date.now()) {
      this.sql.exec('DELETE FROM mutes WHERE member_id = ?', memberId);
      return null;
    }
    return row.until;
  }

  private allowIn(windows: Map<string, number[]>, memberId: string, windowMs: number, max: number): boolean {
    const now = Date.now();
    const window = (windows.get(memberId) ?? []).filter((t) => now - t < windowMs);
    if (window.length >= max) {
      windows.set(memberId, window);
      return false;
    }
    window.push(now);
    windows.set(memberId, window);
    return true;
  }

  /** Preview is read from the latest row so a withdrawn message cannot republish its text. */
  /** 摘要从最新一行读取，已撤回的消息不会把原文再次写进会话列表。 */
  private latestActivity(): { at: string; preview: string } | null {
    const latest = this.sql.exec<MessageRow>('SELECT * FROM messages ORDER BY id DESC LIMIT 1').toArray()[0];
    if (!latest) return null;
    const hidden = latest.recalled === 1 || latest.deleted === 1;
    return {
      at: latest.created_at,
      preview: conversationPreview({
        text: hidden ? '' : latest.text,
        hasImage: !hidden && latest.image_key !== null,
        hasSticker: !hidden && Boolean(latest.sticker_json),
        deleted: latest.deleted === 1,
        recalled: latest.recalled === 1,
      }),
    };
  }

  private async recordActivity(): Promise<void> {
    const parsed = this.roomId ? parseRoomId(this.roomId) : null;
    if (!parsed) return;
    const current = this.latestActivity();
    if (!current) return;
    if (parsed.kind === 'channel') {
      await touchChannel(this.env.DB, parsed.id, current.at);
      return;
    }
    await touchDirect(this.env.DB, parsed.id, current.at, current.preview);
    const again = this.latestActivity();
    if (!again) return;
    if (again.at !== current.at || again.preview !== current.preview) {
      await touchDirect(this.env.DB, parsed.id, again.at, again.preview);
    }
  }

  /* Fan-out */

  private connectedMemberIds(): Set<string> {
    const members = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity) members.add(identity.memberId);
    }
    return members;
  }

  /** Members with a socket whose page is on screen; a socket that never said otherwise counts as on screen. */
  /** 有连接且其页面显示在屏幕上的成员；从未声明过的连接视为在屏幕上。 */
  private watchingMemberIds(): Set<string> {
    const members = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity && identity.hidden !== true) members.add(identity.memberId);
    }
    return members;
  }

  private isWatching(memberId: string): boolean {
    return this.ctx.getWebSockets(memberId).some((socket) => {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      return identity !== null && identity.hidden !== true;
    });
  }

  private onlineCount(): number {
    return this.connectedMemberIds().size;
  }

  private trySend(socket: WebSocket, payload: string): void {
    try {
      socket.send(payload);
    } catch {
      // A closed socket is removed by the runtime; nothing else to do here.
      // 已关闭的连接由运行时清理，此处无需处理。
    }
  }

  private broadcast(frame: ServerFrame): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) this.trySend(socket, payload);
  }

  /** Mutation notices go only to sockets whose floor is at or below the message. */
  /** 变更通知只发给下限不高于该消息的连接。 */
  private broadcastFrom(messageId: number, frame: ServerFrame): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if ((identity?.floorId ?? 0) <= messageId) this.trySend(socket, payload);
    }
  }

  /**
   * New rows are shaped per socket: only the author's sockets see message.clientId, and a quote whose
   * target sits below a socket's floor arrives as unavailable. The top-level clientId stays for old clients.
   * 新消息按连接分别生成：只有作者的连接能看到 message.clientId；被引用消息在某连接下限以下时，该连接收到的引用为不可见。顶层 clientId 为旧客户端保留。
   */
  private broadcastMessage(row: MessageRow, clientId?: string): void {
    const quotes = this.loadQuoteTargets([row]);
    const base = this.toMessage(row, undefined, quotes, { memberId: '', floorId: 0 });
    const payloads = new Map<string, string>();
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      const own = identity?.memberId === row.author_id;
      const replyTo = quoteForViewer(base.replyTo, identity?.floorId ?? 0);
      const key = `${own ? 1 : 0}:${replyTo === base.replyTo ? 1 : 0}`;
      let payload = payloads.get(key);
      if (!payload) {
        const message: ChatMessage = { ...base, replyTo, clientId: own ? (row.client_id ?? null) : null };
        payload = JSON.stringify({ type: 'message', message, ...(clientId ? { clientId } : {}) } satisfies ServerFrame);
        payloads.set(key, payload);
      }
      this.trySend(socket, payload);
    }
  }

  private sendError(ws: WebSocket, code: ErrorFrame['code'], message: string, extras: ErrorExtras = {}): void {
    const frame: ErrorFrame = { type: 'error', code, message };
    if (extras.clientId) frame.clientId = extras.clientId;
    if (extras.requestId) frame.requestId = extras.requestId;
    if (extras.messageId) frame.messageId = extras.messageId;
    if (extras.mutedUntil) frame.mutedUntil = extras.mutedUntil;
    this.trySend(ws, JSON.stringify(frame));
  }
}
