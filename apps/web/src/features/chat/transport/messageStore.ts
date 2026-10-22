import {
  normalizeChatMessage,
  redactChatMessage,
  redactQuotePreview,
  type ChatAuthor,
  type ChatMessage,
  type DeletedBy,
  type FloorReason,
  type HistoryDirection,
  type NormalizedChatMessage,
  type QuotePreview,
} from '@utmmsc/shared';
import type { QuoteTargetState } from '../room/types';

/**
 * Pure message list for one room. Every function returns a new state, or the same state when
 * nothing changed, so React can skip work by identity.
 * 单个房间的纯消息列表。每个函数返回新状态；没有变化时返回原状态，React 可按引用跳过渲染。
 */

/**
 * Sticky record of a withdrawn or removed row. It outlives the row itself, so a history page or
 * echo that arrives late can never bring the body back.
 * 已撤回或已删除消息的持久记录。它比消息本身存在得更久，迟到的历史页或回显因此无法恢复正文。
 */
interface Tombstone {
  recalled: boolean;
  deleted: boolean;
  deletedBy: DeletedBy | null;
}

export interface MessageStoreState {
  messages: NormalizedChatMessage[];
  hasMore: boolean;
  reachedFloor: boolean;
  floorReason: FloorReason | null;
  visibleFromId: number;
  /** Highest room revision this list is known to be current with; the next catch-up asks for changes after it. */
  /** 列表已确认同步到的最高房间版本号；下次补齐请求此后的变更。 */
  lastRev: number;
  /**
   * True only while lastRev comes from a capable server's history and nothing has reached the list from an
   * old one since. An old server changes rows without a revision, so after it a catch-up could miss them.
   * 仅当 lastRev 来自支持新协议的服务端的历史结果、且此后没有来自旧服务端的内容进入列表时为 true。旧服务端修改消息时不更新版本号，此后的补齐可能漏掉这些修改。
   */
  revTrusted: boolean;
  tombstones: ReadonlyMap<number, Tombstone>;
  /** Rows this member hid for themselves. */
  /** 成员为自己隐藏的消息。 */
  hiddenIds: ReadonlySet<number>;
}

export interface HistoryPage {
  messages: readonly ChatMessage[];
  hasMore?: boolean;
  reachedFloor?: boolean;
  floorReason?: FloorReason | null;
  rev?: number;
  /** The beforeId the page was requested with, when known. */
  /** 请求此页时使用的 beforeId（已知时）。 */
  beforeId?: number;
}

export function createMessageStore(seed: Partial<Omit<MessageStoreState, 'tombstones' | 'hiddenIds'>> = {}): MessageStoreState {
  const empty: MessageStoreState = {
    messages: [],
    hasMore: seed.hasMore ?? false,
    reachedFloor: seed.reachedFloor ?? false,
    floorReason: seed.floorReason ?? null,
    visibleFromId: seed.visibleFromId ?? 0,
    lastRev: seed.lastRev ?? 0,
    revTrusted: seed.revTrusted ?? false,
    tombstones: new Map(),
    hiddenIds: new Set(),
  };
  return seed.messages ? upsertRows(empty, seed.messages) : empty;
}

export function oldestId(state: MessageStoreState): number | null {
  return state.messages[0]?.id ?? null;
}

export function newestId(state: MessageStoreState): number | null {
  return state.messages[state.messages.length - 1]?.id ?? null;
}

export function findMessage(state: MessageStoreState, id: number): NormalizedChatMessage | undefined {
  return state.messages.find((m) => m.id === id);
}

function quoteStateFor(tombstone: Tombstone): 'recalled' | 'deleted' {
  return tombstone.recalled ? 'recalled' : 'deleted';
}

/** Normalizes, applies sticky redactions to the row and its quote, then redacts. */
/** 规范化，套用该消息及其引用的持久清理记录，然后清理正文。 */
function ingest(tombstones: ReadonlyMap<number, Tombstone>, raw: ChatMessage): NormalizedChatMessage {
  let message = normalizeChatMessage(raw);
  const own = tombstones.get(message.id);
  if (own) {
    message = {
      ...message,
      recalled: message.recalled || own.recalled,
      deleted: message.deleted || own.deleted,
      deletedBy: message.deletedBy ?? own.deletedBy,
    };
  }
  if (message.replyTo) {
    const target = tombstones.get(message.replyTo.id);
    if (target) message = { ...message, replyTo: redactQuotePreview(message.replyTo, quoteStateFor(target)) };
  }
  return redactChatMessage(message);
}

function sameQuote(a: QuotePreview | null, b: QuotePreview | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.state === b.state && a.excerpt === b.excerpt && a.hasImage === b.hasImage && a.authorName === b.authorName && a.authorId === b.authorId;
}

function sameRow(a: NormalizedChatMessage, b: NormalizedChatMessage): boolean {
  return (
    a.id === b.id &&
    a.rev === b.rev &&
    a.text === b.text &&
    a.imageKey === b.imageKey &&
    a.deleted === b.deleted &&
    a.recalled === b.recalled &&
    a.deletedBy === b.deletedBy &&
    a.kind === b.kind &&
    a.createdAt === b.createdAt &&
    a.clientId === b.clientId &&
    a.imageWidth === b.imageWidth &&
    a.imageHeight === b.imageHeight &&
    a.author.id === b.author.id &&
    a.author.displayName === b.author.displayName &&
    (a.author.avatarKey ?? null) === (b.author.avatarKey ?? null) &&
    sameQuote(a.replyTo, b.replyTo) &&
    (a.kind !== 'system' || JSON.stringify(a.system) === JSON.stringify(b.system))
  );
}

function withTombstone(tombstones: ReadonlyMap<number, Tombstone>, id: number, patch: Partial<Tombstone>): ReadonlyMap<number, Tombstone> {
  const prev = tombstones.get(id);
  const next: Tombstone = {
    recalled: (prev?.recalled ?? false) || patch.recalled === true,
    deleted: (prev?.deleted ?? false) || patch.deleted === true,
    deletedBy: prev?.deletedBy ?? patch.deletedBy ?? null,
  };
  if (prev && prev.recalled === next.recalled && prev.deleted === next.deleted && prev.deletedBy === next.deletedBy) return tombstones;
  const copy = new Map(tombstones);
  copy.set(id, next);
  return copy;
}

/** Records tombstones for rows that arrive already withdrawn or removed. */
/** 为到达时已撤回或已删除的消息记下持久清理记录。 */
function rememberRedacted(tombstones: ReadonlyMap<number, Tombstone>, rows: readonly ChatMessage[]): ReadonlyMap<number, Tombstone> {
  let next = tombstones;
  for (const row of rows) {
    if (row.recalled === true || row.deleted === true) {
      next = withTombstone(next, row.id, { recalled: row.recalled === true, deleted: row.deleted === true, deletedBy: row.deletedBy ?? null });
    }
  }
  return next;
}

/**
 * Inserts or updates rows by id, skipping hidden rows and rows below the floor. A row that arrives
 * withdrawn or removed, for example on an older page, also redacts the quotes of replies already loaded.
 * 按 id 插入或更新消息，跳过已隐藏的和低于下限的消息。到达时已撤回或已删除的消息（例如在更早的一页中）也会清理已加载回复中对它的引用。
 */
function upsertRows(state: MessageStoreState, rows: readonly ChatMessage[]): MessageStoreState {
  if (rows.length === 0) return state;
  const tombstones = rememberRedacted(state.tombstones, rows);
  const byId = new Map(state.messages.map((m) => [m.id, m]));
  let changed = false;
  for (const row of rows) {
    if (state.hiddenIds.has(row.id) || row.id < state.visibleFromId) continue;
    const next = ingest(tombstones, row);
    const existing = byId.get(next.id);
    if (existing && sameRow(existing, next)) continue;
    byId.set(next.id, next);
    changed = true;
  }
  const sorted = changed ? [...byId.values()].sort((a, b) => a.id - b.id) : state.messages;
  const targets = new Map<number, 'recalled' | 'deleted'>();
  for (const row of rows) {
    const tombstone = tombstones.get(row.id);
    if (tombstone) targets.set(row.id, quoteStateFor(tombstone));
  }
  const messages = patchQuotes(sorted, targets);
  if (messages === state.messages) return tombstones === state.tombstones ? state : { ...state, tombstones };
  return { ...state, messages, tombstones };
}

/** Patches the quotes of loaded replies whose target was withdrawn or removed. */
/** 被引用消息被撤回或删除时，更新已加载回复中的引用。 */
function patchQuotes(messages: NormalizedChatMessage[], targets: ReadonlyMap<number, 'recalled' | 'deleted'>): NormalizedChatMessage[] {
  if (targets.size === 0) return messages;
  let changed = false;
  const next = messages.map((m) => {
    const state = m.replyTo ? targets.get(m.replyTo.id) : undefined;
    if (!m.replyTo || !state) return m;
    // A recall is the stronger notice; a later delete of the same row does not overwrite it.
    // 撤回是更明确的提示；之后对同一消息的删除不会覆盖它。
    const target = m.replyTo.state === 'recalled' ? 'recalled' : state;
    const replyTo = redactQuotePreview(m.replyTo, target);
    if (replyTo === m.replyTo) return m;
    changed = true;
    return { ...m, replyTo };
  });
  return changed ? next : messages;
}

function redactLoaded(state: MessageStoreState, id: number, patch: Partial<Tombstone>, quoteState: 'recalled' | 'deleted'): MessageStoreState {
  const tombstones = withTombstone(state.tombstones, id, patch);
  let messages = state.messages.map((m) => {
    if (m.id !== id) return m;
    const next = redactChatMessage({
      ...m,
      recalled: m.recalled || patch.recalled === true,
      deleted: m.deleted || patch.deleted === true,
      deletedBy: m.deletedBy ?? patch.deletedBy ?? null,
    });
    return sameRow(m, next) ? m : next;
  });
  messages = patchQuotes(messages, new Map([[id, quoteState]]));
  const unchanged = messages.every((m, i) => m === state.messages[i]);
  if (unchanged && tombstones === state.tombstones) return state;
  return { ...state, messages: unchanged ? state.messages : messages, tombstones };
}

/**
 * Merges one history page.
 * - latest: replaces the list, keeping only rows newer than the page that arrived live meanwhile.
 * - older: prepends; the paging flags apply only when the page reaches below the current oldest row.
 *   A page asked for below a row that is no longer the oldest (the list was trimmed meanwhile) would
 *   leave a silent gap, so only its withdrawn and removed rows are remembered.
 * - newer: appends; the flags apply only when the caller passes them.
 * 合并一页历史。
 * - latest：替换列表，只保留在此期间实时到达、比该页更新的消息。
 * - older：向前插入；只有该页到达当前最早消息之下时才更新分页标记。若请求该页时的起点已不再是最早的消息（期间列表被裁剪），
 *   合并会留下看不见的缺口，因此只记住其中已撤回和已删除的消息。
 * - newer：向后追加；只有调用方传入时才更新分页标记。
 */
export function mergePage(state: MessageStoreState, page: HistoryPage, direction: HistoryDirection): MessageStoreState {
  const pageOldest = page.messages.reduce((min, m) => Math.min(min, m.id), Number.POSITIVE_INFINITY);
  const pageNewest = page.messages.reduce((max, m) => Math.max(max, m.id), 0);
  const currentOldest = oldestId(state);
  let next: MessageStoreState;
  let applyFlags: boolean;

  if (direction === 'older' && page.beforeId !== undefined && currentOldest !== null && page.beforeId < currentOldest) {
    return rememberOnly(state, page.messages);
  }

  if (direction === 'latest') {
    const keep =
      page.messages.length > 0
        ? state.messages.filter((m) => m.id > pageNewest)
        : state.messages.filter((m) => page.rev !== undefined && m.rev > page.rev);
    next = upsertRows({ ...state, messages: keep }, page.messages);
    applyFlags = true;
  } else if (direction === 'older') {
    next = upsertRows(state, page.messages);
    if (page.messages.length > 0) applyFlags = currentOldest === null || pageOldest <= currentOldest;
    else applyFlags = page.beforeId !== undefined && (currentOldest === null || page.beforeId <= currentOldest);
  } else {
    next = upsertRows(state, page.messages);
    applyFlags = page.hasMore !== undefined;
  }

  if (applyFlags) {
    const hasMore = page.hasMore ?? false;
    const reachedFloor = page.reachedFloor ?? false;
    const floorReason = page.floorReason !== undefined ? page.floorReason : next.floorReason;
    if (hasMore !== next.hasMore || reachedFloor !== next.reachedFloor || floorReason !== next.floorReason) {
      next = { ...next, hasMore, reachedFloor, floorReason };
    }
  }
  if (direction === 'latest') {
    // The page replaces the list as of its revision. A page without one comes from an old server, after
    // which no revision can be relied on.
    // 该页以其版本号为准替换列表。不带版本号的页来自旧服务端，此后任何版本号都不可靠。
    return page.rev !== undefined ? withRev(next, page.rev, true) : distrustRev(next);
  }
  return page.rev !== undefined ? advanceRev(next, page.rev) : next;
}

function withRev(state: MessageStoreState, lastRev: number, revTrusted: boolean): MessageStoreState {
  if (state.lastRev === lastRev && state.revTrusted === revTrusted) return state;
  return { ...state, lastRev, revTrusted };
}

/** The list has been in touch with an old server, so a catch-up from lastRev could miss its changes. */
/** 列表与旧服务端有过往来，从 lastRev 开始的补齐可能漏掉其所做的修改。 */
export function distrustRev(state: MessageStoreState): MessageStoreState {
  return state.revTrusted ? { ...state, revTrusted: false } : state;
}

/** Keeps the sticky redactions a set of rows carries without adding any of the rows. */
/** 只保留一组消息所带的持久清理记录，不加入其中任何消息。 */
function rememberOnly(state: MessageStoreState, rows: readonly ChatMessage[]): MessageStoreState {
  const redacted = rows.filter((row) => row.recalled === true || row.deleted === true);
  if (redacted.length === 0) return state;
  const tombstones = rememberRedacted(state.tombstones, redacted);
  const targets = new Map<number, 'recalled' | 'deleted'>();
  for (const row of redacted) {
    const tombstone = tombstones.get(row.id);
    if (tombstone) targets.set(row.id, quoteStateFor(tombstone));
  }
  const messages = patchQuotes(state.messages, targets);
  if (messages === state.messages && tombstones === state.tombstones) return state;
  return { ...state, messages, tombstones };
}

/**
 * Merges a result whose request is no longer tracked, for example one that arrived after its timeout.
 * Only rows inside the loaded range are updated, because a row outside it could sit past a gap; rows
 * it carries withdrawn or removed are still remembered.
 * 合并对应请求已不再跟踪的结果，例如超时之后才到达的结果。只更新已加载范围内的消息，因为范围之外的消息可能隔着缺口；
 * 其中已撤回或已删除的消息仍会被记住。
 */
export function mergeStale(state: MessageStoreState, rows: readonly ChatMessage[]): MessageStoreState {
  const oldest = oldestId(state);
  const newest = newestId(state);
  const inside = oldest === null || newest === null ? [] : rows.filter((row) => row.id >= oldest && row.id <= newest);
  return upsertRows(rememberOnly(state, rows), inside);
}

/** Sticky redactions win over the loaded row, so a late page cannot make a withdrawn quote usable again. */
/** 持久清理记录优先于已加载的消息，迟到的页面因此无法让已撤回的引用重新可用。 */
export function quoteTargetState(state: MessageStoreState, id: number): QuoteTargetState {
  const tombstone = state.tombstones.get(id);
  if (tombstone) return quoteStateFor(tombstone);
  if (state.hiddenIds.has(id)) return 'hidden';
  if (id < state.visibleFromId) return 'unavailable';
  const row = findMessage(state, id);
  if (!row) return 'unknown';
  if (row.recalled) return 'recalled';
  if (row.deleted) return 'deleted';
  return row.kind === 'system' ? 'unavailable' : 'ok';
}

/** Raises lastRev. Callers pass a revision only once the list is known to be current with it. */
/** 提高 lastRev。只有确认列表已同步到该版本时调用方才会传入。 */
export function advanceRev(state: MessageStoreState, rev: number | undefined): MessageStoreState {
  if (typeof rev !== 'number' || !Number.isFinite(rev) || rev <= state.lastRev) return state;
  return { ...state, lastRev: rev };
}

/** A live row or an echo. A duplicate echo leaves the state untouched. */
/** 实时消息或回显。重复的回显不改变状态。 */
export function applyMessage(state: MessageStoreState, message: ChatMessage): MessageStoreState {
  return upsertRows(state, [message]);
}

export function applyDeleted(state: MessageStoreState, messageId: number, by?: DeletedBy): MessageStoreState {
  return redactLoaded(state, messageId, { deleted: true, deletedBy: by ?? null }, 'deleted');
}

export function applyRecalled(state: MessageStoreState, messageId: number): MessageStoreState {
  return redactLoaded(state, messageId, { recalled: true }, 'recalled');
}

export function applyHidden(state: MessageStoreState, messageId: number): MessageStoreState {
  const loaded = state.messages.some((m) => m.id === messageId);
  if (state.hiddenIds.has(messageId) && !loaded) return state;
  const hiddenIds = new Set(state.hiddenIds);
  hiddenIds.add(messageId);
  return { ...state, hiddenIds, messages: loaded ? state.messages.filter((m) => m.id !== messageId) : state.messages };
}

/** Undoes an optimistic hide that the server refused. */
/** 撤销被服务端拒绝的乐观隐藏。 */
export function restoreHidden(state: MessageStoreState, message: ChatMessage): MessageStoreState {
  if (!state.hiddenIds.has(message.id)) return state;
  const hiddenIds = new Set(state.hiddenIds);
  hiddenIds.delete(message.id);
  return upsertRows({ ...state, hiddenIds }, [message]);
}

/** The member cleared the room: rows below beforeId are gone for them. */
/** 成员清空了聊天记录：beforeId 以下的消息对其不再可见。 */
export function applyCleared(state: MessageStoreState, beforeId: number): MessageStoreState {
  if (beforeId <= state.visibleFromId && state.floorReason === 'clear') return state;
  const floor = Math.max(state.visibleFromId, beforeId);
  return {
    ...state,
    messages: state.messages.filter((m) => m.id >= floor),
    visibleFromId: floor,
    floorReason: 'clear',
    hasMore: false,
    reachedFloor: floor > 1,
  };
}

/**
 * Applies catch-up changes: rows edited, withdrawn or removed while offline, and rows hidden on
 * another device. Quotes whose target changed are patched too.
 * 应用补齐的变更：离线期间被修改、撤回或删除的消息，以及在其他设备上隐藏的消息。被引用消息变化时同时更新引用。
 */
export function applyChanged(state: MessageStoreState, changed: readonly ChatMessage[], hiddenIds: readonly number[] = []): MessageStoreState {
  let next = upsertRows(state, changed);
  for (const row of changed) {
    if (row.recalled === true) next = redactLoaded(next, row.id, { recalled: true }, 'recalled');
    else if (row.deleted === true) next = redactLoaded(next, row.id, { deleted: true, deletedBy: row.deletedBy ?? null }, 'deleted');
  }
  for (const id of hiddenIds) next = applyHidden(next, id);
  return next;
}

/** Applies a raised history floor, dropping every row below it. */
/** 应用提高后的历史下限，丢弃其下的所有消息。 */
export function dropBelowFloor(state: MessageStoreState, floorId: number, reason: FloorReason | null): MessageStoreState {
  const messages = floorId > state.visibleFromId ? state.messages.filter((m) => m.id >= floorId) : state.messages;
  if (floorId === state.visibleFromId && reason === state.floorReason && messages === state.messages) return state;
  return { ...state, messages, visibleFromId: floorId, floorReason: reason };
}

/** Keeps only the newest rows; the dropped ones can be paged back in. */
/** 只保留最新的若干条；被丢弃的可以再翻页取回。 */
export function trimOldest(state: MessageStoreState, keep: number): MessageStoreState {
  if (state.messages.length <= keep) return state;
  return { ...state, messages: state.messages.slice(-Math.max(0, keep)), hasMore: true, reachedFloor: false };
}

/** A member renamed or changed avatar; updates their rows and quotes of their rows. */
/** 成员改了名字或头像；更新其消息以及引用其消息的内容。 */
export function applyAuthor(state: MessageStoreState, author: ChatAuthor): MessageStoreState {
  let changed = false;
  const messages = state.messages.map((m) => {
    let next = m;
    if (m.author.id === author.id) {
      const merged = { ...m.author, ...author };
      if (merged.displayName !== m.author.displayName || (merged.avatarKey ?? null) !== (m.author.avatarKey ?? null)) next = { ...next, author: merged };
    }
    if (m.replyTo && m.replyTo.authorId === author.id && m.replyTo.authorName !== author.displayName) {
      next = { ...next, replyTo: { ...m.replyTo, authorName: author.displayName } };
    }
    if (next !== m) changed = true;
    return next;
  });
  return changed ? { ...state, messages } : state;
}
