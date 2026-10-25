import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrollmentCalendarYear, type AdminChannelRow, type ChannelIconResponse, type Role } from '@utmmsc/shared';
import { issueProfileMediaToken, readProfileMediaToken } from '../../../domain/profile/media-token';
import type { Env } from '../../../env';
import { findMemberById, type MemberRow } from '../../../infrastructure/d1/members';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { isServableMediaKey, serveMemberMedia } from '../members/media';
import { CHANNEL_ICON_MESSAGES, channelRoutes } from './index';

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
vi.mock('../../rooms');

describe('channel routes', () => {
  const paths = channelRoutes.routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`);

  it('adds the icon routes beside the channel routes', () => {
    for (const route of ['POST /:id/icon', 'POST /:id/icon/preset', 'DELETE /:id/icon', 'DELETE /:id', 'PATCH /:id', 'GET /:id', 'GET /']) {
      expect(paths).toContain(route);
    }
  });
});

/* Image bytes */

const u32le = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/** A lossy WebP key frame of this size, padded to `pad` bytes of partition data. */
/** 该尺寸的有损 WebP 关键帧，分区数据填充到 `pad` 字节。 */
function webp(width: number, height = width, pad = 64): Uint8Array {
  const data = [0x10, 0x2b, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, ...new Array<number>(pad).fill(0x55)];
  const chunk = [...ascii('VP8 '), ...u32le(data.length), ...data];
  return Uint8Array.from([...ascii('RIFF'), ...u32le(4 + chunk.length), ...ascii('WEBP'), ...chunk]);
}

/** A baseline JPEG of this size. */
/** 该尺寸的基线 JPEG。 */
function jpeg(width: number, height = width): Uint8Array {
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00, 0x12, 0x34];
  return Uint8Array.from([0xff, 0xd8, ...sof, ...sos, 0xff, 0xd9]);
}

interface Part {
  bytes: Uint8Array;
  type: string;
}

const webpPair = (): { icon: Part; thumb: Part } => ({ icon: { bytes: webp(256), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } });

/* A stand-in R2 bucket */

interface StoredObject {
  bytes: Uint8Array;
  options: R2PutOptions | undefined;
}

function fakeBucket() {
  const objects = new Map<string, StoredObject>();
  const deleted: string[] = [];
  const failPut = { key: null as string | null };
  const describe = (key: string, stored: StoredObject) => ({
    key,
    size: stored.bytes.byteLength,
    etag: `etag-${key.length}`,
    httpEtag: `"etag-${key.length}"`,
    uploaded: new Date(0),
    httpMetadata: stored.options?.httpMetadata,
    writeHttpMetadata: (headers: Headers) => {
      const meta = stored.options?.httpMetadata as R2HTTPMetadata | undefined;
      if (meta?.contentType) headers.set('content-type', meta.contentType);
      if (meta?.cacheControl) headers.set('cache-control', meta.cacheControl);
    },
  });
  const bucket = {
    put: vi.fn(async (key: string, value: ArrayBuffer | Uint8Array, options?: R2PutOptions) => {
      if (failPut.key && key.endsWith(failPut.key)) throw new Error('R2 put failed');
      objects.set(key, { bytes: new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)), options });
      return describe(key, objects.get(key) as StoredObject);
    }),
    head: vi.fn(async (key: string) => {
      const stored = objects.get(key);
      return stored ? describe(key, stored) : null;
    }),
    get: vi.fn(async (key: string, options?: { range?: unknown }) => {
      const stored = objects.get(key);
      if (!stored) return null;
      const range = options?.range as { offset?: number; length?: number } | undefined;
      const offset = typeof range?.offset === 'number' ? range.offset : 0;
      const length = typeof range?.length === 'number' ? range.length : stored.bytes.byteLength - offset;
      const bytes = stored.bytes.slice(offset, offset + length);
      return { ...describe(key, stored), body: new Response(bytes).body, arrayBuffer: async () => bytes.buffer, range: { offset, length } };
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        deleted.push(key);
        objects.delete(key);
      }
    }),
  };
  return { bucket, objects, deleted, failPut };
}

/* Requests */

const SECRET = 'test-secret';
const app = new Hono<AppEnv>();
app.onError(errorResponse);
app.get('/members/media/*', serveMemberMedia);
app.route('/channels', channelRoutes);

let d1: SqliteD1;
let storage: ReturnType<typeof fakeBucket>;
let db: D1Database;
let withBucket = true;
let seq = 0;

async function addMember(role: Role = 'president', acting: Role | null = null): Promise<MemberRow> {
  seq += 1;
  const id = `mem_${seq}`;
  const now = new Date().toISOString();
  d1.rows(
    `INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at, acting_role)
     VALUES (?, ?, ?, 'x', 'active', ?, 'student', ?, ?, ?, ?)`,
    id,
    `m${seq}@mail.utoronto.ca`,
    `成员${seq}`,
    role,
    enrollmentCalendarYear(),
    now,
    now,
    acting,
  );
  const row = await findMemberById(d1.db, id);
  if (!row) throw new Error('member insert failed');
  session.members.set(row.id, row);
  return row;
}

function env(): Env {
  return { DB: db, SESSION_SECRET: SECRET, FILES: withBucket ? storage.bucket : undefined } as unknown as Env;
}

async function request(member: MemberRow | null, method: string, path: string, init: { json?: unknown; body?: BodyInit; headers?: Record<string, string> } = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9', ...init.headers };
  if (member) headers['x-member'] = member.id;
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const response = await app.request(path, { method, headers, body }, env(), ctx);
  await Promise.all(pending);
  return response;
}

async function send<T = Record<string, unknown>>(member: MemberRow, method: string, path: string, init: { json?: unknown } = {}): Promise<{ status: number; json: T }> {
  const response = await request(member, method, path, init);
  return { status: response.status, json: (await response.json()) as T };
}

/** POST /channels/:id/icon with these parts and any extra fields, as a browser sends FormData. */
/** 像浏览器发送 FormData 一样，以这些部分和额外字段调用 POST /channels/:id/icon。 */
async function upload<T = ChannelIconResponse>(member: MemberRow, channelId: string, parts: { icon?: Part; thumb?: Part }, extra: Record<string, string> = {}) {
  const form = new FormData();
  if (parts.icon) form.append('icon', new File([parts.icon.bytes], 'icon', { type: parts.icon.type }));
  if (parts.thumb) form.append('thumb', new File([parts.thumb.bytes], 'thumb', { type: parts.thumb.type }));
  for (const [name, value] of Object.entries(extra)) form.append(name, value);
  const encoded = new Response(form);
  const body = await encoded.arrayBuffer();
  const response = await request(member, 'POST', `/channels/${channelId}/icon`, {
    body,
    headers: { 'content-type': encoded.headers.get('content-type') ?? '', 'content-length': String(body.byteLength) },
  });
  return { status: response.status, json: (await response.json()) as T };
}

const errorOf = (json: unknown) => (json as { error: { code: string; message: string } }).error;
const iconKeyOf = (channelId = 'ch_all') => d1.rows<{ icon_key: string | null; icon_updated_at: string | null }>('SELECT icon_key, icon_updated_at FROM channels WHERE id = ?', channelId)[0];
const UPLOAD_KEY = /^channel-icon\/ch_all\/cic_[A-Za-z0-9_-]{16}\.webp$/;

beforeEach(() => {
  if (sqlite) d1 = createSqliteD1();
  db = d1?.db;
  storage = fakeBucket();
  withBucket = true;
});

afterEach(() => {
  d1?.close();
});

describe.skipIf(!sqlite)('POST /channels/:id/icon', () => {
  it('stores the icon and its thumbnail under a new key and points the channel at them', async () => {
    const president = await addMember();
    const result = await upload(president, 'ch_all', webpPair());
    expect(result.status).toBe(200);
    const key = result.json.channel.iconKey as string;
    expect(key).toMatch(UPLOAD_KEY);
    const thumbKey = key.replace(/\.webp$/, '-96.webp');
    expect([...storage.objects.keys()].sort()).toEqual([key, thumbKey].sort());
    for (const stored of storage.objects.values()) {
      expect(stored.options?.httpMetadata).toEqual({ contentType: 'image/webp', cacheControl: 'private, max-age=31536000, immutable' });
    }
    expect(storage.objects.get(key)?.bytes).toEqual(webp(256));
    expect(storage.objects.get(thumbKey)?.bytes).toEqual(webp(96));
    expect(iconKeyOf()).toEqual({ icon_key: key, icon_updated_at: result.json.channel.iconUpdatedAt });
    expect(result.json.channel.iconUpdatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(result.json.channel).toMatchObject({ id: 'ch_all', name: '全体成员', audience: 'all' });
    expect(await readProfileMediaToken(SECRET, result.json.mediaToken ?? '')).toBe(true);
    expect(storage.deleted).toEqual([]);
  });

  it('stores a JPEG pair with the jpg extension', async () => {
    const president = await addMember();
    const result = await upload(president, 'ch_all', { icon: { bytes: jpeg(256), type: 'image/jpeg' }, thumb: { bytes: jpeg(96), type: 'image/jpeg' } });
    expect(result.status).toBe(200);
    const key = result.json.channel.iconKey as string;
    expect(key).toMatch(/^channel-icon\/ch_all\/cic_[A-Za-z0-9_-]{16}\.jpg$/);
    expect(storage.objects.get(key.replace(/\.jpg$/, '-96.jpg'))?.options?.httpMetadata).toMatchObject({ contentType: 'image/jpeg' });
  });

  it('deletes both objects of the upload it replaces, and never a preset', async () => {
    const president = await addMember();
    const first = (await upload(president, 'ch_all', webpPair())).json.channel.iconKey as string;
    const second = (await upload(president, 'ch_all', webpPair())).json.channel.iconKey as string;
    expect(second).not.toBe(first);
    expect(storage.deleted.sort()).toEqual([first, first.replace(/\.webp$/, '-96.webp')].sort());
    expect([...storage.objects.keys()].sort()).toEqual([second, second.replace(/\.webp$/, '-96.webp')].sort());

    storage.deleted.length = 0;
    expect((await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'tech' } })).status).toBe(200);
    expect(storage.deleted).toHaveLength(2);
    storage.deleted.length = 0;
    expect((await upload(president, 'ch_all', webpPair())).status).toBe(200);
    expect(storage.deleted).toEqual([]);
  });

  it('refuses icons that are not WebP or JPEG, or whose two parts differ in type', async () => {
    const president = await addMember();
    const cases: { icon: Part; thumb: Part }[] = [
      { icon: { bytes: webp(256), type: 'image/png' }, thumb: { bytes: webp(96), type: 'image/png' } },
      { icon: { bytes: webp(256), type: 'image/webp' }, thumb: { bytes: jpeg(96), type: 'image/jpeg' } },
      // The declared type must match the bytes.
      // 声明的类型必须与字节一致。
      { icon: { bytes: jpeg(256), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } },
      { icon: { bytes: webp(256), type: 'image/webp' }, thumb: { bytes: jpeg(96), type: 'image/webp' } },
      { icon: { bytes: Uint8Array.from(ascii('<svg/>')), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } },
    ];
    for (const parts of cases) {
      const result = await upload(president, 'ch_all', parts);
      expect(result.status).toBe(400);
      expect(errorOf(result.json)).toEqual({ code: 'invalid_icon', message: CHANNEL_ICON_MESSAGES.type });
    }
    expect(storage.bucket.put).not.toHaveBeenCalled();
    expect(iconKeyOf()?.icon_key).toBeNull();
  });

  it('refuses an icon or thumbnail that is not exactly 256 or 96 square', async () => {
    const president = await addMember();
    for (const parts of [
      { icon: { bytes: webp(255), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } },
      { icon: { bytes: webp(256, 255), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } },
      { icon: { bytes: webp(256), type: 'image/webp' }, thumb: { bytes: webp(128), type: 'image/webp' } },
      { icon: { bytes: webp(96), type: 'image/webp' }, thumb: { bytes: webp(256), type: 'image/webp' } },
    ]) {
      const result = await upload(president, 'ch_all', parts);
      expect(result.status).toBe(400);
      expect(errorOf(result.json)).toEqual({ code: 'invalid_icon', message: CHANNEL_ICON_MESSAGES.size });
    }
    expect(storage.bucket.put).not.toHaveBeenCalled();
  });

  it('refuses parts over their byte caps, and a request over the total before reading it', async () => {
    const president = await addMember();
    const big = await upload(president, 'ch_all', { icon: { bytes: webp(256, 256, 256 * 1024), type: 'image/webp' }, thumb: { bytes: webp(96), type: 'image/webp' } });
    expect(errorOf(big.json)).toEqual({ code: 'too_large', message: CHANNEL_ICON_MESSAGES.tooLarge });
    const bigThumb = await upload(president, 'ch_all', { icon: { bytes: webp(256), type: 'image/webp' }, thumb: { bytes: webp(96, 96, 64 * 1024), type: 'image/webp' } });
    expect(errorOf(bigThumb.json).code).toBe('too_large');
    // Both parts are within their caps, so only the early content-length check can refuse this one.
    // 两个部分都在各自的上限之内，因此只有提前的 content-length 检查会拒绝这一次。
    const padded = await upload(president, 'ch_all', webpPair(), { junk: 'x'.repeat(340 * 1024) });
    expect(padded.status).toBe(400);
    expect(errorOf(padded.json).code).toBe('too_large');
    expect(storage.bucket.put).not.toHaveBeenCalled();
  });

  it('names a missing part and refuses an empty one', async () => {
    const president = await addMember();
    expect(errorOf((await upload(president, 'ch_all', { icon: webpPair().icon })).json)).toEqual({ code: 'missing_field', message: '缺少 缩略图' });
    expect(errorOf((await upload(president, 'ch_all', {})).json)).toEqual({ code: 'missing_field', message: '缺少 图标' });
    const empty = await upload(president, 'ch_all', { icon: { bytes: new Uint8Array(), type: 'image/webp' }, thumb: webpPair().thumb });
    expect(errorOf(empty.json)).toEqual({ code: 'empty_file', message: '文件为空' });
    const json = await send(president, 'POST', '/channels/ch_all/icon', { json: { icon: 'x' } });
    expect(errorOf(json.json).code).toBe('missing_field');
  });

  it('needs channels.manage by the viewed role', async () => {
    for (const member of [await addMember('student'), await addMember('secretary_general'), await addMember('superadmin', 'secretary_general')]) {
      expect((await upload(member, 'ch_all', webpPair())).status).toBe(403);
      expect((await send(member, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'tech' } })).status).toBe(403);
      expect((await send(member, 'DELETE', '/channels/ch_all/icon')).status).toBe(403);
    }
    expect(storage.bucket.put).not.toHaveBeenCalled();
    expect((await upload(await addMember('superadmin'), 'ch_all', webpPair())).status).toBe(200);
  });

  it('answers 404 for a channel that does not exist', async () => {
    const president = await addMember();
    expect((await upload(president, 'ch_missing', webpPair())).status).toBe(404);
    expect((await send(president, 'POST', '/channels/ch_missing/icon/preset', { json: { id: 'tech' } })).status).toBe(404);
    expect((await send(president, 'DELETE', '/channels/ch_missing/icon')).status).toBe(404);
  });

  it('answers 503 without a bucket, while presets still work', async () => {
    withBucket = false;
    const president = await addMember();
    const result = await upload(president, 'ch_all', webpPair());
    expect(result.status).toBe(503);
    expect(errorOf(result.json).code).toBe('storage_unavailable');
    const preset = await send<ChannelIconResponse>(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'announce' } });
    expect(preset.status).toBe(200);
    expect(preset.json.channel.iconKey).toBe('preset:announce');
  });

  it('allows 10 icon changes a minute per member across upload and preset', async () => {
    const president = await addMember();
    for (let i = 0; i < 10; i += 1) expect((await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'chat' } })).status).toBe(200);
    expect((await upload(president, 'ch_all', webpPair())).status).toBe(429);
    expect((await upload(await addMember(), 'ch_all', webpPair())).status).toBe(200);
  });

  it('cleans up the new objects when storing one of them fails', async () => {
    const president = await addMember();
    storage.failPut.key = '-96.webp';
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await upload(president, 'ch_all', webpPair())).status).toBe(500);
    error.mockRestore();
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(2);
    expect(iconKeyOf()?.icon_key).toBeNull();
  });
});

describe.skipIf(!sqlite)('two admins changing one icon', () => {
  const RIVAL_A = 'channel-icon/ch_all/cic_AAAAAAAAAAAAAAAA.webp';
  const RIVAL_B = 'channel-icon/ch_all/cic_BBBBBBBBBBBBBBBB.webp';

  /**
   * The database, with another admin's edit landing just before each of the first compare-and-swaps.
   * 数据库；在前几次比较并交换之前，各插入一次另一位管理员的修改。
   */
  function racing(rivalKeys: (string | Error)[]): D1Database {
    const base = d1.db;
    return {
      ...base,
      prepare: (sql: string) => {
        const statement = base.prepare(sql);
        if (!sql.startsWith('UPDATE channels SET icon_key')) return statement;
        return {
          bind: (...values: unknown[]) => {
            const bound = statement.bind(...values);
            return {
              run: async () => {
                const rival = rivalKeys.shift();
                if (rival instanceof Error) throw rival;
                if (rival !== undefined) d1.rows('UPDATE channels SET icon_key = ?, icon_updated_at = ? WHERE id = ?', rival, new Date().toISOString(), values[2]);
                return bound.run();
              },
            };
          },
        };
      },
    } as unknown as D1Database;
  }

  function storeRival(key: string) {
    for (const k of [key, key.replace(/\.webp$/, '-96.webp')]) storage.objects.set(k, { bytes: webp(96), options: undefined });
  }

  it('reads the row again and wins on the retry, deleting only what it replaced', async () => {
    const president = await addMember();
    storeRival(RIVAL_A);
    db = racing([RIVAL_A]);
    const result = await upload(president, 'ch_all', webpPair());
    expect(result.status).toBe(200);
    const key = result.json.channel.iconKey as string;
    expect(iconKeyOf()?.icon_key).toBe(key);
    expect(storage.deleted.sort()).toEqual([RIVAL_A, RIVAL_A.replace(/\.webp$/, '-96.webp')].sort());
  });

  it('gives up with 409 after a second miss and deletes only its own new objects', async () => {
    const president = await addMember();
    storeRival(RIVAL_B);
    db = racing([RIVAL_A, RIVAL_B]);
    const result = await upload(president, 'ch_all', webpPair());
    expect(result.status).toBe(409);
    expect(errorOf(result.json)).toEqual({ code: 'icon_conflict', message: CHANNEL_ICON_MESSAGES.conflict });
    expect(iconKeyOf()?.icon_key).toBe(RIVAL_B);
    expect([...storage.objects.keys()].sort()).toEqual([RIVAL_B, RIVAL_B.replace(/\.webp$/, '-96.webp')].sort());
    expect(storage.deleted.every((key) => key !== RIVAL_B && /cic_[A-Za-z0-9_-]{16}(-96)?\.webp$/.test(key))).toBe(true);
    expect(storage.deleted).toHaveLength(2);
  });

  it('treats a preset change the same way', async () => {
    const president = await addMember();
    db = racing(['preset:alumni', 'preset:events']);
    const result = await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'tech' } });
    expect(result.status).toBe(409);
    expect(iconKeyOf()?.icon_key).toBe('preset:events');
  });

  it('answers 503 and deletes the new objects when the column is missing at write time', async () => {
    const president = await addMember();
    db = racing([new Error('D1_ERROR: no such column: icon_key: SQLITE_ERROR')]);
    const result = await upload(president, 'ch_all', webpPair());
    expect(result.status).toBe(503);
    expect(errorOf(result.json)).toEqual({ code: 'schema_pending', message: CHANNEL_ICON_MESSAGES.pending });
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(2);
  });
});

describe.skipIf(!sqlite)('POST /channels/:id/icon/preset and DELETE /channels/:id/icon', () => {
  it('sets a bundled preset', async () => {
    const president = await addMember();
    const result = await send<ChannelIconResponse>(president, 'POST', '/channels/ch_notices/icon/preset', { json: { id: 'announce' } });
    expect(result.status).toBe(200);
    expect(result.json.channel.iconKey).toBe('preset:announce');
    expect(result.json).not.toHaveProperty('mediaToken');
    expect(iconKeyOf('ch_notices')?.icon_key).toBe('preset:announce');
  });

  it('refuses a preset that does not exist', async () => {
    const president = await addMember();
    for (const id of ['nope', 'preset:tech', '', 7, null]) {
      const result = await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id } });
      expect(result.status).toBe(400);
      expect(errorOf(result.json)).toEqual({ code: 'invalid_icon_preset', message: CHANNEL_ICON_MESSAGES.preset });
    }
  });

  it('goes back to the text tile and deletes an uploaded image', async () => {
    const president = await addMember();
    const key = (await upload(president, 'ch_all', webpPair())).json.channel.iconKey as string;
    const result = await send<ChannelIconResponse>(president, 'DELETE', '/channels/ch_all/icon');
    expect(result.status).toBe(200);
    expect(result.json.channel.iconKey).toBeNull();
    expect(typeof result.json.channel.iconUpdatedAt).toBe('string');
    expect(storage.deleted.sort()).toEqual([key, key.replace(/\.webp$/, '-96.webp')].sort());
    expect(storage.objects.size).toBe(0);
  });

  it('leaves files alone when the icon was a preset or nothing', async () => {
    const president = await addMember();
    expect((await send(president, 'DELETE', '/channels/ch_all/icon')).status).toBe(200);
    await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'tech' } });
    expect((await send(president, 'DELETE', '/channels/ch_all/icon')).status).toBe(200);
    expect(storage.bucket.delete).not.toHaveBeenCalled();
  });
});

describe.skipIf(!sqlite)('channel rows and channel delete', () => {
  it('lists iconKey and iconUpdatedAt for every channel', async () => {
    const president = await addMember();
    await send(president, 'POST', '/channels/ch_alumni/icon/preset', { json: { id: 'alumni' } });
    const list = await send<{ channels: AdminChannelRow[] }>(president, 'GET', '/channels');
    const alumni = list.json.channels.find((channel) => channel.id === 'ch_alumni');
    expect(alumni?.iconKey).toBe('preset:alumni');
    expect(alumni?.iconUpdatedAt).toEqual(iconKeyOf('ch_alumni')?.icon_updated_at);
    expect(list.json.channels.find((channel) => channel.id === 'ch_all')).toMatchObject({ iconKey: null, iconUpdatedAt: null });
    const one = await send<{ channel: AdminChannelRow }>(president, 'GET', '/channels/ch_alumni');
    expect(one.json.channel.iconKey).toBe('preset:alumni');
  });

  it('deletes the uploaded icon with the channel', async () => {
    const president = await addMember();
    const created = await send<{ channel: AdminChannelRow }>(president, 'POST', '/channels', { json: { name: '学术交流', audience: 'all', postPolicy: 'members' } });
    expect(created.status).toBe(201);
    const id = created.json.channel.id;
    const key = (await upload(president, id, webpPair())).json.channel.iconKey as string;
    expect(key.startsWith(`channel-icon/${id}/`)).toBe(true);
    expect((await send(president, 'DELETE', `/channels/${id}`)).status).toBe(200);
    expect(d1.rows('SELECT id FROM channels WHERE id = ?', id)).toEqual([]);
    expect(storage.deleted.sort()).toEqual([key, key.replace(/\.webp$/, '-96.webp')].sort());
  });

  it('keeps a preset file when its channel is deleted', async () => {
    const president = await addMember();
    await send(president, 'POST', '/channels/ch_alumni/icon/preset', { json: { id: 'alumni' } });
    expect((await send(president, 'DELETE', '/channels/ch_alumni')).status).toBe(200);
    expect(storage.bucket.delete).not.toHaveBeenCalled();
  });
});

describe.skipIf(!sqlite)('before migration 0018', () => {
  beforeEach(() => {
    d1.close();
    d1 = createSqliteD1({ migrate: false });
    d1.migrate({ to: 17 });
    db = d1.db;
  });

  it('answers 503 schema_pending on every icon route and stores nothing', async () => {
    const president = await addMember();
    const uploaded = await upload(president, 'ch_all', webpPair());
    expect(uploaded.status).toBe(503);
    expect(errorOf(uploaded.json)).toEqual({ code: 'schema_pending', message: CHANNEL_ICON_MESSAGES.pending });
    expect((await send(president, 'POST', '/channels/ch_all/icon/preset', { json: { id: 'tech' } })).status).toBe(503);
    expect((await send(president, 'DELETE', '/channels/ch_all/icon')).status).toBe(503);
    expect(storage.bucket.put).not.toHaveBeenCalled();
  });

  it('leaves the icon fields out of channel rows, and still deletes channels', async () => {
    const president = await addMember();
    const list = await send<{ channels: AdminChannelRow[] }>(president, 'GET', '/channels');
    expect(list.status).toBe(200);
    for (const channel of list.json.channels) {
      expect(channel).not.toHaveProperty('iconKey');
      expect(channel).not.toHaveProperty('iconUpdatedAt');
    }
    expect((await send(president, 'DELETE', '/channels/ch_alumni')).status).toBe(200);
    expect(storage.bucket.delete).not.toHaveBeenCalled();
  });
});

describe.skipIf(!sqlite)('GET /members/media/* for channel icons', () => {
  it('serves an uploaded icon and its thumbnail with a year of immutable caching', async () => {
    const president = await addMember();
    const key = (await upload(president, 'ch_all', webpPair())).json.channel.iconKey as string;
    const token = await issueProfileMediaToken(SECRET);
    for (const [objectKey, bytes] of [
      [key, webp(256)],
      [key.replace(/\.webp$/, '-96.webp'), webp(96)],
    ] as const) {
      const response = await request(null, 'GET', `/members/media/${objectKey}?t=${token}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    }
  });

  it('refuses keys under channel-icon/ that are not an icon upload, and a bad token', async () => {
    const token = await issueProfileMediaToken(SECRET);
    for (const key of ['channel-icon/ch_all/notes.txt', 'channel-icon/ch_all/cic_AAAAAAAAAAAAAAAA.png', 'channel-icon/..%2Favatar%2Fa%2Fb.png', 'files/governance/x.pdf']) {
      expect((await request(null, 'GET', `/members/media/${key}?t=${token}`)).status).toBe(403);
    }
    expect((await request(null, 'GET', '/members/media/channel-icon/ch_all/cic_AAAAAAAAAAAAAAAA.webp?t=bad')).status).toBe(401);
    expect((await request(null, 'GET', `/members/media/channel-icon/ch_all/cic_AAAAAAAAAAAAAAAA.webp?t=${token}`)).status).toBe(404);
  });

  it('still serves member media as before', async () => {
    storage.objects.set('avatar/mem_1/ava_x.png', { bytes: Uint8Array.from([1, 2, 3]), options: { httpMetadata: { contentType: 'image/png' } } });
    const token = await issueProfileMediaToken(SECRET);
    const response = await request(null, 'GET', `/members/media/avatar/mem_1/ava_x.png?t=${token}`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
  });
});

describe('isServableMediaKey', () => {
  it('allows member media prefixes and exact channel icon keys only', () => {
    expect(isServableMediaKey('avatar/m/a.png')).toBe(true);
    expect(isServableMediaKey('cover/m/c.jpg')).toBe(true);
    expect(isServableMediaKey('moments/m/x.mp4')).toBe(true);
    expect(isServableMediaKey('channel-icon/ch_1/cic_AAAAAAAAAAAAAAAA.webp')).toBe(true);
    expect(isServableMediaKey('channel-icon/ch_1/cic_AAAAAAAAAAAAAAAA-96.jpg')).toBe(true);
    expect(isServableMediaKey('channel-icon/ch_1/cic_AAAAAAAAAAAAAAAA-96-96.jpg')).toBe(false);
    expect(isServableMediaKey('channel-icon/ch_1/')).toBe(false);
    expect(isServableMediaKey('avatar/../files/x')).toBe(false);
    expect(isServableMediaKey('chat/room/x.webp')).toBe(false);
  });
});
