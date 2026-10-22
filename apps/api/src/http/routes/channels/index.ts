import { Hono } from 'hono';
import { CHANNEL_AUDIENCES, POST_POLICIES, channelRoomId, type ChannelAudience, type PostPolicy } from '@utmmsc/shared';
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
  type ChannelRow,
} from '../../../infrastructure/d1/channels';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { revokeRoom } from '../../rooms';
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

function toAdminChannel(row: ChannelRow, memberIds: string[]) {
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
  };
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
    createdBy: c.get('member').id,
    memberIds,
  });
  return c.json({ channel: await loadAdminChannel(c.env.DB, channel.id) }, 201);
});

channelRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await findChannel(c.env.DB, id);
  if (!existing) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const patch: {
    name?: string;
    description?: string | null;
    audience?: ChannelAudience;
    postPolicy?: PostPolicy;
  } = {};
  if (body.name !== undefined) patch.name = requireString(body.name, '频道名称', 40);
  if (body.description !== undefined) patch.description = optionalString(body.description, '频道简介', 200);
  if (body.audience !== undefined) patch.audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  if (body.postPolicy !== undefined) patch.postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  // Validate everything before writing anything, so a bad member list does not leave a half-applied edit.
  // 写入前先校验全部字段，成员列表有误时不会只保存了一半。
  const requestedMembers = body.memberIds !== undefined ? memberIdList(body.memberIds) : null;
  if (requestedMembers) await requireExistingMembers(c.env.DB, requestedMembers);
  await updateChannel(c.env.DB, id, patch);

  const nextAudience = patch.audience ?? existing.audience;
  if (requestedMembers || patch.audience !== undefined) {
    if (nextAudience === 'custom') {
      const memberIds = requestedMembers ?? (await listChannelMemberIds(c.env.DB, id));
      await replaceChannelMembers(c.env.DB, id, memberIds.length > 0 ? memberIds : [c.get('member').id]);
    } else if (existing.audience === 'custom') {
      await replaceChannelMembers(c.env.DB, id, []);
    }
  }
  if (patch.audience !== undefined || patch.postPolicy !== undefined || requestedMembers) {
    c.executionCtx.waitUntil(revokeRoom(c.env, channelRoomId(id)));
  }

  return c.json({ channel: await loadAdminChannel(c.env.DB, id) });
});

channelRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  if (!(await findChannel(c.env.DB, id))) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const memberIds = memberIdList(body.memberIds);
  await requireExistingMembers(c.env.DB, memberIds);
  await addChannelMembers(c.env.DB, id, memberIds);
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
