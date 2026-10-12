import { Hono } from 'hono';
import { ABOUT_MAX, EXPERIENCE_LIMIT, HEADLINE_MAX, LOCATION_MAX, POST_MAX } from '@utmmsc/shared';
import { experienceFromInput, FieldError, openToFromInput, skillsFromInput } from '../../../domain/profile/fields';
import {
  countExperiences,
  deleteExperience,
  deletePost,
  insertExperience,
  insertPost,
  listFeed,
} from '../../../infrastructure/d1/profile';
import { findMemberById, toSelf, updateProfile, type ProfileUpdate } from '../../../infrastructure/d1/members';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { optionalString, readJson, requireString } from '../../validation';

const MAJOR_MAX = 80;
const FEED_LIMIT = 40;

function readField<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof FieldError) throw badRequest('invalid_field', error.message);
    throw error;
  }
}

export const profileRoutes = new Hono<AppEnv>();

profileRoutes.get('/feed', async (c) => {
  const posts = await listFeed(c.env.DB, FEED_LIMIT);
  return c.json({ posts });
});

profileRoutes.patch('/me', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const patch: ProfileUpdate = {};
  let any = false;
  if ('headline' in body) {
    patch.headline = optionalString(body.headline, '一句话介绍', HEADLINE_MAX);
    any = true;
  }
  if ('about' in body) {
    patch.about = optionalString(body.about, '简介', ABOUT_MAX);
    any = true;
  }
  if ('location' in body) {
    patch.location = optionalString(body.location, '所在地', LOCATION_MAX);
    any = true;
  }
  if ('major' in body) {
    patch.major = optionalString(body.major, '专业', MAJOR_MAX);
    any = true;
  }
  if ('skills' in body) {
    patch.skills = readField(() => skillsFromInput(body.skills));
    any = true;
  }
  if ('openTo' in body) {
    patch.openTo = readField(() => openToFromInput(body.openTo));
    any = true;
  }
  if (!any) throw badRequest('empty_update', '没有要保存的内容');

  const member = c.get('member');
  await updateProfile(c.env.DB, member.id, patch);
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

profileRoutes.post('/me/experiences', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const input = readField(() => experienceFromInput(body));
  const member = c.get('member');
  if ((await countExperiences(c.env.DB, member.id)) >= EXPERIENCE_LIMIT) {
    throw badRequest('too_many', `经历最多 ${EXPERIENCE_LIMIT} 条`);
  }
  const experience = await insertExperience(c.env.DB, member.id, input);
  return c.json({ experience }, 201);
});

profileRoutes.delete('/me/experiences/:id', async (c) => {
  const removed = await deleteExperience(c.env.DB, c.get('member').id, c.req.param('id'));
  if (!removed) throw notFound('经历不存在');
  return c.json({ ok: true });
});

profileRoutes.post('/me/posts', rateLimit(8, 60_000), async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const text = requireString(body.text, '内容', POST_MAX);
  const post = await insertPost(c.env.DB, c.get('member').id, text);
  return c.json({ post }, 201);
});

profileRoutes.delete('/me/posts/:id', async (c) => {
  const removed = await deletePost(c.env.DB, c.get('member').id, c.req.param('id'));
  if (!removed) throw notFound('动态不存在');
  return c.json({ ok: true });
});
