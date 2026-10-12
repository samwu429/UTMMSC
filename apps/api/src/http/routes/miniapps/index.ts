import { Hono } from 'hono';
import { findMiniApp } from '@utmmsc/shared';
import { listPins, pinMiniApp, unpinMiniApp } from '../../../infrastructure/d1/miniapp-pins';
import type { AppEnv } from '../../context';
import { notFound } from '../../errors';
import { requireSession } from '../../middleware/session';
import { readJson, requireString } from '../../validation';

export const miniappRoutes = new Hono<AppEnv>();

miniappRoutes.use('*', requireSession);

miniappRoutes.get('/pins', async (c) => {
  const ids = await listPins(c.env.DB, c.get('member').id);
  return c.json({ ids });
});

miniappRoutes.post('/pins', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const id = requireString(body.id, '小程序', 40);
  if (!findMiniApp(id)) throw notFound('没有这个小程序');
  await pinMiniApp(c.env.DB, c.get('member').id, id);
  return c.json({ ok: true });
});

miniappRoutes.delete('/pins/:id', async (c) => {
  const id = c.req.param('id');
  if (!findMiniApp(id)) throw notFound('没有这个小程序');
  await unpinMiniApp(c.env.DB, c.get('member').id, id);
  return c.json({ ok: true });
});
