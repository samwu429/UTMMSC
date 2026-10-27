import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import type { Env } from '../../../env';
import { relation } from '../../../infrastructure/d1/friends';
import { findMemberById, type MemberRow } from '../../../infrastructure/d1/members';
import { countMomentsSince, recordMomentUpload } from '../../../infrastructure/d1/moments';
import { deletePost, insertPost, listExperiences, listFeed, listMemberPosts } from '../../../infrastructure/d1/profile';
import { IMMUTABLE_MEDIA_CACHE } from '../../../infrastructure/r2/objects';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { memberRoutes } from './index';
import { isServableMediaKey, serveMemberMedia } from './media';

/** Members the stand-in session knows, by the id sent in x-member. */
/** 替身会话认识的成员，按 x-member 中的 id 查找。 */
const session = vi.hoisted(() => ({ members: new Map<string, unknown>() }));

vi.mock('../../middleware/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/session')>();
  const { unauthorized } = await import('../../errors');
  return {
    ...actual,
    requireSession: async (c: { req: { header(name: string): string | undefined }; set(key: string, value: unknown): void }, next: () => Promise<void>) => {
      const member = session.members.get(c.req.header('x-member') ?? '');
      if (!member) throw unauthorized();
      c.set('member', member);
      c.set('sessionId', 'session-1');
      await next();
    },
  };
});
vi.mock('../../../infrastructure/d1/profile');
vi.mock('../../../infrastructure/d1/moments');
vi.mock('../../../infrastructure/d1/friends');
vi.mock('../../../infrastructure/d1/members', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../infrastructure/d1/members')>()),
  findMemberById: vi.fn(),
}));

describe('member routes', () => {
  it('matches the feed and profile routes before the member id route', () => {
    const paths = memberRoutes.routes.map((route) => `${route.method} ${route.path}`);
    const feed = paths.indexOf('GET /feed');
    const byId = paths.indexOf('GET /:id');
    expect(feed).toBeGreaterThanOrEqual(0);
    expect(byId).toBeGreaterThan(feed);
    expect(paths).toContain('PATCH /me');
    expect(paths).toContain('POST /me/posts');
    expect(paths).toContain('POST /me/avatar');
    expect(paths).toContain('POST /me/avatar/preset');
    expect(paths).toContain('POST /me/cover');
    expect(paths).toContain('DELETE /me/cover');
    expect(paths).toContain('POST /me/media');
  });

  it('keeps the legacy feed and post routes that cached web builds still call', () => {
    const paths = memberRoutes.routes.map((route) => `${route.method} ${route.path}`);
    for (const route of ['GET /feed', 'GET /:id', 'POST /me/posts', 'DELETE /me/posts/:id', 'POST /me/media']) expect(paths).toContain(route);
  });
});

let seq = 0;

function signIn(): MemberRow {
  seq += 1;
  const row = {
    id: `mem_${seq}`,
    email: `m${seq}@mail.utoronto.ca`,
    display_name: `成员${seq}`,
    status: 'active',
    role: 'student',
    acting_role: null,
    enrollment_status: 'student',
    graduation_year: 2026,
    skills: null,
    open_to: null,
    avatar_key: null,
    cover_key: null,
  } as MemberRow;
  session.members.set(row.id, row);
  return row;
}

const put = vi.fn(async () => undefined);
const remove = vi.fn(async () => undefined);
/** The member routes with the error handling createApp gives them. */
/** 带上 createApp 所加错误处理的成员路由。 */
const app = new Hono<AppEnv>();
app.onError(errorResponse);
app.route('/', memberRoutes);

const env = { DB: {} as D1Database, SESSION_SECRET: 'test-secret', FILES: { put, delete: remove } } as unknown as Env;

async function send(member: MemberRow, method: string, path: string, init: { json?: unknown; bytes?: string; type?: string; ip?: string } = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: () => undefined } as unknown as ExecutionContext;
  const headers: Record<string, string> = { 'x-member': member.id, 'cf-connecting-ip': init.ip ?? '203.0.113.9' };
  let body: string | undefined;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (init.bytes !== undefined) {
    headers['content-type'] = init.type ?? 'image/jpeg';
    headers['content-length'] = String(init.bytes.length);
    body = init.bytes;
  }
  const response = await app.request(path, { method, headers, body }, env, ctx);
  await Promise.all(pending);
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  vi.resetAllMocks();
  put.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
});

describe('legacy routes under the moments rules', () => {
  it('lists the legacy feed for the viewer', async () => {
    const member = signIn();
    vi.mocked(listFeed).mockResolvedValue([]);
    expect((await send(member, 'GET', '/feed')).status).toBe(200);
    expect(vi.mocked(listFeed)).toHaveBeenCalledWith(env.DB, member.id, 40);
  });

  it('lists the profile posts the viewer may see', async () => {
    const viewer = signIn();
    const owner = signIn();
    vi.mocked(findMemberById).mockResolvedValue(owner);
    vi.mocked(listExperiences).mockResolvedValue([]);
    vi.mocked(listMemberPosts).mockResolvedValue([]);
    vi.mocked(relation).mockResolvedValue('none');
    expect((await send(viewer, 'GET', `/${owner.id}`)).status).toBe(200);
    expect(vi.mocked(listMemberPosts)).toHaveBeenCalledWith(env.DB, viewer.id, owner.id, 8);
  });

  it('records each upload before storing it', async () => {
    const member = signIn();
    const result = await send(member, 'POST', '/me/media', { bytes: 'jpeg' });
    expect(result.status).toBe(201);
    const key = result.json.key as string;
    expect(key).toMatch(new RegExp(`^moments/${member.id}/`));
    expect(vi.mocked(recordMomentUpload)).toHaveBeenCalledWith(env.DB, member.id, key);
    expect(put).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordMomentUpload).mock.invocationCallOrder[0]).toBeLessThan(put.mock.invocationCallOrder[0] ?? 0);
  });

  it('still uploads before migration 0016, and stores nothing when recording fails otherwise', async () => {
    const member = signIn();
    vi.mocked(recordMomentUpload).mockRejectedValueOnce(new Error('D1_ERROR: no such table: moment_uploads'));
    expect((await send(member, 'POST', '/me/media', { bytes: 'jpeg' })).status).toBe(201);
    expect(put).toHaveBeenCalledTimes(1);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(recordMomentUpload).mockRejectedValueOnce(new Error('D1_ERROR: database is locked'));
    expect((await send(member, 'POST', '/me/media', { bytes: 'jpeg' })).status).toBe(500);
    expect(put).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it('limits uploads to 60 a minute per member, whatever IP they share', async () => {
    const member = signIn();
    for (let i = 0; i < 60; i += 1) expect((await send(member, 'POST', '/me/media', { bytes: 'jpeg', ip: `198.51.100.${i}` })).status).toBe(201);
    expect((await send(member, 'POST', '/me/media', { bytes: 'jpeg' })).status).toBe(429);
    expect((await send(signIn(), 'POST', '/me/media', { bytes: 'jpeg' })).status).toBe(201);
  });

  it('applies the daily cap to legacy posts', async () => {
    const member = signIn();
    vi.mocked(countMomentsSince).mockResolvedValue(30);
    const refused = await send(member, 'POST', '/me/posts', { json: { text: '你好' } });
    expect(refused.status).toBe(429);
    expect((refused.json.error as { code: string }).code).toBe('daily_limit');
    expect(vi.mocked(insertPost)).not.toHaveBeenCalled();
    vi.mocked(countMomentsSince).mockResolvedValue(29);
    vi.mocked(insertPost).mockResolvedValue({ id: 'post_1' } as Awaited<ReturnType<typeof insertPost>>);
    expect((await send(member, 'POST', '/me/posts', { json: { text: '你好' } })).status).toBe(201);
    expect(vi.mocked(insertPost)).toHaveBeenCalledWith(env.DB, member.id, '你好', []);
  });

  it('refuses a legacy post whose upload expired with 400 invalid_media', async () => {
    vi.mocked(countMomentsSince).mockResolvedValue(0);
    vi.mocked(insertPost).mockResolvedValue(null);
    const refused = await send(signIn(), 'POST', '/me/posts', { json: { text: '你好' } });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toEqual({ code: 'invalid_media', message: '有照片或视频无法使用，请重新选择' });
  });

  it('deletes the originals and their previews in one call', async () => {
    const member = signIn();
    vi.mocked(deletePost).mockResolvedValue(['moments/a/1.jpg', 'moments/a/1-preview.jpg']);
    expect((await send(member, 'DELETE', '/me/posts/post_1')).json).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith(['moments/a/1.jpg', 'moments/a/1-preview.jpg']);
    vi.mocked(deletePost).mockResolvedValue(null);
    expect((await send(member, 'DELETE', '/me/posts/post_2')).status).toBe(404);
  });
});

describe('member media', () => {
  const STICKER = 'stk_0123456789abcdefghijkl';
  const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';
  const stored = new Map<string, Uint8Array>([
    ['avatar/mem_1/a.jpg', new Uint8Array(10)],
    [`sticker/${STICKER}.gif`, new Uint8Array(20)],
    [`sticker/${STICKER}-t-${THUMB}`, new Uint8Array(5)],
  ]);
  const bucket = {
    get: async (key: string, options?: { onlyIf?: unknown }) => {
      const bytes = stored.get(key);
      if (!bytes) return null;
      const meta = { key, size: bytes.length, etag: 'e1', httpEtag: '"e1"', uploaded: new Date(0), httpMetadata: { contentType: 'image/gif' } };
      if (options?.onlyIf instanceof Headers && options.onlyIf.get('if-none-match') === '"e1"') return meta;
      return { ...meta, range: { offset: 0, length: bytes.length }, body: new Response(bytes).body };
    },
  } as unknown as R2Bucket;
  const media = new Hono<AppEnv>();
  media.onError(errorResponse);
  media.get('/members/media/*', serveMemberMedia);
  const mediaEnv = { SESSION_SECRET: 'test-secret', FILES: bucket } as unknown as Env;
  const fetchKey = async (key: string, headers: Record<string, string> = {}, encode = true) => {
    const token = await issueProfileMediaToken('test-secret');
    const path = encode ? encodeURIComponent(key) : key;
    return media.request(`/members/media/${path}?t=${encodeURIComponent(token)}`, { headers }, mediaEnv);
  };

  it('serves sticker originals and stills, encoded or not, with immutable caching', async () => {
    for (const key of [`sticker/${STICKER}.gif`, `sticker/${STICKER}-t-${THUMB}`]) {
      for (const encode of [true, false]) {
        const res = await fetchKey(key, {}, encode);
        expect(res.status).toBe(200);
        expect(res.headers.get('cache-control')).toBe(IMMUTABLE_MEDIA_CACHE);
      }
    }
    expect((await fetchKey(`sticker/${STICKER}.png`)).status).toBe(404);
  });

  it('refuses anything under sticker/ that is not exactly a sticker object', () => {
    expect(isServableMediaKey(`sticker/${STICKER}.gif`)).toBe(true);
    expect(isServableMediaKey(`sticker/${STICKER}.jpeg`)).toBe(true);
    expect(isServableMediaKey(`sticker/${STICKER}-t-${THUMB}`)).toBe(true);
    for (const key of [
      'sticker/stk_short.gif',
      `sticker/${STICKER}.bmp`,
      `sticker/${STICKER}.gif.png`,
      `sticker/${STICKER}-thumb`,
      `sticker/${STICKER}-t-${THUMB.slice(1)}`,
      `sticker/x/${STICKER}.gif`,
      `sticker/../avatar/${STICKER}.gif`,
      `stickers/${STICKER}.gif`,
      `sticker/${STICKER}`,
      'sticker/',
    ]) {
      expect(isServableMediaKey(key), key).toBe(false);
    }
  });

  it('answers look-alikes with 403 and an expired token with 401', async () => {
    expect((await fetchKey(`sticker/${STICKER}-thumb`)).status).toBe(403);
    expect((await fetchKey(`sticker/x/${STICKER}.gif`)).status).toBe(403);
    const expired = await issueProfileMediaToken('test-secret', Date.now() - 30 * 86_400_000);
    expect((await media.request(`/members/media/${encodeURIComponent(`sticker/${STICKER}.gif`)}?t=${encodeURIComponent(expired)}`, {}, mediaEnv)).status).toBe(401);
  });

  it('sends the sandbox policy and nosniff with every media response, and no cross-origin-resource-policy', async () => {
    const responses = [await fetchKey('avatar/mem_1/a.jpg'), await fetchKey(`sticker/${STICKER}.gif`), await fetchKey(`sticker/${STICKER}.gif`, { 'if-none-match': '"e1"' })];
    expect(responses.map((res) => res.status)).toEqual([200, 200, 304]);
    for (const res of responses) {
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cross-origin-resource-policy')).toBeNull();
    }
  });
});
