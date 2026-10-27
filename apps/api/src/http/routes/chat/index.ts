import { Hono, type Context } from 'hono';
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  DISPLAY_NAME_MAX,
  MESSAGE_TEXT_MAX,
  ROLES,
  canModerateRoom,
  channelRoomId,
  directRoomId,
  hasPermission,
  parseRoomId,
  planTranslation,
  roleTier,
  stickerKeyForAlias,
  type ChannelSummary,
  type ChatOverviewResponse,
  type ChatPrefs,
  type ChatPrefsResponse,
  type ClearChatHistoryResponse,
  type DirectConversationSummary,
  type Role,
  type RoomAccess,
  type RoomMembersResponse,
  type RoomMeta,
  type RoomTicketResponse,
  type TranslateMessageResponse,
  type UpdateChatPrefsBody,
} from '@utmmsc/shared';
import { canPostInChannel, canReadChannel } from '../../../domain/authorization/channel-access';
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../../../domain/crypto/encoding';
import { issueRoomTicket, readRoomTicket } from '../../../domain/identity/room-ticket';
import { OPEN_ACCESS, listActivityAt, roomAccess } from '../../../domain/messaging/visibility';
import { channelIconKeyOf } from '../../../domain/notifications/icon';
import { issueChatMediaToken, readChatMediaToken } from '../../../domain/profile/media-token';
import { listImplicitJoins } from '../../../infrastructure/d1/channel-joins';
import { findChannel, listChannels, listMembershipJoins, type ChannelRow } from '../../../infrastructure/d1/channels';
import { DEFAULT_CHAT_PREFS, clearMarkedUnread, findPrefs, listPrefs, upsertPrefs } from '../../../infrastructure/d1/chat-prefs';
import { findDirect, listDirectForMember, openDirect, type DirectRow } from '../../../infrastructure/d1/direct';
import { areFriends, listFriendIds } from '../../../infrastructure/d1/friends';
import { findMemberById, listMemberIdsWithRoles, viewedActor, viewedRole, type MemberRow } from '../../../infrastructure/d1/members';
import { ROOM_MEMBERS_PAGE_MAX, countRoomMembers, listRoomMembers, type RoomRef } from '../../../infrastructure/d1/room-members';
import { fetchTranslation, takeTranslateSlot } from '../../../domain/messaging/translate';
import { chatImageKey, isRoomImageKey, mediaObjectResponse, putObject } from '../../../infrastructure/r2/objects';
import type { Env } from '../../../env';
import { requireBucket } from '../../bindings';
import { clearRoomFor, markRoomRead, roomStub, summaryForRoom } from '../../rooms';
import type { AppEnv } from '../../context';
import { badRequest, forbidden, notFound, serviceUnavailable, tooMany, unauthorized } from '../../errors';
import { memberRateLimit, rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { decodeKeyPath, readJson, requireString } from '../../validation';

export const chatRoutes = new Hono<AppEnv>();

const MEMBERS_PAGE_DEFAULT = 30;

/**
 * Starts a read now so it runs beside others, and is awaited later. A failure nobody ends up waiting for, because
 * access was refused first, is not reported as an unhandled rejection; whoever awaits it still sees the error.
 * 现在就开始一次读取，使它与其他读取并行，稍后再等待结果。若因权限先被拒绝而没有人等待它，它的失败不会被报告为未处理的拒绝；
 * 等待它的一方仍会看到错误。
 */
function early<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
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

/**
 * Resolves whether a member may enter a room, whether they may post there, and their history floor. The channel,
 * the member's memberships and their implicit joins are read together, so a channel costs one round trip.
 * `onRoom` hears which members the room has as soon as the room row is in and the member is not already refused,
 * so a caller can start its own reads (the member count) beside the checks that remain.
 * 判断成员能否进入房间、能否在其中发言，以及其历史下限。频道、成员的频道成员记录和隐式加入记录一起读取，频道因此只需一次往返。
 * 一旦读到房间记录且成员没有被直接拒绝，`onRoom` 就会得知房间的成员范围，调用方可以在剩余检查进行的同时开始自己的读取（成员数）。
 */
async function resolveRoomAccess(env: Env, member: MemberRow, roomId: string, onRoom?: (room: RoomRef) => void): Promise<RoomGrant> {
  const parsed = parseRoomId(roomId);
  if (!parsed) throw notFound('房间不存在');
  const actor = viewedActor(member);

  if (parsed.kind === 'channel') {
    const [channel, memberships, implicitJoins] = await Promise.all([
      findChannel(env.DB, parsed.id),
      listMembershipJoins(env.DB, member.id),
      listImplicitJoins(env.DB, member.id),
    ]);
    if (!channel) throw notFound('频道不存在');
    const input = { audience: channel.audience, postPolicy: channel.post_policy, isMember: memberships.has(channel.id) };
    if (!canReadChannel(input, actor)) throw forbidden('你不在这个频道里');
    onRoom?.({ kind: 'channel', channelId: channel.id, audience: channel.audience });
    // Implicit joins describe audience channels only; a custom channel's floor comes from its membership rows.
    // 隐式加入只针对按身份开放的频道；指定成员频道的下限来自其成员记录。
    const implicitJoinedAt = channel.audience === 'custom' ? undefined : implicitJoins.get(channel.id);
    return {
      roomId,
      kind: 'channel',
      canPost: canPostInChannel(input, actor),
      access: channelAccess(channel, member, memberships.get(channel.id), implicitJoinedAt),
      channel,
      conversation: null,
      peer: null,
    };
  }

  const conversation = await findDirect(env.DB, parsed.id);
  if (!conversation) throw notFound('会话不存在');
  if (conversation.member_low !== member.id && conversation.member_high !== member.id) throw forbidden('你不在这个会话里');
  onRoom?.({ kind: 'direct', memberIds: [conversation.member_low, conversation.member_high] });
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

/**
 * Access and the room meta together, for the ticket's ?meta=1 and GET /info, so the room header and the info page
 * always agree. Every read starts as soon as what it needs is known: the viewer's prefs and the moderation-exempt
 * list beside the access reads, the member count as soon as the room row is in. A room then costs two round trips
 * after the session check instead of three.
 * 同时得到权限和房间信息，供票据的 ?meta=1 与 GET /info 使用，房间标题栏与信息页始终一致。每次读取在所需信息就绪后立即开始：
 * 观看者的个人设置和免于管理的名单与权限读取并行，成员数在读到房间记录后立即开始。房间因此在会话检查之后只需两次往返，而不是三次。
 */
async function resolveRoomWithMeta(env: Env, member: MemberRow, roomId: string): Promise<{ grant: RoomGrant; meta: RoomMeta }> {
  const parsed = parseRoomId(roomId);
  if (!parsed) throw notFound('房间不存在');
  const role = viewedRole(member);
  const canModerate = canModerateRoom(parsed.kind, role);
  // Everyone at or above the viewer's tier, so the message menu leaves out what the room would refuse.
  // 档位不低于观看者的所有成员，消息菜单据此省略房间会拒绝的操作。
  const exemptRoles = canModerate && role !== 'superadmin' ? ROLES.filter((r) => roleTier(r) >= roleTier(role)) : [];
  const prefs = early(findPrefs(env.DB, member.id, roomId));
  const exempt = early(listMemberIdsWithRoles(env.DB, exemptRoles));
  const counting: { promise?: Promise<number> } = {};
  const grant = await resolveRoomAccess(env, member, roomId, (room) => {
    counting.promise = early(countRoomMembers(env.DB, room));
  });
  const [memberCount, prefsValue, exemptValue] = await Promise.all([counting.promise ?? countRoomMembers(env.DB, roomRefOf(grant)), prefs, exempt]);
  return { grant, meta: buildRoomMeta(grant, role, canModerate, { memberCount, prefs: prefsValue, exempt: exemptValue }) };
}

/** Assembles the room meta from what resolveRoomWithMeta read. */
/** 用 resolveRoomWithMeta 读到的内容组装房间信息。 */
function buildRoomMeta(
  grant: RoomGrant,
  role: Role,
  canModerate: boolean,
  read: { memberCount: number; prefs: ChatPrefs; exempt: string[] },
): RoomMeta {
  const { memberCount, prefs, exempt } = read;
  const base = {
    roomId: grant.roomId,
    kind: grant.kind,
    memberCount,
    canPost: grant.canPost,
    canModerate,
    ...(exempt.length > 0 ? { moderationExempt: exempt } : {}),
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
      iconKey: channelIconKeyOf(grant.channel),
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
  const actor = viewedActor(member);
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
        iconKey: channelIconKeyOf(ch),
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

/**
 * Where room sockets are opened, without a trailing slash. A request the site Worker forwarded from
 * utmmsc.com/api/* (it sets x-forwarded-prefix) gets API_PUBLIC_URL, so the app opens its socket on its own
 * origin as well; any other request gets the address it called, as before, which keeps old builds and local
 * development unchanged. The forwarded host is never used, only the configured address.
 * 房间连接的地址，末尾不带斜杠。网站 Worker 从 utmmsc.com/api/* 转发来的请求（带有 x-forwarded-prefix）得到 API_PUBLIC_URL，
 * App 因此也在自己的源上打开连接；其他请求仍得到它所调用的地址，旧版本和本地开发都不受影响。这里从不使用转发来的域名，只用配置的地址。
 */
export function socketBase(requestUrl: string, forwardedPrefix: string | undefined, publicUrl: string | undefined): string {
  const configured = publicUrl?.trim().replace(/\/+$/, '');
  if (forwardedPrefix && configured && configured.startsWith('https://')) return `wss://${configured.slice('https://'.length)}`;
  return new URL(requestUrl).origin.replace(/^http/, 'ws');
}

function roomSocketUrl(c: Context<AppEnv>, roomId: string, ticket: string): string {
  const base = socketBase(c.req.url, c.req.header('x-forwarded-prefix'), c.env.API_PUBLIC_URL);
  return `${base}/chat/rooms/${encodeURIComponent(roomId)}/socket?ticket=${encodeURIComponent(ticket)}`;
}

chatRoutes.post('/rooms/:roomId/ticket', requireSession, async (c) => {
  const member = c.get('member');
  const roomId = c.req.param('roomId');
  // Only the first ticket of a screen, and the reconnect after an access change, ask for meta; other reconnects and media refreshes skip the extra queries.
  // 只有进入页面时的第一张票据和权限变化后的重连会请求 meta；其他重连和媒体令牌刷新不做这些额外查询。
  const { grant, meta } =
    c.req.query('meta') === '1' ? await resolveRoomWithMeta(c.env, member, roomId) : { grant: await resolveRoomAccess(c.env, member, roomId), meta: null };
  // The media token is the same for every ticket of one UTC day, so image URLs stay the same and the browser cache hits.
  // 同一个 UTC 日内所有票据的媒体令牌都相同，图片网址因此不变，浏览器缓存可以命中。
  const [ticket, mediaToken] = await Promise.all([
    issueRoomTicket(c.env.SESSION_SECRET, {
      roomId,
      memberId: member.id,
      displayName: member.display_name,
      role: viewedRole(member),
      canPost: grant.canPost,
      avatarKey: member.avatar_key,
      access: grant.access,
    }),
    issueChatMediaToken(c.env.SESSION_SECRET, roomId),
  ]);
  const response: RoomTicketResponse = {
    ticket,
    roomId,
    socketUrl: roomSocketUrl(c, roomId, ticket),
    mediaToken,
    canPost: grant.canPost,
  };
  if (meta) response.room = meta;
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
  const { meta } = await resolveRoomWithMeta(c.env, c.get('member'), c.req.param('roomId'));
  return c.json(meta);
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

/**
 * Uploads per member per minute, every room together. A photo is two uploads, its 2048 px copy and its 360 px
 * thumbnail, so this keeps the 20 photos a minute members had before thumbnails.
 * 每位成员每分钟的上传次数，所有房间合计。一张照片是两次上传（2048px 副本和 360px 缩略图），因此仍是缩略图出现之前的每分钟 20 张照片。
 */
export const CHAT_IMAGE_UPLOADS_PER_MINUTE = 40;

/**
 * Uploads per address per minute in one room, counted before the session is checked. Members on one campus
 * network share an address, so this is a few members' worth and each of them meets only their own limit.
 * 同一房间每个地址每分钟的上传次数，在检查登录之前计算。同一校园网的成员共用地址，因此它相当于几位成员的额度，每位成员只会遇到自己的限制。
 */
export const CHAT_IMAGE_UPLOADS_PER_ADDRESS_PER_MINUTE = 3 * CHAT_IMAGE_UPLOADS_PER_MINUTE;

const imageUploads = memberRateLimit('chat:image', CHAT_IMAGE_UPLOADS_PER_MINUTE, 60_000);

/**
 * Stores one image for the room. The app uploads a photo's 2048 px copy and its 360 px thumbnail here in parallel,
 * as two images; the send frame then names both, and the room checks that both belong to it.
 * 为房间存储一张图片。App 把照片的 2048px 副本和 360px 缩略图作为两张图片并行上传到这里；发送帧随后同时带上两者，房间会检查它们都属于本房间。
 */
chatRoutes.post('/rooms/:roomId/images', rateLimit(CHAT_IMAGE_UPLOADS_PER_ADDRESS_PER_MINUTE, 60_000), requireSession, imageUploads, async (c) => {
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

/**
 * Chat images and their thumbnails, with the room's media token. One R2 call per request, an ETag, 304 for a copy
 * the browser already holds, and a year of immutable caching, since every upload gets a new random key. A sticker
 * message's alias (this room's prefix and <id>.<type>, never stored) serves the sticker's original, so builds that
 * predate stickers show it as a photo.
 * 聊天图片及其缩略图，凭房间的媒体令牌访问。每个请求只调用一次 R2，带 ETag，浏览器已有副本时返回 304，并可不可变地缓存一年，
 * 因为每次上传都使用新的随机键。表情消息的别名（本房间的前缀加 <id>.<type>，从不实际存储）提供表情的原始文件，
 * 早于表情功能的版本因此把它显示为图片。
 */
chatRoutes.get('/media/*', async (c) => {
  const roomId = await readChatMediaToken(c.env.SESSION_SECRET, c.req.query('t') ?? '');
  if (!roomId) throw unauthorized('媒体链接已过期');
  const key = decodeKeyPath(c.req.path.replace(/^\/chat\/media\//, ''));
  if (!isRoomImageKey(roomId, key)) throw forbidden();
  const response = await mediaObjectResponse(requireBucket(c.env), stickerKeyForAlias(roomId, key) ?? key, c.req.raw);
  if (!response) throw notFound();
  return response;
});
