import { Hono } from 'hono';
import { ENROLLMENT_STATUSES, type DirectoryResponse, type EnrollmentStatus, type MemberDetailResponse } from '@utmmsc/shared';
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../../../domain/crypto/encoding';
import { relation } from '../../../infrastructure/d1/friends';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { findMemberById, listDirectory, toProfile, viewedEnrollment, viewedRole } from '../../../infrastructure/d1/members';
import { listExperiences, listMemberPosts } from '../../../infrastructure/d1/profile';
import type { AppEnv } from '../../context';
import { notFound } from '../../errors';
import { requireSession } from '../../middleware/session';
import { profileRoutes } from './profile';

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.use('*', requireSession);
memberRoutes.route('/', profileRoutes);

const PAGE_SIZE = 40;
const PROFILE_POSTS = 8;

function encodeCursor(name: string, id: string): string {
  return bytesToBase64Url(utf8ToBytes(JSON.stringify([name, id])));
}

function decodeCursor(cursor: string | undefined): { name: string; id: string } | null {
  if (!cursor) return null;
  const bytes = base64UrlToBytes(cursor);
  if (!bytes) return null;
  try {
    const [name, id] = JSON.parse(bytesToUtf8(bytes)) as [string, string];
    return typeof name === 'string' && typeof id === 'string' ? { name, id } : null;
  } catch {
    return null;
  }
}

memberRoutes.get('/', async (c) => {
  const q = c.req.query('q')?.trim() || null;
  const enrollmentRaw = c.req.query('enrollmentStatus');
  const enrollmentStatus = (ENROLLMENT_STATUSES as readonly string[]).includes(enrollmentRaw ?? '')
    ? (enrollmentRaw as EnrollmentStatus)
    : null;
  const yearRaw = Number(c.req.query('graduationYear'));
  const graduationYear = Number.isInteger(yearRaw) && yearRaw > 0 ? yearRaw : null;
  const cursor = decodeCursor(c.req.query('cursor'));

  const rows = await listDirectory(c.env.DB, {
    query: q,
    enrollmentStatus,
    graduationYear,
    afterName: cursor?.name ?? null,
    afterId: cursor?.id ?? null,
    limit: PAGE_SIZE + 1,
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page[page.length - 1];
  const response: DirectoryResponse = {
    members: page.map(toProfile),
    nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.display_name, last.id) : null,
  };
  return c.json(response);
});

/**
 * A member's profile. Its posts are the ones the viewer may see under the moments rules, newest first, so a
 * profile never shows friends or private posts to someone outside them.
 * 成员资料页。其中的动态是按好友动态规则查看者能看到的那些，最新的在前，因此资料页不会把好友可见或仅自己可见的动态展示给圈外的人。
 */
memberRoutes.get('/:id', async (c) => {
  const row = await findMemberById(c.env.DB, c.req.param('id'));
  if (!row || row.status !== 'active') throw notFound('成员不存在');
  const viewer = c.get('member');
  const [experiences, posts] = await Promise.all([
    listExperiences(c.env.DB, row.id),
    listMemberPosts(c.env.DB, viewer.id, row.id, PROFILE_POSTS),
  ]);
  const member = toProfile(row);
  if (viewer.id === row.id) {
    member.role = viewedRole(viewer);
    member.enrollmentStatus = viewedEnrollment(viewer);
  }
  const response: MemberDetailResponse = {
    member,
    experiences,
    posts,
    mediaToken: await issueProfileMediaToken(c.env.SESSION_SECRET),
    friendship: await relation(c.env.DB, viewer.id, row.id),
  };
  return c.json(response);
});
