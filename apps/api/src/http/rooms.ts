import { channelRoomId, directRoomId, type ChatAuthor } from '@utmmsc/shared';
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

/** Every room a member can have written in: all channels plus their direct conversations. */
/** 某成员可能发过言的所有房间：全部频道及其私聊。 */
async function roomsOfMember(env: Env, memberId: string): Promise<string[]> {
  const [channels, direct] = await Promise.all([listChannels(env.DB), listDirectForMember(env.DB, memberId)]);
  return [...channels.map((ch) => channelRoomId(ch.id)), ...direct.map((dm) => directRoomId(dm.id))];
}

/** Closes one member's sockets in every channel and in their direct conversations. */
/** 关闭某个成员在所有频道及其私聊中的连接。 */
export async function revokeMemberEverywhere(env: Env, memberId: string): Promise<void> {
  const rooms = await roomsOfMember(env, memberId);
  await Promise.allSettled(rooms.map((roomId) => revokeRoom(env, roomId, memberId)));
}

/** Pushes a member's new name or avatar to every room they can have written in. */
/** 把成员的新名字或头像推送到其可能发过言的每个房间。 */
export async function announceAuthor(env: Env, author: ChatAuthor): Promise<void> {
  const rooms = await roomsOfMember(env, author.id);
  await Promise.allSettled(rooms.map((roomId) => roomStub(env, roomId).refreshAuthor(author)));
}
