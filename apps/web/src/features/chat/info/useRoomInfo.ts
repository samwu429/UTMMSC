import { useCallback, useEffect, useState } from 'react';
import type { RoomMeta } from '@utmmsc/shared';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { chatApi } from '../api';
import { getRoomSnapshot } from '../transport/roomCache';

/**
 * Room info already fetched in this session, so returning to the page renders at once while it refreshes.
 * Cleared when the member signs out or another member signs in.
 * 本次会话中已获取的房间信息，再次进入时可立即显示并在后台刷新。成员退出或换了一个成员登录时清空。
 */
const infoCache = new Map<string, RoomMeta>();

useSessionStore.subscribe((state, prev) => {
  const signedOut = prev.token !== null && state.token === null;
  const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
  if (signedOut || switched) infoCache.clear();
});

export interface RoomInfoState {
  info: RoomMeta | null;
  error: string | null;
  /** True when the member can no longer read the room (403 or 404). */
  /** 成员已无法阅读该房间时为 true（403 或 404）。 */
  fatal: boolean;
  loading: boolean;
}

/**
 * Chat info for one room: starts from the cached copy, or the header data the room screen kept, and then
 * fetches GET /chat/rooms/:roomId/info. `update` patches the cached copy after a local change.
 * 单个房间的聊天信息：先显示缓存，或房间页保存的头部信息，再请求 GET /chat/rooms/:roomId/info。
 * `update` 在本地改动后修补缓存副本。
 */
export function useRoomInfo(roomId: string): RoomInfoState & { reload: () => void; update: (patch: Partial<RoomMeta>) => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<RoomInfoState>(() => ({
    info: infoCache.get(roomId) ?? getRoomSnapshot(roomId)?.meta ?? null,
    error: null,
    fatal: false,
    loading: true,
  }));

  useEffect(() => {
    let cancelled = false;
    chatApi.info(roomId).then(
      (info) => {
        infoCache.set(roomId, info);
        if (!cancelled) setState({ info, error: null, fatal: false, loading: false });
      },
      (error: unknown) => {
        const status = error instanceof ApiClientError ? error.status : 0;
        const fatal = status === 403 || status === 404;
        if (fatal) infoCache.delete(roomId);
        if (!cancelled) setState((current) => ({ info: fatal ? null : current.info, error: errorMessage(error), fatal, loading: false }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [roomId, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ ...current, error: null, loading: true }));
    setAttempt((n) => n + 1);
  }, []);

  const update = useCallback(
    (patch: Partial<RoomMeta>) => {
      setState((current) => {
        if (!current.info) return current;
        const info = { ...current.info, ...patch };
        infoCache.set(roomId, info);
        return { ...current, info };
      });
    },
    [roomId],
  );

  return { ...state, reload, update };
}
