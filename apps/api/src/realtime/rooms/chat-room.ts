import { DurableObject } from 'cloudflare:workers';
import {
  CLIENT_FRAME_MAX,
  HISTORY_PAGE_SIZE,
  MESSAGE_TEXT_MAX,
  decideRecall,
  hasPermission,
  parseClientFrame,
  parseRoomId,
  redactChatBody,
  type ChatAuthor,
  type ChatMessage,
  type ClientFrame,
  type Role,
  type ServerFrame,
} from '@utmmsc/shared';
import type { Env } from '../../env';
import { conversationPreview } from '../../domain/messaging/preview';
import { touchChannel } from '../../infrastructure/d1/channels';
import { findAuthorCards, type AuthorCard } from '../../infrastructure/d1/members';
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
    // Heartbeats are answered by the runtime without waking the object, so idle rooms can hibernate.
    // 心跳由运行时直接应答，不唤醒对象，空闲房间才能真正休眠。
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(JSON.stringify({ type: 'ping' }), JSON.stringify({ type: 'pong' })));
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
      CREATE TABLE IF NOT EXISTS used_tickets (
        jti TEXT PRIMARY KEY,
        exp INTEGER NOT NULL
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
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE id > ? AND deleted = 0 AND recalled = 0 AND author_id != ?', cursor, memberId)
      .one();
    return row.n;
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
   * stored rows, open sockets, and on-screen messages all move to the new one.
   * 成员更换头像后调用。旧的上传头像会从存储中删除，因此已存的消息、打开的连接和屏幕上的消息都要换成新头像。
   */
  async refreshAuthor(author: ChatAuthor): Promise<void> {
    const avatarKey = author.avatarKey ?? null;
    this.sql.exec('UPDATE messages SET author_name = ?, avatar_key = ? WHERE author_id = ?', author.displayName, avatarKey, author.id);
    for (const socket of this.ctx.getWebSockets(author.id)) {
      const identity = socket.deserializeAttachment() as SocketIdentity | null;
      if (identity) socket.serializeAttachment({ ...identity, displayName: author.displayName, avatarKey });
    }
    this.broadcast({ type: 'author', author: { id: author.id, displayName: author.displayName, avatarKey } });
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
    const identity = JSON.parse(identityHeader) as SocketIdentity;

    // Each ticket opens one socket; a replayed URL is refused.
    // 每张票据只能打开一个连接；重放的链接会被拒绝。
    this.sql.exec('DELETE FROM used_tickets WHERE exp <= ?', Date.now());
    const fresh = this.sql.exec('INSERT OR IGNORE INTO used_tickets (jti, exp) VALUES (?, ?)', ticketId, ticketExp).rowsWritten;
    if (!fresh) return new Response('ticket already used', { status: 401 });

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
      this.sendError(ws, 'invalid_frame', '消息格式错误');
      return;
    }
    await this.handleFrame(ws, identity, frame);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // Finish the close handshake; 1005/1006 are reserved and cannot be sent back.
    // 完成关闭握手；1005/1006 为保留码，不能回发。
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
      // 已关闭。
    }
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
        await this.sendHistory(ws, frame.beforeId);
        return;
      case 'read':
        // Never past the newest message, or a bad client would hide all future unread counts.
        // 不能超过最新消息，否则异常客户端会让之后的未读数永远为零。
        this.markRead(identity.memberId, Math.min(frame.messageId, this.latestId()));
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
    this.discardImage(row.image_key);
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
    this.discardImage(row.image_key);
    this.ctx.waitUntil(this.recordActivity());
  }

  /** A withdrawn image must stop being downloadable, not just disappear from history. */
  /** 撤回或删除的图片要真正不可下载，而不只是从历史里隐藏。 */
  private discardImage(key: string | null): void {
    if (!key || !this.env.FILES) return;
    this.ctx.waitUntil(this.env.FILES.delete(key).catch(() => undefined));
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

  private async sendHistory(ws: WebSocket, beforeId?: number): Promise<void> {
    const limit = HISTORY_PAGE_SIZE + 1;
    const rows = beforeId
      ? this.sql.exec<MessageRow>('SELECT * FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?', beforeId, limit).toArray()
      : this.sql.exec<MessageRow>('SELECT * FROM messages ORDER BY id DESC LIMIT ?', limit).toArray();
    const hasMore = rows.length > HISTORY_PAGE_SIZE;
    const page = rows.slice(0, HISTORY_PAGE_SIZE).reverse();
    const authors = await this.currentAuthors(page);
    const frame: ServerFrame = { type: 'history_result', messages: page.map((r) => this.toMessage(r, authors.get(r.author_id))), hasMore };
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      // The socket closed while authors were loading.
      // 加载作者信息期间连接已关闭。
    }
  }

  /**
   * Rows keep the avatar from send time, which may point at a deleted upload. History is served with
   * each author's current name and avatar; if D1 is unreachable the stored values are used.
   * 消息行保存的是发送时的头像，可能指向已删除的上传文件。下发历史时使用作者当前的名字和头像；D1 不可用时退回已存的值。
   */
  private async currentAuthors(rows: MessageRow[]): Promise<Map<string, AuthorCard>> {
    if (rows.length === 0) return new Map();
    try {
      return await findAuthorCards(this.env.DB, rows.map((r) => r.author_id));
    } catch {
      return new Map();
    }
  }

  private toMessage(row: MessageRow, current?: AuthorCard): ChatMessage {
    const recalled = row.recalled === 1;
    const deleted = row.deleted === 1;
    return redactChatBody({
      id: row.id,
      roomId: this.roomId ?? '',
      author: {
        id: row.author_id,
        displayName: current?.displayName ?? row.author_name,
        avatarKey: current ? current.avatarKey : typeof row.avatar_key === 'string' ? row.avatar_key : null,
      },
      text: recalled || deleted ? '' : row.text,
      imageKey: recalled || deleted ? null : row.image_key,
      createdAt: row.created_at,
      deleted,
      recalled,
    });
  }

  private latestId(): number {
    return this.sql.exec<{ m: number }>('SELECT COALESCE(MAX(id), 0) AS m FROM messages').one().m;
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

  private onlineCount(except?: WebSocket): number {
    const members = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue;
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
    this.broadcast({ type: 'presence', onlineCount: this.onlineCount(except) }, except);
  }

  private sendError(ws: WebSocket, code: Extract<ServerFrame, { type: 'error' }>['code'], message: string): void {
    try {
      ws.send(JSON.stringify({ type: 'error', code, message } satisfies ServerFrame));
    } catch {
      // Socket closed meanwhile.
      // 连接已关闭。
    }
  }
}
