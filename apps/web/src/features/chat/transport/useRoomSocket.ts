import { useCallback, useEffect, useRef, useState } from 'react';
import { parseServerFrame, redactChatBody, type ChatMessage, type ClientFrame, type ServerFrame } from '@utmmsc/shared';
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
  const pendingRef = useRef(new Map<string, ChatMessage>());
  const hiddenRef = useRef(new Map<number, { deleted: boolean; recalled: boolean }>());

  const rememberHidden = useCallback((id: number, patch: { deleted?: boolean; recalled?: boolean }) => {
    const prev = hiddenRef.current.get(id) ?? { deleted: false, recalled: false };
    hiddenRef.current.set(id, {
      deleted: prev.deleted || patch.deleted === true,
      recalled: prev.recalled || patch.recalled === true,
    });
  }, []);

  const sendFrame = useCallback((frame: ClientFrame) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }, []);

  const handleFrame = useCallback((frame: ServerFrame) => {
    if (frame.type === 'deleted') rememberHidden(frame.messageId, { deleted: true });
    if (frame.type === 'recalled') rememberHidden(frame.messageId, { recalled: true });
    if (frame.type === 'history_result') {
      for (const message of frame.messages) {
        if (message.deleted || message.recalled) rememberHidden(message.id, { deleted: message.deleted === true, recalled: message.recalled === true });
      }
    }
    setState((prev) => {
      switch (frame.type) {
        case 'ready':
          return { ...prev, status: 'open', onlineCount: frame.onlineCount, lastReadId: frame.lastReadId, error: null };
        case 'history_result': {
          const byId = new Map(prev.messages.map((m) => [m.id, m]));
          for (const message of frame.messages) {
            const hidden = hiddenRef.current.get(message.id);
            const next = hidden ? sanitize({ ...message, deleted: message.deleted || hidden.deleted, recalled: message.recalled || hidden.recalled, text: '', imageKey: null }) : sanitize(message);
            byId.set(message.id, next);
          }
          const merged = [...byId.values()].sort((a, b) => a.id - b.id);
          return { ...prev, messages: merged, hasMore: frame.hasMore };
        }
        case 'message': {
          if (frame.clientId) pendingRef.current.delete(frame.clientId);
          const hidden = hiddenRef.current.get(frame.message.id);
          const incoming = hidden
            ? sanitize({ ...frame.message, deleted: frame.message.deleted || hidden.deleted, recalled: frame.message.recalled || hidden.recalled, text: '', imageKey: null })
            : sanitize(frame.message);
          const existing = prev.messages.find((m) => m.id === incoming.id);
          if (existing?.recalled || existing?.deleted) return prev;
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
          return { ...prev, error: frame.message };
        case 'pong':
          return prev;
      }
    });
  }, [rememberHidden]);

  useEffect(() => {
    closedByUserRef.current = false;
    attemptRef.current = 0;
    hiddenRef.current.clear();
    pendingRef.current.clear();
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
  const recall = useCallback((messageId: number) => sendFrame({ type: 'recall', messageId }), [sendFrame]);
  const mute = useCallback((memberId: string, minutes: number) => sendFrame({ type: 'mute', memberId, minutes }), [sendFrame]);
  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return { ...state, send, loadOlder, markRead, remove, recall, mute, clearError };
}
