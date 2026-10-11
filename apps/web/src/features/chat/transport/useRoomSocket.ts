import { useCallback, useEffect, useRef, useState } from 'react';
import { parseServerFrame, type ChatMessage, type ClientFrame, type ServerFrame } from '@utmmsc/shared';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
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

/**
 * Owns one WebSocket per room: fetches a ticket, connects, reconnects with backoff, keeps the
 * message list ordered by id, and exposes send/history/read/delete actions.
 * 每个房间一条 WebSocket：领取票据、连接、指数退避重连、按 id 维护消息列表，并暴露发送/历史/已读/删除操作。
 */
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
  const pendingRef = useRef(new Map<string, ChatMessage>());

  const sendFrame = useCallback((frame: ClientFrame) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }, []);

  const handleFrame = useCallback((frame: ServerFrame) => {
    setState((prev) => {
      switch (frame.type) {
        case 'ready':
          return { ...prev, status: 'open', onlineCount: frame.onlineCount, lastReadId: frame.lastReadId, error: null };
        case 'history_result': {
          const known = new Set(prev.messages.map((m) => m.id));
          const merged = [...frame.messages.filter((m) => !known.has(m.id)), ...prev.messages].sort((a, b) => a.id - b.id);
          return { ...prev, messages: merged, hasMore: frame.hasMore };
        }
        case 'message': {
          if (frame.clientId) pendingRef.current.delete(frame.clientId);
          if (prev.messages.some((m) => m.id === frame.message.id)) return prev;
          return { ...prev, messages: [...prev.messages, frame.message] };
        }
        case 'deleted':
          return {
            ...prev,
            messages: prev.messages.map((m) => (m.id === frame.messageId ? { ...m, deleted: true, text: '', imageKey: null } : m)),
          };
        case 'presence':
          return { ...prev, onlineCount: frame.onlineCount };
        case 'error':
          return { ...prev, error: frame.message };
        case 'pong':
          return prev;
      }
    });
  }, []);

  useEffect(() => {
    closedByUserRef.current = false;
    attemptRef.current = 0;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
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
          const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptRef.current);
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

      socket.onopen = () => {
        attemptRef.current = 0;
        socket.send(JSON.stringify({ type: 'history' } satisfies ClientFrame));
        heartbeat = setInterval(() => socket.send(JSON.stringify({ type: 'ping' } satisfies ClientFrame)), HEARTBEAT_MS);
      };
      socket.onmessage = (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          return;
        }
        const frame = parseServerFrame(parsed);
        if (frame) handleFrame(frame);
      };
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        socketRef.current = null;
        if (disposed || closedByUserRef.current) return;
        setState((prev) => ({ ...prev, status: 'closed', retrying: true }));
        const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attemptRef.current);
        attemptRef.current += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket.close();
    }

    void connect();

    return () => {
      disposed = true;
      closedByUserRef.current = true;
      if (heartbeat) clearInterval(heartbeat);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
      setState({ status: 'connecting', messages: [], hasMore: false, onlineCount: 0, lastReadId: 0, mediaToken: null, canPost: null, retrying: false, error: null });
    };
  }, [roomId, handleFrame]);

  const send = useCallback(
    (text: string, imageKey?: string) => {
      const clientId = crypto.randomUUID();
      sendFrame({ type: 'send', clientId, text, ...(imageKey ? { imageKey } : {}) });
    },
    [sendFrame],
  );

  const loadOlder = useCallback(() => {
    const oldest = state.messages[0];
    sendFrame(oldest ? { type: 'history', beforeId: oldest.id } : { type: 'history' });
  }, [sendFrame, state.messages]);

  const markRead = useCallback((messageId: number) => sendFrame({ type: 'read', messageId }), [sendFrame]);
  const remove = useCallback((messageId: number) => sendFrame({ type: 'delete', messageId }), [sendFrame]);
  const mute = useCallback((memberId: string, minutes: number) => sendFrame({ type: 'mute', memberId, minutes }), [sendFrame]);
  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return { ...state, send, loadOlder, markRead, remove, mute, clearError };
}
