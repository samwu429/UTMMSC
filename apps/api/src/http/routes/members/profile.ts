import { Hono } from 'hono';
import { ABOUT_MAX, AVATAR_MAX_BYTES, COVER_MAX_BYTES, EXPERIENCE_LIMIT, HEADLINE_MAX, LOCATION_MAX, MOMENT_IMAGE_MAX_BYTES, MOMENT_VIDEO_MAX_BYTES, POST_MAX, PROGRAM_MAJOR_MAX, canonicalizeProgramMajor, isPresetAvatarId, isValidEnrollmentYear, presetAvatarKey } from '@utmmsc/shared';
import { experienceFromInput, FieldError, openToFromInput, skillsFromInput } from '../../../domain/profile/fields';
import { avatarObjectKey, coverObjectKey, describeContentType, momentObjectKey, normalizePostMedia } from '../../../domain/profile/media';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
import { countMomentsSince, recordMomentUpload } from '../../../infrastructure/d1/moments';
import {
  countExperiences,
  deleteExperience,
  deletePost,
  insertExperience,
  insertPost,
  listFeed,
} from '../../../infrastructure/d1/profile';
import { findMemberById, markGraduated, toSelf, updateAvatarKey, updateCoverKey, updateProfile, viewedRole, type MemberRow, type ProfileUpdate } from '../../../infrastructure/d1/members';
import { recordJoinChanges } from '../../access';
import { announceAuthor, revokeMemberEverywhere } from '../../rooms';
import { cancelPendingYearRequest, findPendingYearRequest, savePendingYearRequest } from '../../../infrastructure/d1/enrollment-requests';
import { deleteObject, putObject } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { badRequest, notFound } from '../../errors';
import { memberRateLimit, rateLimit } from '../../middleware/rate-limit';
import { optionalString, readJson, requireInteger } from '../../validation';
import { MINUTE, MOMENT_DAILY_POSTS, dailyLimit, dayAgo, deleteObjectsLater, mediaGone } from '../moments/common';

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

/**
 * Legacy feed for PWA bundles cached before 好友动态, kept for one release. It lists only what the viewer may
 * see under the moments rules, so the old screen no longer shows friends and private posts to everyone.
 * 好友动态上线之前缓存的 PWA 版本所用的旧信息流，保留一个版本。它只列出按好友动态规则查看者能看到的内容，
 * 旧页面因此不会再把好友可见和仅自己可见的动态展示给所有人。
 */
profileRoutes.get('/feed', async (c) => {
  const posts = await listFeed(c.env.DB, c.get('member').id, FEED_LIMIT);
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

function chatAuthor(row: MemberRow) {
  return { id: row.id, displayName: row.display_name, avatarKey: row.avatar_key };
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
  c.executionCtx.waitUntil(announceAuthor(c.env, chatAuthor(updated)));
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
  c.executionCtx.waitUntil(announceAuthor(c.env, chatAuthor(updated)));
  return c.json({ member: toSelf(updated) });
});

profileRoutes.delete('/me/avatar', async (c) => {
  const member = c.get('member');
  await updateAvatarKey(c.env.DB, member.id, null);
  if (member.avatar_key?.startsWith('avatar/')) c.executionCtx.waitUntil(deleteObject(requireBucket(c.env), member.avatar_key));
  const updated = await findMemberById(c.env.DB, member.id);
  if (!updated) throw notFound('成员不存在');
  c.executionCtx.waitUntil(announceAuthor(c.env, chatAuthor(updated)));
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

/**
 * One photo, video or preview for a post not published yet. Limited per member, not per IP, because a
 * campus network shares one address and each photo now uploads a preview too. The upload is recorded before
 * the object is stored, so a file the member never publishes is always found and deleted by the cron.
 * 为尚未发表的动态上传一张照片、一个视频或一张预览图。按成员而不是按 IP 限制频率，因为校园网共用一个地址，
 * 而且现在每张照片还要多传一张预览图。先记录上传再保存对象，成员从未发表的文件因此总能被定时任务找到并删除。
 */
profileRoutes.post('/me/media', memberRateLimit('media', 60, MINUTE), async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  const described = describeContentType(contentType);
  if (!described) throw badRequest('unsupported_type', '只支持 JPEG、PNG、WebP、GIF 照片，或 MP4、MOV、WebM 视频');
  const maxBytes = described.kind === 'video' ? MOMENT_VIDEO_MAX_BYTES : MOMENT_IMAGE_MAX_BYTES;
  const tooLarge = described.kind === 'video' ? '视频不能超过 25MB' : '照片不能超过 8MB';
  const { bytes } = await readUpload(c, maxBytes, tooLarge);
  const member = c.get('member');
  const bucket = requireBucket(c.env);
  const key = momentObjectKey(member.id, contentType);
  try {
    await recordMomentUpload(c.env.DB, member.id, key);
  } catch (err) {
    // Before migration 0016 there is no table to record in and no sweep to read it, so the upload goes ahead.
    // 迁移 0016 之前既没有可写入的表，也没有读取它的清理任务，因此照常上传。
    if (!isMissingSchemaError(err)) throw err;
  }
  await putObject(bucket, key, bytes, contentType);
  return c.json({ key, contentType, kind: described.kind }, 201);
});

function toYearRequest(row: { id: string; requested_year: number; created_at: string }) {
  return { id: row.id, requestedYear: row.requested_year, createdAt: row.created_at };
}

profileRoutes.get('/me/enrollment-year-request', async (c) => {
  const pending = await findPendingYearRequest(c.env.DB, c.get('member').id);
  return c.json({ request: pending ? toYearRequest(pending) : null });
});

profileRoutes.post('/me/enrollment-year-request', async (c) => {
  const member = c.get('member');
  if (member.role === 'honorary_external') throw badRequest('external_advisor', '校外荣誉顾问没有入学年份');
  const body = await readJson<Record<string, unknown>>(c);
  const year = requireInteger(body.graduationYear, '入学年份');
  if (!isValidEnrollmentYear(year)) throw badRequest('invalid_year', '入学年份无效');
  if (year === member.graduation_year) throw badRequest('same_year', '这就是现在的入学年份');
  const saved = await savePendingYearRequest(c.env.DB, member.id, year);
  return c.json({ request: toYearRequest(saved) });
});

profileRoutes.delete('/me/enrollment-year-request', async (c) => {
  await cancelPendingYearRequest(c.env.DB, c.get('member').id);
  return c.json({ ok: true });
});

profileRoutes.post('/me/graduate', async (c) => {
  const member = c.get('member');
  // A test identity changes only what the system admin sees, so it must not write their real enrollment.
  // 测试身份只改变系统管理员看到的内容，不能借此改写其真实的在读状态。
  if (viewedRole(member) !== member.role) throw badRequest('acting_role', '测试身份下不能修改自己的在读状态');
  if (member.enrollment_status !== 'student') throw badRequest('already_alumni', '已经是毕业生');
  if (await markGraduated(c.env.DB, member.id)) {
    await recordJoinChanges(c.env, member);
    c.executionCtx.waitUntil(revokeMemberEverywhere(c.env, member.id));
  }
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

/**
 * Legacy publish, kept for one release. insertPost stores the post for the whole club, as the old screen
 * promised when it was written, and consumes its uploads; an upload no longer recorded is a 400 invalid_media,
 * as on POST /moments/posts. It shares the per-member limit and the daily cap of that route, so switching
 * endpoints buys nothing.
 * 旧的发表接口，保留一个版本。insertPost 按旧页面发表时的约定把动态设为全社团可见，并消耗对应的上传记录；
 * 与 POST /moments/posts 一样，上传记录已不存在时返回 400 invalid_media。它与该接口共用按成员的频率限制和每日上限，换用旧接口不会多出额度。
 */
profileRoutes.post('/me/posts', memberRateLimit('moments:create', 8, MINUTE), async (c) => {
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
  if ((await countMomentsSince(c.env.DB, member.id, dayAgo())) >= MOMENT_DAILY_POSTS) throw dailyLimit();
  const post = await insertPost(c.env.DB, member.id, text, media);
  if (!post) throw mediaGone();
  return c.json({ post }, 201);
});

/** The author's delete; the originals and their previews leave storage after the response. */
/** 作者删除动态；原文件及其预览图在响应之后从存储中删除。 */
profileRoutes.delete('/me/posts/:id', async (c) => {
  const keys = await deletePost(c.env.DB, c.get('member').id, c.req.param('id'));
  if (!keys) throw notFound('动态不存在');
  deleteObjectsLater(c, keys);
  return c.json({ ok: true });
});
