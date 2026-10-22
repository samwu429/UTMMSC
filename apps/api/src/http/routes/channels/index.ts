import { Hono } from 'hono';
import {
  CHANNEL_AUDIENCES,
  DEFAULT_HISTORY_VISIBILITY,
  HISTORY_VISIBILITIES,
  POST_POLICIES,
  channelRoomId,
  type AdminChannelRow,
  type ChannelAudience,
  type HistoryVisibility,
  type PostPolicy,
} from '@utmmsc/shared';
import {
  addChannelMembers,
  createChannel,
  deleteChannel,
  findChannel,
  listChannelMemberIds,
  listChannels,
  removeChannelMember,
  replaceChannelMembers,
  updateChannel,
  type ChannelPatch,
  type ChannelRow,
} from '../../../infrastructure/d1/channels';
import { carriedReaderJoins } from '../../../domain/messaging/visibility';
import { listChannelJoins, recordAudienceChange } from '../../../infrastructure/d1/channel-joins';
import { findAuthorCards, findMemberAccessRows, viewedRole, type MemberRow } from '../../../infrastructure/d1/members';
import { nowIso } from '../../../infrastructure/d1/time';
import type { Env } from '../../../env';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { recordRoomJoins, revokeRoom } from '../../rooms';
import { requirePermission, requireSession } from '../../middleware/session';
import { optionalString, readJson, requireOneOf, requireString } from '../../validation';

/** Channel administration. Reading and posting go through the chat routes. */
/** 频道管理。阅读与发言走 chat 路由。 */
export const channelRoutes = new Hono<AppEnv>();

channelRoutes.use('*', requireSession, requirePermission('channels.manage'));

const CHANNEL_MEMBERS_MAX = 1000;

function memberIdList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0 || v.length > 64)) {
    throw badRequest('invalid_field', '成员列表格式错误');
  }
  if (value.length > CHANNEL_MEMBERS_MAX) throw badRequest('invalid_field', '成员过多');
  return [...new Set(value as string[])];
}

/** Rejects unknown ids up front instead of failing the insert on a foreign key. */
/** 预先拒绝不存在的成员，而不是让插入因外键失败。 */
async function requireExistingMembers(db: D1Database, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 90) {
    const slice = ids.slice(i, i + 90);
    const found = await db
      .prepare(`SELECT COUNT(*) AS n FROM members WHERE id IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .first<{ n: number }>();
    if ((found?.n ?? 0) !== slice.length) throw badRequest('unknown_member', '成员列表里有不存在的成员');
  }
}

function toAdminChannel(row: ChannelRow, memberIds: string[]): AdminChannelRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    audience: row.audience,
    postPolicy: row.post_policy,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    memberIds,
    historyVisibility: row.history_visibility ?? DEFAULT_HISTORY_VISIBILITY,
  };
}

/**
 * Writes the join notice for members an admin added to a custom channel. Runs after the membership
 * rows exist, so the notice is stamped no earlier than their join time and lands at their floor.
 * 为管理员加入指定成员频道的成员写入入群提示。在成员记录写入之后执行，提示的时间不早于其加入时间，正好位于其下限处。
 */
async function announceJoins(env: Env, channelId: string, actor: MemberRow, memberIds: string[]): Promise<void> {
  const ids = memberIds.filter((id) => id !== actor.id);
  if (ids.length === 0) return;
  const at = nowIso();
  const cards = await findAuthorCards(env.DB, ids);
  await recordRoomJoins(env, channelRoomId(channelId), {
    actor: { id: actor.id, displayName: actor.display_name },
    members: ids.map((id) => ({ id, displayName: cards.get(id)?.displayName ?? '' })),
    at,
  });
}

/**
 * Listed members who could already read the channel under its current implicit audience, with the time
 * they started reading it. Narrowing the channel to a member list keeps their history instead of
 * flooring them at the edit.
 * 名单中在频道当前的隐式受众下已能阅读该频道的成员，以及其开始阅读的时间。把频道收窄为指定成员时保留他们的历史，而不是从这次编辑开始限制。
 */
async function previousReaders(db: D1Database, channel: ChannelRow, memberIds: string[]): Promise<Map<string, string>> {
  const [rows, implicitJoins] = await Promise.all([findMemberAccessRows(db, memberIds), listChannelJoins(db, channel.id)]);
  return carriedReaderJoins({
    previousAudience: channel.audience,
    postPolicy: channel.post_policy,
    channelCreatedAt: channel.created_at,
    candidates: rows.map((row) => ({ id: row.id, role: viewedRole(row), enrollmentStatus: row.enrollment_status, createdAt: row.created_at })),
    implicitJoins,
  });
}

async function loadAdminChannel(db: D1Database, id: string) {
  const row = await findChannel(db, id);
  if (!row) return null;
  const memberIds = row.audience === 'custom' ? await listChannelMemberIds(db, id) : [];
  return toAdminChannel(row, memberIds);
}

channelRoutes.get('/', async (c) => {
  const channels = await listChannels(c.env.DB);
  const withMembers = await Promise.all(
    channels.map(async (row) => {
      const memberIds = row.audience === 'custom' ? await listChannelMemberIds(c.env.DB, row.id) : [];
      return toAdminChannel(row, memberIds);
    }),
  );
  return c.json({ channels: withMembers });
});

channelRoutes.get('/:id', async (c) => {
  const channel = await loadAdminChannel(c.env.DB, c.req.param('id'));
  if (!channel) throw notFound('频道不存在');
  return c.json({ channel });
});

channelRoutes.post('/', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const name = requireString(body.name, '频道名称', 40);
  const description = optionalString(body.description, '频道简介', 200);
  const audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  const postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  const historyVisibility =
    body.historyVisibility === undefined ? DEFAULT_HISTORY_VISIBILITY : requireOneOf<HistoryVisibility>(body.historyVisibility, HISTORY_VISIBILITIES, '历史消息');
  const requestedMembers = memberIdList(body.memberIds);
  await requireExistingMembers(c.env.DB, requestedMembers);
  const memberIds =
    audience === 'custom'
      ? requestedMembers.length > 0
        ? requestedMembers
        : [c.get('member').id]
      : [];
  const channel = await createChannel(c.env.DB, {
    name,
    description,
    audience,
    postPolicy,
    historyVisibility,
    createdBy: c.get('member').id,
    memberIds,
  });
  if (audience === 'custom') c.executionCtx.waitUntil(announceJoins(c.env, channel.id, c.get('member'), memberIds));
  return c.json({ channel: await loadAdminChannel(c.env.DB, channel.id) }, 201);
});

channelRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await findChannel(c.env.DB, id);
  if (!existing) throw notFound('频道不存在');
  const actor = c.get('member');
  const body = await readJson<Record<string, unknown>>(c);
  const patch: ChannelPatch = {};
  if (body.name !== undefined) patch.name = requireString(body.name, '频道名称', 40);
  if (body.description !== undefined) patch.description = optionalString(body.description, '频道简介', 200);
  if (body.audience !== undefined) patch.audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  if (body.postPolicy !== undefined) patch.postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  if (body.historyVisibility !== undefined) {
    // Only a real change is written; re-saving since_join must not restart the policy and grandfather recent joiners.
    // 只写入真正的变更；再次保存 since_join 不能重新开始策略，否则最近加入的人会被当作老成员。
    const historyVisibility = requireOneOf<HistoryVisibility>(body.historyVisibility, HISTORY_VISIBILITIES, '历史消息');
    if (historyVisibility !== (existing.history_visibility ?? DEFAULT_HISTORY_VISIBILITY)) patch.historyVisibility = historyVisibility;
  }
  // Validate everything before writing anything, so a bad member list does not leave a half-applied edit.
  // 写入前先校验全部字段，成员列表有误时不会只保存了一半。
  const requestedMembers = body.memberIds !== undefined ? memberIdList(body.memberIds) : null;
  if (requestedMembers) await requireExistingMembers(c.env.DB, requestedMembers);
  const nextAudience = patch.audience ?? existing.audience;
  const audienceChanged = nextAudience !== existing.audience;
  const membersBefore = audienceChanged && existing.audience === 'custom' ? await listChannelMemberIds(c.env.DB, id) : [];
  await updateChannel(c.env.DB, id, patch);

  // Membership rows are kept when a channel moves to another audience. They are inert there, and they
  // keep their join times if the channel becomes custom again.
  // 频道改为其他受众时保留成员记录。它们在那时不起作用；频道再改回指定成员时，加入时间保持不变。
  const roomId = channelRoomId(id);
  let membersAfter: string[] = [];
  if (nextAudience === 'custom' && (requestedMembers || patch.audience !== undefined)) {
    const listed = requestedMembers ?? (await listChannelMemberIds(c.env.DB, id));
    const memberIds = listed.length > 0 ? listed : [actor.id];
    const readerSince = existing.audience === 'custom' ? new Map<string, string>() : await previousReaders(c.env.DB, existing, memberIds);
    const diff = await replaceChannelMembers(c.env.DB, id, memberIds, { readerSince });
    const invited = diff.added.filter((memberId) => !readerSince.has(memberId));
    if (invited.length > 0) c.executionCtx.waitUntil(announceJoins(c.env, id, actor, invited));
    for (const removed of diff.removed) c.executionCtx.waitUntil(revokeRoom(c.env, roomId, removed));
    membersAfter = memberIds;
  }
  if (audienceChanged) {
    // Awaited before the room is revoked, so re-issued tickets already carry the new join times.
    // 在关闭房间连接之前等待完成，重新签发的票据就能用上新的加入时间。
    await recordAudienceChange(c.env.DB, existing, nextAudience, { before: new Set(membersBefore), after: new Set(membersAfter) });
  }
  if (patch.audience !== undefined || patch.postPolicy !== undefined || patch.historyVisibility !== undefined) {
    c.executionCtx.waitUntil(revokeRoom(c.env, roomId));
  }

  return c.json({ channel: await loadAdminChannel(c.env.DB, id) });
});

channelRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  const channel = await findChannel(c.env.DB, id);
  if (!channel) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const memberIds = memberIdList(body.memberIds);
  await requireExistingMembers(c.env.DB, memberIds);
  const added = await addChannelMembers(c.env.DB, id, memberIds);
  if (channel.audience === 'custom' && added.length > 0) c.executionCtx.waitUntil(announceJoins(c.env, id, c.get('member'), added));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id/members/:memberId', async (c) => {
  const id = c.req.param('id');
  const memberId = c.req.param('memberId');
  await removeChannelMember(c.env.DB, id, memberId);
  c.executionCtx.waitUntil(revokeRoom(c.env, channelRoomId(id), memberId));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await findChannel(c.env.DB, id))) throw notFound('频道不存在');
  await deleteChannel(c.env.DB, id);
  c.executionCtx.waitUntil(revokeRoom(c.env, channelRoomId(id)));
  return c.json({ ok: true });
});
