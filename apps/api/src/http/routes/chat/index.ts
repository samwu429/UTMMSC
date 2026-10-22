import { Hono } from 'hono';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  DISPLAY_NAME_MAX,
  MESSAGE_TEXT_MAX,
  channelRoomId,
  directRoomId,
  hasPermission,
  parseRoomId,
  planTranslation,
  type ChannelSummary,
  type ChatOverviewResponse,
  type ChatPrefsResponse,
  type ClearChatHistoryResponse,
  type DirectConversationSummary,
  type RoomAccess,
  type RoomMembersResponse,
  type RoomMeta,
  type RoomTicketResponse,
  type TranslateMessageResponse,
  type UpdateChatPrefsBody,
} from '@utmmsc/shared';
import { canPostInChannel, canReadChannel } from '../../../domain/authorization/channel-access';
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../../../domain/crypto/encoding';
import { signPayload, verifyPayload } from '../../../domain/crypto/hmac';
import { issueRoomTicket, readRoomTicket } from '../../../domain/identity/room-ticket';
import { OPEN_ACCESS, listActivityAt, roomAccess } from '../../../domain/messaging/visibility';
import { listImplicitJoins } from '../../../infrastructure/d1/channel-joins';
import { findChannel, listChannels, listMembershipJoins, type ChannelRow } from '../../../infrastructure/d1/channels';
import { DEFAULT_CHAT_PREFS, clearMarkedUnread, findPrefs, listPrefs, upsertPrefs } from '../../../infrastructure/d1/chat-prefs';
import { findDirect, listDirectForMember, openDirect, type DirectRow } from '../../../infrastructure/d1/direct';
import { areFriends, listFriendIds } from '../../../infrastructure/d1/friends';
import { findMemberById, viewedRole, type MemberRow } from '../../../infrastructure/d1/members';
import { ROOM_MEMBERS_PAGE_MAX, countRoomMembers, listRoomMembers, type RoomRef } from '../../../infrastructure/d1/room-members';
import { fetchTranslation, takeTranslateSlot } from '../../../domain/messaging/translate';
import { chatImageKey, getObject, putObject } from '../../../infrastructure/r2/objects';
import type { Env } from '../../../env';
import { requireBucket } from '../../bindings';
import { clearRoomFor, markRoomRead, roomStub, summaryForRoom } from '../../rooms';
import type { AppEnv } from '../../context';
import { badRequest, forbidden, notFound, serviceUnavailable, tooMany, unauthorized } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { decodeKeyPath, readJson, requireString } from '../../validation';

export const chatRoutes = new Hono<AppEnv>();

const MEDIA_TOKEN_TTL_MS = 60 * 60 * 1000;
const MEMBERS_PAGE_DEFAULT = 30;

interface MediaClaims {
  kind: 'media';
  roomId: string;
  exp: number;
}

/** Everything resolveRoomAccess read, so routes can describe the room without querying again. */
/** resolveRoomAccess 读到的全部内容，路由据此描述房间而无需再次查询。 */
interface RoomGrant {
  roomId: string;
  kind: 'channel' | 'direct';
  canPost: boolean;
  access: RoomAccess;
  channel: ChannelRow | null;
  conversation: DirectRow | null;
  peer: MemberRow | null;
}

/** History floor for one member in one channel, from the rows the caller already loaded. */
/** 根据调用方已读取的数据，计算某成员在某频道的历史下限。 */
function channelAccess(channel: ChannelRow, member: MemberRow, membershipJoinedAt: string | null | undefined, implicitJoinedAt: string | undefined): RoomAccess {
  return roomAccess({
    kind: 'channel',
    audience: channel.audience,
    historyVisibility: channel.history_visibility,
    floorSince: channel.history_floor_since,
    channelCreatedAt: channel.created_at,
    membershipJoinedAt,
    implicitJoinedAt,
    memberCreatedAt: member.created_at,
    // The viewed role decides, so a system admin testing as a student gets the student view.
    // 以当前视角的身份为准，系统管理员以在校生身份测试时看到的就是在校生的视图。
    canManage: hasPermission(viewedRole(member), 'channels.manage'),
  });
}

/** Resolves whether a member may enter a room, whether they may post there, and their history floor. */
/** 判断成员能否进入房间、能否在其中发言，以及其历史下限。 */
async function resolveRoomAccess(env: Env, member: MemberRow, roomId: string): Promise<RoomGrant> {
  const parsed = parseRoomId(roomId);
  if (!parsed) throw notFound('房间不存在');
  const actor = { role: viewedRole(member), enrollmentStatus: member.enrollment_status };

  if (parsed.kind === 'channel') {
    const channel = await findChannel(env.DB, parsed.id);
    if (!channel) throw notFound('频道不存在');
    const [memberships, implicitJoins] = await Promise.all([
      listMembershipJoins(env.DB, member.id),
      channel.audience === 'custom' ? Promise.resolve(new Map<string, string>()) : listImplicitJoins(env.DB, member.id),
    ]);
    const input = { audience: channel.audience, postPolicy: channel.post_policy, isMember: memberships.has(channel.id) };
    if (!canReadChannel(input, actor)) throw forbidden('你不在这个频道里');
    return {
      roomId,
      kind: 'channel',
      canPost: canPostInChannel(input, actor),
      access: channelAccess(channel, member, memberships.get(channel.id), implicitJoins.get(channel.id)),
      channel,
      conversation: null,
      peer: null,
    };
  }

  const conversation = await findDirect(env.DB, parsed.id);
  if (!conversation) throw notFound('会话不存在');
  if (conversation.member_low !== member.id && conversation.member_high !== member.id) throw forbidden('你不在这个会话里');
  const peerId = conversation.member_low === member.id ? conversation.member_high : conversation.member_low;
  const [friends, peer] = await Promise.all([areFriends(env.DB, member.id, peerId), findMemberById(env.DB, peerId)]);
  if (!friends) throw forbidden('先加好友才能私聊');
  // Direct conversations never have a floor.
  // 私聊永远没有历史下限。
  return { roomId, kind: 'direct', canPost: true, access: OPEN_ACCESS, channel: null, conversation, peer };
}

function roomRefOf(grant: RoomGrant): RoomRef {
  if (grant.channel) return { kind: 'channel', channelId: grant.channel.id, audience: grant.channel.audience };
  const conversation = grant.conversation as DirectRow;
  return { kind: 'direct', memberIds: [conversation.member_low, conversation.member_high] };
}

/** Shared by the ticket's ?meta=1 and GET /info, so the room header and the info page always agree. */
/** 票据的 ?meta=1 与 GET /info 共用，房间标题栏与信息页始终一致。 */
async function buildRoomMeta(env: Env, member: MemberRow, grant: RoomGrant): Promise<RoomMeta> {
  const role = viewedRole(member);
  const [memberCount, prefs] = await Promise.all([countRoomMembers(env.DB, roomRefOf(grant)), findPrefs(env.DB, member.id, grant.roomId)]);
  const base = {
    roomId: grant.roomId,
    kind: grant.kind,
    memberCount,
    canPost: grant.canPost,
    canModerate: hasPermission(role, 'chat.moderate'),
    canManage: hasPermission(role, 'channels.manage'),
    prefs,
  };
  if (grant.channel) {
    const meta: RoomMeta = {
      ...base,
      title: grant.channel.name,
      description: grant.channel.description,
      audience: grant.channel.audience,
      postPolicy: grant.channel.post_policy,
    };
    if (grant.channel.history_visibility) meta.historyVisibility = grant.channel.history_visibility;
    return meta;
  }
  const meta: RoomMeta = { ...base, title: grant.peer?.display_name ?? '', description: null };
  if (grant.peer) meta.peer = { id: grant.peer.id, displayName: grant.peer.display_name, avatarKey: grant.peer.avatar_key ?? null };
  return meta;
}

function encodeCursor(name: string, id: string): string {
  return bytesToBase64Url(utf8ToBytes(JSON.stringify([name, id])));
}

function decodeCursor(cursor: string | undefined): { name: string; id: string } | null {
  if (!cursor) return null;
  const bytes = base64UrlToBytes(cursor);
  if (!bytes) return null;
  try {
    const [name, id] = JSON.parse(bytesToUtf8(bytes)) as [unknown, unknown];
    return typeof name === 'string' && typeof id === 'string' ? { name, id } : null;
  } catch {
    return null;
  }
}

/* Overview: channels and direct conversations with unread counts */

chatRoutes.get('/overview', requireSession, async (c) => {
  const member = c.get('member');
  const actor = { role: viewedRole(member), enrollmentStatus: member.enrollment_status };
  const [channels, memberships, implicitJoins, direct, friendIds, prefs] = await Promise.all([
    listChannels(c.env.DB),
    listMembershipJoins(c.env.DB, member.id),
    listImplicitJoins(c.env.DB, member.id),
    listDirectForMember(c.env.DB, member.id),
    listFriendIds(c.env.DB, member.id),
    listPrefs(c.env.DB, member.id),
  ]);
  const friends = new Set(friendIds);

  const visibleChannels = channels.filter((ch) =>
    canReadChannel({ audience: ch.audience, postPolicy: ch.post_policy, isMember: memberships.has(ch.id) }, actor),
  );

  const channelSummaries: ChannelSummary[] = await Promise.all(
    visibleChannels.map(async (ch) => {
      const roomId = channelRoomId(ch.id);
      const access = channelAccess(ch, member, memberships.get(ch.id), implicitJoins.get(ch.id));
      const summary = ch.last_message_at ? await summaryForRoom(c.env, roomId, member.id, access) : null;
      const row: ChannelSummary = {
        id: ch.id,
        slug: ch.slug,
        name: ch.name,
        description: ch.description,
        audience: ch.audience,
        postPolicy: ch.post_policy,
        lastMessageAt: listActivityAt(access, ch.last_message_at, summary?.lastMessage?.at),
        unreadCount: summary?.unreadCount ?? 0,
        lastMessage: summary?.lastMessage ?? null,
        joinedAt: access.joinedAt,
        mentionedMe: summary ? summary.firstMentionId !== null : false,
        prefs: prefs.get(roomId) ?? { ...DEFAULT_CHAT_PREFS },
      };
      if (ch.history_visibility) row.historyVisibility = ch.history_visibility;
      return row;
    }),
  );

  const directSummaries: DirectConversationSummary[] = await Promise.all(
    direct.filter((dm) => friends.has(dm.peer_id)).map(async (dm) => {
      const roomId = directRoomId(dm.id);
      const summary = dm.last_message_at ? await summaryForRoom(c.env, roomId, member.id, OPEN_ACCESS) : null;
      return {
        id: dm.id,
        peer: {
          id: dm.peer_id,
          displayName: dm.peer_name,
          role: dm.peer_role,
          enrollmentStatus: dm.peer_enrollment,
          graduationYear: dm.peer_graduation_year,
          avatarKey: dm.peer_avatar_key ?? null,
        },
        lastMessageAt: dm.last_message_at,
        // The stored preview is shared by both members; once nothing is visible to this one, for example after
        // they cleared the chat, old clients must not keep showing it.
        // 保存的预览由双方共用；当此成员已看不到任何消息时（例如清空聊天记录之后），旧客户端不能继续显示它。
        lastPreview: summary && summary.lastMessage === null ? null : dm.last_preview,
        unreadCount: summary?.unreadCount ?? 0,
        lastMessage: summary?.lastMessage ?? null,
        mentionedMe: false,
        prefs: prefs.get(roomId) ?? { ...DEFAULT_CHAT_PREFS },
      };
    }),
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
  const translated = await fetchTranslation(plan.text, plan.source, plan.target);
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
    access: grant.access,
  });
  const mediaToken = await signPayload(c.env.SESSION_SECRET, {
    kind: 'media',
    roomId,
    exp: Date.now() + MEDIA_TOKEN_TTL_MS,
  } satisfies MediaClaims);
  const origin = new URL(c.req.url).origin.replace(/^http/, 'ws');
  const response: RoomTicketResponse = {
    ticket,
    roomId,
    socketUrl: `${origin}/chat/rooms/${encodeURIComponent(roomId)}/socket?ticket=${encodeURIComponent(ticket)}`,
    mediaToken,
    canPost: grant.canPost,
  };
  // Only the first ticket of a screen asks for meta; reconnects and media refreshes skip the extra queries.
  // 只有进入页面时的第一张票据会请求 meta；重连和媒体令牌刷新不做这些额外查询。
  if (c.req.query('meta') === '1') response.room = await buildRoomMeta(c.env, member, grant);
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
  headers.set('x-room-ticket-id', claims.jti);
  headers.set('x-room-ticket-exp', String(claims.exp));
  headers.set(
    'x-room-identity',
    JSON.stringify({
      memberId: claims.memberId,
      displayName: claims.displayName,
      role: claims.role,
      canPost: claims.canPost,
      avatarKey: typeof claims.avatarKey === 'string' ? claims.avatarKey : null,
      access: claims.access,
    }),
  );
  return roomStub(c.env, roomId).fetch(new Request(c.req.raw.url, { headers }));
});

/* Room info, members and per-member settings. Every route re-checks access; non-readers get 403. */
/* 房间信息、成员和个人设置。每个路由都会重新校验权限；无权阅读的人得到 403。 */

chatRoutes.get('/rooms/:roomId/info', rateLimit(60, 60_000), requireSession, async (c) => {
  const member = c.get('member');
  const grant = await resolveRoomAccess(c.env, member, c.req.param('roomId'));
  return c.json(await buildRoomMeta(c.env, member, grant));
});

chatRoutes.get('/rooms/:roomId/members', rateLimit(30, 60_000), requireSession, async (c) => {
  const member = c.get('member');
  const grant = await resolveRoomAccess(c.env, member, c.req.param('roomId'));
  const q = (c.req.query('q') ?? '').trim().slice(0, DISPLAY_NAME_MAX) || null;
  const limitRaw = Number(c.req.query('limit') ?? MEMBERS_PAGE_DEFAULT);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, ROOM_MEMBERS_PAGE_MAX) : MEMBERS_PAGE_DEFAULT;
  const room = roomRefOf(grant);
  const [page, total] = await Promise.all([
    listRoomMembers(c.env.DB, room, { q, after: decodeCursor(c.req.query('after')), limit }),
    countRoomMembers(c.env.DB, room, q),
  ]);
  const response: RoomMembersResponse = {
    members: page.members.map((row) => ({ id: row.id, displayName: row.display_name, avatarKey: row.avatar_key ?? null, role: row.role })),
    total,
    next: page.next ? encodeCursor(page.next.name, page.next.id) : null,
  };
  return c.json(response);
});

const PREF_FIELDS: Record<keyof UpdateChatPrefsBody, string> = {
  pinned: '置顶',
  muted: '免打扰',
  markedUnread: '未读标记',
  hidden: '隐藏',
};

chatRoutes.patch('/rooms/:roomId/prefs', rateLimit(60, 60_000), requireSession, async (c) => {
  const member = c.get('member');
  const grant = await resolveRoomAccess(c.env, member, c.req.param('roomId'));
  const body = await readJson<Record<string, unknown>>(c);
  const patch: UpdateChatPrefsBody = {};
  for (const key of Object.keys(PREF_FIELDS) as (keyof UpdateChatPrefsBody)[]) {
    const value = body[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw badRequest('invalid_field', `${PREF_FIELDS[key]} 格式错误`);
    patch[key] = value;
  }
  const response: ChatPrefsResponse = { prefs: await upsertPrefs(c.env.DB, member.id, grant.roomId, patch) };
  return c.json(response);
});

chatRoutes.post('/rooms/:roomId/read', rateLimit(60, 60_000), requireSession, async (c) => {
  const member = c.get('member');
  const grant = await resolveRoomAccess(c.env, member, c.req.param('roomId'));
  await Promise.all([markRoomRead(c.env, grant.roomId, member.id), clearMarkedUnread(c.env.DB, member.id, grant.roomId)]);
  return c.json({ ok: true });
});

/** Clear chat history for the caller only, on all of their devices; nothing changes for anyone else. */
/** 清空聊天记录：只对调用者生效，覆盖其所有设备；其他人的记录不受影响。 */
chatRoutes.post('/rooms/:roomId/clear', rateLimit(10, 60_000), requireSession, async (c) => {
  const member = c.get('member');
  const grant = await resolveRoomAccess(c.env, member, c.req.param('roomId'));
  const beforeId = await clearRoomFor(c.env, grant.roomId, member.id);
  await clearMarkedUnread(c.env.DB, member.id, grant.roomId);
  const response: ClearChatHistoryResponse = { ok: true, beforeId };
  return c.json(response);
});

/* Chat images */

chatRoutes.post('/rooms/:roomId/images', rateLimit(20, 60_000), requireSession, async (c) => {
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
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > CHAT_IMAGE_MAX_BYTES) throw badRequest('too_large', '图片不能超过 8MB');
  await putObject(bucket, key, bytes, contentType);
  return c.json({ imageKey: key }, 201);
});

chatRoutes.get('/media/*', async (c) => {
  const token = c.req.query('t') ?? '';
  const claims = await verifyPayload<MediaClaims>(c.env.SESSION_SECRET, token);
  if (!claims || claims.kind !== 'media' || claims.exp <= Date.now()) throw unauthorized('媒体链接已过期');
  const key = decodeKeyPath(c.req.path.replace(/^\/chat\/media\//, ''));
  if (!key.startsWith(`chat/${claims.roomId.replace(':', '/')}/`)) throw forbidden();
  const object = await getObject(requireBucket(c.env), key);
  if (!object) throw notFound();
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
});
