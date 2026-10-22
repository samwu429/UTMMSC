import { useCallback, useEffect, useRef, useState } from 'react';
import { parseServerFrame, redactChatBody, type ChatMessage, type ClientFrame, type ServerFrame } from '@utmmsc/shared';
import { ApiClientError, errorMessage, localizedMessage } from '../../../shared/api/errors';
import { chatApi } from '../api';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface RoomState {
  status: SocketStatus;
  messages: ChatMessage[];
  hasMore: boolean;
  onlineCount: number;
  lastReadId: number;
  mediaToken: string | null;
  /** Null until the ticket returns. False means the room policy blocks this member. */
  /** 票据返回前为 null。false 表示房间规则不允许该成员发言。 */
  canPost: boolean | null;
  retrying: boolean;
  error: string | null;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
const HEARTBEAT_MS = 25_000;
/** Room media tokens live an hour; refresh before that so lazy-loaded images keep working. */
/** 房间媒体令牌有效期一小时；提前刷新，延迟加载的图片才不会失效。 */
const MEDIA_REFRESH_MS = 50 * 60 * 1000;

/** Full jitter so a deploy does not make every client reconnect in the same instant. */
/** 全量抖动，部署后客户端不会在同一瞬间一起重连。 */
function backoff(attempt: number): number {
  return Math.round(Math.random() * Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt));
}

/**
 * Owns one WebSocket per room: fetches a ticket, connects, reconnects with backoff, keeps the
 * message list ordered by id, and exposes send/history/read/delete/recall actions.
 * 每个房间一条 WebSocket：领取票据、连接、指数退避重连、按 id 维护消息列表，并暴露发送/历史/已读/删除/撤回操作。
 */

function sanitize(message: ChatMessage): ChatMessage {
  return redactChatBody({
    ...message,
    deleted: message.deleted === true,
    recalled: message.recalled === true,
    imageKey: message.imageKey ?? null,
  });
}
export function useRoomSocket(roomId: string) {
  const [state, setState] = useState<RoomState>({
    status: 'connecting',
    messages: [],
    hasMore: false,
    onlineCount: 0,
    lastReadId: 0,
    mediaToken: null,
    canPost: null,
    retrying: false,
    error: null,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUserRef = useRef(false);
  const loadingOlderRef = useRef(false);
  /** After a reconnect the newest page replaces the list, so no gap is left between old and new. */
  /** 重连后用最新一页替换列表，新旧消息之间不会留下空洞。 */
  const replaceOnHistoryRef = useRef(false);
  const hiddenRef = useRef(new Map<number, { deleted: boolean; recalled: boolean }>());

  const rememberHidden = useCallback((id: number, patch: { deleted?: boolean; recalled?: boolean }) => {
    const prev = hiddenRef.current.get(id) ?? { deleted: false, recalled: false };
    hiddenRef.current.set(id, {
      deleted: prev.deleted || patch.deleted === true,
      recalled: prev.recalled || patch.recalled === true,
    });
  }, []);

  const sendFrame = useCallback((frame: ClientFrame): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(frame));
    return true;
  }, []);

  const handleFrame = useCallback((frame: ServerFrame) => {
    if (frame.type === 'deleted') rememberHidden(frame.messageId, { deleted: true });
    if (frame.type === 'recalled') rememberHidden(frame.messageId, { recalled: true });
    let replace = false;
    if (frame.type === 'history_result') {
      loadingOlderRef.current = false;
      replace = replaceOnHistoryRef.current;
      replaceOnHistoryRef.current = false;
      for (const message of frame.messages) {
        if (message.deleted || message.recalled) rememberHidden(message.id, { deleted: message.deleted === true, recalled: message.recalled === true });
      }
    }
    setState((prev) => {
      switch (frame.type) {
        case 'ready':
          return { ...prev, status: 'open', onlineCount: frame.onlineCount, lastReadId: frame.lastReadId, error: null };
        case 'history_result': {
          const byId = new Map(replace ? [] : prev.messages.map((m) => [m.id, m]));
          for (const message of frame.messages) {
            const hidden = hiddenRef.current.get(message.id);
            const next = hidden ? sanitize({ ...message, deleted: message.deleted || hidden.deleted, recalled: message.recalled || hidden.recalled, text: '', imageKey: null }) : sanitize(message);
            byId.set(message.id, next);
          }
          const merged = [...byId.values()].sort((a, b) => a.id - b.id);
          return { ...prev, messages: merged, hasMore: frame.hasMore };
        }
        case 'message': {
          const hidden = hiddenRef.current.get(frame.message.id);
          const incoming = hidden
            ? sanitize({ ...frame.message, deleted: frame.message.deleted || hidden.deleted, recalled: frame.message.recalled || hidden.recalled, text: '', imageKey: null })
            : sanitize(frame.message);
          const existing = prev.messages.find((m) => m.id === incoming.id);
          if (existing) return prev;
          return { ...prev, messages: [...prev.messages, incoming] };
        }
        case 'deleted':
          return {
            ...prev,
            messages: prev.messages.map((m) => (m.id === frame.messageId ? sanitize({ ...m, deleted: true, text: '', imageKey: null }) : m)),
          };
        case 'recalled':
          return {
            ...prev,
            messages: prev.messages.map((m) => (m.id === frame.messageId ? sanitize({ ...m, recalled: true, text: '', imageKey: null }) : m)),
          };
        case 'presence':
          return { ...prev, onlineCount: frame.onlineCount };
        case 'error':
          return { ...prev, error: localizedMessage(frame.message) };
        case 'pong':
          return prev;
      }
    });
  }, [rememberHidden]);

  useEffect(() => {
    closedByUserRef.current = false;
    attemptRef.current = 0;
    hiddenRef.current.clear();
    loadingOlderRef.current = false;
    replaceOnHistoryRef.current = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let mediaRefresh: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    async function connect() {
      if (disposed) return;
      setState((prev) => ({ ...prev, status: 'connecting', retrying: false }));
      let ticket;
      try {
        ticket = await chatApi.ticket(roomId);
      } catch (err) {
        const status = err instanceof ApiClientError ? err.status : 0;
        const retry = !disposed && (status === 0 || status >= 500);
        setState((prev) => ({ ...prev, status: 'closed', retrying: retry, error: errorMessage(err) }));
        if (retry) {
          const delay = backoff(attemptRef.current);
          attemptRef.current += 1;
          reconnectTimer = setTimeout(connect, delay);
        }
        return;
      }
      if (disposed) return;
      const canPost = ticket.canPost !== false;
      setState((prev) => ({ ...prev, mediaToken: ticket.mediaToken, canPost }));

      const socket = new WebSocket(ticket.socketUrl);
      socketRef.current = socket;

      // Every handler checks it still owns the ref: a socket from the previous room can fire late.
      // 每个回调都先确认自己仍是当前连接：上一个房间的连接可能延迟触发。
      const current = () => !disposed && socketRef.current === socket;

      socket.onopen = () => {
        if (!current()) return;
        replaceOnHistoryRef.current = true;
        loadingOlderRef.current = false;
        socket.send(JSON.stringify({ type: 'history' } satisfies ClientFrame));
        heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' } satisfies ClientFrame));
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
        if (!frame) return;
        // Count the connection as healthy only once the room accepted it, not on TCP open.
        // 房间接受连接后才算连接正常，而不是在底层连接建立时。
        if (frame.type === 'ready') attemptRef.current = 0;
        handleFrame(frame);
      };
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        loadingOlderRef.current = false;
        if (disposed || closedByUserRef.current) return;
        setState((prev) => ({ ...prev, status: 'closed', retrying: true }));
        const delay = backoff(attemptRef.current);
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    }

    void connect();

    mediaRefresh = setInterval(() => {
      chatApi
        .ticket(roomId)
        .then((ticket) => {
          if (!disposed) setState((prev) => ({ ...prev, mediaToken: ticket.mediaToken }));
        })
        .catch(() => undefined);
    }, MEDIA_REFRESH_MS);

    return () => {
      disposed = true;
      closedByUserRef.current = true;
      if (heartbeat) clearInterval(heartbeat);
      if (mediaRefresh) clearInterval(mediaRefresh);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
      setState({ status: 'connecting', messages: [], hasMore: false, onlineCount: 0, lastReadId: 0, mediaToken: null, canPost: null, retrying: false, error: null });
    };
  }, [roomId, handleFrame]);

  const send = useCallback(
    (text: string, imageKey?: string): boolean => {
      const clientId = crypto.randomUUID();
      return sendFrame({ type: 'send', clientId, text, ...(imageKey ? { imageKey } : {}) });
    },
    [sendFrame],
  );

  const loadOlder = useCallback(() => {
    // One page at a time; scroll events fire many times while near the top.
    // 一次只取一页；靠近顶部时滚动事件会连续触发。
    if (loadingOlderRef.current) return;
    const oldest = state.messages[0];
    if (sendFrame(oldest ? { type: 'history', beforeId: oldest.id } : { type: 'history' })) loadingOlderRef.current = true;
  }, [sendFrame, state.messages]);

  const markRead = useCallback(
    (messageId: number) => {
      if (!sendFrame({ type: 'read', messageId })) return;
      setState((prev) => (messageId > prev.lastReadId ? { ...prev, lastReadId: messageId } : prev));
    },
    [sendFrame],
  );
  const remove = useCallback((messageId: number) => sendFrame({ type: 'delete', messageId }), [sendFrame]);
  const recall = useCallback((messageId: number) => sendFrame({ type: 'recall', messageId }), [sendFrame]);
  const mute = useCallback((memberId: string, minutes: number) => sendFrame({ type: 'mute', memberId, minutes }), [sendFrame]);
  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return { ...state, send, loadOlder, markRead, remove, recall, mute, clearError };
}
