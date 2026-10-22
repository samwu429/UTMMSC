import { channelRoomId, directRoomId, type ChatAuthor, type RoomAccess, type RoomMemberSummary, type SystemMemberRef } from '@utmmsc/shared';
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

/** Unread count, mentions and newest visible row for one member, under that member's history floor. */
/** 某成员在其历史下限之内的未读数、@ 和最新可见的一行。 */
export async function summaryForRoom(env: Env, roomId: string, memberId: string, access: RoomAccess): Promise<RoomMemberSummary> {
  return roomStub(env, roomId).summaryFor({ memberId, access });
}

export async function markRoomRead(env: Env, roomId: string, memberId: string): Promise<void> {
  await roomStub(env, roomId).markAllRead(memberId);
}

/** Clears the room for this member only and returns the first id they can still see. */
/** 只为该成员清空房间，返回其仍能看到的第一个 id。 */
export async function clearRoomFor(env: Env, roomId: string, memberId: string): Promise<number> {
  return roomStub(env, roomId).clearFor(memberId);
}

/**
 * Writes the join notice for members an admin just added. Call it after the membership rows are
 * written and pass that moment as `at`, so the notice sits at each new member's history floor.
 * 为管理员刚添加的成员写入入群提示。应在写入成员记录之后调用，并把该时刻作为 `at` 传入，使提示正好位于每位新成员的历史下限处。
 */
export async function recordRoomJoins(
  env: Env,
  roomId: string,
  input: { actor: SystemMemberRef | null; members: SystemMemberRef[]; at: string },
): Promise<void> {
  if (input.members.length === 0) return;
  await roomStub(env, roomId).recordJoins({ ...input, roomId });
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
