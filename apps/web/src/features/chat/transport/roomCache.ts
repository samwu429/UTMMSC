import { normalizeChatMessage, redactChatMessage, type FloorReason, type NormalizedChatMessage, type RoomMeta } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';

/** Rows kept per room, newest first. */
/** 每个房间保留的消息条数（取最新的）。 */
const SNAPSHOT_MESSAGES_MAX = 150;
/** Rooms kept in memory; the least recently stored one is dropped first. */
/** 内存中保留的房间数；最久未写入的先被丢弃。 */
const SNAPSHOT_ROOMS_MAX = 20;

export interface RoomSnapshot {
  messages: NormalizedChatMessage[];
  hasMore: boolean;
  visibleFromId: number;
  floorReason: FloorReason | null;
  reachedFloor: boolean;
  lastRev: number;
  /** False when lastRev cannot be used for a catch-up, for example after a session with an old server. */
  /** lastRev 不能用于补齐时为 false，例如与旧服务端的会话之后。 */
  revTrusted: boolean;
  meta: RoomMeta | null;
}

/**
 * In-memory snapshots so re-entering a room shows its messages at once and only catches up the gap.
 * Nothing is written to storage, and everything is dropped on sign-out.
 * 内存快照：再次进入房间时立即显示消息，只需补齐缺口。不写入任何存储，退出登录时全部清除。
 */
const snapshots = new Map<string, RoomSnapshot>();

export function getRoomSnapshot(roomId: string): RoomSnapshot | null {
  return snapshots.get(roomId) ?? null;
}

export function putRoomSnapshot(roomId: string, snapshot: RoomSnapshot): void {
  const trimmed = snapshot.messages.length > SNAPSHOT_MESSAGES_MAX;
  const messages = snapshot.messages
    .slice(-SNAPSHOT_MESSAGES_MAX)
    .filter((m) => m.id >= snapshot.visibleFromId)
    .map((m) => redactChatMessage(normalizeChatMessage(m)));
  snapshots.delete(roomId);
  snapshots.set(roomId, {
    ...snapshot,
    messages,
    hasMore: snapshot.hasMore || trimmed,
    reachedFloor: trimmed ? false : snapshot.reachedFloor,
  });
  while (snapshots.size > SNAPSHOT_ROOMS_MAX) {
    const oldest = snapshots.keys().next().value;
    if (oldest === undefined) break;
    snapshots.delete(oldest);
  }
}

export function dropRoomSnapshot(roomId: string): void {
  snapshots.delete(roomId);
}

useSessionStore.subscribe((state, prev) => {
  const signedOut = prev.token !== null && state.token === null;
  const switched = prev.member !== null && state.member !== null && prev.member.id !== state.member.id;
  if (signedOut || switched) snapshots.clear();
});
