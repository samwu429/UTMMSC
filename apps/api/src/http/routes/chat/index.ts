import { Hono } from 'hono';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  MESSAGE_TEXT_MAX,
  channelRoomId,
  directRoomId,
  parseRoomId,
  planTranslation,
  type ChannelSummary,
  type ChatOverviewResponse,
  type DirectConversationSummary,
  type RoomTicketResponse,
  type TranslateMessageResponse,
} from '@utmmsc/shared';
import { canPostInChannel, canReadChannel } from '../../../domain/authorization/channel-access';
import { signPayload, verifyPayload } from '../../../domain/crypto/hmac';
import { issueRoomTicket, readRoomTicket } from '../../../domain/identity/room-ticket';
import { findChannel, listChannels, listMembershipChannelIds } from '../../../infrastructure/d1/channels';
import { findDirect, listDirectForMember, openDirect } from '../../../infrastructure/d1/direct';
import { areFriends, listFriendIds } from '../../../infrastructure/d1/friends';
import { findMemberById, viewedRole, type MemberRow } from '../../../infrastructure/d1/members';
import { fetchMyMemoryTranslation, takeTranslateSlot } from '../../../domain/messaging/translate';
import { chatImageKey, getObject, putObject } from '../../../infrastructure/r2/objects';
import type { ChatRoom } from '../../../realtime/rooms/chat-room';
import type { Env } from '../../../env';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { badRequest, forbidden, notFound, serviceUnavailable, tooMany, unauthorized } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { readJson, requireString } from '../../validation';

export const chatRoutes = new Hono<AppEnv>();

const MEDIA_TOKEN_TTL_MS = 60 * 60 * 1000;

interface MediaClaims {
  kind: 'media';
  roomId: string;
  exp: number;
}

function roomStub(env: Env, roomId: string): DurableObjectStub<ChatRoom> {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(roomId)) as DurableObjectStub<ChatRoom>;
}

interface RoomGrant {
  roomId: string;
  canPost: boolean;
}

/** Resolves whether a member may enter a room and whether they may post there. */
/** 判断成员能否进入房间以及能否在其中发言。 */
async function resolveRoomAccess(env: Env, member: MemberRow, roomId: string): Promise<RoomGrant> {
  const parsed = parseRoomId(roomId);
  if (!parsed) throw notFound('房间不存在');
  const actor = { role: viewedRole(member), enrollmentStatus: member.enrollment_status };

  if (parsed.kind === 'channel') {
    const channel = await findChannel(env.DB, parsed.id);
    if (!channel) throw notFound('频道不存在');
    const memberships = await listMembershipChannelIds(env.DB, member.id);
    const access = { audience: channel.audience, postPolicy: channel.post_policy, isMember: memberships.has(channel.id) };
    if (!canReadChannel(access, actor)) throw forbidden('你不在这个频道里');
    return { roomId, canPost: canPostInChannel(access, actor) };
  }

  const conversation = await findDirect(env.DB, parsed.id);
  if (!conversation) throw notFound('会话不存在');
  if (conversation.member_low !== member.id && conversation.member_high !== member.id) throw forbidden('你不在这个会话里');
  const peerId = conversation.member_low === member.id ? conversation.member_high : conversation.member_low;
  if (!(await areFriends(env.DB, member.id, peerId))) throw forbidden('先加好友才能私聊');
  return { roomId, canPost: true };
}

/* Overview: channels and direct conversations with unread counts */

chatRoutes.get('/overview', requireSession, async (c) => {
  const member = c.get('member');
  const actor = { role: viewedRole(member), enrollmentStatus: member.enrollment_status };
  const [channels, memberships, direct, friendIds] = await Promise.all([
    listChannels(c.env.DB),
    listMembershipChannelIds(c.env.DB, member.id),
    listDirectForMember(c.env.DB, member.id),
    listFriendIds(c.env.DB, member.id),
  ]);
  const friends = new Set(friendIds);

  const visibleChannels = channels.filter((ch) =>
    canReadChannel({ audience: ch.audience, postPolicy: ch.post_policy, isMember: memberships.has(ch.id) }, actor),
  );

  const channelSummaries: ChannelSummary[] = await Promise.all(
    visibleChannels.map(async (ch) => ({
      id: ch.id,
      slug: ch.slug,
      name: ch.name,
      description: ch.description,
      audience: ch.audience,
      postPolicy: ch.post_policy,
      lastMessageAt: ch.last_message_at,
      unreadCount: ch.last_message_at ? await roomStub(c.env, channelRoomId(ch.id)).getUnread(member.id) : 0,
    })),
  );

  const directSummaries: DirectConversationSummary[] = await Promise.all(
    direct.filter((dm) => friends.has(dm.peer_id)).map(async (dm) => ({
      id: dm.id,
      peer: { id: dm.peer_id, displayName: dm.peer_name, enrollmentStatus: dm.peer_enrollment, graduationYear: dm.peer_graduation_year },
      lastMessageAt: dm.last_message_at,
      lastPreview: dm.last_preview,
      unreadCount: dm.last_message_at ? await roomStub(c.env, directRoomId(dm.id)).getUnread(member.id) : 0,
    })),
  );

  const response: ChatOverviewResponse = { channels: channelSummaries, direct: directSummaries };
  return c.json(response);
});

chatRoutes.post('/direct', requireSession, async (c) => {
  const member = c.get('member');
  const body = await readJson<Record<string, unknown>>(c);
  const peerId = requireString(body.memberId, '成员', 64);
  if (peerId === member.id) throw badRequest('self_direct', '不能和自己私聊');
  const peer = await findMemberById(c.env.DB, peerId);
  if (!peer || peer.status !== 'active') throw notFound('成员不存在');
  if (!(await areFriends(c.env.DB, member.id, peer.id))) throw forbidden('先加好友才能私聊');
  const conversation = await openDirect(c.env.DB, member.id, peer.id);
  return c.json({ conversationId: conversation.id });
});

/* Short zh/en translation. The worker calls MyMemory; message text is not logged. */
/* 中英短翻译。由 Worker 调用 MyMemory，不记录消息正文。 */

chatRoutes.post('/translate', rateLimit(15, 60_000), requireSession, async (c) => {
  if (!takeTranslateSlot(Date.now())) throw tooMany();
  const body = await readJson<Record<string, unknown>>(c);
  const text = requireString(body.text, '文本', MESSAGE_TEXT_MAX);
  const plan = planTranslation(text);
  if (!plan.ok) {
    if (plan.error === 'too_long') throw badRequest('text_too_long', '这段内容较长，暂时只能翻译较短的文字');
    throw badRequest('missing_field', '缺少 文本');
  }
  const translated = await fetchMyMemoryTranslation(plan.text, plan.pair);
  if (!translated) throw serviceUnavailable('translate_unavailable', '翻译服务暂时不可用，请稍后再试');
  const response: TranslateMessageResponse = { text: translated, sourceLang: plan.source, targetLang: plan.target };
  return c.json(response);
});

/* Tickets and sockets */

chatRoutes.post('/rooms/:roomId/ticket', requireSession, async (c) => {
  const member = c.get('member');
  const roomId = c.req.param('roomId');
  const grant = await resolveRoomAccess(c.env, member, roomId);
  const ticket = await issueRoomTicket(c.env.SESSION_SECRET, {
    roomId,
    memberId: member.id,
    displayName: member.display_name,
    role: viewedRole(member),
    canPost: grant.canPost,
    avatarKey: member.avatar_key,
  });
  const mediaToken = await signPayload(c.env.SESSION_SECRET, {
    kind: 'media',
    roomId,
    exp: Date.now() + MEDIA_TOKEN_TTL_MS,
  } satisfies MediaClaims);
  const origin = new URL(c.req.url).origin.replace(/^http/, 'ws');
  const response: RoomTicketResponse & { mediaToken: string } = {
    ticket,
    roomId,
    socketUrl: `${origin}/chat/rooms/${encodeURIComponent(roomId)}/socket?ticket=${encodeURIComponent(ticket)}`,
    mediaToken,
    canPost: grant.canPost,
  };
  return c.json(response);
});

chatRoutes.get('/rooms/:roomId/socket', async (c) => {
  if (c.req.header('upgrade') !== 'websocket') throw badRequest('expected_websocket', '需要 WebSocket');
  const roomId = c.req.param('roomId');
  const ticket = c.req.query('ticket') ?? '';
  const claims = await readRoomTicket(c.env.SESSION_SECRET, ticket);
  if (!claims || claims.roomId !== roomId) throw unauthorized('票据无效或已过期');

  const headers = new Headers(c.req.raw.headers);
  headers.set('x-room-id', roomId);
  headers.set(
    'x-room-identity',
    JSON.stringify({
      memberId: claims.memberId,
      displayName: claims.displayName,
      role: claims.role,
      canPost: claims.canPost,
      avatarKey: typeof claims.avatarKey === 'string' ? claims.avatarKey : null,
    }),
  );
  return roomStub(c.env, roomId).fetch(new Request(c.req.raw.url, { headers }));
});

/* Chat images */

chatRoutes.post('/rooms/:roomId/images', requireSession, async (c) => {
  const member = c.get('member');
  const roomId = c.req.param('roomId');
  const grant = await resolveRoomAccess(c.env, member, roomId);
  if (!grant.canPost) throw forbidden('此频道不允许你发言');
  const contentType = c.req.header('content-type') ?? '';
  if (!(CHAT_IMAGE_TYPES as readonly string[]).includes(contentType)) throw badRequest('unsupported_type', '只支持 JPEG、PNG、WebP、GIF');
  const length = Number(c.req.header('content-length') ?? '0');
  if (!length || length > CHAT_IMAGE_MAX_BYTES) throw badRequest('too_large', '图片不能超过 8MB');
  const bucket = requireBucket(c.env);
  const key = chatImageKey(roomId, contentType);
  await putObject(bucket, key, await c.req.arrayBuffer(), contentType);
  return c.json({ imageKey: key }, 201);
});

chatRoutes.get('/media/*', async (c) => {
  const token = c.req.query('t') ?? '';
  const claims = await verifyPayload<MediaClaims>(c.env.SESSION_SECRET, token);
  if (!claims || claims.kind !== 'media' || claims.exp <= Date.now()) throw unauthorized('媒体链接已过期');
  const key = decodeURIComponent(c.req.path.replace(/^\/chat\/media\//, ''));
  if (!key.startsWith(`chat/${claims.roomId.replace(':', '/')}/`)) throw forbidden();
  const object = await getObject(requireBucket(c.env), key);
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    },
  });
});
