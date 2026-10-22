import { DurableObject } from 'cloudflare:workers';
import {
  CHANGED_MAX,
  CLIENT_FRAME_MAX,
  HISTORY_PAGE_SIZE,
  IMAGE_DIMENSION_MAX,
  MESSAGE_TEXT_MAX,
  REQUEST_ID_MAX,
  SYSTEM_AUTHOR_ID,
  canModerateRoom,
  decideModeration,
  decideRecall,
  hasPermission,
  parseClientFrame,
  parseRoomId,
  redactChatMessage,
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
  type SystemMemberRef,
} from '@utmmsc/shared';
import type { Env } from '../../env';
import { conversationPreview, lastMessagePreview, parseSystemEvent } from '../../domain/messaging/preview';
import { OPEN_ACCESS, coerceRoomAccess } from '../../domain/messaging/visibility';
import { touchChannel } from '../../infrastructure/d1/channels';
import { findAuthorCards, findMemberRole, type AuthorCard } from '../../infrastructure/d1/members';
import { touchDirect } from '../../infrastructure/d1/direct';
import {
  buildQuotePreview,
  capList,
  decideFloor,
  joinEvent,
  joinFallbackText,
  quoteForViewer,
  sanitizeMentions,
  slicePage,
  unreadBaseline,
  type QuoteTarget,
} from './history';
import { currentRev, ensureRoomSchema, nextRev } from './room-schema';

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

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
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
   * revision so a reconnecting client refreshes names it already holds.
   * 成员更换头像后调用。旧的上传头像会从存储中删除，因此已存的消息、打开的连接和屏幕上的消息都要换成新头像。这些行会取新的版本号，重连的客户端据此刷新已有的名字。
   */
  async refreshAuthor(author: ChatAuthor): Promise<void> {
    const avatarKey = author.avatarKey ?? null;
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
        await this.handleSend(ws, identity, frame);
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
    }
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
   * Checks run in a fixed order and every rejection names the clientId. A repeated clientId is
   * answered from the stored row before mute or rate limits, so a resend after a lost ack never
   * costs quota or creates a second row.
   * 检查按固定顺序进行，每次拒绝都带上 clientId。重复的 clientId 会在禁言和限流之前直接用已存的行回复，因此确认丢失后的重发既不消耗额度也不会产生第二行。
   */
  private async handleSend(ws: WebSocket, identity: SocketIdentity, frame: SendFrame): Promise<void> {
    const { clientId } = frame;
    const imageKey = frame.imageKey ?? null;
    if (!identity.canPost) {
      this.sendError(ws, 'forbidden', '此频道不允许你发言', { clientId });
      return;
    }
    const trimmed = frame.text.trim();
    if (!trimmed && !imageKey) {
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
    if (imageKey && this.roomId && !imageKey.startsWith(`chat/${this.roomId.replace(':', '/')}/`)) {
      this.sendError(ws, 'invalid_frame', '图片无效', { clientId });
      return;
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
      inserted = this.sql
        .exec<MessageRow>(
          `INSERT INTO messages (author_id, author_name, text, image_key, created_at, avatar_key, kind, reply_to_id, mention_all, client_id, image_w, image_h, rev)
           VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?) RETURNING *`,
          identity.memberId,
          identity.displayName,
          trimmed,
          imageKey,
          createdAt,
          avatarKey,
          replyToId,
          frame.mentionAll ? 1 : 0,
          clientId,
          frame.imageWidth ?? null,
          frame.imageHeight ?? null,
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
    this.sql.exec("UPDATE messages SET recalled = 1, text = '', image_key = NULL, image_w = NULL, image_h = NULL, rev = ? WHERE id = ?", rev, messageId);
    this.touchReplies(messageId, rev);
    this.broadcastFrom(messageId, { type: 'recalled', messageId, rev });
    this.discardImage(row.image_key);
    this.ctx.waitUntil(this.recordActivity());
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
      "UPDATE messages SET deleted = 1, deleted_by = ?, text = '', image_key = NULL, image_w = NULL, image_h = NULL, rev = ? WHERE id = ?",
      by,
      rev,
      messageId,
    );
    this.touchReplies(messageId, rev);
    this.broadcastFrom(messageId, { type: 'deleted', messageId, by, rev });
    this.discardImage(row.image_key);
    this.ctx.waitUntil(this.recordActivity());
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

  /** A withdrawn image must stop being downloadable, not just disappear from history. */
  /** 撤回或删除的图片要真正不可下载，而不只是从历史里隐藏。 */
  private discardImage(key: string | null): void {
    if (!key || !this.env.FILES) return;
    this.ctx.waitUntil(this.env.FILES.delete(key).catch(() => undefined));
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
   * each author's current name and avatar; if D1 is unreachable the stored values are used.
   * 消息行保存的是发送时的头像，可能指向已删除的上传文件。下发历史时使用作者当前的名字和头像；D1 不可用时退回已存的值。
   */
  private async currentAuthors(authorIds: string[]): Promise<Map<string, AuthorCard>> {
    const ids = authorIds.filter((id) => id !== SYSTEM_AUTHOR_ID);
    if (ids.length === 0) return new Map();
    try {
      return await findAuthorCards(this.env.DB, ids);
    } catch {
      return new Map();
    }
  }

  /** Batch-loads the rows that replies point at, so quotes are built from their current state. */
  /** 批量读取回复所引用的行，引用内容据其当前状态生成。 */
  private loadQuoteTargets(rows: MessageRow[]): Map<number, QuoteRow> {
    const ids = rows.map((r) => r.reply_to_id).filter((id): id is number => typeof id === 'number' && id > 0);
    const targets = this.selectByIds<QuoteRow>('id, kind, author_id, author_name, text, image_key, deleted, recalled', ids);
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
    return redactChatMessage({
      id: row.id,
      roomId: this.roomId ?? '',
      author,
      text: row.text,
      imageKey: row.image_key,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
      recalled: row.recalled === 1,
      kind: system ? 'system' : 'user',
      system: system ? parseSystemEvent(row.system_json) : null,
      replyTo: row.reply_to_id ? buildQuotePreview(row.reply_to_id, quotes.get(row.reply_to_id), viewer.floorId) : null,
      imageWidth: row.image_w ?? null,
      imageHeight: row.image_h ?? null,
      clientId: row.author_id === viewer.memberId ? (row.client_id ?? null) : null,
      deletedBy: row.deleted_by === 'author' || row.deleted_by === 'moderator' ? row.deleted_by : null,
      rev: row.rev ?? 0,
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

  private onlineCount(): number {
    const members = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity) members.add(identity.memberId);
    }
    return members.size;
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
