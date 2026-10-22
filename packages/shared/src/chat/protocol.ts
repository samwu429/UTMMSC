/**
 * Wire protocol between browser and ChatRoom over WebSocket. Every frame is a JSON object
 * with a `type` discriminator. Validation lives next to the types so both ends agree.
 * 浏览器与 ChatRoom 之间的 WebSocket 协议。每帧都是带 `type` 的 JSON 对象。校验与类型放在一起，保证两端一致。
 */

export const MESSAGE_TEXT_MAX = 2000;
export const HISTORY_PAGE_SIZE = 50;

export interface ChatAuthor {
  id: string;
  displayName: string;
  /** The sender's current avatar, filled in by the room when it serves history. Null when they have none. */
  /** 发送者当前的头像，由房间在下发历史时填入。没有头像时为 null。 */
  avatarKey?: string | null;
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
}

/* Client -> server */

export interface SendFrame {
  type: 'send';
  clientId: string;
  text: string;
  imageKey?: string;
}

export interface HistoryFrame {
  type: 'history';
  beforeId?: number;
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

export interface MuteFrame {
  type: 'mute';
  memberId: string;
  minutes: number;
}

export interface PingFrame {
  type: 'ping';
}

export type ClientFrame =
  | SendFrame
  | HistoryFrame
  | ReadFrame
  | DeleteFrame
  | RecallFrame
  | MuteFrame
  | PingFrame;

/* Server -> client */

export interface ReadyFrame {
  type: 'ready';
  roomId: string;
  memberId: string;
  lastReadId: number;
  onlineCount: number;
}

export interface MessageFrame {
  type: 'message';
  message: ChatMessage;
  clientId?: string;
}

export interface HistoryResultFrame {
  type: 'history_result';
  messages: ChatMessage[];
  hasMore: boolean;
}

export interface DeletedFrame {
  type: 'deleted';
  messageId: number;
}

/** Recall notice. Carries no body, so a live client cannot keep the original text. */
/** 撤回通知。不带正文，在线客户端因此无法留下原文。 */
export interface RecalledFrame {
  type: 'recalled';
  messageId: number;
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
}

export interface PongFrame {
  type: 'pong';
}

/** A member changed their name or avatar; clients update every message they already show by that author. */
/** 某成员修改了名字或头像；客户端更新已显示的该作者全部消息。 */
export interface AuthorFrame {
  type: 'author';
  author: ChatAuthor;
}

export type ServerFrame =
  | ReadyFrame
  | MessageFrame
  | HistoryResultFrame
  | DeletedFrame
  | RecalledFrame
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

/** Image keys are server-generated paths; anything longer is not one of ours. */
/** 图片键由服务端生成，超出此长度的一定不是合法键。 */
const IMAGE_KEY_MAX = 200;

/** Largest raw inbound frame the room accepts, in characters. */
/** 房间接受的单条入站帧最大长度（字符）。 */
export const CLIENT_FRAME_MAX = 16_384;

/**
 * Parses an inbound frame. Returns null for anything that does not match the protocol so the
 * server can reject it without trusting any field.
 * 解析入站帧。不符合协议的一律返回 null，服务端据此拒绝而不信任任何字段。
 */
export function parseClientFrame(raw: unknown): ClientFrame | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'send': {
      if (typeof raw.clientId !== 'string' || raw.clientId.length === 0 || raw.clientId.length > 64) {
        return null;
      }
      if (typeof raw.text !== 'string') return null;
      if (raw.imageKey !== undefined && (typeof raw.imageKey !== 'string' || raw.imageKey.length > IMAGE_KEY_MAX)) return null;
      const frame: SendFrame = { type: 'send', clientId: raw.clientId, text: raw.text };
      if (typeof raw.imageKey === 'string') frame.imageKey = raw.imageKey;
      return frame;
    }
    case 'history': {
      if (raw.beforeId !== undefined && !isPositiveInt(raw.beforeId)) return null;
      const frame: HistoryFrame = { type: 'history' };
      if (isPositiveInt(raw.beforeId)) frame.beforeId = raw.beforeId;
      return frame;
    }
    case 'read':
      return isPositiveInt(raw.messageId) ? { type: 'read', messageId: raw.messageId } : null;
    case 'delete':
      return isPositiveInt(raw.messageId) ? { type: 'delete', messageId: raw.messageId } : null;
    case 'recall':
      return isPositiveInt(raw.messageId) ? { type: 'recall', messageId: raw.messageId } : null;
    case 'mute':
      if (typeof raw.memberId !== 'string' || raw.memberId.length === 0 || raw.memberId.length > 64 || !isPositiveInt(raw.minutes) || raw.minutes > 60 * 24 * 30) {
        return null;
      }
      return { type: 'mute', memberId: raw.memberId, minutes: raw.minutes };
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

export function parseServerFrame(raw: unknown): ServerFrame | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'ready':
    case 'message':
    case 'history_result':
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
