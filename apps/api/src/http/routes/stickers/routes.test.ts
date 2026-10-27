import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STICKERS_PER_MEMBER_MAX,
  STICKER_CLUB_LIVE_BYTES,
  STICKER_CLUB_UPLOADS_PER_DAY,
  STICKER_CLUB_UPLOAD_BYTES_PER_DAY,
  STICKER_EDITS_PER_DAY,
  STICKER_FULL_LISTS_PER_DAY,
  STICKER_LIVE_BYTES_PER_MEMBER,
  STICKER_MAX_BYTES,
  STICKER_MESSAGES,
  STICKER_THUMB_MAX_BYTES,
  STICKER_UPLOADS_PER_DAY,
  STICKER_UPLOAD_REQUEST_MAX_BYTES,
  enrollmentCalendarYear,
  stickerDay,
  type Role,
  type StickerAddResponse,
  type StickerListResponse,
} from '@utmmsc/shared';
import { bytesToHex } from '../../../domain/crypto/encoding';
import { issueSessionToken } from '../../../domain/identity/session-token';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { stickerObjectId, stickerThumbToken } from '../../../domain/stickers/ids';
import type { Env } from '../../../env';
import { sweepStickers } from '../../../infrastructure/d1/sticker-maintenance';
import { blockSticker } from '../../../infrastructure/d1/stickers';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { stickerRoutes } from './index';

/**
 * The sticker routes over real SQLite (with D1's limits) and real sessions, with a bucket that checks every put's
 * SHA-256 as R2 does. The in-memory limiters are switched off except in the test that checks them, so the durable
 * caps in D1 are what the other tests meet.
 * 表情接口的测试，运行在真实 SQLite（带 D1 的限制）和真实会话之上，存储桶像 R2 一样检查每次写入的 SHA-256。
 * 内存限流只在检查它的那个测试中打开，其他测试遇到的都是 D1 中的持久上限。
 */

const limits = vi.hoisted(() => ({ on: false }));

vi.mock('../../middleware/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/rate-limit')>();
  type Middleware = ReturnType<typeof actual.rateLimit>;
  const switchable =
    (real: Middleware): Middleware =>
    async (c, next) =>
      limits.on ? real(c, next) : next();
  return {
    ...actual,
    rateLimit: (limit: number, windowMs: number) => switchable(actual.rateLimit(limit, windowMs)),
    memberRateLimit: (name: string, limit: number, windowMs: number) => switchable(actual.memberRateLimit(name, limit, windowMs)),
  };
});

const SECRET = 'test-session-secret';

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

/** A minimal well-formed GIF: `frames` image blocks whose data carries `seed`, so each seed gives other bytes. */
/** 最小的格式完好的 GIF：`frames` 个图像块，数据中带有 `seed`，因此不同的 seed 得到不同的字节。 */
function gif(seed: number, options: { width?: number; height?: number; frames?: number; pad?: number } = {}): Uint8Array {
  const { width = 240, height = 240, frames = 1, pad = 0 } = options;
  const bytes = [...'GIF89a'].map((ch) => ch.charCodeAt(0));
  bytes.push(...u16le(width), ...u16le(height), 0, 0, 0);
  // A comment extension of 255-byte sub-blocks, to give a file its size.
  // 由 255 字节子块组成的注释扩展，用来撑出文件大小。
  if (pad > 0) {
    bytes.push(0x21, 0xfe);
    for (let left = pad; left > 0; left -= 255) {
      const size = Math.min(255, left);
      bytes.push(size, ...new Array<number>(size).fill(0x20));
    }
    bytes.push(0);
  }
  for (let frame = 0; frame < frames; frame += 1) {
    bytes.push(0x2c, 0, 0, 0, 0, ...u16le(width), ...u16le(height), 0, 2, 4, seed & 0xff, (seed >> 8) & 0xff, (seed >> 16) & 0xff, frame & 0xff, 0);
  }
  bytes.push(0x3b);
  return Uint8Array.from(bytes);
}

function pngChunk(type: string, data: number[]): number[] {
  return [...u32be(data.length), ...[...type].map((ch) => ch.charCodeAt(0)), ...data, 0, 0, 0, 0];
}

/** A minimal well-formed PNG still (the sniffer does not check CRCs). */
/** 最小的格式完好的 PNG 静态图（嗅探器不检查 CRC）。 */
function png(seed = 0, width = 120, height = 120): Uint8Array {
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0]),
    ...pngChunk('IDAT', [seed & 0xff, (seed >> 8) & 0xff, 1, 2]),
    ...pngChunk('IEND', []),
  ]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

interface StoredObject {
  bytes: Uint8Array;
  type: string;
}

const R2_INTERNAL_ERROR = 'We encountered an internal error. Please try again. (10001)';

/**
 * A bucket that verifies sha256 like R2 (with R2's error text) and records every put and delete. `beforePut` runs
 * while a put is in flight, before it lands, so a test can let a block or the sweep happen in between.
 * 像 R2 一样校验 sha256（使用 R2 的错误文字）并记录每次写入和删除的存储桶。`beforePut` 在写入进行中、完成之前执行，
 * 测试因此可以让封禁或清理恰好发生在这段时间里。
 */
function fakeBucket() {
  const objects = new Map<string, StoredObject>();
  const calls: string[] = [];
  const state: { failPuts: boolean; failDeletes: boolean; beforePut: ((key: string) => Promise<void>) | null } = {
    failPuts: false,
    failDeletes: false,
    beforePut: null,
  };
  const bucket = {
    put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions) => {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
      await state.beforePut?.(key);
      if (state.failPuts) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
      if (typeof options?.sha256 === 'string' && options.sha256 !== (await sha256(bytes))) {
        throw new Error('put: The SHA-256 checksum you specified did not match what we received. (10037)');
      }
      calls.push(`put ${key}`);
      objects.set(key, { bytes, type: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType ?? '' });
      return null;
    },
    delete: async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      calls.push(`delete ${list.join(' ')}`);
      if (state.failDeletes) throw new Error(`delete: ${R2_INTERNAL_ERROR}`);
      for (const key of list) objects.delete(key);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, objects, calls, state };
}

describe.skipIf(!sqlite)('sticker routes on SQLite', () => {
  let d1: SqliteD1;
  let files: ReturnType<typeof fakeBucket>;
  const tokens = new Map<string, string>();
  /** Every promise a request handed to waitUntil, to outlive a client that went away. */
  /** 请求交给 waitUntil 的每个 promise，用于在客户端离开之后继续执行。 */
  const waits: Promise<unknown>[] = [];
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.route('/stickers', stickerRoutes);

  const env = (extra: Partial<Env> = {}) => ({ DB: d1.db, SESSION_SECRET: SECRET, FILES: files.bucket, ...extra }) as unknown as Env;

  async function addMember(id: string, role: Role = 'student', actingRole: Role | null = null) {
    const now = new Date().toISOString();
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, acting_role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', 'active', ?, ?, 'student', ?, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      id,
      role,
      actingRole,
      enrollmentCalendarYear(),
      now,
      now,
    );
    const expires = new Date(Date.now() + 86_400_000);
    d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `ses_${id}`, id, expires.toISOString(), now);
    tokens.set(id, await issueSessionToken(SECRET, `ses_${id}`, id, expires));
  }

  function call(memberId: string | null, method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit; extra?: Partial<Env> } = {}) {
    const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7', ...init.headers };
    if (memberId) headers.authorization = `Bearer ${tokens.get(memberId)}`;
    const ctx = { waitUntil: (promise: Promise<unknown>) => void waits.push(promise), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    const request: RequestInit & { duplex?: 'half' } = { method, headers, body: init.body };
    if (init.body instanceof ReadableStream) request.duplex = 'half';
    return app.request(path, request, env(init.extra), ctx);
  }

  const json = (memberId: string, path: string, body: unknown) =>
    call(memberId, 'POST', path, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  async function upload(
    memberId: string,
    file: Uint8Array,
    still: Uint8Array = png(),
    init: { sha?: string; thumbSha?: string; headers?: Record<string, string>; extra?: Partial<Env> } = {},
  ) {
    const body = concat(still, file);
    const header = `${init.sha ?? (await sha256(file))}.${init.thumbSha ?? (await sha256(still))}.${still.length}`;
    return call(memberId, 'POST', '/stickers/upload', {
      headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length), 'x-sticker': header, ...init.headers },
      body,
      extra: init.extra,
    });
  }

  async function errorOf(res: Response): Promise<{ status: number; code: string; message: string }> {
    const body = (await res.json()) as { error: { code: string; message: string } };
    return { status: res.status, ...body.error };
  }

  const idOf = async (file: Uint8Array) => stickerObjectId(SECRET, await sha256(file));
  const thumbOf = async (file: Uint8Array, still: Uint8Array) => stickerThumbToken(SECRET, await idOf(file), await sha256(still));
  /** The original under every type, the keys a block or the sweep deletes for it. */
  /** 每种类型下的原始文件，即封禁或清理任务为它删除的键。 */
  const originals = (id: string) => ['gif', 'png', 'webp', 'jpeg'].map((type) => `sticker/${id}.${type}`);
  const today = () => stickerDay(Date.now());
  const daily = (scope: string) =>
    d1.rows<{ uploads: number; upload_bytes: number; edits: number; lists: number }>(
      'SELECT uploads, upload_bytes, edits, lists FROM sticker_daily WHERE day = ? AND scope = ?',
      today(),
      scope,
    )[0];
  const counts = (scope: string) => d1.rows<{ items: number; live_bytes: number; version: number }>('SELECT items, live_bytes, version FROM sticker_counts WHERE scope = ?', scope)[0];
  const rowsOf = (memberId: string) =>
    d1.rows<{ sticker_id: string; thumb: string | null }>('SELECT sticker_id, thumb FROM member_stickers WHERE member_id = ? ORDER BY position DESC, sticker_id', memberId);
  const listOf = async (memberId: string) => (await (await call(memberId, 'GET', '/stickers')).json()) as StickerListResponse & { stickers: StickerAddResponse['sticker'][] };

  /** Ready files numbered from..to (stk_ and 22 digits), optionally in a member's collection with the count set. */
  /** 编号从 from 到 to 的 ready 文件（stk_ 加 22 位数字），可选择放进某位成员的表情列表并设置计数。 */
  const sid = (i: number) => `stk_${String(i).padStart(22, '0')}`;
  function seedFiles(from: number, to: number, memberId?: string) {
    const now = new Date().toISOString();
    d1.exec(`WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})
      INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at)
      SELECT 'stk_' || printf('%022d', i), 'png', 200, 200, 1000, 0, 'ready', NULL, '${now}', '${now}' FROM n`);
    if (!memberId) return;
    d1.exec(`WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})
      INSERT INTO member_stickers (member_id, sticker_id, thumb, position, added_at)
      SELECT '${memberId}', 'stk_' || printf('%022d', i), NULL, 1000000 - i, '${now}' FROM n`);
    d1.rows(
      `INSERT INTO sticker_counts (scope, items, version) VALUES (?1, (SELECT COUNT(*) FROM member_stickers WHERE member_id = ?1), 1)
       ON CONFLICT (scope) DO UPDATE SET items = excluded.items`,
      memberId,
    );
  }

  beforeEach(async () => {
    d1 = createSqliteD1();
    files = fakeBucket();
    tokens.clear();
    waits.length = 0;
    limits.on = false;
    await addMember('mem_ann');
    await addMember('mem_bob');
    await addMember('mem_cat');
    await addMember('mem_root', 'superadmin', 'student');
    await addMember('mem_pres', 'president');
  });

  afterEach(() => d1.close());

  describe('POST /stickers/upload', () => {
    it('stores the original and the still with their sniffed types, then a ready file, its still and the uploader’s row', async () => {
      const file = gif(1, { frames: 2, width: 300, height: 200 });
      const still = png(1);
      const res = await upload('mem_ann', file, still);
      expect(res.status).toBe(201);
      const body = (await res.json()) as StickerAddResponse;
      const id = await idOf(file);
      const thumb = await thumbOf(file, still);
      expect(body).toEqual({
        sticker: { id, type: 'gif', width: 300, height: 200, bytes: file.length, animated: true, thumb, addedAt: expect.any(String) },
        duplicate: false,
        total: 1,
        version: 1,
      });
      expect(files.objects.get(`sticker/${id}.gif`)).toEqual({ bytes: file, type: 'image/gif' });
      expect(files.objects.get(`sticker/${id}-t-${thumb}`)).toEqual({ bytes: still, type: 'image/png' });
      expect(d1.rows('SELECT state, created_by, sent_at, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([
        { state: 'ready', created_by: 'mem_ann', sent_at: null, bytes: file.length },
      ]);
      expect(d1.rows('SELECT thumb, bytes, created_by FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb, bytes: still.length, created_by: 'mem_ann' }]);
      expect(rowsOf('mem_ann')).toEqual([{ sticker_id: id, thumb }]);
      // The file and the still both count toward the storage caps.
      // 文件和静态缩略图都计入存储上限。
      expect(counts('mem_ann')).toEqual({ items: 1, live_bytes: file.length + still.length, version: 1 });
      expect(counts('*')?.live_bytes).toBe(file.length + still.length);
      expect(daily('mem_ann')).toMatchObject({ uploads: 1, upload_bytes: file.length + still.length });
      expect(daily('*')).toMatchObject({ uploads: 1, upload_bytes: file.length + still.length });
      // The writes and the commit ran under waitUntil, so a client that goes away cannot cut them short.
      // 写入和提交都在 waitUntil 之下执行，客户端离开也不能让它们中途停止。
      expect(waits).toHaveLength(1);
    });

    it('binds each still to its uploader: a second member’s upload of the same bytes changes nothing the first one sees', async () => {
      const file = gif(2);
      const annStill = png(1);
      const bobStill = png(2);
      expect((await upload('mem_ann', file, annStill)).status).toBe(201);
      const before = await listOf('mem_ann');
      files.calls.length = 0;
      const res = await upload('mem_bob', file, bobStill);
      expect(res.status).toBe(201);
      const id = await idOf(file);
      const bobThumb = await thumbOf(file, bobStill);
      expect(((await res.json()) as StickerAddResponse).sticker.thumb).toBe(bobThumb);
      // The original is written again under R2's checksum; the second member's still is their own.
      // 原始文件在 R2 的校验下再次写入；第二位成员的静态图是他自己的。
      expect([...files.calls].sort()).toEqual([`put sticker/${id}-t-${bobThumb}`, `put sticker/${id}.gif`].sort());
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects')).toEqual([{ n: 1 }]);
      expect(d1.rows('SELECT thumb FROM sticker_thumbs WHERE sticker_id = ? ORDER BY thumb', id)).toHaveLength(2);
      expect((await listOf('mem_ann')).stickers).toEqual(before.stickers);
      // Only the creator carries the file's bytes; each uploader carries their own still.
      // 只有创建者承担文件的字节数；每位上传者承担自己的静态缩略图。
      expect(counts('mem_ann')?.live_bytes).toBe(file.length + annStill.length);
      expect(counts('mem_bob')?.live_bytes).toBe(bobStill.length);
      expect(counts('*')?.live_bytes).toBe(file.length + annStill.length + bobStill.length);
    });

    it('counts every still a stored file is uploaded with toward the caps, so re-uploads with fresh stills cannot fill R2 uncounted', async () => {
      // The finding's second route: upload someone else's stored file again with a fresh still, removing it in between.
      // 问题中的第二种途径：再次上传别人已存储的文件，每次换一张新的静态缩略图，中间把它删除。
      const file = gif(110);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      for (let i = 0; i < 5; i += 1) {
        expect((await upload('mem_ann', file, png(200 + i))).status).toBe(201);
        expect((await json('mem_ann', '/stickers/remove', { ids: [id] })).status).toBe(200);
      }
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ n: 6 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(5 * png().length);
      expect(counts('*')?.live_bytes).toBe(file.length + 6 * png().length);
      // At the cap, a stored file is refused for its still alone, before any put.
      // 达到上限时，已存储的文件仅因静态缩略图就会被拒绝，且在任何写入之前。
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER - png().length + 1, 'mem_ann');
      files.calls.length = 0;
      expect(await errorOf(await upload('mem_ann', file, png(300)))).toEqual({ status: 429, code: 'sticker_storage_limit', message: STICKER_MESSAGES.memberStorage });
      expect(files.calls).toEqual([]);
      // A block takes every still's bytes back off with the file's.
      // 封禁连同文件一起，把每张静态缩略图的字节数都减回去。
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', 5 * png().length, 'mem_ann');
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('mem_bob')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
    });

    it('takes a retry with the same still after a failed still put, at the storage cap, since its still is recorded and charged already', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(111);
      const still = png(111);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'mem_ann', STICKER_LIVE_BYTES_PER_MEMBER - still.length);
      files.state.beforePut = async (key) => {
        if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
      };
      expect((await upload('mem_ann', file, still)).status).toBe(500);
      files.state.beforePut = null;
      expect(counts('mem_ann')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      // The web client's retry sends the same prepared still: it needs no room it will not use.
      // 网页客户端的重试发送同一张准备好的静态缩略图：它不需要用不到的空间。
      const res = await upload('mem_ann', file, still);
      expect(res.status).toBe(201);
      expect(((await res.json()) as StickerAddResponse).sticker.thumb).toBe(await thumbOf(file, still));
      expect(counts('mem_ann')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ? AND created_by = ?', id, 'mem_ann')).toEqual([{ n: 1 }]);
      // A fresh still still needs its room.
      // 新的静态缩略图仍然需要它自己的空间。
      expect((await json('mem_ann', '/stickers/remove', { ids: [id] })).status).toBe(200);
      expect((await errorOf(await upload('mem_ann', file, png(112)))).code).toBe('sticker_storage_limit');
      vi.restoreAllMocks();
    });

    it('answers a repeat by the same member with 200 duplicate: moved to the front, its still kept, no second still', async () => {
      const first = gif(3);
      const second = gif(4);
      await upload('mem_ann', first, png(1));
      await upload('mem_ann', second, png(2));
      files.calls.length = 0;
      const res = await upload('mem_ann', first, png(3));
      expect(res.status).toBe(200);
      const body = (await res.json()) as StickerAddResponse;
      expect(body).toMatchObject({ duplicate: true, total: 2, sticker: { id: await idOf(first), thumb: await thumbOf(first, png(1)) } });
      expect(files.calls).toEqual([`put sticker/${await idOf(first)}.gif`]);
      expect(rowsOf('mem_ann').map((row) => row.sticker_id)).toEqual([await idOf(first), await idOf(second)]);
      expect(daily('mem_ann')?.uploads).toBe(3);
    });

    it('refuses an original that does not match its hash with checksum_mismatch: the day stays charged, nothing is stored and its pending row goes', async () => {
      const file = gif(5);
      const res = await upload('mem_ann', file, png(), { sha: await sha256(gif(6)) });
      expect(await errorOf(res)).toEqual({ status: 400, code: 'checksum_mismatch', message: STICKER_MESSAGES.checksum });
      const size = file.length + png().length;
      expect(daily('mem_ann')).toMatchObject({ uploads: 1, upload_bytes: size });
      expect(daily('*')).toMatchObject({ uploads: 1, upload_bytes: size });
      // No still is put after a refused original, and the pending row the request created goes with its bytes.
      // 原始文件被拒绝后不再写入静态图，本次请求新建的 pending 记录连同其字节数一起删除。
      expect(files.calls).toEqual([]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects')).toEqual([{ n: 0 }]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')).toEqual([{ n: 0 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect(rowsOf('mem_ann')).toEqual([]);
    });

    it('keeps a stored file’s row when a wrong hash claims it, and leaves no still row or charge however often it is repeated', async () => {
      const file = gif(5);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      const id = await idOf(file);
      files.calls.length = 0;
      // The declared hash names the stored file, the bytes are other ones: with fresh stills, and with the same one.
      // 声明的哈希指向已存储的文件，字节却是别的：每次换一张新的静态缩略图，以及每次用同一张。
      for (let i = 0; i < 6; i += 1) {
        const res = await upload('mem_ann', gif(600 + i), png(i % 2 === 0 ? 2 : 10 + i), { sha: await sha256(file) });
        expect((await errorOf(res)).code).toBe('checksum_mismatch');
      }
      expect(files.calls).toEqual([]);
      expect(d1.rows('SELECT state, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'ready', bytes: file.length }]);
      expect(counts('mem_bob')?.live_bytes).toBe(file.length + png(1).length);
      // The claimant's stills were never written, so none stays recorded and none stays on any total.
      // 声称者的静态缩略图从未写入，因此一张也不留下记录，也不留在任何累计数上。
      expect(d1.rows('SELECT thumb, created_by FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb: await thumbOf(file, png(1)), created_by: 'mem_bob' }]);
      expect(counts('mem_ann')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length);
      expect(daily('mem_ann')?.uploads).toBe(6);
    });

    /**
     * A file mem_bob stored, then mem_ann's upload of other bytes under its hash with the still `still`, during whose
     * put of the original `during` runs. Answers mem_ann's response.
     * mem_bob 已存储的文件，然后是 mem_ann 以它的哈希上传别的字节、静态缩略图为 `still` 的上传；在它写入原始文件期间执行 `during`。返回 mem_ann 的回应。
     */
    async function wrongHashDuring(file: Uint8Array, still: Uint8Array, during: () => Promise<void>): Promise<Response> {
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        await during();
      };
      return upload('mem_ann', gif(700), still, { sha: await sha256(file) });
    }

    it('keeps the still’s row a parallel honest upload with the identical still relies on, held across the wrong hash’s refusal, charged once', async () => {
      const file = gif(160);
      const still = png(160);
      const id = await idOf(file);
      const thumb = await thumbOf(file, still);
      // mem_cat's honest upload of the same file and still reserves while mem_ann's put is in flight, relying on the
      // still's row mem_ann recorded, and is held at its own put until mem_ann's refusal has been settled.
      // mem_cat 对同一文件、同一静态缩略图的正常上传在 mem_ann 的写入进行中预留，依赖 mem_ann 记录的静态缩略图记录，
      // 并停在它自己的写入处，直到 mem_ann 的拒绝处理完毕。
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached: () => void = () => undefined;
      const atPut = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const honest: Promise<Response>[] = [];
      const res = await wrongHashDuring(file, still, async () => {
        files.state.beforePut = async (key) => {
          if (key !== `sticker/${id}.gif`) return;
          files.state.beforePut = null;
          reached();
          await held;
        };
        honest.push(upload('mem_cat', file, still));
        await atPut;
        // Its reserve holds the row it relies on, beside mem_ann's hold.
        // 它的预留持有它所依赖的记录，与 mem_ann 的持有并存。
        expect(d1.rows('SELECT created_by, holders FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, thumb)).toEqual([{ created_by: 'mem_ann', holders: 2 }]);
      });
      expect((await errorOf(res)).code).toBe('checksum_mismatch');
      // So the refusal releases mem_ann's hold alone and leaves the row: mem_cat is about to write the key it names.
      // 因此拒绝时只释放 mem_ann 的持有并保留这条记录：mem_cat 即将写入它所指向的键。
      expect(d1.rows('SELECT holders FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, thumb)).toEqual([{ holders: 1 }]);
      release();
      const [done] = await Promise.all(honest);
      expect(done?.status).toBe(201);
      // The still is recorded once and charged once, to the upload that recorded it first.
      // 这张静态缩略图只记录一次、只计费一次，计在最先记录它的那次上传上。
      expect(d1.rows('SELECT bytes, created_by FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, thumb)).toEqual([{ bytes: still.length, created_by: 'mem_ann' }]);
      expect(files.objects.has(`sticker/${id}-t-${thumb}`)).toBe(true);
      expect(rowsOf('mem_cat')).toEqual([{ sticker_id: id, thumb }]);
      expect(counts('mem_ann')?.live_bytes).toBe(still.length);
      expect(counts('mem_cat')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length + still.length);
      // So a block deletes the still and takes every byte back off.
      // 因此封禁会删除这张静态缩略图，并把所有字节数都减回去。
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
      for (const scope of ['mem_ann', 'mem_bob', 'mem_cat', '*']) expect(counts(scope)?.live_bytes ?? 0).toBe(0);
    });

    it('leaves no still row or charge when two wrong hashes with the identical still race each other', async () => {
      const file = gif(163);
      const still = png(163);
      const id = await idOf(file);
      // mem_cat's wrong hash with the same still reserves while mem_ann's put is in flight and is refused first.
      // mem_cat 用同一张静态缩略图的错误哈希在 mem_ann 的写入进行中预留，并先被拒绝。
      const res = await wrongHashDuring(file, still, async () => {
        expect((await errorOf(await upload('mem_cat', gif(701), still, { sha: await sha256(file) }))).code).toBe('checksum_mismatch');
      });
      expect((await errorOf(res)).code).toBe('checksum_mismatch');
      expect(d1.rows('SELECT created_by FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ created_by: 'mem_bob' }]);
      expect(counts('mem_ann')?.live_bytes ?? 0).toBe(0);
      expect(counts('mem_cat')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length);
    });

    it('keeps the still’s row when a parallel honest upload with the identical still committed before the wrong hash was refused, charged once', async () => {
      // Kept in mem_cat's collection, and removed from it again before the refusal, so no collection names the still.
      // 保留在 mem_cat 的表情列表中，以及在拒绝之前又从中删除、因此没有任何表情列表指向这张静态缩略图。
      for (const [seed, removed] of [
        [161, false],
        [162, true],
      ] as const) {
        const file = gif(seed);
        const still = png(seed);
        const id = await idOf(file);
        const thumb = await thumbOf(file, still);
        const res = await wrongHashDuring(file, still, async () => {
          expect((await upload('mem_cat', file, still)).status).toBe(201);
          if (removed) expect((await json('mem_cat', '/stickers/remove', { ids: [id] })).status).toBe(200);
        });
        expect((await errorOf(res)).code).toBe('checksum_mismatch');
        // mem_cat relied on the row, so it stays, on the total of the upload that recorded it, and names the key mem_cat wrote.
        // mem_cat 依赖这条记录，因此它保留，计在记录它的那次上传的累计数上，并指向 mem_cat 写入的键。
        expect(d1.rows('SELECT bytes, created_by FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, thumb)).toEqual([{ bytes: still.length, created_by: 'mem_ann' }]);
        expect(files.objects.has(`sticker/${id}-t-${thumb}`)).toBe(true);
        expect(rowsOf('mem_cat')).toEqual(removed ? [] : [{ sticker_id: id, thumb }]);
        expect(counts('mem_ann')?.live_bytes).toBe(still.length);
        expect(counts('mem_cat')?.live_bytes ?? 0).toBe(0);
        expect(counts('*')?.live_bytes).toBe(file.length + png(1).length + still.length);
        // So a block deletes the still with the file and takes every byte back off.
        // 因此封禁会把这张静态缩略图连同文件一起删除，并把所有字节数都减回去。
        expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
        expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
        for (const scope of ['mem_ann', 'mem_bob', 'mem_cat', '*']) expect(counts(scope)?.live_bytes ?? 0).toBe(0);
      }
    });

    /** The original under every type and every still of a file that R2 holds. */
    /** R2 中保存的某个文件在每种类型下的原始文件和所有静态缩略图。 */
    const keysOf = (id: string) => [...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`));
    /** Two hours on: past the hour any reserve gave a file, for the sweep that comes after an upload. */
    /** 两小时之后：已过任何预留给文件的那一小时，供上传之后的清理任务使用。 */
    const LATER = () => new Date(Date.now() + 2 * 60 * 60 * 1000);

    it('leaves the pending row and the original a parallel upload stored under it to the sweep, when that upload gave up before the wrong hash was refused', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The original's put lands, then its answer is lost.
      // 原始文件的写入已经落地，但其回应丢失。
      const landing = {
        put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions) => {
          await files.bucket.put(key, value, options);
          throw new Error(`put: ${R2_INTERNAL_ERROR}`);
        },
        delete: files.bucket.delete,
      } as unknown as R2Bucket;
      // The harness's D1, except that the read of what a failed upload left fails as a lost connection does.
      // 测试工具的 D1，只是读取失败的上传剩下的内容时会像连接中断时那样失败。
      const unreadable = {
        ...d1.db,
        batch: async (list: D1PreparedStatement[]) => {
          const sqls = list.map((item) => (item as unknown as { toSqlite: () => { sql: string } }).toSqlite().sql);
          if (sqls.some((sql) => sql.includes("state <> 'deleting'"))) throw new Error('D1_ERROR: Network connection lost.');
          return d1.db.batch(list);
        },
      } as unknown as D1Database;
      // During the put of mem_ann's other bytes under the file's hash, mem_cat's honest upload reserves over the pending
      // row mem_ann's reserve wrote, stores the original under it and gives up its hold: its still is refused for its
      // checksum, or the original's put fails otherwise after it landed, or its still is refused and its read of what is
      // left fails, so only its reserve ever counted it on the row. Only then is mem_ann refused.
      // 在 mem_ann 以文件的哈希发送别的字节、写入原始文件期间，mem_cat 的正常上传在 mem_ann 的预留写入的 pending 记录之上预留，
      // 在它之下存下原始文件，然后放弃持有：它的静态缩略图因校验不符被拒绝；或者原始文件的写入在落地之后因别的原因失败；
      // 或者静态缩略图被拒绝、而读取剩下的内容时失败，因此只有它的预留曾把它计入这条记录。此后 mem_ann 才被拒绝。
      const junks: Uint8Array[] = [];
      for (const [seed, failed] of [
        [180, 'still'],
        [181, 'original'],
        [186, 'unread'],
      ] as const) {
        const file = gif(seed);
        const junk = gif(800 + seed);
        junks.push(junk);
        const id = await idOf(file);
        files.state.beforePut = async (key) => {
          if (key !== `sticker/${id}.gif`) return;
          files.state.beforePut = null;
          const extra = failed === 'original' ? { FILES: landing } : failed === 'unread' ? { DB: unreadable } : undefined;
          const thumbSha = failed === 'original' ? undefined : await sha256(png(9));
          const parallel = await upload('mem_cat', file, png(2), { thumbSha, extra });
          expect(parallel.status).toBe(failed === 'original' ? 500 : 400);
          expect(files.objects.get(`sticker/${id}.gif`)?.bytes).toEqual(file);
        };
        expect((await errorOf(await upload('mem_ann', junk, png(1), { sha: await sha256(file) }))).code).toBe('checksum_mismatch');
        // The row that names the stored original stays, with mem_ann's charge for it; neither still was written, so
        // neither stays recorded or charged.
        // 指向已存原始文件的记录保留，mem_ann 为它计入的字节数也保留；两张静态缩略图都从未写入，因此都不留下记录，也不留下计费。
        expect(d1.rows('SELECT state, bytes, created_by FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'pending', bytes: junk.length, created_by: 'mem_ann' }]);
        expect(keysOf(id)).toEqual([`sticker/${id}.gif`]);
        expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ n: 0 }]);
      }
      const charged = junks.reduce((sum, junk) => sum + junk.length, 0);
      expect(counts('mem_ann')?.live_bytes).toBe(charged);
      expect(counts('mem_cat')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(charged);
      expect(daily('mem_cat')?.uploads).toBe(2);
      // So the sweep deletes the original under every type and takes the bytes back off.
      // 因此清理任务按每种类型删除原始文件，并把字节数减回去。
      expect((await sweepStickers(d1.db, files.bucket, new Date(Date.now() + 2 * 60 * 60 * 1000))).deleted).toBe(3);
      expect(files.objects.size).toBe(0);
      for (const scope of ['mem_ann', 'mem_cat', '*']) expect(counts(scope)?.live_bytes ?? 0).toBe(0);
      vi.restoreAllMocks();
    });

    it('leaves the pending row to the sweep when two requests of the same member in the same millisecond both count as its creator', async () => {
      const now = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const file = gif(182);
      const junk = gif(982);
      const id = await idOf(file);
      // mem_ann's honest upload writes the row. During its put, mem_ann's other bytes under the same hash reserve over
      // the row in the same millisecond, so the probe marks both as its creator, and are held at their own put. The
      // honest still is refused for its checksum once the original is stored; then the other bytes are refused, and
      // their discard must not take the row that names the stored original.
      // mem_ann 的正常上传写入这条记录。在它写入期间，mem_ann 以同一哈希发送的别的字节在同一毫秒内在这条记录之上预留，因此探查把两者都标记为创建者，
      // 并停在它自己的写入处。原始文件存好之后，正常上传的静态缩略图因校验不符被拒绝；然后别的字节被拒绝，它的丢弃不能删除指向已存原始文件的记录。
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let reached: () => void = () => undefined;
      const atPut = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const other: Promise<Response>[] = [];
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = async (next) => {
          if (next !== `sticker/${id}.gif`) return;
          files.state.beforePut = null;
          reached();
          await held;
        };
        other.push(upload('mem_ann', junk, png(5), { sha: await sha256(file) }));
        await atPut;
      };
      expect((await errorOf(await upload('mem_ann', file, png(4), { thumbSha: await sha256(png(9)) }))).code).toBe('checksum_mismatch');
      expect(d1.rows('SELECT created_by, created_at FROM sticker_objects WHERE id = ?', id)).toEqual([{ created_by: 'mem_ann', created_at: new Date(now).toISOString() }]);
      release();
      const [refused] = await Promise.all(other);
      expect((await errorOf(refused as Response)).code).toBe('checksum_mismatch');
      expect(d1.rows('SELECT state, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'pending', bytes: file.length }]);
      expect(keysOf(id)).toEqual([`sticker/${id}.gif`]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ n: 0 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(file.length);
      expect((await sweepStickers(d1.db, files.bucket, new Date(now + 2 * 60 * 60 * 1000))).deleted).toBe(1);
      expect(files.objects.size).toBe(0);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      vi.restoreAllMocks();
    });

    it('leaves the row an upload reserved over to it while its writes are in flight, so a newer upload goes over that row and every key stays named and stored', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The still's put lands, then its answer is lost.
      // 静态缩略图的写入已经落地，但其回应丢失。
      const landing = {
        put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions) => {
          await files.bucket.put(key, value, options);
          if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
          return null;
        },
        delete: files.bucket.delete,
      } as unknown as R2Bucket;
      const ids: string[] = [];
      for (const [seed, ending] of [
        [183, 'commits'],
        [187, 'still fails'],
      ] as const) {
        const file = gif(seed);
        const id = await idOf(file);
        ids.push(id);
        // mem_bob stored the file long ago and nobody keeps it, so the sweep is due. Between mem_cat's original landing
        // and its still, the hourly run comes and mem_ann uploads the same file, whose puts fail. Before every reserve
        // moved the sweep, that run deleted the row with the original mem_cat had stored, mem_ann wrote a new pending
        // row, and mem_cat's commit made that row ready although no original was stored under it.
        // mem_bob 很久以前存储了这个文件，且没有人收藏，因此清理任务已到期。在 mem_cat 的原始文件落地之后、写入静态缩略图之前，每小时一次的清理执行，
        // mem_ann 也上传同一个文件，但写入失败。在每次预留推迟清理时间之前，那次执行会连同 mem_cat 已存下的原始文件一起删除记录，mem_ann 写入新的
        // pending 记录，而 mem_cat 的提交会把那条记录变为 ready，尽管它之下并没有存下任何原始文件。
        expect((await upload('mem_bob', file, png(1))).status).toBe(201);
        expect((await json('mem_bob', '/stickers/remove', { ids: [id] })).status).toBe(200);
        d1.rows("UPDATE sticker_objects SET sweep_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", id);
        files.state.beforePut = async (key) => {
          if (!key.startsWith(`sticker/${id}-t-`)) return;
          files.state.beforePut = null;
          // mem_cat's reserve moved the file's sweep an hour off, so the run leaves it alone, and mem_ann reserves over
          // the same row.
          // mem_cat 的预留把文件的清理时间推迟了一小时，因此这次执行不碰它，mem_ann 也在同一条记录之上预留。
          expect(await sweepStickers(d1.db, files.bucket)).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
          files.state.failPuts = true;
          expect((await upload('mem_ann', file, png(2))).status).toBe(500);
          files.state.failPuts = false;
          expect(d1.rows('SELECT state, created_by FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'ready', created_by: 'mem_bob' }]);
        };
        files.calls.length = 0;
        const res = await upload('mem_cat', file, png(3), ending === 'still fails' ? { extra: { FILES: landing } } : {});
        expect(res.status).toBe(ending === 'commits' ? 201 : 500);
        // Nothing was deleted: the file's row names the original and every recorded still, all stored, and R2 holds no
        // key of the file that no row names (mem_ann's still was never put and its row went).
        // 什么也没有删除：文件的记录指向原始文件和每张已记录的静态缩略图，它们都已存储；R2 中也没有任何记录都不指向的该文件的键
        // （mem_ann 的静态缩略图从未写入，它的记录已被删除）。
        expect(files.calls.filter((call) => call.startsWith('delete'))).toEqual([]);
        const named = [
          `sticker/${id}.gif`,
          ...d1.rows<{ thumb: string }>('SELECT thumb FROM sticker_thumbs WHERE sticker_id = ? ORDER BY thumb', id).map((row) => `sticker/${id}-t-${row.thumb}`),
        ];
        expect(named.sort()).toEqual([`sticker/${id}.gif`, `sticker/${id}-t-${await thumbOf(file, png(1))}`, `sticker/${id}-t-${await thumbOf(file, png(3))}`].sort());
        expect(keysOf(id).sort()).toEqual(named);
        expect(rowsOf('mem_cat').filter((row) => row.sticker_id === id)).toEqual(ending === 'commits' ? [{ sticker_id: id, thumb: await thumbOf(file, png(3)) }] : []);
      }
      expect(rowsOf('mem_ann')).toEqual([]);
      expect(counts('mem_ann')?.live_bytes ?? 0).toBe(0);
      expect(counts('mem_cat')?.live_bytes).toBe(2 * png(3).length);
      // After the hour the sweep keeps the file mem_cat collected, and collects the other one with every key and their
      // bytes.
      // 这一小时之后，清理任务保留 mem_cat 收藏的文件，并删除另一个文件，连同它的每个键及其字节数。
      expect(await sweepStickers(d1.db, files.bucket, LATER())).toMatchObject({ claimed: 1, kept: 1, deleted: 1 });
      expect(keysOf(ids[0] as string)).toHaveLength(3);
      expect(keysOf(ids[1] as string)).toEqual([]);
      expect(counts('mem_cat')?.live_bytes).toBe(png(3).length);
      expect(counts('mem_bob')?.live_bytes).toBe(gif(183).length + png(1).length);
      expect(counts('*')?.live_bytes).toBe(gif(183).length + png(1).length + png(3).length);
      vi.restoreAllMocks();
    });

    it('hands the reserve to waitUntil before it settles, so a client that goes away cannot cut short a batch that may commit, and answers the same', async () => {
      const file = gif(184);
      const still = png(184);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let sent: () => void = () => undefined;
      const reserving = new Promise<void>((resolve) => {
        sent = resolve;
      });
      // The harness's D1, except that the reserve batch (the one that probes the still) waits before it runs.
      // 测试工具的 D1，只是预留批次（探查静态缩略图的那个批次）在执行之前先等待。
      const slow = {
        ...d1.db,
        batch: async (list: D1PreparedStatement[]) => {
          const sqls = list.map((item) => (item as unknown as { toSqlite: () => { sql: string } }).toSqlite().sql);
          if (sqls.some((sql) => sql.includes('AS still_recorded'))) {
            sent();
            await held;
          }
          return d1.db.batch(list);
        },
      } as unknown as D1Database;
      const answer = upload('mem_ann', file, still, { extra: { DB: slow } });
      await reserving;
      expect(waits).toHaveLength(1);
      release();
      const res = await answer;
      expect(res.status).toBe(201);
      expect(((await res.json()) as StickerAddResponse).sticker).toMatchObject({ id: await idOf(file), thumb: await thumbOf(file, still) });
      expect(waits).toHaveLength(1);
      await expect(waits[0]).resolves.toMatchObject({ result: { outcome: 'added' } });
      // A refused reserve is handed over the same way and answers as before.
      // 被拒绝的预留以同样的方式交出，回答与之前相同。
      d1.rows('UPDATE sticker_counts SET items = ? WHERE scope = ?', STICKERS_PER_MEMBER_MAX, 'mem_ann');
      expect(await errorOf(await upload('mem_ann', gif(185)))).toEqual({ status: 409, code: 'sticker_full', message: STICKER_MESSAGES.full });
      expect(waits).toHaveLength(2);
      await expect(waits[1]).resolves.toEqual({ refusal: 'full' });
    });

    it('refuses a still that does not match its hash with checksum_mismatch, keeps the day charged, drops the still’s row and leaves the stored original to the sweep', async () => {
      const file = gif(5);
      const id = await idOf(file);
      const res = await upload('mem_ann', file, png(), { thumbSha: await sha256(png(9)) });
      expect(await errorOf(res)).toEqual({ status: 400, code: 'checksum_mismatch', message: STICKER_MESSAGES.checksum });
      expect(files.calls).toEqual([`put sticker/${id}.gif`]);
      expect(daily('mem_ann')?.uploads).toBe(1);
      expect(d1.rows('SELECT state, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'pending', bytes: file.length }]);
      // The still was never stored, so its row went with its bytes; the original's stay on the pending row.
      // 静态缩略图从未存下，因此它的记录连同其字节数一起删除；原始文件的字节数仍计在 pending 记录上。
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ n: 0 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(file.length);
      expect(counts('*')?.live_bytes).toBe(file.length);
      // The pending row names the original, so the sweep deletes it after the hour and takes its bytes off.
      // pending 记录指向原始文件，因此一小时后清理任务删除它，并减去它的字节数。
      expect((await sweepStickers(d1.db, files.bucket, new Date(Date.now() + 2 * 60 * 60 * 1000))).deleted).toBe(1);
      expect(files.objects.size).toBe(0);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('leaves no still row or charge for wrong still hashes over a stored file, however often they are repeated', async () => {
      const file = gif(170);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      files.calls.length = 0;
      // The declared still hash is wrong: the same one each time, and a fresh one each time.
      // 声明的静态缩略图哈希是错的：每次都是同一个，以及每次都换一个新的。
      for (let i = 0; i < 6; i += 1) {
        const res = await upload('mem_ann', file, png(2), { thumbSha: await sha256(png(i % 2 === 0 ? 9 : 20 + i)) });
        expect((await errorOf(res)).code).toBe('checksum_mismatch');
      }
      // Only the original was written again, with the same bytes; no still of the claimant is recorded or charged.
      // 只有原始文件以相同的字节被重新写入；声称者的静态缩略图既没有记录，也没有计费。
      expect(files.calls).toEqual(new Array<string>(6).fill(`put sticker/${id}.gif`));
      expect(d1.rows('SELECT thumb, created_by FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb: await thumbOf(file, png(1)), created_by: 'mem_bob' }]);
      expect(counts('mem_ann')?.live_bytes ?? 0).toBe(0);
      expect(counts('mem_bob')?.live_bytes).toBe(file.length + png(1).length);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length);
      expect(daily('mem_ann')?.uploads).toBe(6);
      // An honest upload of the same still afterwards is recorded and charged once, to its own uploader.
      // 此后对同一张静态缩略图的正常上传只记录一次、只计费一次，计在它自己的上传者上。
      expect((await upload('mem_ann', file, png(9))).status).toBe(201);
      expect(counts('mem_ann')?.live_bytes).toBe(png(9).length);
      expect(files.objects.has(`sticker/${id}-t-${await thumbOf(file, png(9))}`)).toBe(true);
    });

    it('stops a member who keeps sending wrong hashes at the daily cap, with nothing left behind', async () => {
      for (let i = 0; i < STICKER_UPLOADS_PER_DAY; i += 1) {
        const res = await upload('mem_ann', gif(4000 + i), png(i), { sha: await sha256(gif(5000 + i)) });
        expect((await errorOf(res)).code).toBe('checksum_mismatch');
      }
      const next = await upload('mem_ann', gif(4100), png(), { sha: await sha256(gif(5100)) });
      expect(await errorOf(next)).toEqual({ status: 429, code: 'sticker_daily_limit', message: STICKER_MESSAGES.daily });
      expect(daily('mem_ann')?.uploads).toBe(STICKER_UPLOADS_PER_DAY);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects')).toEqual([{ n: 0 }]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')).toEqual([{ n: 0 }]);
      expect(files.objects.size).toBe(0);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('refunds and passes on any other storage failure, of the original or of the still, leaving the pending row to the sweep', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      files.state.failPuts = true;
      const res = await upload('mem_ann', gif(7));
      expect(res.status).toBe(500);
      expect(daily('mem_ann')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      expect(d1.rows('SELECT state FROM sticker_objects WHERE id = ?', await idOf(gif(7)))).toEqual([{ state: 'pending' }]);
      // The still follows the original, so it was never put: its row goes with its bytes, the pending row's stay.
      // 静态缩略图在原始文件之后才写，因此从未写入：它的记录连同其字节数一起删除，pending 记录的字节数保留。
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', await idOf(gif(7)))).toEqual([{ n: 0 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(gif(7).length);
      files.state.failPuts = false;
      files.state.beforePut = async (key) => {
        if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
      };
      const file = gif(8);
      const still = await upload('mem_ann', file);
      expect(still.status).toBe(500);
      expect(files.calls).toEqual([`put sticker/${await idOf(file)}.gif`]);
      expect(daily('mem_ann')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      expect(d1.rows('SELECT state FROM sticker_objects WHERE id = ?', await idOf(file))).toEqual([{ state: 'pending' }]);
      // A still whose own put failed may have been stored, so its row stays with its bytes.
      // 自己的写入失败的静态缩略图可能已经存下，因此它的记录连同其字节数保留。
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?', await idOf(file))).toEqual([{ n: 1 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(gif(7).length + file.length + png().length);
      // The work handed to waitUntil settles quietly: the failure reaches the client through the answer alone.
      // 交给 waitUntil 的工作安静地结束：失败只通过回答告知客户端。
      expect(waits).toHaveLength(2);
      await expect(Promise.all(waits)).resolves.toEqual([undefined, undefined]);
      vi.restoreAllMocks();
    });

    it('keeps the day charged when R2 refuses a put for its per-key rate limit, so racing uploads of one file cannot dodge the daily cap', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(9);
      files.state.beforePut = async (key) => {
        if (!key.includes('-t-')) throw new Error('put: Reduce your concurrent request rate for the same object. (10058)');
      };
      const res = await upload('mem_ann', file);
      expect(res.status).toBe(500);
      expect(daily('mem_ann')).toMatchObject({ uploads: 1, upload_bytes: file.length + png().length });
      // The put may have been refused after an earlier one stored the key, so the pending row stays for the sweep.
      // 这次写入可能是在更早的一次已存下这个键之后被拒绝的，因此 pending 记录留给清理任务。
      expect(d1.rows('SELECT state FROM sticker_objects WHERE id = ?', await idOf(file))).toEqual([{ state: 'pending' }]);
      vi.restoreAllMocks();
    });

    it('drops the still of an original whose put failed otherwise over a stored file, so nothing stays charged and a retry is charged once', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(171);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      files.state.failPuts = true;
      expect((await upload('mem_ann', file, png(2))).status).toBe(500);
      files.state.failPuts = false;
      expect(daily('mem_ann')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      expect(d1.rows('SELECT created_by FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ created_by: 'mem_bob' }]);
      expect(counts('mem_ann')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length);
      const res = await upload('mem_ann', file, png(2));
      expect(res.status).toBe(201);
      expect(counts('mem_ann')?.live_bytes).toBe(png(2).length);
      expect(counts('*')?.live_bytes).toBe(file.length + png(1).length + png(2).length);
      expect(files.objects.has(`sticker/${id}-t-${await thumbOf(file, png(2))}`)).toBe(true);
      vi.restoreAllMocks();
    });

    it('stores what R2 verified over a pending row that recorded other bytes, and charges the member whose bytes were stored', async () => {
      const file = gif(60, { frames: 2, width: 300, height: 200, pad: 2000 });
      const id = await idOf(file);
      // A PNG sent under the GIF's hash, whose put failed for another reason: its pending row records the PNG.
      // 以 GIF 的哈希发送的 PNG，写入因别的原因失败：它的 pending 记录记的是这个 PNG。
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      files.state.failPuts = true;
      expect((await upload('mem_bob', png(7), png(), { sha: await sha256(file) })).status).toBe(500);
      files.state.failPuts = false;
      vi.restoreAllMocks();
      expect(d1.rows('SELECT type, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([{ type: 'png', bytes: png(7).length }]);
      const res = await upload('mem_ann', file, png(3));
      expect(res.status).toBe(201);
      expect(((await res.json()) as StickerAddResponse).sticker).toMatchObject({ id, type: 'gif', width: 300, height: 200, bytes: file.length, animated: true });
      expect(d1.rows('SELECT type, width, height, bytes, animated, state, created_by FROM sticker_objects WHERE id = ?', id)).toEqual([
        { type: 'gif', width: 300, height: 200, bytes: file.length, animated: 1, state: 'ready', created_by: 'mem_ann' },
      ]);
      expect(files.objects.has(`sticker/${id}.gif`)).toBe(true);
      // The file's bytes moved to the member whose bytes R2 stored; the still of the failed upload, never put after its
      // original failed, went with its bytes then.
      // 文件的字节数转给了由 R2 存下其字节的成员；失败的那次上传的静态缩略图在原始文件失败后从未写入，当时就已连同其字节数一起删除。
      expect(counts('mem_ann')?.live_bytes).toBe(file.length + png(3).length);
      expect(counts('mem_bob')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(file.length + png(3).length);
      expect((await listOf('mem_ann')).stickers[0]).toMatchObject({ id, type: 'gif', bytes: file.length });
      // The row names the key that was written, so a block deletes it.
      // 记录指向实际写入的键，因此封禁会删除它。
      files.calls.length = 0;
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect(files.calls[0]).toContain(`sticker/${id}.gif`);
      expect(files.objects.size).toBe(0);
    });

    it('holds a member to the storage cap for a file whose refused bytes left a smaller pending row', async () => {
      const file = gif(61, { pad: 2000 });
      const id = await idOf(file);
      // The member's own tiny PNG under the file's hash, whose put failed for another reason: a pending row of its size.
      // 成员自己以这个文件的哈希发送的小 PNG，写入因别的原因失败：留下一条按它的大小记录的 pending 记录。
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      files.state.failPuts = true;
      expect((await upload('mem_ann', png(8), png(), { sha: await sha256(file) })).status).toBe(500);
      files.state.failPuts = false;
      vi.restoreAllMocks();
      expect(counts('mem_ann')?.live_bytes).toBe(png(8).length);
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER - 1000, 'mem_ann');
      files.calls.length = 0;
      expect(await errorOf(await upload('mem_ann', file))).toEqual({ status: 429, code: 'sticker_storage_limit', message: STICKER_MESSAGES.memberStorage });
      expect(files.calls).toEqual([]);
      expect(d1.rows('SELECT state, bytes FROM sticker_objects WHERE id = ?', id)).toEqual([{ state: 'pending', bytes: png(8).length }]);
      // With room for the whole file it goes through, and the totals carry its real size and the still once (the failed
      // upload's still went with its original's failure).
      // 有足够容纳整个文件的空间时上传成功，累计数按它的真实大小计算，静态缩略图只计一次（失败的那次上传的静态缩略图已随原始文件的失败一起删除）。
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', png(8).length, 'mem_ann');
      expect((await upload('mem_ann', file)).status).toBe(201);
      expect(counts('mem_ann')?.live_bytes).toBe(file.length + png().length);
      expect(counts('*')?.live_bytes).toBe(file.length + png().length);
    });

    it('deletes what it wrote when a block lands during its put, and still answers sticker_blocked', async () => {
      const file = gif(70);
      const still = png(70);
      const id = await idOf(file);
      const thumb = await thumbOf(file, still);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      };
      const res = await upload('mem_ann', file, still);
      expect(await errorOf(res)).toEqual({ status: 409, code: 'sticker_blocked', message: STICKER_MESSAGES.blocked });
      // The block already knew the still's key: the reserve recorded it before the put.
      // 封禁已经知道静态缩略图的键：预留批次在写入之前就记录了它。
      expect(files.calls).toEqual([
        `delete ${[...originals(id), `sticker/${id}-t-${thumb}`].join(' ')}`,
        `put sticker/${id}.gif`,
        `put sticker/${id}-t-${thumb}`,
        `delete sticker/${id}.gif sticker/${id}-t-${thumb}`,
      ]);
      expect(files.objects.size).toBe(0);
      expect(d1.rows('SELECT blocked_at IS NOT NULL AS blocked FROM sticker_objects WHERE id = ?', id)).toEqual([{ blocked: 1 }]);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect(rowsOf('mem_ann')).toEqual([]);
    });

    it('leaves the file to an upload whose put is in flight, and deletes what it wrote, answering sticker_unavailable, once it outlived the hour and the sweep claimed or deleted the file', async () => {
      // Past the hour the reserve gave the file: the sweep has finished (the row is gone); then a sweep has claimed the
      // file and deleted its objects, but not yet its row.
      // 已过预留给文件的那一小时：清理任务已经完成（记录已不存在）；然后是清理任务已认领文件并删除了它的对象，但还没有删除记录。
      const steps: [number, (id: string) => Promise<void>][] = [
        [
          80,
          async () => {
            expect((await sweepStickers(d1.db, files.bucket, LATER())).deleted).toBe(1);
          },
        ],
        [
          81,
          async (id) => {
            d1.rows("UPDATE sticker_objects SET state = 'deleting' WHERE id = ?", id);
            await files.bucket.delete([...files.objects.keys()].filter((stored) => stored.startsWith(`sticker/${id}`)));
          },
        ],
      ];
      for (const [seed, sweep] of steps) {
        const file = gif(seed);
        const id = await idOf(file);
        // Stored by another member long ago and in nobody's collection, so the sweep is due.
        // 很久以前由另一位成员存储，且不在任何人的表情列表中，因此清理任务到期。
        expect((await upload('mem_bob', file, png(1))).status).toBe(201);
        expect((await json('mem_bob', '/stickers/remove', { ids: [id] })).status).toBe(200);
        d1.rows("UPDATE sticker_objects SET sweep_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", id);
        files.state.beforePut = async (key) => {
          if (key !== `sticker/${id}.gif`) return;
          files.state.beforePut = null;
          // Within the hour mem_ann's reserve gave the file, the sweep leaves it alone.
          // 在 mem_ann 的预留给文件的那一小时之内，清理任务不碰它。
          expect(await sweepStickers(d1.db, files.bucket)).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
          await sweep(id);
        };
        files.calls.length = 0;
        const res = await upload('mem_ann', file, png(2));
        expect(await errorOf(res)).toEqual({ status: 503, code: 'sticker_unavailable', message: STICKER_MESSAGES.unavailable });
        expect(files.calls.at(-1)).toBe(`delete sticker/${id}.gif sticker/${id}-t-${await thumbOf(file, png(2))}`);
        expect([...files.objects.keys()].filter((stored) => stored.startsWith(`sticker/${id}`))).toEqual([]);
        expect(rowsOf('mem_ann')).toEqual([]);
      }
    });

    it('deletes nothing when the commit finds the collection full, since the file is still in use', async () => {
      const file = gif(90);
      const still = png(90);
      const id = await idOf(file);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        d1.rows('INSERT INTO sticker_counts (scope, items) VALUES (?, ?) ON CONFLICT (scope) DO UPDATE SET items = excluded.items', 'mem_ann', STICKERS_PER_MEMBER_MAX);
      };
      expect(await errorOf(await upload('mem_ann', file, still))).toEqual({ status: 409, code: 'sticker_full', message: STICKER_MESSAGES.full });
      expect(files.calls.filter((entry) => entry.startsWith('delete'))).toEqual([]);
      expect(files.objects.has(`sticker/${id}.gif`)).toBe(true);
      expect(d1.rows('SELECT thumb FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb: await thumbOf(file, still) }]);
    });

    it('answers the same when it cannot delete what it wrote, and logs it', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(95);
      const id = await idOf(file);
      files.state.failDeletes = true;
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        await blockSticker(d1.db, id, new Date().toISOString());
      };
      expect(await errorOf(await upload('mem_ann', file))).toEqual({ status: 409, code: 'sticker_blocked', message: STICKER_MESSAGES.blocked });
      expect(errors).toHaveBeenCalledWith(`stickers: could not delete the objects of refused upload ${id}`, expect.stringContaining('internal error'));
      vi.restoreAllMocks();
    });

    it('deletes the original it wrote when a block lands during its put and its still then fails on purpose', async () => {
      const file = gif(96);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      };
      files.calls.length = 0;
      // A still hash that is wrong on purpose cannot bring the blocked file back. The still was never stored, so only
      // the original goes.
      // 故意写错的静态图哈希不能让被封禁的文件重新上线。静态缩略图从未存下，因此只删除原始文件。
      const res = await upload('mem_ann', file, png(2), { thumbSha: await sha256(png(9)) });
      expect((await errorOf(res)).code).toBe('checksum_mismatch');
      expect(files.calls.slice(1)).toEqual([`put sticker/${id}.gif`, `delete sticker/${id}.gif`]);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
    });

    it('deletes the original it wrote when it outlived the hour, the sweep deleted the file during its put and its still then failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(97);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      expect((await json('mem_bob', '/stickers/remove', { ids: [id] })).status).toBe(200);
      d1.rows("UPDATE sticker_objects SET sweep_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", id);
      files.state.beforePut = async (key) => {
        if (key === `sticker/${id}.gif`) {
          // The sweep leaves the file alone within the hour mem_ann's reserve gave it, and deletes it after.
          // 在 mem_ann 的预留给文件的那一小时之内清理任务不碰它，过了这一小时才删除它。
          expect((await sweepStickers(d1.db, files.bucket)).deleted).toBe(0);
          expect((await sweepStickers(d1.db, files.bucket, LATER())).deleted).toBe(1);
        } else {
          throw new Error(`put: ${R2_INTERNAL_ERROR}`);
        }
      };
      files.calls.length = 0;
      expect((await upload('mem_ann', file, png(2))).status).toBe(500);
      // The still's put failed for another reason, so it may have landed after the sweep's delete: it goes too.
      // 静态缩略图的写入因别的原因失败，可能在清理任务删除之后才落地：它也一并删除。
      expect(files.calls.slice(1)).toEqual([`put sticker/${id}.gif`, `delete sticker/${id}.gif sticker/${id}-t-${await thumbOf(file, png(2))}`]);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
      expect(daily('mem_ann')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      vi.restoreAllMocks();
    });

    it('keeps a stored file’s original when only its still fails, and when the file cannot be read after it', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(98);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      files.calls.length = 0;
      expect((await errorOf(await upload('mem_ann', file, png(2), { thumbSha: await sha256(png(9)) }))).code).toBe('checksum_mismatch');
      expect(files.calls).toEqual([`put sticker/${id}.gif`]);
      expect(files.objects.has(`sticker/${id}.gif`)).toBe(true);
      // Blocked during the put, but the read that would say so fails: the original stays rather than risk a file in use.
      // 写入期间被封禁，但本应说明这一点的读取失败了：保留原始文件，而不冒删除仍在使用的文件的风险。
      const unreadable = {
        ...d1.db,
        batch: async (list: D1PreparedStatement[]) => {
          const sqls = list.map((item) => (item as unknown as { toSqlite: () => { sql: string } }).toSqlite().sql);
          if (sqls.some((sql) => sql.includes("state <> 'deleting'"))) throw new Error('D1_ERROR: Network connection lost.');
          return d1.db.batch(list);
        },
      } as unknown as D1Database;
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        await blockSticker(d1.db, id, new Date().toISOString());
      };
      files.calls.length = 0;
      const res = await upload('mem_cat', file, png(3), { thumbSha: await sha256(png(9)), extra: { DB: unreadable } });
      expect((await errorOf(res)).code).toBe('checksum_mismatch');
      expect(files.calls).toEqual([`put sticker/${id}.gif`]);
      expect(errors).toHaveBeenCalledWith(`stickers: could not read the file of failed upload ${id}`, expect.stringContaining('Network connection lost'));
      vi.restoreAllMocks();
    });

    /** The harness's D1, except that the commit batch (the one that makes a file ready) fails as a lost connection does. */
    /** 测试工具的 D1，只是提交批次（让文件变为 ready 的那个批次）会像连接中断时那样失败。 */
    function commitFails(): D1Database {
      return {
        ...d1.db,
        batch: async (list: D1PreparedStatement[]) => {
          const sqls = list.map((item) => (item as unknown as { toSqlite: () => { sql: string } }).toSqlite().sql);
          if (sqls.some((sql) => sql.includes("SET state = 'ready'"))) throw new Error('D1_ERROR: Network connection lost.');
          return d1.db.batch(list);
        },
      } as unknown as D1Database;
    }

    it('records the still before writing it, so a commit that fails leaves only keys the sweep deletes, with their bytes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(120);
      const still = png(120);
      const id = await idOf(file);
      const thumb = await thumbOf(file, still);
      expect((await upload('mem_ann', file, still, { extra: { DB: commitFails() } })).status).toBe(500);
      expect([...files.objects.keys()].sort()).toEqual([`sticker/${id}-t-${thumb}`, `sticker/${id}.gif`].sort());
      expect(d1.rows('SELECT thumb FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb }]);
      expect((await sweepStickers(d1.db, files.bucket, LATER())).deleted).toBe(1);
      expect(files.objects.size).toBe(0);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      vi.restoreAllMocks();
    });

    it('lets a block delete the still of an upload of a stored file whose commit failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(121);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      expect((await upload('mem_ann', file, png(2), { extra: { DB: commitFails() } })).status).toBe(500);
      expect(files.objects.has(`sticker/${id}-t-${await thumbOf(file, png(2))}`)).toBe(true);
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      vi.restoreAllMocks();
    });

    it('deletes what it wrote when its commit fails over a file blocked during its put', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(122);
      const still = png(122);
      const id = await idOf(file);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        await blockSticker(d1.db, id, new Date().toISOString());
      };
      expect((await upload('mem_ann', file, still, { extra: { DB: commitFails() } })).status).toBe(500);
      expect(files.calls.at(-1)).toBe(`delete sticker/${id}.gif sticker/${id}-t-${await thumbOf(file, still)}`);
      expect(files.objects.size).toBe(0);
      vi.restoreAllMocks();
    });

    it('deletes an original whose put failed after it landed, when the file was blocked meanwhile', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(124);
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      // The put lands, then its answer is lost; a block deleted the file's objects just before it landed.
      // 写入已经落地，但其回应丢失；封禁恰好在它落地之前删除了文件的对象。
      const landing = {
        ...files.bucket,
        put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions) => {
          await blockSticker(d1.db, id, new Date().toISOString());
          await files.bucket.put(key, value, options);
          throw new Error(`put: ${R2_INTERNAL_ERROR}`);
        },
        delete: files.bucket.delete,
      } as unknown as R2Bucket;
      files.calls.length = 0;
      expect((await upload('mem_ann', file, png(2), { extra: { FILES: landing } })).status).toBe(500);
      expect(files.calls).toEqual([`put sticker/${id}.gif`, `delete sticker/${id}.gif`]);
      expect(files.objects.has(`sticker/${id}.gif`)).toBe(false);
      vi.restoreAllMocks();
    });

    it('leaves nothing behind when its still fails over another member’s stale pending row of another type', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const file = gif(123);
      const id = await idOf(file);
      // A PNG sent under the GIF's hash, whose put failed for another reason: its pending row records a png.
      // 以 GIF 的哈希发送的 PNG，写入因别的原因失败：它的 pending 记录记的是 png。
      files.state.failPuts = true;
      expect((await upload('mem_bob', png(7), png(), { sha: await sha256(file) })).status).toBe(500);
      files.state.failPuts = false;
      files.state.beforePut = async (key) => {
        if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
      };
      expect((await upload('mem_ann', file, png(3))).status).toBe(500);
      files.state.beforePut = null;
      expect(files.objects.has(`sticker/${id}.gif`)).toBe(true);
      expect(d1.rows('SELECT type, state FROM sticker_objects WHERE id = ?', id)).toEqual([{ type: 'png', state: 'pending' }]);
      // The sweep deletes the original under every type, so the gif this upload wrote goes with the row.
      // 清理任务按每种类型删除原始文件，因此本次上传写入的 gif 随记录一起删除。
      expect((await sweepStickers(d1.db, files.bucket, LATER())).deleted).toBe(1);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('mem_bob')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      vi.restoreAllMocks();
    });

    it('puts back the member’s own still, never one it did not write, when the sticker was removed during a repeat upload', async () => {
      const file = gif(130);
      const id = await idOf(file);
      const kept = await thumbOf(file, png(1));
      expect((await upload('mem_ann', file, png(1))).status).toBe(201);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        expect((await json('mem_ann', '/stickers/remove', { ids: [id] })).status).toBe(200);
      };
      files.calls.length = 0;
      const res = await upload('mem_ann', file, png(2));
      expect(res.status).toBe(201);
      expect(((await res.json()) as StickerAddResponse).sticker.thumb).toBe(kept);
      expect(rowsOf('mem_ann')).toEqual([{ sticker_id: id, thumb: kept }]);
      // The repeat wrote no still and recorded none.
      // 重复上传没有写入、也没有记录任何静态缩略图。
      expect(files.calls).toEqual([`put sticker/${id}.gif`]);
      expect(d1.rows('SELECT thumb FROM sticker_thumbs WHERE sticker_id = ?', id)).toEqual([{ thumb: kept }]);
    });

    /**
     * A file mem_bob stored that is in nobody's collection and due for the sweep. During the put of the original of the
     * upload that follows, the sweep leaves it alone, since that upload's reserve moved its sweep an hour off; should
     * the upload outlive the hour, the sweep then deletes it with every still (the uploader's too), and mem_cat stores
     * it anew.
     * mem_bob 存储的、不在任何人表情列表中且清理任务已到期的文件。在随后那次上传写入原始文件期间，清理任务不碰它，因为那次上传的预留把它的清理时间
     * 推迟了一小时；如果那次上传超过这一小时仍未结束，清理任务就会连同所有静态缩略图（包括这次上传的）删除它，然后 mem_cat 又重新存储了它。
     */
    async function sweptAndStoredAnewDuringPut(file: Uint8Array): Promise<string> {
      const id = await idOf(file);
      expect((await upload('mem_bob', file, png(1))).status).toBe(201);
      expect((await json('mem_bob', '/stickers/remove', { ids: [id] })).status).toBe(200);
      d1.rows("UPDATE sticker_objects SET sweep_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", id);
      files.state.beforePut = async (key) => {
        if (key !== `sticker/${id}.gif`) return;
        files.state.beforePut = null;
        expect((await sweepStickers(d1.db, files.bucket)).deleted).toBe(0);
        expect((await sweepStickers(d1.db, files.bucket, LATER())).deleted).toBe(1);
        expect((await upload('mem_cat', file, png(3))).status).toBe(201);
      };
      return id;
    }

    it('records its still again when it outlived the hour, the sweep deleted the file during its put and another member stored it anew', async () => {
      const file = gif(150);
      const id = await sweptAndStoredAnewDuringPut(file);
      expect((await upload('mem_ann', file, png(2))).status).toBe(201);
      const thumb = await thumbOf(file, png(2));
      expect(d1.rows('SELECT bytes, created_by FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, thumb)).toEqual([{ bytes: png(2).length, created_by: 'mem_ann' }]);
      expect(rowsOf('mem_ann')).toEqual([{ sticker_id: id, thumb }]);
      expect(counts('mem_ann')?.live_bytes).toBe(png(2).length);
      // So a block deletes every key, this still included, and takes every byte back off.
      // 因此封禁会删除每一个键，包括这张静态缩略图，并把所有字节数都减回去。
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect([...files.objects.keys()].filter((key) => key.startsWith(`sticker/${id}`))).toEqual([]);
      for (const scope of ['mem_ann', 'mem_bob', 'mem_cat', '*']) expect(counts(scope)?.live_bytes).toBe(0);
    });

    it('deletes its still alone when it outlived the hour, its row went with the file swept during its put and the still or the commit then failed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The still's put lands, then its answer is lost.
      // 静态缩略图的写入已经落地，但其回应丢失。
      const landing = {
        put: async (key: string, value: ArrayBuffer | ArrayBufferView, options?: R2PutOptions) => {
          await files.bucket.put(key, value, options);
          if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
          return null;
        },
        delete: files.bucket.delete,
      } as unknown as R2Bucket;
      for (const [seed, extra] of [
        [151, { FILES: landing }],
        [152, { DB: commitFails() }],
      ] as const) {
        const file = gif(seed);
        const id = await sweptAndStoredAnewDuringPut(file);
        expect((await upload('mem_ann', file, png(2), { extra })).status).toBe(500);
        // No row names the still any more and nothing else would delete it; the original is the file mem_cat stored.
        // 已没有任何记录指向这张静态缩略图，也没有别的途径会删除它；原始文件则是 mem_cat 存储的文件。
        expect(files.objects.has(`sticker/${id}-t-${await thumbOf(file, png(2))}`)).toBe(false);
        expect(files.objects.has(`sticker/${id}.gif`)).toBe(true);
        expect(rowsOf('mem_cat')).toContainEqual({ sticker_id: id, thumb: await thumbOf(file, png(3)) });
        expect(rowsOf('mem_ann')).toEqual([]);
        expect(counts('mem_ann')?.live_bytes).toBe(0);
      }
      vi.restoreAllMocks();
    });

    it('runs an upload within D1’s 50 queries per invocation, the session and the cleanup of a failure included', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      d1.statements.length = 0;
      expect((await upload('mem_ann', gif(140))).status).toBe(201);
      expect(d1.statements.length).toBeLessThanOrEqual(50);
      files.state.beforePut = async (key) => {
        if (key.includes('-t-')) throw new Error(`put: ${R2_INTERNAL_ERROR}`);
      };
      d1.statements.length = 0;
      expect((await upload('mem_ann', gif(141))).status).toBe(500);
      expect(d1.statements.length).toBeLessThanOrEqual(50);
      // A wrong hash for a stored file: the reserve, then the discard of the still it recorded.
      // 对已存储文件的哈希不符：预留，然后丢弃它记录的静态缩略图。
      files.state.beforePut = null;
      d1.statements.length = 0;
      expect((await errorOf(await upload('mem_cat', gif(142), png(3), { sha: await sha256(gif(140)) }))).code).toBe('checksum_mismatch');
      expect(d1.statements.length).toBeLessThanOrEqual(50);
      // A wrong still hash, and an original whose put failed otherwise: the reserve, the refund where it applies, the
      // discard of the still never put and the read of what is left.
      // 静态缩略图哈希不符，以及原始文件的写入因别的原因失败：预留、适用时的退回、丢弃从未写入的静态缩略图，以及读取剩下的内容。
      d1.statements.length = 0;
      expect((await errorOf(await upload('mem_cat', gif(140), png(4), { thumbSha: await sha256(png(9)) }))).code).toBe('checksum_mismatch');
      expect(d1.statements.length).toBeLessThanOrEqual(50);
      files.state.failPuts = true;
      d1.statements.length = 0;
      expect((await upload('mem_cat', gif(143))).status).toBe(500);
      expect(d1.statements.length).toBeLessThanOrEqual(50);
      files.state.failPuts = false;
      vi.restoreAllMocks();
    });

    it('refuses a request without content-length before reading any of it', async () => {
      let pulled = false;
      // No queue ahead of a reader, so pull runs only when someone reads the body.
      // 不预先排队，因此只有在有人读取请求体时才会调用 pull。
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled = true;
            controller.enqueue(new Uint8Array(10));
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      const res = await call('mem_ann', 'POST', '/stickers/upload', { headers: { 'x-sticker': `${'a'.repeat(64)}.${'b'.repeat(64)}.5` }, body });
      expect(await errorOf(res)).toEqual({ status: 400, code: 'invalid_body', message: '请求格式错误' });
      expect(pulled).toBe(false);
      expect(daily('mem_ann')).toBeUndefined();
    });

    it('refuses a file with anything after its real end', async () => {
      const res = await upload('mem_ann', concat(gif(8), Uint8Array.from([1, 2, 3])));
      expect(await errorOf(res)).toEqual({ status: 400, code: 'invalid_sticker', message: STICKER_MESSAGES.unreadable });
      expect(files.calls).toEqual([]);
    });

    it('answers each check of the request with its own code, before anything is charged or stored', async () => {
      const raw = (headers: Record<string, string>, body: Uint8Array = new Uint8Array(8)) =>
        call('mem_ann', 'POST', '/stickers/upload', { headers: { 'content-type': 'application/octet-stream', ...headers }, body });
      const header = `${'a'.repeat(64)}.${'b'.repeat(64)}`;
      const cases: [Response | Promise<Response>, string, string][] = [
        [raw({ 'content-length': '0', 'x-sticker': `${header}.1` }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': 'abc', 'x-sticker': `${header}.1` }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': String(STICKER_UPLOAD_REQUEST_MAX_BYTES + 1), 'x-sticker': `${header}.1` }), 'too_large', STICKER_MESSAGES.tooLarge],
        [raw({ 'content-length': '8' }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': '8', 'x-sticker': `${header.toUpperCase()}.1` }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': '8', 'x-sticker': `${header}.0` }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': '8', 'x-sticker': `${header}.8` }), 'invalid_body', '请求格式错误'],
        [raw({ 'content-length': '200000', 'x-sticker': `${header}.${STICKER_THUMB_MAX_BYTES + 1}` }), 'invalid_thumb', STICKER_MESSAGES.thumb],
        [raw({ 'content-length': String(STICKER_MAX_BYTES + 101), 'x-sticker': `${header}.100` }), 'too_large', STICKER_MESSAGES.tooLarge],
        [raw({ 'content-length': '9', 'x-sticker': `${header}.1` }), 'invalid_body', '请求格式错误'],
        [upload('mem_ann', Uint8Array.from([1, 2, 3, 4, 5])), 'invalid_sticker', STICKER_MESSAGES.unreadable],
        [upload('mem_ann', gif(10, { width: 3000, height: 100 })), 'sticker_dimensions', STICKER_MESSAGES.dimensions],
        [upload('mem_ann', gif(11, { width: 1100, height: 1000, frames: 2 })), 'sticker_dimensions', STICKER_MESSAGES.animatedSize],
        [upload('mem_ann', gif(12, { width: 20, height: 20, frames: 301 })), 'sticker_frames', STICKER_MESSAGES.frames],
        [upload('mem_ann', gif(13), Uint8Array.from([1, 2, 3])), 'invalid_thumb', STICKER_MESSAGES.thumb],
        [upload('mem_ann', gif(14), gif(15, { width: 100, height: 100, frames: 2 })), 'invalid_thumb', STICKER_MESSAGES.thumb],
        [upload('mem_ann', gif(16), png(1, 300, 100)), 'invalid_thumb', STICKER_MESSAGES.thumb],
        [upload('mem_ann', gif(17), concat(png(1), Uint8Array.from([0]))), 'invalid_thumb', STICKER_MESSAGES.thumb],
      ];
      for (const [response, code, message] of cases) expect(await errorOf(await response)).toEqual({ status: 400, code, message });
      // A wide banner with a small area is not refused, and neither is a long static file.
      // 面积不大的宽横幅不会被拒绝，较长的静态文件也不会。
      expect((await upload('mem_ann', gif(18, { width: 1500, height: 600, frames: 2 }))).status).toBe(201);
      expect((await upload('mem_ann', gif(19, { width: 2048, height: 40 }))).status).toBe(201);
      expect(daily('mem_ann')?.uploads).toBe(2);
    });

    it('refuses a 1000th sticker with sticker_full before any put, and still takes a duplicate', async () => {
      seedFiles(1, STICKERS_PER_MEMBER_MAX - 1, 'mem_ann');
      const last = await upload('mem_ann', gif(20));
      expect(last.status).toBe(201);
      expect(((await last.json()) as StickerAddResponse).total).toBe(STICKERS_PER_MEMBER_MAX);
      files.calls.length = 0;
      const res = await upload('mem_ann', gif(21));
      expect(await errorOf(res)).toEqual({ status: 409, code: 'sticker_full', message: STICKER_MESSAGES.full });
      expect(files.calls).toEqual([]);
      expect(daily('mem_ann')?.uploads).toBe(1);
      const again = await upload('mem_ann', gif(20));
      expect(again.status).toBe(200);
      expect(((await again.json()) as StickerAddResponse).duplicate).toBe(true);
    });

    it('refuses blocked bytes for good, before any put', async () => {
      const file = gif(21);
      const now = new Date().toISOString();
      d1.rows(
        "INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_at, blocked_at) VALUES (?, 'gif', 240, 240, ?, 0, 'ready', ?, ?)",
        await idOf(file),
        file.length,
        now,
        now,
      );
      expect(await errorOf(await upload('mem_ann', file))).toEqual({ status: 409, code: 'sticker_blocked', message: STICKER_MESSAGES.blocked });
      expect(files.calls).toEqual([]);
    });

    it('answers each cap with its own code once the counters reach it', async () => {
      const day = today();
      d1.rows('INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, ?, ?)', day, 'mem_ann', STICKER_UPLOADS_PER_DAY);
      expect(await errorOf(await upload('mem_ann', gif(22)))).toEqual({ status: 429, code: 'sticker_daily_limit', message: STICKER_MESSAGES.daily });
      d1.rows("INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, '*', ?)", day, STICKER_CLUB_UPLOADS_PER_DAY);
      expect(await errorOf(await upload('mem_bob', gif(23)))).toEqual({ status: 429, code: 'sticker_club_limit', message: STICKER_MESSAGES.clubLimit });
      d1.rows("UPDATE sticker_daily SET uploads = 0 WHERE scope = '*'");
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'mem_bob', STICKER_LIVE_BYTES_PER_MEMBER);
      expect(await errorOf(await upload('mem_bob', gif(24)))).toEqual({ status: 429, code: 'sticker_storage_limit', message: STICKER_MESSAGES.memberStorage });
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', ?)", STICKER_CLUB_LIVE_BYTES);
      expect(await errorOf(await upload('mem_cat', gif(25)))).toEqual({ status: 503, code: 'sticker_storage_full', message: STICKER_MESSAGES.clubStorage });
      expect(files.calls).toEqual([]);
    });

    it('answers 503 without the bucket, and 503 schema_pending before migration 0019', async () => {
      expect(await errorOf(await upload('mem_ann', gif(26), png(), { extra: { FILES: undefined } }))).toMatchObject({ status: 503, code: 'storage_unavailable' });
      d1.exec('DROP TABLE sticker_daily');
      expect(await errorOf(await upload('mem_ann', gif(26)))).toEqual({ status: 503, code: 'schema_pending', message: STICKER_MESSAGES.pending });
      expect(await errorOf(await call('mem_ann', 'GET', '/stickers'))).toEqual({ status: 503, code: 'schema_pending', message: STICKER_MESSAGES.pending });
    });

    it('accepts exactly the daily number of 40 uploads started together, and the counters match what was accepted', async () => {
      const uploads = await Promise.all(Array.from({ length: 40 }, (_, i) => upload('mem_ann', gif(1000 + i), png(i))));
      const statuses = uploads.map((res) => res.status);
      const accepted = statuses.filter((status) => status === 201).length;
      expect(accepted).toBe(STICKER_UPLOADS_PER_DAY);
      for (const res of uploads.filter((r) => r.status !== 201)) {
        expect(await errorOf(res)).toEqual({ status: 429, code: 'sticker_daily_limit', message: STICKER_MESSAGES.daily });
      }
      const size = gif(1000).length + png(0).length;
      expect(daily('mem_ann')).toMatchObject({ uploads: accepted, upload_bytes: accepted * size });
      expect(daily('*')).toMatchObject({ uploads: accepted, upload_bytes: accepted * size });
      expect(counts('mem_ann')).toMatchObject({ items: accepted, live_bytes: accepted * size });
      expect(counts('*')?.live_bytes).toBe(accepted * size);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')).toEqual([{ n: accepted }]);
      expect(rowsOf('mem_ann')).toHaveLength(accepted);
    });

    it('lets parallel uploads by several members fill the club’s bytes exactly', async () => {
      const size = gif(0, { pad: 4000 }).length + png(0).length;
      d1.rows("INSERT INTO sticker_daily (day, scope, upload_bytes) VALUES (?, '*', ?)", today(), STICKER_CLUB_UPLOAD_BYTES_PER_DAY - 3 * size - 10);
      const members = ['mem_ann', 'mem_bob', 'mem_cat', 'mem_pres', 'mem_root'];
      const uploads = await Promise.all(members.flatMap((memberId, m) => [0, 1].map((k) => upload(memberId, gif(2000 + m * 10 + k, { pad: 4000 }), png(m * 10 + k)))));
      expect(uploads.filter((res) => res.status === 201)).toHaveLength(3);
      for (const res of uploads.filter((r) => r.status !== 201)) expect((await errorOf(res)).code).toBe('sticker_club_limit');
      expect(daily('*')?.upload_bytes).toBe(STICKER_CLUB_UPLOAD_BYTES_PER_DAY - 10);
      expect(daily('*')?.uploads).toBe(3);
    });

    it('keeps the per-minute limiter as the first line', async () => {
      limits.on = true;
      await addMember('mem_fast');
      for (let i = 0; i < 20; i += 1) expect((await upload('mem_fast', gif(3000 + i), png(i))).status).toBe(201);
      expect(await errorOf(await upload('mem_fast', gif(3100)))).toMatchObject({ status: 429, code: 'rate_limited' });
      expect(daily('mem_fast')?.uploads).toBe(20);
    });
  });

  describe('POST /stickers/add', () => {
    const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';

    it('adds a stored sticker with the message’s still, then answers 200 duplicate keeping that still', async () => {
      const file = gif(30);
      await upload('mem_ann', file);
      const id = await idOf(file);
      const res = await json('mem_bob', '/stickers/add', { id, thumb: THUMB });
      expect(res.status).toBe(201);
      expect((await res.json()) as StickerAddResponse).toMatchObject({ duplicate: false, total: 1, version: 1, sticker: { id, thumb: THUMB, type: 'gif' } });
      files.calls.length = 0;
      const again = await json('mem_bob', '/stickers/add', { id, thumb: 'ZzZzZzZzZzZzZzZzZzZzZz' });
      expect(again.status).toBe(200);
      expect((await again.json()) as StickerAddResponse).toMatchObject({ duplicate: true, sticker: { thumb: THUMB } });
      expect((await json('mem_cat', '/stickers/add', { id, thumb: null })).status).toBe(201);
      expect(rowsOf('mem_cat')).toEqual([{ sticker_id: id, thumb: null }]);
      expect(files.calls).toEqual([]);
      expect(daily('mem_bob')?.edits).toBe(2);
    });

    it('answers unknown and unfinished files with 404, a blocked one with 409 and a full collection with 409', async () => {
      const now = new Date().toISOString();
      d1.rows("INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_at) VALUES (?, 'png', 9, 9, 9, 0, 'pending', ?)", sid(1), now);
      d1.rows("INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_at, blocked_at) VALUES (?, 'png', 9, 9, 9, 0, 'ready', ?, ?)", sid(2), now, now);
      expect(await errorOf(await json('mem_ann', '/stickers/add', { id: sid(99) }))).toEqual({ status: 404, code: 'sticker_not_found', message: STICKER_MESSAGES.notFound });
      expect(await errorOf(await json('mem_ann', '/stickers/add', { id: sid(1) }))).toMatchObject({ status: 404, code: 'sticker_not_found' });
      expect(await errorOf(await json('mem_ann', '/stickers/add', { id: sid(2) }))).toEqual({ status: 409, code: 'sticker_blocked', message: STICKER_MESSAGES.blocked });
      seedFiles(10, 10 + STICKERS_PER_MEMBER_MAX, 'mem_bob');
      d1.rows('DELETE FROM member_stickers WHERE member_id = ? AND sticker_id = ?', 'mem_bob', sid(10 + STICKERS_PER_MEMBER_MAX));
      d1.rows('UPDATE sticker_counts SET items = ? WHERE scope = ?', STICKERS_PER_MEMBER_MAX, 'mem_bob');
      expect(await errorOf(await json('mem_bob', '/stickers/add', { id: sid(10 + STICKERS_PER_MEMBER_MAX) }))).toEqual({
        status: 409,
        code: 'sticker_full',
        message: STICKER_MESSAGES.full,
      });
      // At 999 a sticker already there still moves to the front.
      // 达到 999 个时，已有的表情仍可以移到最前。
      const dup = await json('mem_bob', '/stickers/add', { id: sid(500) });
      expect(dup.status).toBe(200);
      expect(rowsOf('mem_bob')[0]?.sticker_id).toBe(sid(500));
    });

    it('refuses malformed bodies and ids', async () => {
      const bad = (body: string) => call('mem_ann', 'POST', '/stickers/add', { headers: { 'content-type': 'application/json' }, body });
      expect(await errorOf(await bad('nope'))).toEqual({ status: 400, code: 'invalid_body', message: '请求格式错误' });
      expect(await errorOf(await bad('[1]'))).toMatchObject({ code: 'invalid_body' });
      for (const body of [{}, { id: 'stk_short' }, { id: sid(1), thumb: 'short' }, { id: sid(1), thumb: 5 }]) {
        expect(await errorOf(await json('mem_ann', '/stickers/add', body))).toEqual({ status: 400, code: 'invalid_ids', message: STICKER_MESSAGES.ids });
      }
    });

    it('stops at the edit budget with 429', async () => {
      seedFiles(1, 1);
      d1.rows('INSERT INTO sticker_daily (day, scope, edits) VALUES (?, ?, ?)', today(), 'mem_ann', STICKER_EDITS_PER_DAY);
      expect(await errorOf(await json('mem_ann', '/stickers/add', { id: sid(1) }))).toEqual({ status: 429, code: 'sticker_edit_limit', message: STICKER_MESSAGES.edits });
      expect(rowsOf('mem_ann')).toEqual([]);
    });
  });

  describe('POST /stickers/front', () => {
    it('puts the ids first in the order asked, drops repeats, ignores ids that are not the member’s', async () => {
      seedFiles(1, 5, 'mem_ann');
      seedFiles(6, 6, 'mem_bob');
      const res = await json('mem_ann', '/stickers/front', { ids: [sid(4), sid(2), sid(4), sid(6), sid(77)] });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ moved: 2, version: 2 });
      expect(rowsOf('mem_ann').map((row) => row.sticker_id)).toEqual([sid(4), sid(2), sid(1), sid(3), sid(5)]);
      expect(rowsOf('mem_bob').map((row) => row.sticker_id)).toEqual([sid(6)]);
      expect(daily('mem_ann')?.edits).toBe(4);
    });

    it('moves a whole collection of 999 in one call', async () => {
      seedFiles(1, STICKERS_PER_MEMBER_MAX, 'mem_ann');
      const ids = Array.from({ length: STICKERS_PER_MEMBER_MAX }, (_, i) => sid(STICKERS_PER_MEMBER_MAX - i));
      const res = await json('mem_ann', '/stickers/front', { ids });
      expect(await res.json()).toEqual({ moved: STICKERS_PER_MEMBER_MAX, version: 2 });
      expect(rowsOf('mem_ann').map((row) => row.sticker_id)).toEqual(ids);
    });

    it('refuses empty, oversized and malformed lists, and stops at the club’s edit budget', async () => {
      for (const body of [{}, { ids: [] }, { ids: 'x' }, { ids: [sid(1), 'bad'] }, { ids: Array.from({ length: STICKERS_PER_MEMBER_MAX + 1 }, (_, i) => sid(i)) }]) {
        expect(await errorOf(await json('mem_ann', '/stickers/front', body))).toEqual({ status: 400, code: 'invalid_ids', message: STICKER_MESSAGES.ids });
      }
      d1.rows("INSERT INTO sticker_daily (day, scope, edits) VALUES (?, '*', 5000)", today());
      expect(await errorOf(await json('mem_ann', '/stickers/front', { ids: [sid(1)] }))).toEqual({ status: 429, code: 'sticker_club_limit', message: STICKER_MESSAGES.clubLimit });
    });
  });

  describe('POST /stickers/remove', () => {
    it('removes only the member’s own rows, keeps the total equal to the rows and never touches the bucket', async () => {
      seedFiles(1, 3, 'mem_ann');
      d1.exec(`INSERT INTO member_stickers (member_id, sticker_id, position, added_at) VALUES ('mem_bob', '${sid(2)}', 1, 'x')`);
      const res = await json('mem_ann', '/stickers/remove', { ids: [sid(2), sid(3), sid(9)] });
      expect(await res.json()).toEqual({ removed: 2, total: 1, version: 2 });
      expect(rowsOf('mem_ann').map((row) => row.sticker_id)).toEqual([sid(1)]);
      expect(rowsOf('mem_bob').map((row) => row.sticker_id)).toEqual([sid(2)]);
      expect(counts('mem_ann')?.items).toBe(1);
      expect(files.calls).toEqual([]);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects')).toEqual([{ n: 3 }]);
    });

    it('removes 999 in one call', async () => {
      seedFiles(1, STICKERS_PER_MEMBER_MAX, 'mem_ann');
      const ids = Array.from({ length: STICKERS_PER_MEMBER_MAX }, (_, i) => sid(i + 1));
      expect(await (await json('mem_ann', '/stickers/remove', { ids })).json()).toEqual({ removed: STICKERS_PER_MEMBER_MAX, total: 0, version: 2 });
      expect(counts('mem_ann')?.items).toBe(0);
    });
  });

  describe('GET /stickers', () => {
    it('lists newest first with the limit, the version and a profile media token, never a pending or blocked file', async () => {
      const a = gif(40);
      const b = gif(41);
      await upload('mem_ann', a);
      await upload('mem_ann', b);
      const now = new Date().toISOString();
      d1.rows("INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_at) VALUES (?, 'png', 9, 9, 9, 0, 'pending', ?)", sid(1), now);
      d1.rows("INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_at, blocked_at) VALUES (?, 'png', 9, 9, 9, 0, 'ready', ?, ?)", sid(2), now, now);
      d1.rows("INSERT INTO member_stickers (member_id, sticker_id, position, added_at) VALUES ('mem_ann', ?, 9e15, ?), ('mem_ann', ?, 9e15, ?)", sid(1), now, sid(2), now);
      const res = await call('mem_ann', 'GET', '/stickers');
      expect(res.status).toBe(200);
      const body = (await res.json()) as StickerListResponse & { stickers: StickerAddResponse['sticker'][] };
      expect(body.stickers.map((s) => s.id)).toEqual([await idOf(b), await idOf(a)]);
      expect(body).toMatchObject({ max: STICKERS_PER_MEMBER_MAX, version: 2, mediaToken: await issueProfileMediaToken(SECRET) });
      expect(daily('mem_ann')?.lists).toBe(1);
    });

    it('answers unchanged without counting a list when the version matches, and 429 once the full lists are spent', async () => {
      seedFiles(1, 2, 'mem_ann');
      const unchanged = await call('mem_ann', 'GET', '/stickers?v=1');
      expect(await unchanged.json()).toEqual({ unchanged: true, max: STICKERS_PER_MEMBER_MAX, version: 1, mediaToken: await issueProfileMediaToken(SECRET) });
      expect(daily('mem_ann')).toBeUndefined();
      expect(((await (await call('mem_ann', 'GET', '/stickers?v=abc')).json()) as { stickers?: unknown[] }).stickers).toHaveLength(2);
      d1.rows('UPDATE sticker_daily SET lists = ? WHERE scope = ?', STICKER_FULL_LISTS_PER_DAY, 'mem_ann');
      expect(await errorOf(await call('mem_ann', 'GET', '/stickers?v=0'))).toMatchObject({ status: 429, code: 'rate_limited' });
      expect((await call('mem_ann', 'GET', '/stickers?v=1')).status).toBe(200);
      expect((await call(null, 'GET', '/stickers')).status).toBe(401);
    });
  });

  describe('POST /stickers/block', () => {
    it('is for the system administrator’s real role only, acting as a student or not', async () => {
      seedFiles(1, 1);
      expect(await errorOf(await json('mem_pres', '/stickers/block', { id: sid(1) }))).toEqual({ status: 403, code: 'forbidden', message: STICKER_MESSAGES.blockForbidden });
      expect(await errorOf(await json('mem_ann', '/stickers/block', { id: sid(1) }))).toMatchObject({ status: 403 });
      expect((await json('mem_root', '/stickers/block', { id: sid(1) })).status).toBe(200);
      expect(await errorOf(await json('mem_root', '/stickers/block', { id: sid(9) }))).toEqual({ status: 404, code: 'sticker_not_found', message: STICKER_MESSAGES.notFound });
      expect(await errorOf(await json('mem_root', '/stickers/block', { id: 'nope' }))).toMatchObject({ status: 400, code: 'invalid_ids' });
    });

    it('takes the sticker out of every collection, deletes the original and every still in one call, and refuses it from then on', async () => {
      const file = gif(50);
      const annStill = png(1);
      const bobStill = png(2);
      await upload('mem_ann', file, annStill);
      await upload('mem_bob', file, bobStill);
      const id = await idOf(file);
      await json('mem_cat', '/stickers/add', { id, thumb: null });
      files.calls.length = 0;
      const res = await json('mem_root', '/stickers/block', { id });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ blocked: true });
      expect(files.calls).toHaveLength(1);
      const deleted = (files.calls[0] ?? '').replace(/^delete /, '').split(' ').sort();
      expect(deleted).toEqual([...originals(id), `sticker/${id}-t-${await thumbOf(file, annStill)}`, `sticker/${id}-t-${await thumbOf(file, bobStill)}`].sort());
      expect(files.objects.size).toBe(0);
      for (const member of ['mem_ann', 'mem_bob', 'mem_cat']) {
        expect(rowsOf(member)).toEqual([]);
        expect(counts(member)).toMatchObject({ items: 0, version: 2 });
      }
      // The file's bytes and both stills' come off.
      // 文件和两张静态缩略图的字节数都被减去。
      expect(counts('mem_ann')?.live_bytes).toBe(0);
      expect(counts('mem_bob')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')).toEqual([{ n: 0 }]);
      expect((await errorOf(await upload('mem_ann', file))).code).toBe('sticker_blocked');
      expect((await errorOf(await json('mem_ann', '/stickers/add', { id }))).code).toBe('sticker_blocked');
      // A repeat is safe: it deletes what is left (the original) and answers the same.
      // 重复封禁是安全的：删除剩下的内容（原始文件），回答相同。
      files.calls.length = 0;
      expect((await json('mem_root', '/stickers/block', { id })).status).toBe(200);
      expect(files.calls).toEqual([`delete ${originals(id).join(' ')}`]);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('answers 503 when the objects cannot be deleted, after the block itself has happened', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      seedFiles(1, 1, 'mem_ann');
      const failing = { delete: async () => Promise.reject(new Error('R2 down')) } as unknown as R2Bucket;
      const res = await call('mem_root', 'POST', '/stickers/block', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: sid(1) }),
        extra: { FILES: failing },
      });
      expect(await errorOf(res)).toEqual({ status: 503, code: 'sticker_unavailable', message: STICKER_MESSAGES.unavailable });
      expect(d1.rows('SELECT blocked_at IS NOT NULL AS blocked FROM sticker_objects WHERE id = ?', sid(1))).toEqual([{ blocked: 1 }]);
      expect(rowsOf('mem_ann')).toEqual([]);
      vi.restoreAllMocks();
    });
  });

  it('exposes the five routes', () => {
    const paths = stickerRoutes.routes.map((route) => `${route.method} ${route.path}`);
    for (const route of ['GET /', 'POST /upload', 'POST /add', 'POST /front', 'POST /remove', 'POST /block']) expect(paths).toContain(route);
  });
});
