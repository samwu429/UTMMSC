import { Hono } from 'hono';
import { ABOUT_MAX, AVATAR_MAX_BYTES, COVER_MAX_BYTES, EXPERIENCE_LIMIT, HEADLINE_MAX, LOCATION_MAX, MOMENT_IMAGE_MAX_BYTES, MOMENT_VIDEO_MAX_BYTES, POST_MAX, PROGRAM_MAJOR_MAX, canonicalizeProgramMajor, isPresetAvatarId, presetAvatarKey } from '@utmmsc/shared';
import { experienceFromInput, FieldError, openToFromInput, skillsFromInput } from '../../../domain/profile/fields';
import { avatarObjectKey, coverObjectKey, describeContentType, momentObjectKey, normalizePostMedia } from '../../../domain/profile/media';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import {
  countExperiences,
  deleteExperience,
  deletePost,
  insertExperience,
  insertPost,
  listFeed,
} from '../../../infrastructure/d1/profile';
import { findMemberById, markGraduated, toSelf, updateAvatarKey, updateCoverKey, updateProfile, type ProfileUpdate } from '../../../infrastructure/d1/members';
import { deleteObject, putObject } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { rateLimit } from '../../middleware/rate-limit';
import { optionalString, readJson } from '../../validation';

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
  return c.json({ posts, mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET) });
});

async function readUpload(c: { req: { header: (name: string) => string | undefined; arrayBuffer: () => Promise<ArrayBuffer> } }, maxBytes: number, tooLarge: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const contentType = c.req.header('content-type') ?? '';
  const length = Number(c.req.header('content-length') ?? '0');
  if (!length) throw badRequest('empty_file', '文件为空');
  if (length > maxBytes) throw badRequest('too_large', tooLarge);
  const bytes = await c.req.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > maxBytes) throw badRequest('too_large', tooLarge);
  return { bytes, contentType };
}

profileRoutes.post('/me/avatar', rateLimit(10, 60_000), async (c) => {
  const { bytes, contentType } = await readUpload(c, AVATAR_MAX_BYTES, '头像不能超过 8MB');
  const member = c.get('member');
  let key: string;
  try {
    key = avatarObjectKey(member.id, contentType);
  } catch (error) {
    if (error instanceof FieldError) throw badRequest('unsupported_type', error.message);
    throw error;
  }
  const bucket = requireBucket(c.env);
  await putObject(bucket, key, bytes, contentType);
  const previous = member.avatar_key;
  await updateAvatarKey(c.env.DB, member.id, key);
  if (previous?.startsWith('avatar/') && previous !== key) c.executionCtx.waitUntil(deleteObject(bucket, previous));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated), mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET) });
});

profileRoutes.post('/me/avatar/preset', async (c) => {
  const body = await readJson<Record<string, unknown>>(c);
  const id = typeof body.id === 'string' ? body.id : '';
  if (!isPresetAvatarId(id)) throw badRequest('invalid_avatar', '没有这个头像');
  const motion = body.motion === 'still' ? 'still' : body.motion === 'animated' || body.motion === undefined ? 'animated' : null;
  if (!motion) throw badRequest('invalid_avatar', '请选择动态版或静态版');
  const member = c.get('member');
  const key = presetAvatarKey(id, motion);
  const previous = member.avatar_key;
  await updateAvatarKey(c.env.DB, member.id, key);
  if (previous?.startsWith('avatar/') && previous !== key) c.executionCtx.waitUntil(deleteObject(requireBucket(c.env), previous));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

profileRoutes.delete('/me/avatar', async (c) => {
  const member = c.get('member');
  await updateAvatarKey(c.env.DB, member.id, null);
  if (member.avatar_key?.startsWith('avatar/')) c.executionCtx.waitUntil(deleteObject(requireBucket(c.env), member.avatar_key));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

profileRoutes.post('/me/cover', rateLimit(10, 60_000), async (c) => {
  const { bytes, contentType } = await readUpload(c, COVER_MAX_BYTES, '封面不能超过 8MB');
  const member = c.get('member');
  let key: string;
  try {
    key = coverObjectKey(member.id, contentType);
  } catch (error) {
    if (error instanceof FieldError) throw badRequest('unsupported_type', error.message);
    throw error;
  }
  const bucket = requireBucket(c.env);
  await putObject(bucket, key, bytes, contentType);
  const previous = member.cover_key;
  await updateCoverKey(c.env.DB, member.id, key);
  if (previous?.startsWith('cover/') && previous !== key) c.executionCtx.waitUntil(deleteObject(bucket, previous));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated), mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET) });
});

profileRoutes.delete('/me/cover', async (c) => {
  const member = c.get('member');
  await updateCoverKey(c.env.DB, member.id, null);
  if (member.cover_key?.startsWith('cover/')) c.executionCtx.waitUntil(deleteObject(requireBucket(c.env), member.cover_key));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
});

profileRoutes.post('/me/media', rateLimit(30, 60_000), async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  const described = describeContentType(contentType);
  if (!described) throw badRequest('unsupported_type', '只支持 JPEG、PNG、WebP、GIF 照片，或 MP4、MOV、WebM 视频');
  const maxBytes = described.kind === 'video' ? MOMENT_VIDEO_MAX_BYTES : MOMENT_IMAGE_MAX_BYTES;
  const tooLarge = described.kind === 'video' ? '视频不能超过 25MB' : '照片不能超过 8MB';
  const { bytes } = await readUpload(c, maxBytes, tooLarge);
  const member = c.get('member');
  const key = momentObjectKey(member.id, contentType);
  await putObject(requireBucket(c.env), key, bytes, contentType);
  return c.json({ key, contentType, kind: described.kind }, 201);
});

profileRoutes.post('/me/graduate', async (c) => {
  const member = c.get('member');
  if (member.enrollment_status !== 'student') throw badRequest('already_alumni', '已经是毕业生');
  await markGraduated(c.env.DB, member.id);
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  return c.json({ member: toSelf(updated) });
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
    const result = canonicalizeProgramMajor(optionalString(body.major, '专业', PROGRAM_MAJOR_MAX));
    if (!result.ok) throw badRequest('invalid_program', result.message);
    patch.major = result.major;
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
  let text = '';
  if (body.text !== undefined && body.text !== null && body.text !== '') {
    if (typeof body.text !== 'string') throw badRequest('invalid_field', '内容格式错误');
    text = body.text.trim();
    if (text.length > POST_MAX) throw badRequest('field_too_long', '内容过长');
  }
  const member = c.get('member');
  const media = readField(() => normalizePostMedia(member.id, body.media));
  if (!text && media.length === 0) throw badRequest('empty_post', '写点什么，或加上照片、视频');
  const post = await insertPost(c.env.DB, member.id, text, media);
  return c.json({ post }, 201);
});

profileRoutes.delete('/me/posts/:id', async (c) => {
  const keys = await deletePost(c.env.DB, c.get('member').id, c.req.param('id'));
  if (!keys) throw notFound('动态不存在');
  if (keys.length > 0) {
    const bucket = requireBucket(c.env);
    c.executionCtx.waitUntil(Promise.all(keys.map((key) => deleteObject(bucket, key))));
  }
  return c.json({ ok: true });
});
