import { Hono } from 'hono';
import { friendSummary, relation, requestFriend, respondFriend } from '../../../infrastructure/d1/friends';
import { findMemberById } from '../../../infrastructure/d1/members';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { readJson, requireString } from '../../validation';

export const friendRoutes = new Hono<AppEnv>();

friendRoutes.use('*', requireSession);

friendRoutes.get('/', async (c) => {
  return c.json(await friendSummary(c.env.DB, c.get('member').id));
});

friendRoutes.get('/with/:id', async (c) => {
  const me = c.get('member').id;
  const them = c.req.param('id');
  return c.json({ friendship: await relation(c.env.DB, me, them) });
});

friendRoutes.post('/', rateLimit(20, 60_000), async (c) => {
  const me = c.get('member');
  const body = await readJson<Record<string, unknown>>(c);
  const them = requireString(body.memberId, '成员', 64);
  if (them === me.id) throw badRequest('self_friend', '不能加自己为好友');
  const peer = await findMemberById(c.env.DB, them);
  if (!peer || peer.status !== 'active') throw notFound('成员不存在');
  const friendship = await requestFriend(c.env.DB, me.id, them);
  return c.json({ friendship });
});

friendRoutes.post('/:id/accept', async (c) => {
  const friendship = await respondFriend(c.env.DB, c.get('member').id, c.req.param('id'), true);
  return c.json({ friendship });
});

friendRoutes.post('/:id/reject', async (c) => {
  const friendship = await respondFriend(c.env.DB, c.get('member').id, c.req.param('id'), false);
  return c.json({ friendship });
});
