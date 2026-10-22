import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  HISTORY_PAGE_MAX,
  HISTORY_PAGE_SIZE,
  parseServerFrame,
  type ClientFrame,
  type ErrorFrame,
  type HistoryResultFrame,
  type NormalizedChatMessage,
  type QuotePreview,
  type ReadyFrame,
  type RoomTicketResponse,
  type ServerFrame,
} from '@utmmsc/shared';
import { ApiClientError, errorMessage, localizedMessage } from '../../../shared/api/errors';
import { useLocaleStore } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { chatApi } from '../api';
import type { PendingMessage, RoomController } from '../room/types';
import { HistoryRequests, planCatchUp, planSync, type HistoryFields, type HistoryPurpose, type HistoryRequest } from './historyRequests';
import {
  advanceRev,
  applyAuthor,
  applyChanged,
  applyCleared,
  applyDeleted,
  applyHidden,
  applyMessage,
  applyRecalled,
  createMessageStore,
  distrustRev,
  dropBelowFloor,
  findMessage,
  mergePage,
  mergeStale,
  newestId,
  oldestId,
  quoteTargetState,
  restoreHidden,
  trimOldest,
  type MessageStoreState,
} from './messageStore';
import { Outbox, ackedClientIds, type OutboxLink, type OutboxTransport } from './outbox';
import { dropRoomSnapshot, getRoomSnapshot, putRoomSnapshot } from './roomCache';
import { uploadWithProgress } from './uploadWithProgress';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const HEARTBEAT_MS = 25_000;
/** Must match the Durable Object's auto-response pair exactly. */
/** 必须与 Durable Object 的自动应答字符串完全一致。 */
const PING = JSON.stringify({ type: 'ping' } satisfies ClientFrame);
/** Room media tokens live an hour; refresh before that so lazy-loaded images keep working. */
/** 房间媒体令牌有效期一小时；提前刷新，延迟加载的图片才不会失效。 */
const MEDIA_REFRESH_MS = 50 * 60 * 1000;
const UNTIL_PAGES_MAX = 10;
const TRIM_KEEP = 200;
const RECALL_STASH_MS = 5 * 60 * 1000;
const SYNC_WAIT_MS = 10_000;
const SYNC_RETRY_MS = 2_000;
const SYNC_RETRIES_MAX = 3;
/** Lock holder for the span from socket open until the first history result is applied. */
/** 从连接打开到第一个历史结果应用完毕期间的锁持有者。 */
const SYNC_LOCK = 'sync';

function trNow(zh: string, en: string): string {
  return useLocaleStore.getState().locale === 'en' ? en : zh;
}

/** Full jitter so a deploy does not make every client reconnect in the same instant. */
/** 全量抖动，部署后客户端不会在同一瞬间一起重连。 */
function backoff(attempt: number): number {
  return Math.round(Math.random() * Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt));
}

/** An old server only says '你已被禁言 N 分钟'; turn that into an end time. */
/** 旧服务端只发送“你已被禁言 N 分钟”；据此推算结束时间。 */
function legacyMutedUntil(message: string): string | null {
  const match = /^你已被禁言 (\d+) 分钟$/.exec(message);
  return match ? new Date(Date.now() + Number(match[1]) * 60_000).toISOString() : null;
}

function offlineNotice(): string {
  return trNow('网络未连接，请稍后再试', 'You are offline. Try again in a moment.');
}

/**
 * Pending messages outlive the room screen within a session, so a room left mid-send flushes
 * when it is entered again. They are dropped on sign-out.
 * 待发消息在本次会话中比房间页存在得更久，发送中途离开的房间再次进入时会继续发送。退出登录时清除。
 */
const outboxes = new Map<string, Outbox>();

function outboxFor(roomId: string): Outbox {
  let box = outboxes.get(roomId);
  if (!box) {
    box = new Outbox({
      timeoutText: () => trNow('消息发送失败', 'Message not sent'),
      uncertainText: () => trNow('可能未发送', 'May not have been sent'),
      uploadFailureText: errorMessage,
    });
    outboxes.set(roomId, box);
  }
  return box;
}

/**
 * What the last ready frame of any room said about the server. A new visit starts from it, or from capable
 * when nothing is known yet, so a quote or mention written before the first ready is kept; each send is
 * still shaped for the server that takes it.
 * 任一房间最近一次 ready 帧所表明的服务端能力。新的进入以它为起点，尚不知道时视为支持新协议，因此第一次 ready 之前写下的引用和提醒会被保留；
 * 每次发送仍按实际接收它的服务端生成。
 */
let lastServerCapable: boolean | null = null;

useSessionStore.subscribe((state, prev) => {
  const signedOut = prev.token !== null && state.token === null;
  const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
  if (!signedOut && !switched) return;
  for (const box of outboxes.values()) box.dispose();
  outboxes.clear();
});

type RoomMethods = Pick<
  RoomController,
  | 'loadOlder'
  | 'retryOlder'
  | 'loadUntil'
  | 'trimOldest'
  | 'sendText'
  | 'sendImage'
  | 'resend'
  | 'discard'
  | 'markRead'
  | 'hide'
  | 'removeAsModerator'
  | 'recall'
  | 'reeditText'
  | 'quoteTarget'
  | 'mute'
  | 'clearNotice'
>;

type RoomView = Omit<RoomController, keyof RoomMethods>;

type SessionData = Omit<RoomView, 'messages' | 'pending' | 'hasMore' | 'reachedFloor' | 'floorReason' | 'visibleFromId'>;

/** The server's refusal of a send whose quoted message is gone; matched to resend without the quote. */
/** 服务端因所引用的消息已不存在而拒绝发送时的文字；据此判断后去掉引用重发。 */
const QUOTE_GONE_MESSAGE = '引用的消息不存在';

const INITIAL_DATA: SessionData = {
  capable: true,
  status: 'connecting',
  synced: false,
  retrying: false,
  fatalError: null,
  meta: null,
  loadingOlder: false,
  olderFailed: false,
  entry: null,
  lastReadId: 0,
  canPost: null,
  mutedUntil: null,
  mediaToken: null,
  clockSkewMs: 0,
  notice: null,
};

/**
 * One room connection: ticket, socket, heartbeat, backoff, history paging and catch-up, the outbox
 * and the moderation actions. Construction has no side effects; start() and stop() follow the
 * component's effect, so StrictMode's extra cycle is safe.
 * 单个房间的连接：票据、连接、心跳、退避重连、历史翻页与补齐、发送队列和管理操作。构造时没有副作用；
 * start() 和 stop() 跟随组件的副作用执行，因此 StrictMode 的额外一轮也是安全的。
 */
class RoomSession {
  private data: SessionData = { ...INITIAL_DATA, capable: lastServerCapable ?? true };
  private store: MessageStoreState;
  private view: RoomView;
  private readonly listeners = new Set<() => void>();
  private readonly history: HistoryRequests;

  private running = false;
  /** Bumped on every start and stop, so late callbacks from an earlier run do nothing. */
  /** 每次 start 和 stop 时递增，之前一轮的迟到回调因此不会生效。 */
  private generation = 0;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private firstTicket = true;
  private entrySeen = false;
  /** Set by the first ready of this visit; until then data.capable is only an assumption. */
  /** 本次进入的第一个 ready 帧到达后设置；在此之前 data.capable 只是推测。 */
  private serverKnown = false;
  private memberId: string | null = null;
  private sessionMemberId: string | null = null;

  /** True once the socket is open and the first history result is applied. */
  /** 连接已打开且第一个历史结果已应用后为 true。 */
  private synced = false;
  private legacyReplace = false;
  private legacyOlderBeforeId: number | undefined;
  private catchUpCursor = 0;
  private syncRetries = 0;
  /** Live rows that arrive while catching up wait here, so a row past a gap cannot move the catch-up cursor. */
  /** 补齐期间实时到达的消息在此等待，越过缺口的消息因此不会移动补齐游标。 */
  private buffered: ServerFrame[] = [];
  private olderWanted = false;
  private olderInFlight: Promise<boolean> | null = null;
  /** loadUntil loops in progress; each pages back on its own, so the list must not be trimmed under it. */
  /** 正在进行的 loadUntil 循环；每个循环都会自行向前翻页，因此期间不能裁剪列表。 */
  private untilRunning = 0;
  private committing = false;
  /** Sends already retried once without their quote, so a refusal can never loop. */
  /** 已去掉引用重试过一次的发送，拒绝因此不会循环。 */
  private readonly quoteRetried = new Set<string>();
  private olderWaiter: { key: string; resolve: (ok: boolean) => void } | null = null;
  private syncWaiters: ((ok: boolean) => void)[] = [];

  private outbox: Outbox | null = null;
  private outboxLink: OutboxLink | null = null;
  private unsubscribeOutbox: (() => void) | null = null;
  private readonly pendingHides = new Map<number, NormalizedChatMessage>();
  private readonly recallStash = new Map<number, { text: string; at: number }>();

  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private mediaRefresh: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private legacyOlderTimer: ReturnType<typeof setTimeout> | null = null;

  readonly methods: RoomMethods;

  constructor(private readonly roomId: string) {
    this.store = createMessageStore();
    this.history = new HistoryRequests({ onTimeout: (request) => this.onHistoryFailed(request) });
    this.hydrate();
    this.view = this.buildView();
    this.methods = {
      loadOlder: () => this.loadOlder(),
      retryOlder: () => {
        this.setData({ olderFailed: false });
        this.loadOlder();
      },
      loadUntil: (id) => this.loadUntil(id),
      trimOldest: (keep = TRIM_KEEP) => {
        // A page on its way was asked for below the current oldest row; trimming now would leave a gap
        // between that page and the rows that stay, so the trim waits until paging and catch-up are done.
        // 正在途中的页是以当前最早的消息为起点请求的；此时裁剪会在该页与保留的消息之间留下缺口，因此要等翻页和补齐结束后再裁剪。
        if (!this.synced || this.olderInFlight || this.untilRunning > 0) return;
        this.store = trimOldest(this.store, keep);
        this.commit();
      },
      sendText: (input) => this.sendText(input),
      sendImage: (file, size) => {
        const width = Math.round(size.width);
        const height = Math.round(size.height);
        return outboxFor(this.roomId).enqueue({ text: '', image: { file, localUrl: URL.createObjectURL(file), width, height } });
      },
      resend: (clientId) => outboxFor(this.roomId).resend(clientId),
      discard: (clientId) => outboxFor(this.roomId).discard(clientId),
      markRead: (id) => this.markRead(id),
      hide: (id) => this.hide(id),
      removeAsModerator: (id) => this.sendOrNotice({ type: 'delete', messageId: id }),
      recall: (id) => this.recall(id),
      reeditText: (id) => this.reeditText(id),
      quoteTarget: (id) => quoteTargetState(this.store, id),
      mute: (memberId, minutes) => this.sendOrNotice({ type: 'mute', memberId, minutes }),
      clearNotice: () => this.setData({ notice: null }),
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getView = (): RoomView => this.view;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    this.sessionMemberId = useSessionStore.getState().member?.id ?? null;
    if (this.store.messages.length === 0) this.hydrate();

    this.outbox = outboxFor(this.roomId);
    this.unsubscribeOutbox = this.outbox.subscribe(() => this.commit());
    const transport: OutboxTransport = {
      send: (frame) => this.sendFrame(frame),
      upload: (file, options) => uploadWithProgress(this.roomId, file, options).then((res) => res.imageKey),
      online: () => navigator.onLine !== false,
    };
    this.outboxLink = this.outbox.attach(transport);
    this.onVisibility();

    window.addEventListener('online', this.onWake);
    document.addEventListener('visibilitychange', this.onWake);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.mediaRefresh = setInterval(() => this.refreshMedia(), MEDIA_REFRESH_MS);
    this.commit();
    void this.connect();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.generation += 1;
    window.removeEventListener('online', this.onWake);
    document.removeEventListener('visibilitychange', this.onWake);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.mediaRefresh) clearInterval(this.mediaRefresh);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.mediaRefresh = null;
    this.reconnectTimer = null;

    const socket = this.socket;
    this.socket = null;
    this.onSocketLost();
    socket?.close();
    this.resolveSyncWaiters(false);

    // A sign-out clears the cache before this screen unmounts; writing it back would leak the room.
    // 退出登录会在本页卸载前清空缓存；此时写回会泄露该房间的内容。
    const session = useSessionStore.getState();
    const sameMember = session.token !== null && (session.member?.id ?? null) === this.sessionMemberId;
    if (sameMember && !this.data.fatalError) {
      putRoomSnapshot(this.roomId, {
        messages: this.store.messages,
        hasMore: this.store.hasMore,
        visibleFromId: this.store.visibleFromId,
        floorReason: this.store.floorReason,
        reachedFloor: this.store.reachedFloor,
        lastRev: this.store.lastRev,
        revTrusted: this.store.revTrusted,
        meta: this.data.meta,
      });
    }

    this.unsubscribeOutbox?.();
    this.unsubscribeOutbox = null;
    this.outboxLink?.detach();
    this.outboxLink = null;
    if (this.outbox && this.outbox.size === 0 && outboxes.get(this.roomId) === this.outbox) outboxes.delete(this.roomId);
    this.outbox = null;
    this.recallStash.clear();
    this.pendingHides.clear();
  }

  /* View plumbing */
  /* 视图更新 */

  private hydrate(): void {
    const snapshot = getRoomSnapshot(this.roomId);
    if (!snapshot) return;
    this.store = createMessageStore({
      messages: snapshot.messages,
      hasMore: snapshot.hasMore,
      reachedFloor: snapshot.reachedFloor,
      floorReason: snapshot.floorReason,
      visibleFromId: snapshot.visibleFromId,
      lastRev: snapshot.lastRev,
      revTrusted: snapshot.revTrusted,
    });
    if (!this.data.meta && snapshot.meta) this.data = { ...this.data, meta: snapshot.meta, canPost: snapshot.meta.canPost };
  }

  private buildView(): RoomView {
    const pending: PendingMessage[] = this.outbox?.list() ?? outboxes.get(this.roomId)?.list() ?? [];
    return {
      ...this.data,
      messages: this.store.messages,
      pending,
      hasMore: this.store.hasMore,
      reachedFloor: this.store.reachedFloor,
      floorReason: this.store.floorReason,
      visibleFromId: this.store.visibleFromId,
    };
  }

  private commit(): void {
    // Dropping a pending quote notifies the outbox listener, which lands here again; the outer pass
    // already builds the view after that change.
    // 去掉待发引用会通知发送队列的监听器，从而再次进入这里；外层这一轮在该变更之后才生成视图。
    if (this.committing) return;
    this.committing = true;
    try {
      this.reconcilePendingQuotes();
      this.view = this.buildView();
    } finally {
      this.committing = false;
    }
    for (const listener of this.listeners) listener();
  }

  /**
   * Pending sends drop a quote whose message was withdrawn, removed or fell below the floor, so no
   * withdrawn text stays on screen and the send is not refused for its quote.
   * 待发消息去掉所引用消息已撤回、已删除或已低于下限的引用，屏幕上因此不会留下被撤回的内容，发送也不会因引用而被拒绝。
   */
  private reconcilePendingQuotes(): void {
    const box = this.outbox ?? outboxes.get(this.roomId);
    if (!box) return;
    for (const item of box.list()) {
      if (!item.replyTo) continue;
      const state = quoteTargetState(this.store, item.replyTo.id);
      if (state === 'recalled' || state === 'deleted' || state === 'unavailable') box.dropQuote(item.replyTo.id);
    }
  }

  private setData(patch: Partial<SessionData>): void {
    this.data = { ...this.data, ...patch };
    this.commit();
  }

  /* Connection */
  /* 连接 */

  private readonly onVisibility = () => {
    this.outboxLink?.setVisible(document.visibilityState !== 'hidden');
  };

  private readonly onWake = () => {
    if (!this.running || this.socket || !this.reconnectTimer) return;
    if (document.visibilityState === 'hidden') return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    void this.connect();
  };

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = backoff(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private refreshMedia(): void {
    const generation = this.generation;
    chatApi
      .ticket(this.roomId)
      .then((ticket) => {
        if (generation === this.generation) this.setData({ mediaToken: ticket.mediaToken });
      })
      .catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const generation = this.generation;
    this.setData({ status: 'connecting', retrying: false });
    let ticket: RoomTicketResponse;
    try {
      ticket = await chatApi.ticket(this.roomId, { meta: this.firstTicket });
    } catch (err) {
      if (generation !== this.generation) return;
      const status = err instanceof ApiClientError ? err.status : 0;
      if (status === 403 || status === 404) {
        this.becomeFatal(errorMessage(err));
        return;
      }
      const retry = status === 0 || status >= 500;
      this.setData({ status: 'closed', retrying: retry, ...(retry ? {} : { notice: errorMessage(err) }) });
      if (retry) this.scheduleReconnect();
      return;
    }
    if (generation !== this.generation) return;
    if (ticket.room) this.firstTicket = false;
    this.setData({
      mediaToken: ticket.mediaToken,
      canPost: ticket.canPost !== false,
      meta: ticket.room ?? this.data.meta,
      fatalError: null,
    });
    this.open(ticket.socketUrl, generation);
  }

  /** The member can no longer read this room: stop for good and forget what was shown. */
  /** 成员已无法阅读此房间：彻底停止，并丢弃已显示的内容。 */
  private becomeFatal(message: string): void {
    dropRoomSnapshot(this.roomId);
    this.store = createMessageStore();
    const box = outboxes.get(this.roomId);
    if (box) {
      box.dispose();
      outboxes.delete(this.roomId);
    }
    this.setData({ status: 'closed', retrying: false, fatalError: message });
  }

  private open(url: string, generation: number): void {
    const socket = new WebSocket(url);
    this.socket = socket;
    // Every handler checks it still owns the ref: a socket from an earlier run can fire late.
    // 每个回调都先确认自己仍是当前连接：之前一轮的连接可能延迟触发。
    const current = () => generation === this.generation && this.socket === socket;

    socket.onopen = () => {
      if (!current()) return;
      this.history.acquire(SYNC_LOCK);
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(PING);
      }, HEARTBEAT_MS);
    };
    socket.onmessage = (event) => {
      if (!current()) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const frame = parseServerFrame(parsed);
      if (frame) this.handleFrame(frame);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.onSocketLost();
      if (!this.running || generation !== this.generation) return;
      this.setData({ status: 'closed', retrying: true, loadingOlder: false });
      this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private onSocketLost(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.legacyOlderTimer) clearTimeout(this.legacyOlderTimer);
    this.heartbeat = null;
    this.retryTimer = null;
    this.legacyOlderTimer = null;
    this.synced = false;
    this.data = { ...this.data, synced: false };
    this.buffered = [];
    const dropped = this.history.cancelAll();
    if (dropped.some((r) => r.purpose === 'older') || this.olderWaiter?.key === 'legacy') this.olderWanted = true;
    this.settleOlder(false);
    this.outboxLink?.setReady(false);
  }

  private sendFrame(frame: ClientFrame): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }

  private sendOrNotice(frame: ClientFrame): void {
    if (!this.sendFrame(frame)) this.setData({ notice: offlineNotice() });
  }

  /* Frames */
  /* 帧处理 */

  private handleFrame(frame: ServerFrame): void {
    if (frame.type === 'pong') return;
    if (frame.type === 'ready') {
      this.onReady(frame);
      return;
    }
    if (frame.type === 'history_result') {
      this.onHistory(frame);
      return;
    }
    if (frame.type === 'error') {
      this.onError(frame);
      return;
    }
    if (frame.type === 'message' && this.data.status === 'catching_up') {
      this.buffered.push(frame);
      return;
    }
    this.applyLive(frame);
    this.commit();
  }

  private applyLive(frame: ServerFrame): void {
    let rev: number | undefined;
    switch (frame.type) {
      case 'message':
        this.store = applyMessage(this.store, frame.message);
        rev = frame.message.rev;
        this.ack(ackedClientIds(frame));
        break;
      case 'deleted':
        this.store = applyDeleted(this.store, frame.messageId, frame.by);
        rev = frame.rev;
        break;
      case 'recalled':
        this.store = applyRecalled(this.store, frame.messageId);
        rev = frame.rev;
        break;
      case 'hidden':
        this.pendingHides.delete(frame.messageId);
        this.store = applyHidden(this.store, frame.messageId);
        rev = frame.rev;
        break;
      case 'cleared':
        this.store = applyCleared(this.store, frame.beforeId);
        this.data = { ...this.data, lastReadId: Math.max(this.data.lastReadId, frame.beforeId - 1) };
        rev = frame.rev;
        break;
      case 'author':
        this.store = applyAuthor(this.store, frame.author);
        rev = frame.rev;
        break;
      default:
        break;
    }
    // Live revisions count only once caught up; before that, a missed change could hide behind a newer one.
    // 只有补齐之后实时帧的版本号才计入；在此之前，漏掉的变更可能被更新的版本号掩盖。
    if (this.synced) this.store = advanceRev(this.store, rev);
  }

  private ack(clientIds: string[]): void {
    if (clientIds.length === 0) return;
    const box = outboxFor(this.roomId);
    for (const id of clientIds) box.ack(id);
  }

  private onReady(frame: ReadyFrame): void {
    this.attempt = 0;
    this.syncRetries = 0;
    this.memberId = frame.memberId;
    const serverRev = typeof frame.rev === 'number' ? frame.rev : undefined;
    const capable = serverRev !== undefined;
    lastServerCapable = capable;
    this.serverKnown = true;
    this.outboxLink?.setCapable(capable);
    const patch: Partial<SessionData> = { capable, lastReadId: frame.lastReadId };
    if (!this.entrySeen) {
      this.entrySeen = true;
      patch.entry = {
        lastReadId: frame.lastReadId,
        unreadCount: frame.unreadCount ?? 0,
        firstUnreadId: frame.firstUnreadId ?? null,
        firstMentionId: frame.firstMentionId ?? null,
      };
    }
    const serverMs = frame.serverTime ? Date.parse(frame.serverTime) : Number.NaN;
    if (Number.isFinite(serverMs)) patch.clockSkewMs = serverMs - Date.now();
    if (capable) {
      patch.mutedUntil = frame.mutedUntil ?? null;
      this.store = dropBelowFloor(this.store, frame.visibleFromId ?? 0, frame.floorReason ?? null);
    }

    const plan = planSync({
      serverRev,
      newestId: newestId(this.store),
      oldestId: oldestId(this.store),
      lastRev: this.store.lastRev,
      revTrusted: this.store.revTrusted,
      limit: HISTORY_PAGE_SIZE,
    });

    if (plan.kind === 'legacy') {
      // An old server: replace the list with the newest page, exactly as before. It changes rows without a
      // revision, so the next capable server reloads the list instead of catching up from lastRev, and it
      // cannot hide messages, so hides made before it answered are undone.
      // 旧服务端：与以前完全一样，用最新一页替换列表。它修改消息时不更新版本号，因此下一个支持新协议的服务端会重新加载列表，
      // 而不是从 lastRev 补齐；它也不支持隐藏消息，因此在它答复之前做的隐藏会被撤销。
      this.store = distrustRev(this.store);
      for (const row of this.pendingHides.values()) this.store = restoreHidden(this.store, row);
      this.pendingHides.clear();
      this.legacyReplace = true;
      this.setData({ ...patch, status: 'open', loadingOlder: this.store.messages.length === 0 });
      if (!this.sendFrame({ type: 'history' })) this.socket?.close();
      return;
    }

    if (plan.kind === 'catch_up') {
      this.catchUpCursor = plan.fields.afterId ?? 0;
      this.setData({ ...patch, status: 'catching_up' });
      this.requestHistory('catch_up', plan.fields, 1);
    } else {
      this.setData({ ...patch, status: 'open', loadingOlder: plan.purpose === 'initial' });
      this.requestHistory(plan.purpose, plan.fields, 1);
    }
  }

  private requestHistory(purpose: HistoryPurpose, fields: HistoryFields, page: number): HistoryRequest | null {
    const lock = purpose === 'older' || purpose === 'until';
    const request = this.history.start(purpose, fields, { page, lock });
    if (this.sendFrame(request.frame)) return request;
    this.history.settle(request.requestId);
    return null;
  }

  private onHistory(frame: HistoryResultFrame): void {
    if (!this.data.capable) {
      this.onLegacyHistory(frame);
      return;
    }
    const request = this.history.settle(frame.requestId);
    if (!request) {
      // A stale result moves no flag, lock or revision, and only updates rows inside the loaded range.
      // Only rows that ended up in the list confirm pending sends, so nothing vanishes without its row.
      // 过期的结果不改变任何标记、锁或版本号，只更新已加载范围内的消息。只有进入列表的消息才会确认待发项，因此不会有消息在没有对应行时消失。
      const rows = [...frame.messages, ...(frame.changed ?? [])];
      this.store = mergeStale(this.store, rows);
      if (frame.hiddenIds?.length) this.store = applyChanged(this.store, [], frame.hiddenIds);
      this.ack(rows.flatMap((m) => (m.clientId && findMessage(this.store, m.id) ? [m.clientId] : [])));
      this.commit();
      return;
    }
    switch (request.purpose) {
      case 'initial':
      case 'reset':
        this.store = mergePage(
          this.store,
          { messages: frame.messages, hasMore: frame.hasMore, reachedFloor: frame.reachedFloor, floorReason: frame.floorReason, rev: frame.rev },
          'latest',
        );
        this.ack(ackedClientIds(frame));
        this.finishSync();
        return;
      case 'catch_up':
        this.onCatchUp(request, frame);
        return;
      case 'older':
      case 'until':
        this.store = mergePage(
          this.store,
          {
            messages: frame.messages,
            hasMore: frame.hasMore,
            reachedFloor: frame.reachedFloor,
            floorReason: frame.floorReason,
            rev: this.synced ? frame.rev : undefined,
            beforeId: request.frame.beforeId,
          },
          'older',
        );
        this.ack(ackedClientIds(frame));
        this.data = { ...this.data, loadingOlder: false, olderFailed: false };
        this.settleOlder(true);
        this.commit();
        return;
    }
  }

  private onCatchUp(request: HistoryRequest, frame: HistoryResultFrame): void {
    if (frame.changedOverflow) {
      this.resetToLatest();
      return;
    }
    const flags = request.frame.oldestId !== undefined ? { hasMore: frame.hasMore, reachedFloor: frame.reachedFloor, floorReason: frame.floorReason } : {};
    this.store = mergePage(this.store, { messages: frame.messages, ...flags }, 'newer');
    if (frame.changed || frame.hiddenIds) this.store = applyChanged(this.store, frame.changed ?? [], frame.hiddenIds ?? []);
    for (const id of frame.hiddenIds ?? []) this.pendingHides.delete(id);
    this.store = advanceRev(this.store, frame.rev);
    this.ack(ackedClientIds(frame));
    this.catchUpCursor = frame.messages.reduce((max, m) => Math.max(max, m.id), this.catchUpCursor);

    const step = planCatchUp({ page: request.page, hasNewer: frame.hasNewer === true, changedOverflow: false, cursor: this.catchUpCursor });
    if (step.kind === 'next') {
      this.commit();
      if (!this.requestHistory('catch_up', { afterId: step.afterId, limit: HISTORY_PAGE_SIZE }, step.page)) this.socket?.close();
    } else if (step.kind === 'reset') {
      this.resetToLatest();
    } else {
      this.finishSync();
    }
  }

  private resetToLatest(): void {
    this.commit();
    if (!this.requestHistory('reset', { limit: HISTORY_PAGE_SIZE }, 1)) this.socket?.close();
  }

  private onLegacyHistory(frame: HistoryResultFrame): void {
    const replace = this.legacyReplace;
    this.legacyReplace = false;
    if (this.legacyOlderTimer) clearTimeout(this.legacyOlderTimer);
    this.legacyOlderTimer = null;
    this.store = mergePage(this.store, { messages: frame.messages, hasMore: frame.hasMore, beforeId: replace ? undefined : this.legacyOlderBeforeId }, replace ? 'latest' : 'older');
    this.ack(ackedClientIds(frame));
    if (replace || !this.synced) {
      this.finishSync();
      return;
    }
    this.data = { ...this.data, loadingOlder: false, olderFailed: false };
    this.settleOlder(true);
    this.commit();
  }

  /** The first result after open is in: unlock paging, release the outbox and replay deferred work. */
  /** 连接后的第一个结果已到：解锁翻页、放行发送队列，并执行被推迟的操作。 */
  private finishSync(): void {
    this.history.release(SYNC_LOCK);
    this.synced = true;
    this.syncRetries = 0;
    this.data = { ...this.data, status: 'open', synced: true, loadingOlder: false };
    const buffered = this.buffered;
    this.buffered = [];
    for (const frame of buffered) this.applyLive(frame);
    this.commit();

    for (const id of this.pendingHides.keys()) this.sendFrame({ type: 'hide', messageId: id });
    this.outboxLink?.setReady(true);
    this.resolveSyncWaiters(true);
    if (this.olderWanted) {
      this.olderWanted = false;
      this.loadOlder();
    }
  }

  private onHistoryFailed(request: HistoryRequest): void {
    if (request.purpose === 'older' || request.purpose === 'until') {
      this.data = { ...this.data, loadingOlder: false, olderFailed: request.purpose === 'older' };
      this.settleOlder(false);
      this.commit();
      return;
    }
    // The sync chain is stuck. Retry a few times; after that assume the socket is dead and reconnect.
    // 同步过程卡住了。先重试几次；之后视为连接已失效并重连。
    this.syncRetries += 1;
    if (this.syncRetries > SYNC_RETRIES_MAX) {
      this.socket?.close();
      return;
    }
    const generation = this.generation;
    const socket = this.socket;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (generation !== this.generation || this.socket !== socket || this.synced) return;
      if (!this.requestHistory(request.purpose, request.fields, request.page)) this.socket?.close();
    }, SYNC_RETRY_MS * this.syncRetries);
  }

  private onError(frame: ErrorFrame): void {
    const text = localizedMessage(frame.message);
    if (frame.code === 'muted') {
      const until = frame.mutedUntil ?? legacyMutedUntil(frame.message);
      if (until) this.data = { ...this.data, mutedUntil: until };
    }
    // A rejected send fails only its own item. When only its quote is gone, it goes again without the quote.
    // 被拒绝的发送只让对应的待发项失败。若只是所引用的消息已不存在，则去掉引用再发一次。
    if (frame.clientId) {
      const box = outboxFor(this.roomId);
      const quoteGone = frame.code === 'invalid_frame' && frame.message === QUOTE_GONE_MESSAGE && !this.quoteRetried.has(frame.clientId);
      if (quoteGone && box.has(frame.clientId)) {
        this.quoteRetried.add(frame.clientId);
        box.retryWithoutQuote(frame.clientId);
      } else {
        box.fail(frame.clientId, text);
      }
      this.commit();
      return;
    }
    if (frame.requestId) {
      const request = this.history.settle(frame.requestId);
      if (request) this.onHistoryFailed(request);
    }
    if (frame.messageId !== undefined) {
      this.recallStash.delete(frame.messageId);
      const hidden = this.pendingHides.get(frame.messageId);
      if (hidden) {
        this.pendingHides.delete(frame.messageId);
        this.store = restoreHidden(this.store, hidden);
      }
    }
    this.setData({ notice: text });
  }

  /* Paging */
  /* 翻页 */

  private settleOlder(ok: boolean): void {
    const waiter = this.olderWaiter;
    this.olderWaiter = null;
    this.olderInFlight = null;
    waiter?.resolve(ok);
  }

  private resolveSyncWaiters(ok: boolean): void {
    const waiters = this.syncWaiters;
    this.syncWaiters = [];
    for (const resolve of waiters) resolve(ok);
  }

  private whenSynced(): Promise<boolean> {
    if (this.synced) return Promise.resolve(true);
    if (!this.running || this.data.fatalError) return Promise.resolve(false);
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.syncWaiters = this.syncWaiters.filter((w) => w !== done);
        resolve(false);
      }, SYNC_WAIT_MS);
      this.syncWaiters.push(done);
    });
  }

  private loadOlder(): void {
    // After a failure only retryOlder() pages again, so the list's sentinel cannot loop on errors.
    // 失败后只有 retryOlder() 才会再次翻页，列表的哨兵因此不会在出错时循环请求。
    if (!this.store.hasMore || this.data.olderFailed) return;
    if (!this.synced) {
      // Runs once the socket is back and caught up.
      // 连接恢复并补齐后再执行。
      this.olderWanted = true;
      return;
    }
    void this.requestOlderPage(HISTORY_PAGE_SIZE, 'older');
  }

  private requestOlderPage(limit: number, purpose: 'older' | 'until'): Promise<boolean> {
    if (!this.synced || this.history.locked || this.olderInFlight) return Promise.resolve(false);
    const beforeId = oldestId(this.store);
    if (beforeId === null) return Promise.resolve(false);
    let key: string;
    if (this.data.capable) {
      const request = this.requestHistory(purpose, { beforeId, limit }, 1);
      if (!request) return Promise.resolve(false);
      key = request.requestId;
    } else {
      if (!this.sendFrame({ type: 'history', beforeId })) return Promise.resolve(false);
      key = 'legacy';
      this.legacyOlderBeforeId = beforeId;
      this.legacyOlderTimer = setTimeout(() => {
        this.legacyOlderTimer = null;
        this.data = { ...this.data, loadingOlder: false, olderFailed: purpose === 'older' };
        this.settleOlder(false);
        this.commit();
      }, 10_000);
    }
    const promise = new Promise<boolean>((resolve) => {
      this.olderWaiter = { key, resolve };
    });
    this.olderInFlight = promise;
    this.setData({ loadingOlder: true, olderFailed: false });
    return promise;
  }

  private async loadUntil(id: number): Promise<boolean> {
    this.untilRunning += 1;
    try {
      return await this.pageBackTo(id);
    } finally {
      this.untilRunning -= 1;
    }
  }

  private async pageBackTo(id: number): Promise<boolean> {
    let pages = 0;
    for (;;) {
      if (findMessage(this.store, id)) return true;
      if (id < this.store.visibleFromId || !this.store.hasMore || pages >= UNTIL_PAGES_MAX) return false;
      const oldest = oldestId(this.store);
      // Inside the loaded range but missing: hidden, removed or below the floor.
      // 位于已加载范围内却不存在：已隐藏、已删除或低于下限。
      if (oldest !== null && oldest <= id) return false;
      if (!this.synced) {
        if (!(await this.whenSynced())) return false;
        continue;
      }
      if (this.olderInFlight) {
        await this.olderInFlight;
        continue;
      }
      pages += 1;
      if (!(await this.requestOlderPage(HISTORY_PAGE_MAX, 'until'))) return false;
    }
  }

  /* Actions */
  /* 操作 */

  private sendText(input: { text: string; replyTo?: QuotePreview | null; mentions?: string[]; mentionAll?: boolean }): string {
    const text = input.text.trim();
    if (!text) return '';
    // Before this visit's first ready nothing is known about the server, so the quote and mentions stay on
    // the item and the outbox leaves them out only if the server that takes the send turns out to be old.
    // 本次进入的第一个 ready 帧到达之前对服务端一无所知，因此引用和提醒保留在待发项上；只有实际接收这次发送的服务端是旧版本时，发送队列才会去掉它们。
    const legacy = this.serverKnown && !this.data.capable;
    const target = input.replyTo ? quoteTargetState(this.store, input.replyTo.id) : null;
    const quotable = target === 'ok' || target === 'hidden' || target === 'unknown';
    return outboxFor(this.roomId).enqueue({
      text,
      replyTo: !legacy && quotable ? (input.replyTo ?? null) : null,
      mentions: legacy ? [] : (input.mentions ?? []),
      mentionAll: !legacy && input.mentionAll === true,
    });
  }

  private markRead(id: number): void {
    if (id <= this.data.lastReadId) return;
    if (!this.sendFrame({ type: 'read', messageId: id })) return;
    this.setData({ lastReadId: id });
  }

  private hide(id: number): void {
    if (!this.data.capable) return;
    const row = findMessage(this.store, id);
    this.store = applyHidden(this.store, id);
    if (row) this.pendingHides.set(id, row);
    // Sent now if open, otherwise again once the socket is back and caught up.
    // 连接打开时立即发送，否则在连接恢复并补齐后再次发送。
    if (this.synced) this.sendFrame({ type: 'hide', messageId: id });
    this.commit();
  }

  private recall(id: number): void {
    const row = findMessage(this.store, id);
    const me = this.memberId ?? useSessionStore.getState().member?.id ?? null;
    if (row && me && row.author.id === me && !row.recalled && !row.deleted && row.text.trim()) {
      this.recallStash.set(id, { text: row.text, at: Date.now() });
    }
    if (!this.sendFrame({ type: 'recall', messageId: id })) {
      this.recallStash.delete(id);
      this.setData({ notice: offlineNotice() });
    }
  }

  private reeditText(id: number): string | null {
    const stash = this.recallStash.get(id);
    if (!stash) return null;
    if (Date.now() - stash.at > RECALL_STASH_MS) {
      this.recallStash.delete(id);
      return null;
    }
    return findMessage(this.store, id)?.recalled ? stash.text : null;
  }
}

/**
 * Owns one WebSocket per room and implements RoomController: fetches a ticket, connects,
 * reconnects with backoff, catches up after a reconnect without dropping loaded pages, and queues
 * sends in an outbox so the composer never waits for the connection.
 * 每个房间一条 WebSocket，并实现 RoomController：领取票据、连接、退避重连；重连后补齐缺口而不丢弃已加载的页；
 * 发送进入队列，输入框从不需要等待连接。
 */
export function useRoomSocket(roomId: string): RoomController {
  const session = useMemo(() => new RoomSession(roomId), [roomId]);
  useEffect(() => {
    session.start();
    return () => session.stop();
  }, [session]);
  const view = useSyncExternalStore(session.subscribe, session.getView);
  return useMemo(() => ({ ...view, ...session.methods }), [view, session]);
}
