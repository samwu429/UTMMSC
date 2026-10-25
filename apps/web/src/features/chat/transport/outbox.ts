import { IMAGE_DIMENSION_MAX, MENTIONS_MAX, type QuotePreview, type SendFrame, type ServerFrame } from '@utmmsc/shared';
import { holdAppUpdate } from '../../../app/pwa';
import type { PendingImage, PendingMessage } from '../room/types';

/** How long a sent item may wait for its echo, counted only while the socket is ready and the page is visible. */
/** 已发送项等待回显的最长时间，只在连接就绪且页面可见时计时。 */
export const ACK_TIMEOUT_MS = 12_000;
/** Minimum gap between two sends, which keeps a long queue under the room's send limit. */
/** 两次发送之间的最小间隔，使较长的队列不超过房间的发送频率限制。 */
export const FLUSH_SPACING_MS = 900;

/**
 * A finished image upload: the stored key, the thumbnail's key when one was stored beside it, and the stored image's
 * size when it differs from the picked one (a photo re-encoded at a 2048px long edge).
 * 已完成的图片上传：存储键、一同存储的缩略图的键，以及存储图片与所选图片尺寸不同时（照片按 2048px 长边重新编码）的新尺寸。
 */
export interface UploadedImage {
  imageKey: string;
  thumbKey?: string | null;
  width?: number;
  height?: number;
}

export interface OutboxTransport {
  /** Returns false when the socket is not open and nothing was sent. */
  /** 连接未打开、未发送时返回 false。 */
  send(frame: SendFrame): boolean;
  /** Resolves with the stored image key, or the keys and size of an upload that also stored a thumbnail. */
  /** 返回存储后的图片键；同时存储了缩略图时返回各个键和尺寸。 */
  upload(file: Blob, options: { signal: AbortSignal; onProgress(fraction: number): void; size: { width: number; height: number } }): Promise<string | UploadedImage>;
  /** False while the device is known to be offline, so uploads wait instead of failing at once. */
  /** 设备已知离线时为 false，上传因此等待而不是立即失败。 */
  online?(): boolean;
}

/** Ready means the socket is open and the room has caught up, so sends may go out. */
/** 就绪表示连接已打开且房间已补齐，可以发送。 */
export interface OutboxLink {
  setReady(ready: boolean): void;
  /**
   * Set from every ready frame, before the outbox is ready. A capable server de-duplicates a resent clientId
   * and takes quotes and mentions; an old one does neither, so nothing is resent to it on its own.
   * 每次收到 ready 帧时、在发送队列就绪之前设置。支持新协议的服务端会按 clientId 去重并接受引用和提醒；旧服务端两者都不支持，因此不会自动向它重发。
   */
  setCapable(capable: boolean): void;
  /** A hidden page may be frozen and cannot receive echoes, so the ack clock stops while it is hidden. */
  /** 隐藏的页面可能被冻结，无法收到回显，因此页面隐藏期间确认计时暂停。 */
  setVisible(visible: boolean): void;
  detach(): void;
}

export interface OutboxOptions {
  /** Localized failure for an item whose echo never came. */
  /** 一直没有回显的项的失败说明（已本地化）。 */
  timeoutText(): string;
  /** Localized failure for a send that may have landed on a server that cannot de-duplicate a resend. */
  /** 发送可能已到达一个无法对重发去重的服务端时的失败说明（已本地化）。 */
  uncertainText(): string;
  /** Localized failure for an upload error. */
  /** 上传出错时的失败说明（已本地化）。 */
  uploadFailureText(error: unknown): string;
  /** True for an upload error worth retrying on reconnect; by default a network failure (TypeError). */
  /** 值得在重连后重试的上传错误为 true；默认是网络失败（TypeError）。 */
  retryableUpload?(error: unknown): boolean;
  revokeUrl?(url: string): void;
  ackTimeoutMs?: number;
  spacingMs?: number;
  makeClientId?(): string;
  /**
   * Keeps a waiting app update from reloading the page and returns the release; by default the app's own (pwa.ts).
   * The items live only in memory, so a reload would lose them without a word.
   * 阻止等待中的应用更新重新加载页面，并返回释放函数；默认使用应用自己的（pwa.ts）。待发项只保存在内存中，重新加载会让它们无声无息地丢失。
   */
  holdUpdate?(): () => void;
}

export interface OutboxInput {
  text: string;
  replyTo?: QuotePreview | null;
  mentions?: string[];
  mentionAll?: boolean;
  image?: { file: Blob | null; localUrl: string; width: number; height: number; imageKey?: string | null; thumbKey?: string | null } | null;
}

/** Time spent waiting for one echo, counting only stretches while the socket is ready and the page is visible. */
/** 等待一次回显所用的时间，只累计连接就绪且页面可见的时段。 */
interface AckClock {
  waitedMs: number;
  /** Device time the current stretch began; null while the clock is stopped. */
  /** 当前时段开始时的设备时间；计时暂停时为 null。 */
  since: number | null;
}

/**
 * The item's last send went out and the server neither confirmed nor refused it. 'deduplicated' means that
 * server drops a repeated clientId, so the same send may go out again; 'legacy' means it does not.
 * 该项最近一次发送已发出，服务端既未确认也未拒绝。'deduplicated' 表示该服务端会丢弃重复的 clientId，同一发送可以再发一次；'legacy' 表示不会。
 */
type Unanswered = 'deduplicated' | 'legacy' | null;

interface OutboxItem {
  view: PendingMessage;
  file: Blob | null;
  /** Stored beside the image by its upload; the view has no use for it, so it stays here. */
  /** 上传时与图片一同存储；视图用不到它，因此只保存在这里。 */
  thumbKey: string | null;
  /** Set while the item waits for its echo. */
  /** 等待回显期间设置。 */
  clock: AckClock | null;
  unanswered: Unanswered;
  /** The upload failed for lack of a network; it is queued again once the socket is back. */
  /** 上传因没有网络而失败；连接恢复后会重新排队。 */
  retryUpload: boolean;
}

type ItemState = Partial<Pick<OutboxItem, 'clock' | 'unanswered' | 'retryUpload'>>;

function waited(clock: AckClock, now: number): number {
  return clock.waitedMs + (clock.since === null ? 0 : now - clock.since);
}

function validDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= IMAGE_DIMENSION_MAX;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

/**
 * Builds the send frame; a resend produces the same frame with the same clientId. An old server gets
 * no quote, mentions or thumbnail, which it cannot take.
 * 生成发送帧；重发得到的帧与 clientId 都相同。旧服务端不支持引用、提醒和缩略图，发给它的帧不带这些内容。
 */
export function buildSendFrame(item: PendingMessage, capable = true, thumbKey: string | null = null): SendFrame {
  const frame: SendFrame = { type: 'send', clientId: item.clientId, text: item.text };
  if (item.image?.imageKey) {
    frame.imageKey = item.image.imageKey;
    if (validDimension(item.image.width) && validDimension(item.image.height)) {
      frame.imageWidth = item.image.width;
      frame.imageHeight = item.image.height;
    }
    if (capable && thumbKey) frame.thumbKey = thumbKey;
  }
  if (!capable) return frame;
  if (item.replyTo && item.replyTo.state === 'ok') frame.replyToId = item.replyTo.id;
  if (item.mentions.length > 0) frame.mentions = item.mentions.slice(0, MENTIONS_MAX);
  if (item.mentionAll) frame.mentionAll = true;
  return frame;
}

/**
 * Client ids a server frame confirms: the top-level clientId of a message frame, message.clientId,
 * and own rows in a history page or its catch-up changes.
 * 服务端帧所确认的 clientId：消息帧顶层的 clientId、message.clientId，以及历史页或补齐变更中自己的消息。
 */
export function ackedClientIds(frame: ServerFrame): string[] {
  if (frame.type === 'message') {
    const found = [frame.clientId, frame.message.clientId].filter((id): id is string => typeof id === 'string' && id.length > 0);
    return [...new Set(found)];
  }
  if (frame.type === 'history_result') {
    const rows = [...frame.messages, ...(frame.changed ?? [])];
    return rows.map((m) => m.clientId).filter((id): id is string => typeof id === 'string' && id.length > 0);
  }
  return [];
}

function defaultRevoke(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

/** randomUUID exists only in secure contexts, so a page opened over plain http on a LAN falls back. */
/** randomUUID 只在安全上下文中可用，因此通过局域网 http 打开的页面会使用后备方案。 */
export function newClientId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Pending sends for one room: queued, uploading, sending, then acked (removed) or failed.
 * Items survive a detach so a room left mid-send flushes when it is entered again.
 * 单个房间的待发消息：排队、上传中、发送中，之后被确认（移除）或失败。
 * 解除绑定后待发项仍保留，发送中途离开的房间再次进入时会继续发送。
 */
export class Outbox {
  private items: OutboxItem[] = [];
  private snapshot: PendingMessage[] = [];
  private transport: OutboxTransport | null = null;
  private link: OutboxLink | null = null;
  private ready = false;
  /** What the last ready frame said about the server; kept across a detach until the next one. */
  /** 最近一次 ready 帧所表明的服务端能力；解除绑定后保留到下一次 ready。 */
  private capable = true;
  private visible = true;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private upload: { clientId: string; controller: AbortController } | null = null;
  /** Releases the app update hold taken while an item is on its way. */
  /** 释放有待发项正在发送期间获取的应用更新占用。 */
  private releaseUpdate: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly ackTimeoutMs: number;
  private readonly spacingMs: number;

  constructor(private readonly options: OutboxOptions) {
    this.ackTimeoutMs = options.ackTimeoutMs ?? ACK_TIMEOUT_MS;
    this.spacingMs = options.spacingMs ?? FLUSH_SPACING_MS;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): PendingMessage[] {
    return this.snapshot;
  }

  get size(): number {
    return this.items.length;
  }

  has(clientId: string): boolean {
    return this.items.some((i) => i.view.clientId === clientId);
  }

  /**
   * Binds a transport and returns the link that controls it. A newer attach takes over, after which
   * the older link does nothing, so a stale room session can never stall or detach the current one.
   * 绑定一个传输通道并返回控制它的链接。新的绑定会接管，旧链接随之失效，过期的房间会话因此无法卡住或解绑当前会话。
   */
  attach(transport: OutboxTransport): OutboxLink {
    if (this.link) this.release();
    const link: OutboxLink = {
      setReady: (ready) => {
        if (this.link === link) this.setReady(ready);
      },
      setCapable: (capable) => {
        if (this.link === link) this.setCapable(capable);
      },
      setVisible: (visible) => {
        if (this.link === link) this.setVisible(visible);
      },
      detach: () => {
        if (this.link !== link) return;
        this.release();
        this.link = null;
      },
    };
    this.link = link;
    this.transport = transport;
    this.pump();
    return link;
  }

  /** Stops timers and uploads but keeps every item for the next attach. */
  /** 停止计时和上传，但保留所有待发项供下次绑定。 */
  private release(): void {
    this.setReady(false);
    this.abortUpload(true);
    this.transport = null;
    this.clearTimers();
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) {
      if (ready) this.pump();
      return;
    }
    this.ready = ready;
    if (ready) {
      this.requeueUploads();
      this.pump();
      return;
    }
    // A send in flight when the socket drops may or may not have landed. A server that de-duplicates
    // takes it again under the same clientId, so it goes back to the queue, and so does an item that timed
    // out there. An old server would store it twice, so the member decides instead.
    // 连接断开时正在发送的消息可能已送达也可能没有。会去重的服务端可以用相同的 clientId 再收一次，因此它回到队列，
    // 在该服务端上超时的项也一样。旧服务端会存成两条，因此改由成员决定。
    let changed = false;
    this.items = this.items.map((item) => {
      const { status } = item.view;
      if (status !== 'sending' && status !== 'failed') return item;
      if (item.unanswered === 'deduplicated' && this.capable) {
        changed = true;
        return { ...item, view: { ...item.view, status: 'queued', failure: null }, clock: null };
      }
      if (status !== 'sending') return item;
      changed = true;
      return { ...item, view: { ...item.view, status: 'failed', failure: this.options.uncertainText() }, clock: null };
    });
    this.clearTimers();
    if (changed) this.emit();
  }

  private setCapable(capable: boolean): void {
    this.capable = capable;
    if (capable) return;
    // An old server would store a repeated send twice, so items already sent once wait for the member,
    // and items still waiting drop the quote and mentions it cannot take, as their bubbles must show.
    // 旧服务端会把重复的发送存成两条，因此已发出过一次的项等待成员决定；仍在等待的项去掉它不支持的引用和提醒，气泡也随之显示。
    let changed = false;
    this.items = this.items.map((item) => {
      let view = item.view;
      if (view.status === 'queued' && item.unanswered === 'deduplicated') view = { ...view, status: 'failed', failure: this.options.uncertainText() };
      if (view.status !== 'sending' && (view.replyTo || view.mentions.length > 0 || view.mentionAll)) view = { ...view, replyTo: null, mentions: [], mentionAll: false };
      if (view === item.view) return item;
      changed = true;
      return { ...item, view };
    });
    if (changed) this.emit();
  }

  /** Images whose upload failed for lack of a network go again once the socket is back. */
  /** 因没有网络而上传失败的图片在连接恢复后重新上传。 */
  private requeueUploads(): void {
    let changed = false;
    this.items = this.items.map((item) => {
      if (!item.retryUpload || item.view.status !== 'failed' || !item.view.image) return item;
      changed = true;
      return { ...item, view: { ...item.view, status: 'queued', failure: null, image: { ...item.view.image, progress: 0 } }, retryUpload: false };
    });
    if (changed) this.emit();
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    const now = Date.now();
    const running = this.clockRunning();
    this.items = this.items.map((item) => {
      const clock = item.clock;
      if (!clock) return item;
      if (!running && clock.since !== null) return { ...item, clock: { waitedMs: waited(clock, now), since: null } };
      if (running && clock.since === null) return { ...item, clock: { ...clock, since: now } };
      return item;
    });
    this.scheduleAckCheck();
  }

  private clockRunning(): boolean {
    return this.ready && this.visible;
  }

  enqueue(input: OutboxInput): string {
    const clientId = this.options.makeClientId?.() ?? newClientId();
    const image: PendingImage | null = input.image
      ? { localUrl: input.image.localUrl, width: input.image.width, height: input.image.height, progress: input.image.imageKey ? 1 : 0, imageKey: input.image.imageKey ?? null }
      : null;
    const view: PendingMessage = {
      clientId,
      text: input.text,
      replyTo: input.replyTo ?? null,
      mentions: [...new Set(input.mentions ?? [])].slice(0, MENTIONS_MAX),
      mentionAll: input.mentionAll === true,
      image,
      status: 'queued',
      failure: null,
      createdAt: new Date().toISOString(),
    };
    const thumbKey = input.image?.imageKey ? (input.image.thumbKey ?? null) : null;
    this.items = [...this.items, { view, file: input.image?.file ?? null, thumbKey, clock: null, unanswered: null, retryUpload: false }];
    this.emit();
    this.pump();
    return clientId;
  }

  /** The server confirmed the item; it leaves the queue. */
  /** 服务端已确认该项；它离开队列。 */
  ack(clientId: string): boolean {
    const item = this.find(clientId);
    if (!item) return false;
    this.remove(item);
    return true;
  }

  fail(clientId: string, failure: string): boolean {
    const item = this.find(clientId);
    if (!item) return false;
    if (this.upload?.clientId === clientId) this.abortUpload(false);
    this.replace(clientId, { status: 'failed', failure });
    this.scheduleAckCheck();
    this.pump();
    return true;
  }

  /**
   * The quoted message was withdrawn or removed, so items quoting it drop the quote. Nothing of the
   * quoted text is kept, and a later send goes out as a plain message.
   * 被引用的消息已被撤回或删除，引用它的待发项去掉引用。不保留任何被引用的内容，之后的发送作为普通消息发出。
   */
  dropQuote(targetId: number): void {
    let changed = false;
    this.items = this.items.map((item) => {
      if (item.view.replyTo?.id !== targetId) return item;
      changed = true;
      return { ...item, view: { ...item.view, replyTo: null } };
    });
    if (changed) this.emit();
  }

  /**
   * The server refused the item only because its quote is gone. It is queued again without the quote,
   * under the same clientId, which the refusal never stored.
   * 服务端拒绝该项只是因为所引用的消息已不存在。它去掉引用后以相同的 clientId 重新排队；被拒绝的那次发送并未存储该 clientId。
   */
  retryWithoutQuote(clientId: string): boolean {
    if (!this.find(clientId)) return false;
    this.replace(clientId, { status: 'queued', failure: null, replyTo: null });
    this.scheduleAckCheck();
    this.pump();
    return true;
  }

  /** Resends with the same clientId; the image is uploaded again only if it never finished. */
  /** 以相同的 clientId 重发；图片只有在从未上传完成时才会重新上传。 */
  resend(clientId: string): void {
    const item = this.find(clientId);
    if (!item || item.view.status !== 'failed') return;
    const image = item.view.image && item.view.image.imageKey === null ? { ...item.view.image, progress: 0 } : item.view.image;
    this.replace(clientId, { status: 'queued', failure: null, image });
    this.pump();
  }

  discard(clientId: string): void {
    const item = this.find(clientId);
    if (item) this.remove(item);
  }

  /** Drops everything, for sign-out. */
  /** 丢弃所有内容，用于退出登录。 */
  dispose(): void {
    this.abortUpload(false);
    for (const item of this.items) this.revoke(item);
    this.items = [];
    this.transport = null;
    this.link = null;
    this.ready = false;
    this.clearTimers();
    this.emit();
  }

  private find(clientId: string): OutboxItem | undefined {
    return this.items.find((i) => i.view.clientId === clientId);
  }

  private remove(item: OutboxItem): void {
    if (this.upload?.clientId === item.view.clientId) this.abortUpload(false);
    this.revoke(item);
    this.items = this.items.filter((i) => i !== item);
    this.emit();
    this.scheduleAckCheck();
    this.pump();
  }

  private revoke(item: OutboxItem): void {
    const url = item.view.image?.localUrl;
    if (url) (this.options.revokeUrl ?? defaultRevoke)(url);
  }

  /** Updates one item's view; its ack clock and send and upload marks reset unless the state argument carries them. */
  /** 更新一个待发项的视图；除非 state 参数中给出，否则其确认计时以及发送和上传标记都会重置。 */
  private replace(clientId: string, patch: Partial<PendingMessage>, state: ItemState = {}): void {
    this.items = this.items.map((item) =>
      item.view.clientId === clientId
        ? { ...item, view: { ...item.view, ...patch }, clock: state.clock ?? null, unanswered: state.unanswered ?? null, retryUpload: state.retryUpload ?? false }
        : item,
    );
    this.emit();
  }

  private emit(): void {
    this.snapshot = this.items.map((i) => i.view);
    this.syncUpdateHold();
    for (const listener of this.listeners) listener();
  }

  /**
   * Holds back a waiting app update while an item will still go out by itself: queued, uploading, waiting for its
   * echo, or an image whose upload failed for lack of a network and goes again once the socket is back. Items outlive
   * a detach, so a room left mid-send keeps holding until it is entered again and they go. Failed items that wait for
   * the member do not hold it back.
   * 只要还有待发项会自行发出，就推迟等待中的应用更新：排队、上传、等待回显，或者因没有网络而上传失败、连接恢复后会重新上传的图片。
   * 解除绑定后待发项仍然保留，所以发送中途离开的房间会一直占用，直到再次进入、待发项发出为止。等成员处理的失败项不推迟更新。
   */
  private syncUpdateHold(): void {
    const busy = this.items.some((i) => i.view.status !== 'failed' || i.retryUpload);
    if (busy && !this.releaseUpdate) {
      this.releaseUpdate = (this.options.holdUpdate ?? holdAppUpdate)();
    } else if (!busy && this.releaseUpdate) {
      const release = this.releaseUpdate;
      this.releaseUpdate = null;
      release();
    }
  }

  private clearTimers(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.flushTimer = null;
    this.ackTimer = null;
  }

  private abortUpload(requeue: boolean): void {
    const current = this.upload;
    if (!current) return;
    this.upload = null;
    current.controller.abort();
    if (!requeue) return;
    const item = this.find(current.clientId);
    if (item?.view.image) this.replace(current.clientId, { status: 'queued', image: { ...item.view.image, progress: 0 } });
  }

  private sendable(item: OutboxItem): boolean {
    return item.view.status === 'queued' && (!item.view.image || item.view.image.imageKey !== null);
  }

  /**
   * Starts the next upload and sends the next ready item, at most one send per spacing interval.
   * Calling it twice in a row sends nothing extra, which covers StrictMode's double effects.
   * 开始下一个上传并发送下一个就绪项，每个间隔最多发送一次。连续调用两次不会多发，可应对 StrictMode 的重复副作用。
   */
  private pump(): void {
    if (!this.transport) return;
    this.startNextUpload();
    if (!this.ready) return;
    const next = this.items.find((i) => this.sendable(i));
    if (!next) return;
    const wait = this.lastSentAt + this.spacingMs - Date.now();
    if (wait > 0) {
      this.flushTimer ??= setTimeout(() => {
        this.flushTimer = null;
        this.pump();
      }, wait);
      return;
    }
    if (!this.transport.send(buildSendFrame(next.view, this.capable, next.thumbKey))) return;
    const now = Date.now();
    this.lastSentAt = now;
    this.replace(
      next.view.clientId,
      { status: 'sending' },
      { clock: { waitedMs: 0, since: this.clockRunning() ? now : null }, unanswered: this.capable ? 'deduplicated' : 'legacy' },
    );
    this.scheduleAckCheck();
    this.pump();
  }

  private startNextUpload(): void {
    if (this.upload || !this.transport) return;
    // An open socket shows the network works whatever the browser reports.
    // 连接已打开说明网络可用，无论浏览器报告什么。
    if (!this.ready && this.transport.online?.() === false) return;
    const item = this.items.find((i) => i.view.status === 'queued' && i.view.image !== null && i.view.image.imageKey === null && i.file !== null);
    if (!item || !item.file || !item.view.image) return;
    const clientId = item.view.clientId;
    const controller = new AbortController();
    this.upload = { clientId, controller };
    this.replace(clientId, { status: 'uploading', image: { ...item.view.image, progress: 0 } });
    const owns = () => this.upload?.controller === controller;
    let shownPercent = 0;
    this.transport
      .upload(item.file, {
        signal: controller.signal,
        size: { width: item.view.image.width, height: item.view.image.height },
        onProgress: (fraction) => {
          if (!owns()) return;
          const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
          if (percent === shownPercent) return;
          shownPercent = percent;
          this.patchImage(clientId, { progress: percent / 100 });
        },
      })
      .then(
        (result) => {
          if (!owns()) return;
          this.upload = null;
          const uploaded: UploadedImage = typeof result === 'string' ? { imageKey: result } : result;
          const patch: Partial<PendingImage> = { progress: 1, imageKey: uploaded.imageKey };
          // The frame must carry the stored image's size, which differs from the picked one after a re-encode.
          // 发送帧必须带上存储图片的尺寸；重新编码后它与所选图片的尺寸不同。
          if (uploaded.width !== undefined && uploaded.height !== undefined && validDimension(uploaded.width) && validDimension(uploaded.height)) {
            patch.width = uploaded.width;
            patch.height = uploaded.height;
          }
          this.items = this.items.map((i) => (i.view.clientId === clientId ? { ...i, thumbKey: uploaded.thumbKey ?? null } : i));
          this.patchImage(clientId, patch, { status: 'queued' });
          this.pump();
        },
        (error: unknown) => {
          if (!owns()) return;
          this.upload = null;
          const retryUpload = (this.options.retryableUpload ?? isNetworkError)(error);
          this.replace(clientId, { status: 'failed', failure: this.options.uploadFailureText(error) }, { retryUpload });
          this.pump();
        },
      );
  }

  private patchImage(clientId: string, patch: Partial<PendingImage>, extra: Partial<PendingMessage> = {}): void {
    const item = this.find(clientId);
    if (!item?.view.image) return;
    this.replace(clientId, { ...extra, image: { ...item.view.image, ...patch } }, { clock: item.clock, unanswered: item.unanswered, retryUpload: item.retryUpload });
  }

  /**
   * The ack timer runs only while the clock runs: leaving ready ends every wait, either back in the queue
   * or failed, and a hidden page pauses every clock.
   * 确认计时只在计时运行时进行：离开就绪状态会结束所有等待（放回队列或标为失败），页面隐藏会暂停所有计时。
   */
  private scheduleAckCheck(): void {
    if (this.ackTimer) clearTimeout(this.ackTimer);
    this.ackTimer = null;
    if (!this.clockRunning()) return;
    const now = Date.now();
    const remaining = this.items.flatMap((i) => (i.view.status === 'sending' && i.clock && i.clock.since !== null ? [this.ackTimeoutMs - waited(i.clock, now)] : []));
    if (remaining.length === 0) return;
    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.expire();
    }, Math.max(0, Math.min(...remaining)));
  }

  private expire(): void {
    if (!this.clockRunning()) return;
    const now = Date.now();
    let changed = false;
    this.items = this.items.map((item) => {
      if (item.view.status !== 'sending' || !item.clock || waited(item.clock, now) < this.ackTimeoutMs) return item;
      changed = true;
      return { ...item, view: { ...item.view, status: 'failed', failure: this.options.timeoutText() }, clock: null };
    });
    if (changed) this.emit();
    this.scheduleAckCheck();
  }
}
