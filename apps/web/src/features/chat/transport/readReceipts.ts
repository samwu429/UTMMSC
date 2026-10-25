/**
 * At most one read frame per this interval. A busy channel then costs the room one read write per second per viewer
 * instead of one per message; the newest id waiting is sent when the page hides or the room closes.
 * 每个间隔内最多发送一个 read 帧。繁忙的频道因此每位查看者每秒只写一次已读，而不是每条消息一次；等待中的最新 id 在页面隐藏或离开房间时发出。
 */
export const READ_FLUSH_MS = 1000;

/**
 * The read receipts of one room connection: remembers the newest id read and tells the server at most once per
 * interval, never an id it already has.
 * 一个房间连接的已读回执：记下读到的最新 id，每个间隔最多告诉服务端一次，且从不重复告诉它已有的 id。
 */
export class ReadReceipts {
  private sentId = 0;
  private wantedId = 0;
  private sentAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * `send` returns false when the socket is not open, and the id then waits for the next mark or flush.
   * `send` 在连接未打开时返回 false，该 id 随后等待下一次 mark 或 flush。
   */
  constructor(
    private readonly send: (id: number) => boolean,
    private readonly intervalMs: number = READ_FLUSH_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** The newest id the server is known to have. */
  /** 已知服务端拥有的最新 id。 */
  get sent(): number {
    return this.sentId;
  }

  /**
   * A new socket's ready frame says what the server has, so a read lost with the old socket goes again, and a read
   * made on another device is not repeated.
   * 新连接的 ready 帧说明服务端已有的记录：随旧连接丢失的已读会再发一次，在其他设备上做的已读则不会重复发送。
   */
  reset(serverLastReadId: number): void {
    this.sentId = serverLastReadId;
  }

  mark(id: number): void {
    if (id <= this.sentId) return;
    if (id > this.wantedId) this.wantedId = id;
    const wait = this.sentAt + this.intervalMs - this.now();
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.timer ??= setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
  }

  /** Sends the newest id waiting, if any. Returns the id sent, or null. */
  /** 发出等待中的最新 id（如果有）。返回发出的 id，没有发出时为 null。 */
  flush(): number | null {
    this.cancelTimer();
    const id = this.wantedId;
    if (id <= this.sentId || !this.send(id)) return null;
    this.sentId = id;
    this.sentAt = this.now();
    return id;
  }

  /** Stops the timer; what is waiting stays for a later flush. */
  /** 停止计时器；等待中的 id 保留，供之后发送。 */
  cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
