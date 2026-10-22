import { REQUEST_ID_MAX, type HistoryFrame } from '@utmmsc/shared';

/** A history request with no answer after this long is treated as lost. */
/** 超过这么久仍无回复的历史请求视为丢失。 */
export const HISTORY_TIMEOUT_MS = 10_000;
/** After this many newer pages the client stops catching up and reloads the latest page. */
/** 补齐超过这么多页后，客户端停止补齐并重新加载最新一页。 */
export const CATCH_UP_PAGES_MAX = 8;

/**
 * initial: first page of an empty list. catch_up: newer pages after a reconnect. reset: the latest
 * page replacing the list. older: one page back. until: paging back to reach a given message.
 * initial：空列表的第一页。catch_up：重连后的更新页。reset：用最新一页替换列表。older：向前一页。until：向前翻页直到某条消息。
 */
export type HistoryPurpose = 'initial' | 'catch_up' | 'reset' | 'older' | 'until';

export type HistoryFields = Omit<HistoryFrame, 'type' | 'requestId'>;

export interface HistoryRequest {
  requestId: string;
  purpose: HistoryPurpose;
  /** What was asked, without the requestId, so a retry can ask again. */
  /** 请求的内容（不含 requestId），供重试时再次请求。 */
  fields: HistoryFields;
  frame: HistoryFrame;
  /** Catch-up page number, starting at 1. */
  /** 补齐页序号，从 1 开始。 */
  page: number;
}

export interface HistoryRequestsOptions {
  onTimeout(request: HistoryRequest): void;
  timeoutMs?: number;
  makeRequestId?(): string;
}

let sequence = 0;

function defaultRequestId(): string {
  sequence = (sequence + 1) % 1_000_000;
  const id = `h${Date.now().toString(36)}${sequence.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, REQUEST_ID_MAX);
}

/**
 * In-flight history requests keyed by requestId, each with a timeout, plus the older-page lock.
 * The lock has one holder at a time; only that holder's result or timeout releases it, so a stale
 * result still merges its rows but never unlocks paging for a newer request.
 * 以 requestId 为键的进行中历史请求，每个都有超时；另有翻页锁。锁同一时间只有一个持有者，只有它的结果或超时才能释放，
 * 因此过期的结果仍会合并消息，但不会替较新的请求解锁翻页。
 */
export class HistoryRequests {
  private readonly inFlight = new Map<string, { request: HistoryRequest; timer: ReturnType<typeof setTimeout> }>();
  private lockHolder: string | null = null;

  constructor(private readonly options: HistoryRequestsOptions) {}

  get locked(): boolean {
    return this.lockHolder !== null;
  }

  /** Takes the lock for a holder that is not a request, such as the sync after a socket opens. */
  /** 为非请求的持有者加锁，例如连接打开后的同步过程。 */
  acquire(holder: string): boolean {
    if (this.lockHolder !== null && this.lockHolder !== holder) return false;
    this.lockHolder = holder;
    return true;
  }

  release(holder: string): void {
    if (this.lockHolder === holder) this.lockHolder = null;
  }

  isPending(purpose: HistoryPurpose): boolean {
    for (const { request } of this.inFlight.values()) if (request.purpose === purpose) return true;
    return false;
  }

  /** Registers a request. With `lock`, it holds the older-page lock until it settles or times out. */
  /** 登记一个请求。带 `lock` 时，它持有翻页锁直到得到结果或超时。 */
  start(purpose: HistoryPurpose, fields: HistoryFields, options: { page?: number; lock?: boolean } = {}): HistoryRequest {
    const requestId = this.options.makeRequestId?.() ?? defaultRequestId();
    const request: HistoryRequest = { requestId, purpose, fields, frame: { type: 'history', ...fields, requestId }, page: options.page ?? 1 };
    if (options.lock) this.lockHolder = requestId;
    const timer = setTimeout(() => {
      if (!this.inFlight.delete(requestId)) return;
      this.release(requestId);
      this.options.onTimeout(request);
    }, this.options.timeoutMs ?? HISTORY_TIMEOUT_MS);
    this.inFlight.set(requestId, { request, timer });
    return request;
  }

  /** Settles a result or error. Returns the request while it is still in flight, or null for a stale id. */
  /** 处理一个结果或错误。请求仍在进行中时返回它；过期的 id 返回 null。 */
  settle(requestId: string | undefined): HistoryRequest | null {
    if (!requestId) return null;
    const entry = this.inFlight.get(requestId);
    if (!entry) return null;
    clearTimeout(entry.timer);
    this.inFlight.delete(requestId);
    this.release(requestId);
    return entry.request;
  }

  /** Drops every request and the lock, for a closed socket. Returns what was dropped. */
  /** 丢弃所有请求和锁，用于连接关闭时。返回被丢弃的请求。 */
  cancelAll(): HistoryRequest[] {
    const dropped = [...this.inFlight.values()].map(({ request, timer }) => {
      clearTimeout(timer);
      return request;
    });
    this.inFlight.clear();
    this.lockHolder = null;
    return dropped;
  }
}

export type SyncPlan = { kind: 'legacy' } | { kind: 'catch_up'; fields: HistoryFields } | { kind: 'latest'; purpose: 'initial' | 'reset'; fields: HistoryFields };

export interface SyncInput {
  /** ready.rev; undefined from an old server. */
  /** ready.rev；旧服务端不提供。 */
  serverRev: number | undefined;
  newestId: number | null;
  oldestId: number | null;
  lastRev: number;
  revTrusted: boolean;
  limit: number;
}

/**
 * Decides how a ready socket syncs the list. A catch-up asks only for changes after lastRev, so it runs
 * only when that revision is trusted and the server has not gone back past it; otherwise loaded rows are
 * replaced by the latest page, which drops anything withdrawn or removed meanwhile.
 * 决定连接就绪后如何同步列表。补齐只请求 lastRev 之后的变更，因此只有该版本号可信、且服务端版本号没有退回到它之前时才补齐；
 * 否则用最新一页替换已加载的消息，期间被撤回或删除的内容随之去掉。
 */
export function planSync(input: SyncInput): SyncPlan {
  if (input.serverRev === undefined) return { kind: 'legacy' };
  if (input.newestId === null || input.oldestId === null) return { kind: 'latest', purpose: 'initial', fields: { limit: input.limit } };
  if (!input.revTrusted || input.serverRev < input.lastRev) return { kind: 'latest', purpose: 'reset', fields: { limit: input.limit } };
  return { kind: 'catch_up', fields: { afterId: input.newestId, oldestId: input.oldestId, sinceRev: input.lastRev, limit: input.limit } };
}

export type CatchUpStep = { kind: 'done' } | { kind: 'next'; afterId: number; page: number } | { kind: 'reset' };

/**
 * Decides what follows one catch-up page. Too many changes, or more than the page budget, mean the
 * gap is too large to patch, so the list is reset to the latest page.
 * 决定一页补齐之后的动作。变更过多或超过页数上限，说明缺口太大无法修补，列表重置为最新一页。
 */
export function planCatchUp(input: { page: number; hasNewer: boolean; changedOverflow: boolean; cursor: number }): CatchUpStep {
  if (input.changedOverflow) return { kind: 'reset' };
  if (!input.hasNewer) return { kind: 'done' };
  if (input.page >= CATCH_UP_PAGES_MAX) return { kind: 'reset' };
  return { kind: 'next', afterId: input.cursor, page: input.page + 1 };
}
