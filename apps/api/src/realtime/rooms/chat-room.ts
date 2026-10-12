import { DurableObject } from 'cloudflare:workers';
import {
  HISTORY_PAGE_SIZE,
  MESSAGE_TEXT_MAX,
  decideRecall,
  hasPermission,
  parseClientFrame,
  parseRoomId,
  redactChatBody,
  type ChatMessage,
  type ClientFrame,
  type Role,
  type ServerFrame,
} from '@utmmsc/shared';
import type { Env } from '../../env';
import { conversationPreview } from '../../domain/messaging/preview';
import { touchChannel } from '../../infrastructure/d1/channels';
import { touchDirect } from '../../infrastructure/d1/direct';

/** Identity attached to each socket; survives hibernation through serializeAttachment. */
/** 附着在每个连接上的身份；通过 serializeAttachment 在休眠后保留。 */
export interface SocketIdentity {
  memberId: string;
  displayName: string;
  role: Role;
  canPost: boolean;
  avatarKey?: string | null;
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
}

const SEND_WINDOW_MS = 10_000;
const SEND_WINDOW_MAX = 12;

/**
 * One instance per channel or direct conversation. Holds message history and read cursors in its
 * own SQLite storage, fans out to connected sockets, and sleeps between messages.
 * 每个频道或私聊一个实例。消息历史与已读游标存于自身 SQLite，向在线连接广播，消息间隙休眠。
 */
export class ChatRoom extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private roomId: string | null = null;
  private readonly sendWindows = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ensureSchema();
    ctx.blockConcurrencyWhile(async () => {
      this.roomId = (await ctx.storage.get<string>('roomId')) ?? null;
    });
  }

  private ensureSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        text TEXT NOT NULL,
        image_key TEXT,
        created_at TEXT NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0,
        recalled INTEGER NOT NULL DEFAULT 0,
        avatar_key TEXT
      );
      CREATE TABLE IF NOT EXISTS read_cursors (
        member_id TEXT PRIMARY KEY,
        last_read_id INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mutes (
        member_id TEXT PRIMARY KEY,
        until TEXT NOT NULL
      );
    `);
    this.addColumn('ALTER TABLE messages ADD COLUMN recalled INTEGER NOT NULL DEFAULT 0');
    this.addColumn('ALTER TABLE messages ADD COLUMN avatar_key TEXT');
  }

  /** Existing rooms were created before recall. Adding a column twice is expected. */
  /** 已有房间在撤回功能之前创建。列已存在时再添加是正常情况。 */
  private addColumn(statement: string): void {
    try {
      this.sql.exec(statement);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicate column/i.test(message)) return;
      throw err;
    }
  }

  /* RPC used by the Worker */

  async getUnread(memberId: string): Promise<number> {
    const cursor = this.lastReadOf(memberId);
    const row = this.sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE id > ? AND deleted = 0 AND author_id != ?', cursor, memberId)
      .one();
    return row.n;
  }

  /* WebSocket upgrade */

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const identityHeader = request.headers.get('x-room-identity');
    const roomIdHeader = request.headers.get('x-room-id');
    if (!identityHeader || !roomIdHeader) return new Response('missing identity', { status: 400 });
    const identity = JSON.parse(identityHeader) as SocketIdentity;

    if (this.roomId !== roomIdHeader) {
      this.roomId = roomIdHeader;
      await this.ctx.storage.put('roomId', roomIdHeader);
    }

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [identity.memberId]);
    server.serializeAttachment(identity);

    const ready: ServerFrame = {
      type: 'ready',
      roomId: roomIdHeader,
      memberId: identity.memberId,
      lastReadId: this.lastReadOf(identity.memberId),
      onlineCount: this.onlineCount(),
    };
    server.send(JSON.stringify(ready));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const identity = ws.deserializeAttachment() as SocketIdentity | null;
    if (!identity) {
      ws.close(1008, 'no identity');
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
      this.sendError(ws, 'invalid_frame', '消息格式错误');
      return;
    }
    await this.handleFrame(ws, identity, frame);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcastPresence(ws);
  }

  /* Frame handling */

  private async handleFrame(ws: WebSocket, identity: SocketIdentity, frame: ClientFrame): Promise<void> {
    switch (frame.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' } satisfies ServerFrame));
        return;
      case 'history':
        this.sendHistory(ws, frame.beforeId);
        return;
      case 'read':
        this.markRead(identity.memberId, frame.messageId);
        return;
      case 'send':
        await this.handleSend(ws, identity, frame.clientId, frame.text, frame.imageKey ?? null);
        return;
      case 'delete':
        await this.handleDelete(ws, identity, frame.messageId);
        return;
      case 'recall':
        await this.handleRecall(ws, identity, frame.messageId);
        return;
      case 'mute':
        this.handleMute(ws, identity, frame.memberId, frame.minutes);
        return;
    }
  }

  private async handleSend(ws: WebSocket, identity: SocketIdentity, clientId: string, text: string, imageKey: string | null): Promise<void> {
    if (!identity.canPost) {
      this.sendError(ws, 'forbidden', '此频道不允许你发言');
      return;
    }
    const trimmed = text.trim();
    if (!trimmed && !imageKey) {
      this.sendError(ws, 'invalid_frame', '消息不能为空');
      return;
    }
    if (trimmed.length > MESSAGE_TEXT_MAX) {
      this.sendError(ws, 'text_too_long', `消息最多 ${MESSAGE_TEXT_MAX} 字`);
      return;
    }
    if (this.isMuted(identity.memberId)) {
      this.sendError(ws, 'muted', '你已被禁言');
      return;
    }
    if (!this.allowSend(identity.memberId)) {
      this.sendError(ws, 'rate_limited', '发送太快，请稍候');
      return;
    }
    if (imageKey && this.roomId && !imageKey.startsWith(`chat/${this.roomId.replace(':', '/')}/`)) {
      this.sendError(ws, 'invalid_frame', '图片无效');
      return;
    }

    const createdAt = new Date().toISOString();
    const avatarKey = typeof identity.avatarKey === 'string' && identity.avatarKey.length > 0 && identity.avatarKey.length <= 300 ? identity.avatarKey : null;
    const inserted = this.sql
      .exec<{ id: number }>(
        'INSERT INTO messages (author_id, author_name, text, image_key, created_at, avatar_key) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
        identity.memberId,
        identity.displayName,
        trimmed,
        imageKey,
        createdAt,
        avatarKey,
      )
      .one();

    const message: ChatMessage = {
      id: inserted.id,
      roomId: this.roomId ?? '',
      author: { id: identity.memberId, displayName: identity.displayName, avatarKey },
      text: trimmed,
      imageKey,
      createdAt,
      deleted: false,
      recalled: false,
    };
    this.markRead(identity.memberId, message.id);
    this.broadcast({ type: 'message', message, clientId });
    this.ctx.waitUntil(this.recordActivity());
  }

  /**
   * Withdrawal uses the row's stored timestamp and Date.now() on this object, never a client clock.
   * The broadcast and later history omit the original text.
   * 撤回只用本对象上的当前时间和行里存的时间，不信客户端时钟。广播和之后的历史都不再带原文。
   */
  private async handleRecall(ws: WebSocket, identity: SocketIdentity, messageId: number): Promise<void> {
    const row = this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId).toArray()[0];
    if (!row) {
      this.sendError(ws, 'not_found', '消息不存在');
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
      this.sendError(ws, 'forbidden', '只能撤回自己的消息');
      return;
    }
    if (decision === 'expired') {
      this.sendError(ws, 'recall_expired', '已超过 3 分钟，无法撤回');
      return;
    }
    if (decision !== 'ok') {
      this.sendError(ws, 'forbidden', '这条消息不能撤回');
      return;
    }
    this.sql.exec("UPDATE messages SET recalled = 1, text = '', image_key = NULL WHERE id = ?", messageId);
    this.broadcast({ type: 'recalled', messageId });
    this.ctx.waitUntil(this.recordActivity());
  }

  private async handleDelete(ws: WebSocket, identity: SocketIdentity, messageId: number): Promise<void> {
    const row = this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id = ?', messageId).toArray()[0];
    if (!row) {
      this.sendError(ws, 'not_found', '消息不存在');
      return;
    }
    const ownMessage = row.author_id === identity.memberId;
    if (!ownMessage && !hasPermission(identity.role, 'chat.moderate')) {
      this.sendError(ws, 'forbidden', '只能删除自己的消息');
      return;
    }
    this.sql.exec("UPDATE messages SET deleted = 1, text = '', image_key = NULL WHERE id = ?", messageId);
    this.broadcast({ type: 'deleted', messageId });
  }

  private handleMute(ws: WebSocket, identity: SocketIdentity, memberId: string, minutes: number): void {
    if (!hasPermission(identity.role, 'chat.moderate')) {
      this.sendError(ws, 'forbidden', '没有禁言权限');
      return;
    }
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    this.sql.exec('INSERT INTO mutes (member_id, until) VALUES (?, ?) ON CONFLICT(member_id) DO UPDATE SET until = excluded.until', memberId, until);
    for (const socket of this.ctx.getWebSockets(memberId)) {
      this.sendError(socket, 'muted', `你已被禁言 ${minutes} 分钟`);
    }
  }

  /* Storage helpers */

  private sendHistory(ws: WebSocket, beforeId?: number): void {
    const limit = HISTORY_PAGE_SIZE + 1;
    const rows = beforeId
      ? this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?', beforeId, limit).toArray()
      : this.sql.exec<MessageRow>('SELECT * FROM messages ORDER BY id DESC LIMIT ?', limit).toArray();
    const hasMore = rows.length > HISTORY_PAGE_SIZE;
    const page = rows.slice(0, HISTORY_PAGE_SIZE).reverse();
    const frame: ServerFrame = { type: 'history_result', messages: page.map((r) => this.toMessage(r)), hasMore };
    ws.send(JSON.stringify(frame));
  }

  private toMessage(row: MessageRow): ChatMessage {
    const recalled = row.recalled === 1;
    const deleted = row.deleted === 1;
    return redactChatBody({
      id: row.id,
      roomId: this.roomId ?? '',
      author: {
        id: row.author_id,
        displayName: row.author_name,
        avatarKey: typeof row.avatar_key === 'string' ? row.avatar_key : null,
      },
      text: recalled || deleted ? '' : row.text,
      imageKey: recalled || deleted ? null : row.image_key,
      createdAt: row.created_at,
      deleted,
      recalled,
    });
  }

  private lastReadOf(memberId: string): number {
    const row = this.sql.exec<{ last_read_id: number }>('SELECT last_read_id FROM read_cursors WHERE member_id = ?', memberId).toArray()[0];
    return row?.last_read_id ?? 0;
  }

  private markRead(memberId: string, messageId: number): void {
    this.sql.exec(
      `INSERT INTO read_cursors (member_id, last_read_id) VALUES (?, ?)
       ON CONFLICT(member_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`,
      memberId,
      messageId,
    );
  }

  private isMuted(memberId: string): boolean {
    const row = this.sql.exec<{ until: string }>('SELECT until FROM mutes WHERE member_id = ?', memberId).toArray()[0];
    if (!row) return false;
    if (new Date(row.until).getTime() <= Date.now()) {
      this.sql.exec('DELETE FROM mutes WHERE member_id = ?', memberId);
      return false;
    }
    return true;
  }

  private allowSend(memberId: string): boolean {
    const now = Date.now();
    const window = (this.sendWindows.get(memberId) ?? []).filter((t) => now - t < SEND_WINDOW_MS);
    if (window.length >= SEND_WINDOW_MAX) {
      this.sendWindows.set(memberId, window);
      return false;
    }
    window.push(now);
    this.sendWindows.set(memberId, window);
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

  private broadcast(frame: ServerFrame, except?: WebSocket): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(payload);
      } catch {
        // A closed socket is removed by the runtime; nothing else to do here.
        // 已关闭的连接由运行时清理，此处无需处理。
      }
    }
  }

  private broadcastPresence(except?: WebSocket): void {
    this.broadcast({ type: 'presence', onlineCount: this.onlineCount() }, except);
  }

  private sendError(ws: WebSocket, code: Extract<ServerFrame, { type: 'error' }>['code'], message: string): void {
    ws.send(JSON.stringify({ type: 'error', code, message } satisfies ServerFrame));
  }
}
