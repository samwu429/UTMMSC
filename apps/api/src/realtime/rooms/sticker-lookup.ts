import type { StickerRef } from '@utmmsc/shared';

/** What a room stores for a sticker before it adds the sender's still: the file's description as D1 has it. */
/** 房间加上发送者的静态图之前为表情保存的内容：D1 中该文件的描述。 */
export type StickerDescription = Omit<StickerRef, 'thumb'>;

/**
 * The answer of a load: the description; null when the id is unknown, still uploading, being swept or blocked; or
 * 'unavailable' when D1 failed or did not answer in time.
 * 一次读取的结果：文件描述；id 不存在、仍在上传、正被清理或已被封禁时为 null；D1 出错或没有及时回应时为 'unavailable'。
 */
export type StickerLookupResult = StickerDescription | null | 'unavailable';

/**
 * How long a room trusts a description it read. A block reaches every room within this time, since an expired entry
 * is read again and a blocked file reads as null.
 * 房间信任已读取描述的时长。封禁在这段时间内传到每个房间：过期的条目会重新读取，而被封禁的文件读出来是 null。
 */
export const STICKER_LOOKUP_TTL_MS = 10 * 60 * 1000;

/** Descriptions kept per room; the least recently used go first. */
/** 每个房间保留的描述数；最久未使用的先被移除。 */
export const STICKER_LOOKUP_MAX = 256;

/** A load gives up after this long, so a hung D1 call cannot hold a member's sends for long. */
/** 读取超过这个时长即放弃，D1 调用卡住时也不会让成员的发送等待太久。 */
export const STICKER_LOOKUP_TIMEOUT_MS = 5_000;

export interface StickerLookupOptions {
  ttlMs?: number;
  max?: number;
  timeoutMs?: number;
  now?: () => number;
}

interface Entry {
  sticker: StickerDescription;
  at: number;
}

/**
 * Sticker descriptions a room has read from D1, kept in the Durable Object's memory. A fresh hit is answered
 * synchronously, so a sticker sent again costs no D1 round trip and keeps its place among the member's frames
 * without waiting. Only found descriptions are kept: an unknown or blocked id is asked again every time. Concurrent
 * loads of one id share one D1 call. The memory goes when the object hibernates, which only means one more read.
 * 房间从 D1 读取过的表情描述，保存在 Durable Object 的内存中。未过期的命中同步返回，再次发送同一表情不需要 D1 往返，
 * 也无需等待就能保持它在该成员各帧中的顺序。只保留找到的描述：不存在或已封禁的 id 每次都重新查询。同一 id 的并发读取共用一次 D1 调用。
 * 对象休眠后内存清空，只是之后多读一次而已。
 */
export class StickerLookup {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<StickerLookupResult>>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly loader: (id: string) => Promise<StickerDescription | null>,
    options: StickerLookupOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? STICKER_LOOKUP_TTL_MS;
    this.max = options.max ?? STICKER_LOOKUP_MAX;
    this.timeoutMs = options.timeoutMs ?? STICKER_LOOKUP_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** A fresh description held in memory, or undefined when it has to be loaded. Never reads D1. */
  /** 内存中未过期的描述；需要读取时为 undefined。从不读取 D1。 */
  peek(id: string): StickerDescription | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.at >= this.ttlMs) {
      this.entries.delete(id);
      return undefined;
    }
    // Move to the end of the insertion order, so the least recently used are evicted first.
    // 移到插入顺序的末尾，使最久未使用的先被移除。
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry.sticker;
  }

  /**
   * The description from memory, or from D1. Never throws: a D1 error, or no answer within the timeout, gives
   * 'unavailable'. A late answer that found the file is still kept for the next send.
   * 从内存或 D1 取得描述。从不抛出异常：D1 出错或在超时之前没有回应时返回 'unavailable'。超时之后才到达且找到了文件的回应仍会保留，供下次发送使用。
   */
  load(id: string): Promise<StickerLookupResult> {
    const hit = this.peek(id);
    if (hit) return Promise.resolve(hit);
    const pending = this.loading.get(id);
    if (pending) return pending;
    const started = this.start(id);
    this.loading.set(id, started);
    void started.then(() => {
      if (this.loading.get(id) === started) this.loading.delete(id);
    });
    return started;
  }

  get size(): number {
    return this.entries.size;
  }

  private start(id: string): Promise<StickerLookupResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve('unavailable'), this.timeoutMs);
      let call: Promise<StickerDescription | null>;
      try {
        call = this.loader(id);
      } catch (err) {
        call = Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
      call.then(
        (sticker) => {
          clearTimeout(timer);
          if (sticker) this.store(id, sticker);
          resolve(sticker);
        },
        () => {
          clearTimeout(timer);
          resolve('unavailable');
        },
      );
    });
  }

  private store(id: string, sticker: StickerDescription): void {
    this.entries.delete(id);
    this.entries.set(id, { sticker, at: this.now() });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
