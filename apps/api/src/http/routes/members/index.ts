import { Hono } from 'hono';
import { ENROLLMENT_STATUSES, type DirectoryResponse, type EnrollmentStatus } from '@utmmsc/shared';
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../../../domain/crypto/encoding';
import { findMemberById, listDirectory, toProfile } from '../../../infrastructure/d1/members';
import type { AppEnv } from '../../context';
import { notFound } from '../../errors';
import { requireSession } from '../../middleware/session';

export const memberRoutes = new Hono<AppEnv>();

memberRoutes.use('*', requireSession);

const PAGE_SIZE = 40;

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

memberRoutes.get('/:id', async (c) => {
  const row = await findMemberById(c.env.DB, c.req.param('id'));
  if (!row || row.status !== 'active') throw notFound('成员不存在');
  return c.json({ member: toProfile(row) });
});
