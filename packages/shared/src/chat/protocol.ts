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
}

export interface ChatMessage {
  id: number;
  roomId: string;
  author: ChatAuthor;
  text: string;
  imageKey: string | null;
  createdAt: string;
  deleted: boolean;
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
    | 'rate_limited';
  message: string;
}

export interface PongFrame {
  type: 'pong';
}

export type ServerFrame =
  | ReadyFrame
  | MessageFrame
  | HistoryResultFrame
  | DeletedFrame
  | PresenceFrame
  | ErrorFrame
  | PongFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

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
      if (raw.imageKey !== undefined && typeof raw.imageKey !== 'string') return null;
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
    case 'mute':
      if (typeof raw.memberId !== 'string' || !isPositiveInt(raw.minutes) || raw.minutes > 60 * 24 * 30) {
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
    case 'presence':
    case 'error':
    case 'pong':
      return raw as unknown as ServerFrame;
    default:
      return null;
  }
}
