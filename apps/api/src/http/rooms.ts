import { channelRoomId, directRoomId } from '@utmmsc/shared';
import type { Env } from '../env';
import { listChannels } from '../infrastructure/d1/channels';
import { listDirectForMember } from '../infrastructure/d1/direct';
import type { ChatRoom } from '../realtime/rooms/chat-room';

export function roomStub(env: Env, roomId: string): DurableObjectStub<ChatRoom> {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(roomId)) as DurableObjectStub<ChatRoom>;
}

/**
 * Open sockets carry the identity from when they connected. After a change to who may read or post
 * in a room, close the affected sockets so the client fetches a new ticket and access is re-checked.
 * 已打开的连接带着连接时的身份。房间的阅读或发言权限变化后，关闭受影响的连接，客户端重新领取票据时会重新校验权限。
 */
export async function revokeRoom(env: Env, roomId: string, memberId?: string): Promise<void> {
  await roomStub(env, roomId).revoke(memberId);
}

/** Closes one member's sockets in every channel and in their direct conversations. */
/** 关闭某个成员在所有频道及其私聊中的连接。 */
export async function revokeMemberEverywhere(env: Env, memberId: string): Promise<void> {
  const [channels, direct] = await Promise.all([listChannels(env.DB), listDirectForMember(env.DB, memberId)]);
  const rooms = [...channels.map((ch) => channelRoomId(ch.id)), ...direct.map((dm) => directRoomId(dm.id))];
  await Promise.allSettled(rooms.map((roomId) => revokeRoom(env, roomId, memberId)));
}
