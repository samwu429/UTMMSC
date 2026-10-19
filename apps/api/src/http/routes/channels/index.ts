import { Hono } from 'hono';
import { CHANNEL_AUDIENCES, POST_POLICIES, type ChannelAudience, type PostPolicy } from '@utmmsc/shared';
import {
  addChannelMembers,
  createChannel,
  deleteChannel,
  findChannel,
  listChannels,
  removeChannelMember,
  updateChannel,
} from '../../../infrastructure/d1/channels';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { requirePermission, requireSession } from '../../middleware/session';
import { optionalString, readJson, requireOneOf, requireString } from '../../validation';

/** Channel administration. Reading and posting go through the chat routes. */
/** 频道管理。阅读与发言走 chat 路由。 */
export const channelRoutes = new Hono<AppEnv>();

channelRoutes.use('*', requireSession, requirePermission('channels.manage'));

function memberIdList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw badRequest('invalid_field', '成员列表格式错误');
  return value as string[];
}

function toAdminChannel(row: Awaited<ReturnType<typeof findChannel>>) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    audience: row.audience,
    postPolicy: row.post_policy,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
  };
}

channelRoutes.get('/', async (c) => {
  const channels = await listChannels(c.env.DB);
  return c.json({ channels: channels.map((row) => toAdminChannel(row)) });
});

channelRoutes.post('/', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const name = requireString(body.name, '频道名称', 40);
  const description = optionalString(body.description, '频道简介', 200);
  const audience = requireOneOf<ChannelAudience>(body.audience, CHANNEL_AUDIENCES, '受众');
  const postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  const channel = await createChannel(c.env.DB, {
    name,
    description,
    audience,
    postPolicy,
    createdBy: c.get('member').id,
    memberIds: memberIdList(body.memberIds),
  });
  return c.json({ channel }, 201);
});

channelRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await findChannel(c.env.DB, id))) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  const patch: { name?: string; description?: string | null; postPolicy?: PostPolicy } = {};
  if (body.name !== undefined) patch.name = requireString(body.name, '频道名称', 40);
  if (body.description !== undefined) patch.description = optionalString(body.description, '频道简介', 200);
  if (body.postPolicy !== undefined) patch.postPolicy = requireOneOf<PostPolicy>(body.postPolicy, POST_POLICIES, '发言规则');
  await updateChannel(c.env.DB, id, patch);
  return c.json({ channel: await findChannel(c.env.DB, id) });
});

channelRoutes.post('/:id/members', async (c) => {
  const id = c.req.param('id');
  if (!(await findChannel(c.env.DB, id))) throw notFound('频道不存在');
  const body = await readJson<Record<string, unknown>>(c);
  await addChannelMembers(c.env.DB, id, memberIdList(body.memberIds));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id/members/:memberId', async (c) => {
  await removeChannelMember(c.env.DB, c.req.param('id'), c.req.param('memberId'));
  return c.json({ ok: true });
});

channelRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await findChannel(c.env.DB, id))) throw notFound('频道不存在');
  await deleteChannel(c.env.DB, id);
  return c.json({ ok: true });
});
