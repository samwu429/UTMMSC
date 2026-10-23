/**
 * Wire protocol between browser and ChatRoom over WebSocket. Every frame is a JSON object
 * with a `type` discriminator. Validation lives next to the types so both ends agree.
 * Fields added after the first release are optional on the wire, so old clients ignore them and
 * new clients still run against an old server.
 * 浏览器与 ChatRoom 之间的 WebSocket 协议。每帧都是带 `type` 的 JSON 对象。校验与类型放在一起，保证两端一致。
 * 首版之后新增的字段在线路上都是可选的，旧客户端会忽略它们，新客户端连旧服务端也能运行。
 */

export const MESSAGE_TEXT_MAX = 2000;
export const HISTORY_PAGE_SIZE = 50;
/** Largest page a history request may ask for. */
/** 单次历史请求可要求的最大条数。 */
export const HISTORY_PAGE_MAX = 100;
export const MENTIONS_MAX = 20;
export const QUOTE_EXCERPT_MAX = 60;
export const IMAGE_DIMENSION_MAX = 20_000;
export const REQUEST_ID_MAX = 32;
/** Cap on changed rows and hidden ids in one catch-up reply; past it the client resets to the latest page. */
/** 一次补齐回复中变更行与隐藏 id 的上限；超过时客户端回到最新一页。 */
export const CHANGED_MAX = 50;
/** Author id carried by rows the room writes itself, such as join notices. */
/** 房间自己写入的行（例如入群提示）使用的作者 id。 */
export const SYSTEM_AUTHOR_ID = 'system';

export interface ChatAuthor {
  id: string;
  displayName: string;
  /** The sender's current avatar, filled in by the room when it serves history. Null when they have none. */
  /** 发送者当前的头像，由房间在下发历史时填入。没有头像时为 null。 */
  avatarKey?: string | null;
}

export type MessageKind = 'user' | 'system';
export type DeletedBy = 'author' | 'moderator';
export type QuoteState = 'ok' | 'recalled' | 'deleted' | 'unavailable';
/** Why a socket cannot see older rows: it joined after the policy instant, or the member cleared the room. */
/** 连接看不到更早消息的原因：在策略生效后加入，或成员清空了聊天记录。 */
export type FloorReason = 'join' | 'clear';
export type HistoryDirection = 'latest' | 'older' | 'newer';

export interface SystemMemberRef {
  id: string;
  displayName: string;
}

/** Structured body of a system row. `members` holds at most 20 entries; `more` counts the rest. */
/** 系统行的结构化内容。`members` 最多 20 项；`more` 为其余人数。 */
export interface SystemEvent {
  type: 'join';
  actor: SystemMemberRef | null;
  members: SystemMemberRef[];
  more: number;
}

/** Quoted message as the viewer may see it. `excerpt` is empty unless state is 'ok'. */
/** 观看者可见的被引用消息。state 不是 'ok' 时 `excerpt` 为空。 */
export interface QuotePreview {
  id: number;
  authorId: string;
  authorName: string;
  excerpt: string;
  hasImage: boolean;
  state: QuoteState;
}

export interface ChatMessage {
  id: number;
  roomId: string;
  author: ChatAuthor;
  text: string;
  imageKey: string | null;
  createdAt: string;
  deleted: boolean;
  /** Author withdrew it. Clients must treat text and imageKey as empty. */
  /** 作者已撤回。客户端必须把正文和图片视为已清空。 */
  recalled: boolean;
  kind?: MessageKind;
  /** Present on system rows; `text` then holds a Chinese fallback sentence for old clients. */
  /** 系统行才有；此时 `text` 是给旧客户端看的中文兜底句子。 */
  system?: SystemEvent | null;
  replyTo?: QuotePreview | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  /** Sent only on the viewer's own rows, so an outbox can match its pending item. */
  /** 只出现在观看者自己的消息上，供发送队列匹配待发项。 */
  clientId?: string | null;
  /** Null on rows deleted before this field existed. */
  /** 此字段出现之前删除的行为 null。 */
  deletedBy?: DeletedBy | null;
  /** Room revision of the last change to this row; drives reconnect catch-up. */
  /** 此行最近一次变更时的房间版本号；用于重连补齐。 */
  rev?: number;
}

/** A message with every optional field filled in with its default. */
/** 所有可选字段都已填入默认值的消息。 */
export type NormalizedChatMessage = Required<ChatMessage>;

/* Client -> server */

export interface SendFrame {
  type: 'send';
  /** Idempotency key: a resend must reuse it. */
  /** 幂等键：重发时必须沿用。 */
  clientId: string;
  text: string;
  imageKey?: string;
  replyToId?: number;
  mentions?: string[];
  mentionAll?: boolean;
  imageWidth?: number;
  imageHeight?: number;
}

export interface HistoryFrame {
  type: 'history';
  beforeId?: number;
  requestId?: string;
  limit?: number;
  /** Forward catch-up from this id; cannot be combined with beforeId. */
  /** 从此 id 向后补齐；不能与 beforeId 同时使用。 */
  afterId?: number;
  oldestId?: number;
  sinceRev?: number;
}

export interface ReadFrame {
  type: 'read';
  messageId: number;
}

export interface DeleteFrame {
  type: 'delete';
  messageId: number;
}

export interface RecallFrame {
  type: 'recall';
  messageId: number;
}

/** Hides one message for the sender only, on all of their devices. */
/** 只为发送者本人隐藏一条消息，在其所有设备上生效。 */
export interface HideFrame {
  type: 'hide';
  messageId: number;
}

export interface MuteFrame {
  type: 'mute';
  memberId: string;
  minutes: number;
}

export interface PingFrame {
  type: 'ping';
}

/**
 * Whether the page holding this socket is on screen. A socket counts as visible until it says otherwise,
 * and only visible sockets keep their member from being pushed for this room. Sent only to a server
 * whose ready frame set `visibility`.
 * 持有此连接的页面是否显示在屏幕上。连接在声明之前都算可见，只有可见的连接才会让其成员不再收到本房间的推送。
 * 只发给 ready 帧中设置了 `visibility` 的服务端。
 */
export interface VisibilityFrame {
  type: 'visibility';
  visible: boolean;
}

export type ClientFrame =
  | SendFrame
  | HistoryFrame
  | ReadFrame
  | DeleteFrame
  | RecallFrame
  | HideFrame
  | MuteFrame
  | PingFrame
  | VisibilityFrame;

/* Server -> client */

export interface ReadyFrame {
  type: 'ready';
  roomId: string;
  memberId: string;
  /** Unread baseline: max(read cursor, join floor - 1, clear point). */
  /** 未读基线：max(已读游标, 加入下限 - 1, 清空位置)。 */
  lastReadId: number;
  /** Kept for old clients; presence broadcasts no longer update it. */
  /** 为旧客户端保留；不再广播在线人数更新。 */
  onlineCount: number;
  /** First id this socket can ever receive; 0 means no floor. */
  /** 此连接能收到的最小 id；0 表示没有下限。 */
  visibleFromId?: number;
  floorReason?: FloorReason | null;
  joinedAt?: string | null;
  unreadCount?: number;
  firstUnreadId?: number | null;
  firstMentionId?: number | null;
  mutedUntil?: string | null;
  serverTime?: string;
  /** Current room revision. A number here marks a server that speaks this protocol. */
  /** 当前房间版本号。此处为数字表示服务端支持本协议。 */
  rev?: number;
  /** True when the server accepts visibility frames. */
  /** 服务端接受 visibility 帧时为 true。 */
  visibility?: boolean;
}

export interface MessageFrame {
  type: 'message';
  message: ChatMessage;
  clientId?: string;
}

export interface HistoryResultFrame {
  type: 'history_result';
  /** Ascending by id. */
  /** 按 id 升序。 */
  messages: ChatMessage[];
  /** Never crosses the viewer's floor. */
  /** 不会越过观看者的下限。 */
  hasMore: boolean;
  requestId?: string;
  direction?: HistoryDirection;
  hasNewer?: boolean;
  /** True when hasMore is false only because older rows exist below this viewer's floor. */
  /** 仅因为下限以下还有更早的消息而 hasMore 为 false 时为 true。 */
  reachedFloor?: boolean;
  floorReason?: FloorReason | null;
  changed?: ChatMessage[];
  hiddenIds?: number[];
  changedOverflow?: boolean;
  rev?: number;
}

export interface DeletedFrame {
  type: 'deleted';
  messageId: number;
  by?: DeletedBy;
  rev?: number;
}

/** Recall notice. Carries no body, so a live client cannot keep the original text. */
/** 撤回通知。不带正文，在线客户端因此无法留下原文。 */
export interface RecalledFrame {
  type: 'recalled';
  messageId: number;
  rev?: number;
}

/** Sent only to the acting member's own sockets. */
/** 只发给操作成员自己的连接。 */
export interface HiddenFrame {
  type: 'hidden';
  messageId: number;
  rev: number;
}

/** Sent only to the acting member's own sockets; rows below beforeId are gone for them. */
/** 只发给操作成员自己的连接；beforeId 以下的消息对其不再可见。 */
export interface ClearedFrame {
  type: 'cleared';
  beforeId: number;
  rev: number;
}

export interface PresenceFrame {
  type: 'presence';
  onlineCount: number;
}

export interface ErrorFrame {
  type: 'error';
  code:
    | 'invalid_frame'
    | 'text_too_long'
    | 'forbidden'
    | 'muted'
    | 'not_found'
    | 'rate_limited'
    | 'recall_expired';
  message: string;
  /** Set on every send rejection. */
  /** 每次拒绝发送时都会带上。 */
  clientId?: string;
  /** Set on history errors. */
  /** 历史请求出错时带上。 */
  requestId?: string;
  /** Set on recall, delete and hide errors. */
  /** 撤回、删除、隐藏出错时带上。 */
  messageId?: number;
  mutedUntil?: string;
}

export interface PongFrame {
  type: 'pong';
}

/** A member changed their name or avatar; clients update every message they already show by that author. */
/** 某成员修改了名字或头像；客户端更新已显示的该作者全部消息。 */
export interface AuthorFrame {
  type: 'author';
  author: ChatAuthor;
  rev?: number;
}

export type ServerFrame =
  | ReadyFrame
  | MessageFrame
  | HistoryResultFrame
  | DeletedFrame
  | RecalledFrame
  | HiddenFrame
  | ClearedFrame
  | PresenceFrame
  | ErrorFrame
  | PongFrame
  | AuthorFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Image keys are server-generated paths; anything longer is not one of ours. */
/** 图片键由服务端生成，超出此长度的一定不是合法键。 */
const IMAGE_KEY_MAX = 200;

/** Member ids, client ids and mute targets share this bound. */
/** 成员 id、客户端 id 和禁言对象共用此长度上限。 */
const ID_MAX = 64;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Largest raw inbound frame the room accepts, in characters. */
/** 房间接受的单条入站帧最大长度（字符）。 */
export const CLIENT_FRAME_MAX = 16_384;

function isShortId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= ID_MAX;
}

function parseSend(raw: Record<string, unknown>): SendFrame | null {
  if (!isShortId(raw.clientId)) return null;
  if (typeof raw.text !== 'string') return null;
  if (raw.imageKey !== undefined && (typeof raw.imageKey !== 'string' || raw.imageKey.length > IMAGE_KEY_MAX)) return null;
  if (raw.replyToId !== undefined && !isPositiveInt(raw.replyToId)) return null;
  if (raw.mentionAll !== undefined && typeof raw.mentionAll !== 'boolean') return null;

  let mentions: string[] | undefined;
  if (raw.mentions !== undefined) {
    if (!Array.isArray(raw.mentions) || raw.mentions.length > MENTIONS_MAX) return null;
    if (!raw.mentions.every(isShortId)) return null;
    mentions = [...new Set(raw.mentions as string[])];
  }

  // Dimensions travel together and only describe an attached image.
  // 尺寸必须成对出现，且只用于描述附带的图片。
  const hasWidth = raw.imageWidth !== undefined;
  const hasHeight = raw.imageHeight !== undefined;
  if (hasWidth !== hasHeight) return null;
  if (hasWidth) {
    if (raw.imageKey === undefined) return null;
    if (!isIntInRange(raw.imageWidth, 1, IMAGE_DIMENSION_MAX) || !isIntInRange(raw.imageHeight, 1, IMAGE_DIMENSION_MAX)) return null;
  }

  const frame: SendFrame = { type: 'send', clientId: raw.clientId, text: raw.text };
  if (typeof raw.imageKey === 'string') frame.imageKey = raw.imageKey;
  if (isPositiveInt(raw.replyToId)) frame.replyToId = raw.replyToId;
  if (mentions && mentions.length > 0) frame.mentions = mentions;
  if (raw.mentionAll === true) frame.mentionAll = true;
  if (hasWidth) {
    frame.imageWidth = raw.imageWidth as number;
    frame.imageHeight = raw.imageHeight as number;
  }
  return frame;
}

function parseHistory(raw: Record<string, unknown>): HistoryFrame | null {
  if (raw.beforeId !== undefined && !isPositiveInt(raw.beforeId)) return null;
  if (raw.requestId !== undefined) {
    if (typeof raw.requestId !== 'string' || raw.requestId.length === 0 || raw.requestId.length > REQUEST_ID_MAX) return null;
    if (!REQUEST_ID_PATTERN.test(raw.requestId)) return null;
  }
  if (raw.limit !== undefined && !isIntInRange(raw.limit, 1, HISTORY_PAGE_MAX)) return null;
  if (raw.afterId !== undefined && !isNonNegativeInt(raw.afterId)) return null;
  if (raw.afterId !== undefined && raw.beforeId !== undefined) return null;
  if (raw.oldestId !== undefined && (raw.afterId === undefined || !isPositiveInt(raw.oldestId))) return null;
  if (raw.sinceRev !== undefined && (raw.afterId === undefined || !isNonNegativeInt(raw.sinceRev))) return null;

  const frame: HistoryFrame = { type: 'history' };
  if (isPositiveInt(raw.beforeId)) frame.beforeId = raw.beforeId;
  if (typeof raw.requestId === 'string') frame.requestId = raw.requestId;
  if (typeof raw.limit === 'number') frame.limit = raw.limit;
  if (isNonNegativeInt(raw.afterId)) frame.afterId = raw.afterId;
  if (isPositiveInt(raw.oldestId)) frame.oldestId = raw.oldestId;
  if (isNonNegativeInt(raw.sinceRev)) frame.sinceRev = raw.sinceRev;
  return frame;
}

/**
 * Parses an inbound frame. Returns null for anything that does not match the protocol so the
 * server can reject it without trusting any field. Frames are rebuilt field by field, so unknown
 * fields never reach the room.
 * 解析入站帧。不符合协议的一律返回 null，服务端据此拒绝而不信任任何字段。帧逐字段重建，未知字段不会进入房间。
 */
export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'send':
      return parseSend(raw);
    case 'history':
      return parseHistory(raw);
    case 'read':
      return isPositiveInt(raw.messageId) ? { type: 'read', messageId: raw.messageId } : null;
    case 'delete':
      return isPositiveInt(raw.messageId) ? { type: 'delete', messageId: raw.messageId } : null;
    case 'recall':
      return isPositiveInt(raw.messageId) ? { type: 'recall', messageId: raw.messageId } : null;
    case 'hide':
      return isPositiveInt(raw.messageId) ? { type: 'hide', messageId: raw.messageId } : null;
    case 'mute':
      if (!isShortId(raw.memberId) || !isPositiveInt(raw.minutes) || raw.minutes > 60 * 24 * 30) {
        return null;
      }
      return { type: 'mute', memberId: raw.memberId, minutes: raw.minutes };
    case 'ping':
      return { type: 'ping' };
    case 'visibility':
      return typeof raw.visible === 'boolean' ? { type: 'visibility', visible: raw.visible } : null;
    default:
      return null;
  }
}

function normalizeMemberRef(value: unknown): SystemMemberRef | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return { id: value.id, displayName: typeof value.displayName === 'string' ? value.displayName : '' };
}

function normalizeSystemEvent(value: unknown): SystemEvent | null {
  if (!isRecord(value) || value.type !== 'join') return null;
  const members = Array.isArray(value.members)
    ? value.members.map(normalizeMemberRef).filter((m): m is SystemMemberRef => m !== null).slice(0, MENTIONS_MAX)
    : [];
  return {
    type: 'join',
    actor: normalizeMemberRef(value.actor),
    members,
    more: isNonNegativeInt(value.more) ? value.more : 0,
  };
}

const QUOTE_STATES: readonly QuoteState[] = ['ok', 'recalled', 'deleted', 'unavailable'];

function normalizeQuote(value: unknown): QuotePreview | null {
  if (!isRecord(value) || !isPositiveInt(value.id)) return null;
  const state = QUOTE_STATES.includes(value.state as QuoteState) ? (value.state as QuoteState) : 'unavailable';
  const live = state === 'ok';
  return {
    id: value.id,
    authorId: typeof value.authorId === 'string' ? value.authorId : '',
    authorName: typeof value.authorName === 'string' ? value.authorName : '',
    excerpt: live && typeof value.excerpt === 'string' ? value.excerpt.slice(0, QUOTE_EXCERPT_MAX) : '',
    hasImage: live && value.hasImage === true,
    state,
  };
}

function dimensionOrNull(value: unknown): number | null {
  return isIntInRange(value, 1, IMAGE_DIMENSION_MAX) ? value : null;
}

/**
 * Fills every optional field with its default, so the rest of the client can rely on one shape
 * whether the server is old or new. Values of the wrong type fall back to the default.
 * 为每个可选字段填入默认值，客户端其余部分无论服务端新旧都能依赖同一结构。类型不对的值退回默认值。
 */
export function normalizeChatMessage(message: ChatMessage): NormalizedChatMessage {
  const kind: MessageKind = message.kind === 'system' ? 'system' : 'user';
  return {
    id: message.id,
    roomId: message.roomId,
    author: message.author,
    text: typeof message.text === 'string' ? message.text : '',
    imageKey: typeof message.imageKey === 'string' ? message.imageKey : null,
    createdAt: message.createdAt,
    deleted: message.deleted === true,
    recalled: message.recalled === true,
    kind,
    system: kind === 'system' ? normalizeSystemEvent(message.system) : null,
    replyTo: normalizeQuote(message.replyTo),
    imageWidth: dimensionOrNull(message.imageWidth),
    imageHeight: dimensionOrNull(message.imageHeight),
    clientId: typeof message.clientId === 'string' && message.clientId.length > 0 ? message.clientId : null,
    deletedBy: message.deletedBy === 'author' || message.deletedBy === 'moderator' ? message.deletedBy : null,
    rev: isNonNegativeInt(message.rev) ? message.rev : 0,
  };
}

function isMessageRecord(value: unknown): value is ChatMessage {
  return isRecord(value) && isPositiveInt(value.id) && isRecord(value.author) && typeof value.author.id === 'string';
}

function normalizeList(value: unknown): NormalizedChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isMessageRecord).map(normalizeChatMessage);
}

/**
 * Parses an outbound frame on the client. Every message it carries is normalized.
 * 在客户端解析服务端帧。帧内的每条消息都会被规范化。
 */
export function parseServerFrame(raw: unknown): ServerFrame | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'message':
      if (!isMessageRecord(raw.message)) return null;
      return { ...(raw as unknown as MessageFrame), message: normalizeChatMessage(raw.message) };
    case 'history_result': {
      if (!Array.isArray(raw.messages)) return null;
      const frame: HistoryResultFrame = { ...(raw as unknown as HistoryResultFrame), messages: normalizeList(raw.messages) };
      if (raw.changed !== undefined) frame.changed = normalizeList(raw.changed);
      if (raw.hiddenIds !== undefined) frame.hiddenIds = Array.isArray(raw.hiddenIds) ? raw.hiddenIds.filter(isPositiveInt) : [];
      return frame;
    }
    case 'hidden':
      return isPositiveInt(raw.messageId) ? (raw as unknown as HiddenFrame) : null;
    case 'cleared':
      return isPositiveInt(raw.beforeId) ? (raw as unknown as ClearedFrame) : null;
    case 'ready':
    case 'deleted':
    case 'recalled':
    case 'presence':
    case 'error':
    case 'pong':
      return raw as unknown as ServerFrame;
    case 'author':
      return isRecord(raw.author) && typeof raw.author.id === 'string' ? (raw as unknown as ServerFrame) : null;
    default:
      return null;
  }
}
