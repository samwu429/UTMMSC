import {
  MENTIONS_MAX,
  QUOTE_EXCERPT_MAX,
  STICKER_TEXT,
  SYSTEM_AUTHOR_ID,
  normalizeStickerRef,
  type FloorReason,
  type HistoryDirection,
  type QuotePreview,
  type StickerRef,
  type SystemEvent,
  type SystemMemberRef,
} from '@utmmsc/shared';

/**
 * Pure rules the ChatRoom applies to history, unread counts, quotes and mentions. Kept apart from
 * the Durable Object so they can be unit-tested without storage.
 * ChatRoom 用于历史、未读数、引用和 @ 的纯规则。与 Durable Object 分开，便于在没有存储的情况下做单元测试。
 */

export interface FloorDecision {
  /** Lowest id the socket may receive; 0 means no floor. */
  /** 连接能收到的最小 id；0 表示没有下限。 */
  floorId: number;
  floorReason: FloorReason | null;
}

/**
 * Combines the join floor and the member's own clear point. joinFirstId is the first message at or
 * after the join instant (or latestId + 1), and clearId is the last id the member cleared.
 * 合并加入下限与成员自己的清空位置。joinFirstId 是加入时刻及之后的第一条消息（没有时为 latestId + 1），clearId 是成员清空到的最后一个 id。
 */
export function decideFloor(input: { floorApplies: boolean; joinFirstId: number | null; clearId: number }): FloorDecision {
  const joinFloor = input.floorApplies && input.joinFirstId !== null ? Math.max(input.joinFirstId, 0) : 0;
  const clearFloor = input.clearId > 0 ? input.clearId + 1 : 0;
  if (joinFloor === 0 && clearFloor === 0) return { floorId: 0, floorReason: null };
  if (clearFloor >= joinFloor) return { floorId: clearFloor, floorReason: 'clear' };
  return { floorId: joinFloor, floorReason: 'join' };
}

/**
 * Unread counting starts above this id. A member who joined later starts from their join, so a new
 * member does not see every earlier message as unread, even when the full history is visible.
 * 未读从此 id 之后开始计算。后加入的成员从加入处开始计，即使能看到全部历史，新成员也不会把之前的消息都算作未读。
 */
export function unreadBaseline(input: { cursor: number; joinFirstId: number | null; clearId: number }): number {
  const joinBase = input.joinFirstId !== null ? input.joinFirstId - 1 : 0;
  return Math.max(input.cursor, joinBase, input.clearId, 0);
}

export interface PageSlice<T> {
  /** Ascending by id. */
  /** 按 id 升序。 */
  page: T[];
  hasMore: boolean;
  hasNewer: boolean;
}

/**
 * Rows were fetched with limit + 1 so one extra row tells whether more exist. Latest and older pages
 * are read newest first; newer pages are read oldest first.
 * 读取时多取一行（limit + 1），用于判断是否还有更多。最新页和更早页按从新到旧读取；更新页按从旧到新读取。
 */
export function slicePage<T extends { id: number }>(rows: T[], limit: number, direction: HistoryDirection): PageSlice<T> {
  const extra = rows.length > limit;
  if (direction === 'newer') {
    return { page: rows.slice(0, limit), hasMore: false, hasNewer: extra };
  }
  return { page: rows.slice(0, limit).reverse(), hasMore: extra, hasNewer: false };
}

/** The fields of a quoted row that a preview needs. */
/** 生成引用预览所需的被引用行字段。 */
export interface QuoteTarget {
  id: number;
  kind: string;
  author_id: string;
  author_name: string;
  text: string;
  image_key: string | null;
  deleted: number;
  recalled: number;
  /** Schema 8: set when the quoted row is a sticker. */
  /** 结构版本 8：被引用的行是表情时有值。 */
  sticker_json?: string | null;
}

/**
 * The sticker a stored row shows, or null when its JSON is missing or malformed. The row then shows its stored text
 * (the fallback '[表情]') instead of failing the page.
 * 已存的行所显示的表情；JSON 缺失或格式不对时为 null。此时这一行显示保存的文字（备用的 '[表情]'），而不是让整页失败。
 */
export function parseStickerJson(json: string | null | undefined): StickerRef | null {
  if (!json) return null;
  try {
    return normalizeStickerRef(JSON.parse(json));
  } catch {
    return null;
  }
}

function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > QUOTE_EXCERPT_MAX ? `${collapsed.slice(0, QUOTE_EXCERPT_MAX - 1)}…` : collapsed;
}

function unavailableQuote(id: number): QuotePreview {
  return { id, authorId: '', authorName: '', excerpt: '', hasImage: false, state: 'unavailable' };
}

/**
 * Builds the quote shown with a reply at read time, so a later recall or delete is reflected at once.
 * A missing target, a system row, or a row below the viewer's floor reveals nothing, not even the author.
 * A live sticker carries '[表情]' as its excerpt for old clients and hasSticker for new ones.
 * 在读取时生成回复所附的引用，因此之后的撤回或删除会立即体现。被引用行不存在、是系统行或在观看者下限以下时，不透露任何内容，包括作者。
 * 有效的表情以 '[表情]' 作为摘录供旧客户端显示，并带上 hasSticker 供新客户端使用。
 */
export function buildQuotePreview(replyToId: number, target: QuoteTarget | null | undefined, viewerFloorId: number): QuotePreview {
  if (!target || target.kind === 'system' || target.author_id === SYSTEM_AUTHOR_ID || target.id < viewerFloorId) {
    return unavailableQuote(replyToId);
  }
  const base = { id: target.id, authorId: target.author_id, authorName: target.author_name };
  if (target.recalled === 1) return { ...base, excerpt: '', hasImage: false, state: 'recalled' };
  if (target.deleted === 1) return { ...base, excerpt: '', hasImage: false, state: 'deleted' };
  if (target.sticker_json) return { ...base, excerpt: STICKER_TEXT, hasImage: false, hasSticker: true, state: 'ok' };
  return { ...base, excerpt: excerptOf(target.text), hasImage: target.image_key !== null, state: 'ok' };
}

/** Narrows a quote for one socket: a target below that socket's floor becomes unavailable. */
/** 按单个连接收窄引用：被引用消息在该连接下限以下时改为不可见。 */
export function quoteForViewer(quote: QuotePreview | null | undefined, viewerFloorId: number): QuotePreview | null {
  if (!quote) return null;
  if (quote.id < viewerFloorId && quote.state !== 'unavailable') return unavailableQuote(quote.id);
  return quote;
}

/** Mentions are channel-only flags: deduplicated, without the sender, and capped. */
/** @ 只在频道中生效：去重、去掉发送者本人，并限制数量。 */
export function sanitizeMentions(ids: readonly string[] | undefined, selfId: string, roomKind: 'channel' | 'direct'): string[] {
  if (!ids || roomKind !== 'channel') return [];
  const unique = [...new Set(ids)].filter((id) => id !== selfId && id !== SYSTEM_AUTHOR_ID);
  return unique.slice(0, MENTIONS_MAX);
}

export function capList<T>(list: readonly T[], max: number): { items: T[]; overflow: boolean } {
  return { items: list.slice(0, max), overflow: list.length > max };
}

/** Members named in one join notice; the rest are counted in `more`. */
/** 一条入群提示里列出姓名的人数上限；其余计入 `more`。 */
export const JOIN_MEMBERS_MAX = 20;

const JOIN_NAMES_SHOWN = 3;

function quoted(name: string): string {
  return `“${name}”`;
}

/** Splits the joined members into the stored event, keeping at most JOIN_MEMBERS_MAX names. */
/** 把加入的成员拆分为存储用的事件，最多保留 JOIN_MEMBERS_MAX 个姓名。 */
export function joinEvent(actor: SystemMemberRef | null, members: readonly SystemMemberRef[]): SystemEvent {
  const shown = members.slice(0, JOIN_MEMBERS_MAX);
  return { type: 'join', actor, members: shown, more: members.length - shown.length };
}

/**
 * Chinese sentence stored in `text` so clients that predate system rows still show something readable.
 * New clients build their own wording from the structured event.
 * 存在 `text` 里的中文句子，让不认识系统行的旧客户端也能显示可读内容。新客户端根据结构化事件自行生成文案。
 */
export function joinFallbackText(event: SystemEvent): string {
  const total = event.members.length + event.more;
  const names = event.members.slice(0, JOIN_NAMES_SHOWN).map((m) => quoted(m.displayName)).join('、');
  const who = total > JOIN_NAMES_SHOWN ? `${names}等${total}人` : names;
  return event.actor ? `${quoted(event.actor.displayName)}邀请${who}加入了频道` : `${who}加入了频道`;
}
