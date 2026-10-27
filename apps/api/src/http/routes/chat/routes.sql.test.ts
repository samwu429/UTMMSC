import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { enrollmentCalendarYear, type ChatOverviewResponse, type RoomMeta, type RoomTicketResponse, type Role } from '@utmmsc/shared';
import { signPayload } from '../../../domain/crypto/hmac';
import { issueSessionToken } from '../../../domain/identity/session-token';
import { issueChatMediaToken } from '../../../domain/profile/media-token';
import type { Env } from '../../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../../infrastructure/d1/testing/sqlite-d1';
import type { AppEnv } from '../../context';
import { errorResponse } from '../../errors';
import { CHAT_IMAGE_UPLOADS_PER_ADDRESS_PER_MINUTE, CHAT_IMAGE_UPLOADS_PER_MINUTE, chatRoutes, socketBase } from './index';

const SECRET = 'test-session-secret';
const UPLOAD = 'channel-icon/ch_all/cic_abcdefghijklmnop.webp';

/**
 * D1 that records which statements run in which round: a statement issued while k rounds have finished is in round
 * k + 1. Each statement takes a moment, so statements started together finish together.
 * 记录每条语句属于第几轮的 D1：在已完成 k 轮时发出的语句属于第 k + 1 轮。每条语句都会耗时片刻，因此同时开始的语句会同时完成。
 */
function roundCounting(db: D1Database) {
  let finished = 0;
  const rounds: number[] = [];
  const timed = async <T>(run: () => Promise<T>): Promise<T> => {
    const round = finished + 1;
    rounds.push(round);
    await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      return await run();
    } finally {
      finished = Math.max(finished, round);
    }
  };
  const wrap = (inner: D1PreparedStatement): D1PreparedStatement =>
    ({
      bind: (...values: unknown[]) => wrap(inner.bind(...values)),
      first: (column?: string) => timed(() => (column === undefined ? inner.first() : inner.first(column))),
      all: () => timed(() => inner.all()),
      run: () => timed(() => inner.run()),
      raw: () => timed(() => inner.raw()),
    }) as unknown as D1PreparedStatement;
  return {
    db: { prepare: (sql: string) => wrap(db.prepare(sql)), batch: (list: D1PreparedStatement[]) => timed(() => db.batch(list)) } as unknown as D1Database,
    reset: () => {
      finished = 0;
      rounds.length = 0;
    },
    count: () => ({ queries: rounds.length, rounds: Math.max(0, ...rounds) }),
  };
}

interface StoredObject {
  bytes: Uint8Array;
  type: string;
}

function fakeBucket() {
  const objects = new Map<string, StoredObject>();
  const calls: string[] = [];
  const bucket = {
    put: async (key: string, value: ArrayBuffer, options?: R2PutOptions) => {
      calls.push(`put ${key}`);
      objects.set(key, { bytes: new Uint8Array(value), type: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType ?? '' });
    },
    get: async (key: string, options?: { onlyIf?: unknown }) => {
      calls.push(`get ${key}`);
      const stored = objects.get(key);
      if (!stored) return null;
      const meta = { key, size: stored.bytes.byteLength, etag: `e${key.length}`, httpEtag: `"e${key.length}"`, uploaded: new Date(0), httpMetadata: { contentType: stored.type } };
      if (options?.onlyIf instanceof Headers && options.onlyIf.get('if-none-match') === meta.httpEtag) return meta;
      return { ...meta, range: { offset: 0, length: stored.bytes.byteLength }, body: new Response(stored.bytes).body };
    },
    head: async () => null,
    delete: async () => undefined,
  };
  return { bucket: bucket as unknown as R2Bucket, objects, calls };
}

describe('socketBase', () => {
  it('puts sockets on the public address for requests the site forwarded', () => {
    expect(socketBase('https://utmmsc-api.utmmsc.workers.dev/chat/rooms/x/ticket', '/api', 'https://utmmsc.com/api')).toBe('wss://utmmsc.com/api');
    expect(socketBase('https://utmmsc-api.utmmsc.workers.dev/chat/rooms/x/ticket', '/api', 'https://utmmsc.com/api/')).toBe('wss://utmmsc.com/api');
  });

  it('keeps the address that was called otherwise', () => {
    expect(socketBase('https://utmmsc-api.utmmsc.workers.dev/chat/rooms/x/ticket', undefined, 'https://utmmsc.com/api')).toBe('wss://utmmsc-api.utmmsc.workers.dev');
    expect(socketBase('http://localhost:8787/chat/rooms/x/ticket', undefined, undefined)).toBe('ws://localhost:8787');
    expect(socketBase('https://utmmsc-api.utmmsc.workers.dev/x', '/api', undefined)).toBe('wss://utmmsc-api.utmmsc.workers.dev');
    expect(socketBase('https://utmmsc-api.utmmsc.workers.dev/x', '/api', 'http://insecure.example/api')).toBe('wss://utmmsc-api.utmmsc.workers.dev');
  });
});

describe.skipIf(!sqlite)('chat routes on SQLite', () => {
  let d1: SqliteD1;
  let counting: ReturnType<typeof roundCounting>;
  let files: ReturnType<typeof fakeBucket>;
  const tokens = new Map<string, string>();
  const app = new Hono<AppEnv>();
  app.onError(errorResponse);
  app.route('/chat', chatRoutes);

  const env = (extra: Partial<Env> = {}) =>
    ({
      DB: counting.db,
      SESSION_SECRET: SECRET,
      FILES: files.bucket,
      APP_BASE_URL: 'https://utmmsc.com/UTMMSC/',
      API_PUBLIC_URL: 'https://utmmsc.com/api',
      CHAT_ROOMS: {
        idFromName: (name: string) => name,
        get: () => ({ summaryFor: async () => ({ unreadCount: 0, firstUnreadId: null, firstMentionId: null, lastMessage: null, joinedAt: null }) }),
      },
      ...extra,
    }) as unknown as Env;

  async function addMember(id: string, role: Role = 'student') {
    const now = new Date().toISOString();
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', 'active', ?, 'student', ?, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      id,
      role,
      enrollmentCalendarYear(),
      now,
      now,
    );
    const expires = new Date(Date.now() + 86_400_000);
    d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)', `ses_${id}`, id, expires.toISOString(), now);
    tokens.set(id, await issueSessionToken(SECRET, `ses_${id}`, id, expires));
  }

  const call = (memberId: string | null, method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit; extra?: Partial<Env> } = {}) => {
    const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.7', ...init.headers };
    if (memberId) headers.authorization = `Bearer ${tokens.get(memberId)}`;
    const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext;
    return app.request(path, { method, headers, body: init.body }, env(init.extra), ctx);
  };

  beforeEach(async () => {
    d1 = createSqliteD1();
    counting = roundCounting(d1.db);
    files = fakeBucket();
    tokens.clear();
    await addMember('mem_ann');
    await addMember('mem_bob');
    await addMember('mem_pres', 'president');
    const now = new Date().toISOString();
    d1.rows('UPDATE channels SET last_message_at = ?', now);
    d1.rows("UPDATE channels SET icon_key = ? WHERE id = 'ch_all'", UPLOAD);
    d1.rows("INSERT INTO channels (id, slug, name, audience, post_policy, created_at, icon_key) VALUES ('ch_team', 'team', '小组', 'custom', 'members', ?, 'preset:tech')", now);
    d1.rows("INSERT INTO channel_memberships (channel_id, member_id, joined_at) VALUES ('ch_team', 'mem_ann', ?)", now);
    d1.rows("INSERT INTO direct_conversations (id, member_low, member_high, created_at) VALUES ('dm_1', 'mem_ann', 'mem_bob', ?)", now);
    d1.rows("INSERT INTO friend_requests (id, from_id, to_id, status, created_at, updated_at) VALUES ('fr_1', 'mem_ann', 'mem_bob', 'accepted', ?, ?)", now, now);
    // The hourly graduation sweep runs on the first request; the counts below are for the requests after it.
    // 每小时一次的毕业处理在第一个请求时执行；下面的计数针对之后的请求。
    await call('mem_ann', 'GET', '/chat/overview');
    counting.reset();
  });
  afterEach(() => d1.close());

  describe('channel icons', () => {
    it('lists each channel with its icon key, or null', async () => {
      d1.rows("UPDATE channels SET icon_key = 'preset:unknown' WHERE id = 'ch_announcements'");
      const body = (await (await call('mem_ann', 'GET', '/chat/overview')).json()) as ChatOverviewResponse;
      const icons = Object.fromEntries(body.channels.map((ch) => [ch.id, ch.iconKey]));
      expect(icons.ch_all).toBe(UPLOAD);
      expect(icons.ch_team).toBe('preset:tech');
      expect(Object.values(icons).filter((key) => key === null).length).toBe(body.channels.length - 2);
    });

    it('describes a channel with its icon in the room info and the ticket meta, and a direct room without one', async () => {
      const info = (await (await call('mem_ann', 'GET', '/chat/rooms/channel%3Ach_team/info')).json()) as RoomMeta;
      expect(info).toMatchObject({ roomId: 'channel:ch_team', title: '小组', memberCount: 1, iconKey: 'preset:tech' });
      const ticket = (await (await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket?meta=1')).json()) as RoomTicketResponse;
      expect(ticket.room?.iconKey).toBe(UPLOAD);
      const direct = (await (await call('mem_ann', 'GET', '/chat/rooms/direct%3Adm_1/info')).json()) as RoomMeta;
      expect(direct).toMatchObject({ kind: 'direct', memberCount: 2, peer: { id: 'mem_bob' } });
      expect('iconKey' in direct).toBe(false);
    });
  });

  describe('access and meta', () => {
    it('still refuses rooms the member cannot read', async () => {
      expect((await call('mem_bob', 'POST', '/chat/rooms/channel%3Ach_team/ticket?meta=1')).status).toBe(403);
      expect((await call('mem_bob', 'GET', '/chat/rooms/channel%3Ach_nope/info')).status).toBe(404);
      expect((await call('mem_pres', 'GET', '/chat/rooms/direct%3Adm_1/info')).status).toBe(403);
      expect((await call('mem_ann', 'GET', '/chat/rooms/nonsense/info')).status).toBe(404);
    });

    it('lists members at or above a moderator, and takes the viewer prefs', async () => {
      d1.rows("INSERT INTO chat_prefs (member_id, room_id, pinned, muted, marked_unread, updated_at) VALUES ('mem_pres', 'channel:ch_all', 1, 0, 0, ?)", new Date().toISOString());
      const info = (await (await call('mem_pres', 'GET', '/chat/rooms/channel%3Ach_all/info')).json()) as RoomMeta;
      expect(info.canModerate).toBe(true);
      expect(info.moderationExempt).toEqual(['mem_pres']);
      expect(info.prefs.pinned).toBe(true);
      expect(info.memberCount).toBe(3);
    });

    it('a channel ticket with meta reads in three rounds: the session, then access with prefs, then the count', async () => {
      const res = await call('mem_pres', 'POST', '/chat/rooms/channel%3Ach_all/ticket?meta=1');
      expect(res.status).toBe(200);
      expect(counting.count()).toEqual({ queries: 7, rounds: 3 });
    });

    it('a direct ticket with meta reads in three rounds: the session, then the conversation, then friends, peer and count', async () => {
      const res = await call('mem_ann', 'POST', '/chat/rooms/direct%3Adm_1/ticket?meta=1');
      expect(res.status).toBe(200);
      expect(counting.count()).toEqual({ queries: 6, rounds: 3 });
    });

    it('a ticket without meta reads in two rounds', async () => {
      expect((await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket')).status).toBe(200);
      expect(counting.count()).toEqual({ queries: 4, rounds: 2 });
    });

    it('the overview reads in two rounds', async () => {
      expect((await call('mem_ann', 'GET', '/chat/overview')).status).toBe(200);
      expect(counting.count().rounds).toBe(2);
    });
  });

  describe('tickets', () => {
    it('gives the same media token to every ticket of the day, so image URLs stay the same', async () => {
      const first = (await (await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket')).json()) as RoomTicketResponse;
      const second = (await (await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket?meta=1')).json()) as RoomTicketResponse;
      expect(second.mediaToken).toBe(first.mediaToken);
      expect(first.mediaToken).toBe(await issueChatMediaToken(SECRET, 'channel:ch_all'));
      expect(second.ticket).not.toBe(first.ticket);
    });

    it('opens the socket on utmmsc.com for a request the site forwarded, and where it was called otherwise', async () => {
      const forwarded = (await (await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket', { headers: { 'x-forwarded-prefix': '/api' } })).json()) as RoomTicketResponse;
      expect(forwarded.socketUrl).toMatch(/^wss:\/\/utmmsc\.com\/api\/chat\/rooms\/channel%3Ach_all\/socket\?ticket=/);
      const direct = (await (await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket')).json()) as RoomTicketResponse;
      expect(direct.socketUrl).toMatch(/^ws:\/\/localhost\/chat\/rooms\/channel%3Ach_all\/socket\?ticket=/);
      const unset = (await (
        await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/ticket', { headers: { 'x-forwarded-prefix': '/api' }, extra: { API_PUBLIC_URL: undefined } })
      ).json()) as RoomTicketResponse;
      expect(unset.socketUrl).toMatch(/^ws:\/\/localhost\/chat\//);
    });
  });

  describe('images', () => {
    it('stores a photo and its thumbnail as two images of the room', async () => {
      const keys: string[] = [];
      for (const size of [4000, 300]) {
        const res = await call('mem_ann', 'POST', '/chat/rooms/channel%3Ach_all/images', {
          headers: { 'content-type': 'image/jpeg', 'content-length': String(size) },
          body: new Uint8Array(size),
        });
        expect(res.status).toBe(201);
        keys.push(((await res.json()) as { imageKey: string }).imageKey);
      }
      expect(keys.every((key) => key.startsWith('chat/channel/ch_all/img_'))).toBe(true);
      expect(new Set(keys).size).toBe(2);
      expect(files.objects.get(keys[1]!)?.bytes.byteLength).toBe(300);
    });

    it('lets each member send 20 photos with thumbnails a minute, even with others on the same address', async () => {
      // Members and an address no other test uses, since the limits live for the whole file.
      // 使用其他测试没有用过的成员和地址，因为这些限制在整个文件中一直有效。
      const ip = '198.51.100.40';
      // The plain D1, without the round counter's pause on every statement, keeps the 120 uploads quick.
      // 使用不带轮次计数的 D1（计数器每条语句都会停顿片刻），120 次上传才能很快完成。
      const upload = (memberId: string) =>
        call(memberId, 'POST', '/chat/rooms/channel%3Ach_all/images', {
          headers: { 'content-type': 'image/jpeg', 'content-length': '10', 'cf-connecting-ip': ip },
          body: new Uint8Array(10),
          extra: { DB: d1.db },
        });
      expect(CHAT_IMAGE_UPLOADS_PER_MINUTE).toBe(2 * 20);
      for (const id of ['mem_up1', 'mem_up2', 'mem_up3']) await addMember(id);
      let fromAddress = 0;
      for (const id of ['mem_up1', 'mem_up2']) {
        for (let i = 0; i < CHAT_IMAGE_UPLOADS_PER_MINUTE; i += 1) expect((await upload(id)).status).toBe(201);
        expect((await upload(id)).status).toBe(429);
        fromAddress += CHAT_IMAGE_UPLOADS_PER_MINUTE + 1;
      }
      // The address limit, counted before the session is read, still stops a flood from one address.
      // 地址限制在读取登录之前计算，仍会挡住来自同一地址的大量请求。
      for (; fromAddress < CHAT_IMAGE_UPLOADS_PER_ADDRESS_PER_MINUTE; fromAddress += 1) expect((await upload('mem_up3')).status).toBe(201);
      expect((await upload('mem_up3')).status).toBe(429);
    });

    it('serves a room image with one R2 call, an ETag, immutable caching and 304 for a held copy', async () => {
      const key = 'chat/channel/ch_all/img_one.jpg';
      files.objects.set(key, { bytes: new Uint8Array(1234), type: 'image/jpeg' });
      const token = await issueChatMediaToken(SECRET, 'channel:ch_all');
      const path = `/chat/media/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
      files.calls.length = 0;
      const res = await call(null, 'GET', path);
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect((await res.arrayBuffer()).byteLength).toBe(1234);
      const etag = res.headers.get('etag') ?? '';
      expect(etag).not.toBe('');
      const again = await call(null, 'GET', path, { headers: { 'if-none-match': etag } });
      expect(again.status).toBe(304);
      expect(files.calls).toEqual([`get ${key}`, `get ${key}`]);
    });

    it('serves a sticker message’s alias from the sticker’s original, for this room’s token only', async () => {
      const sticker = 'stk_0123456789abcdefghijkl';
      files.objects.set(`sticker/${sticker}.gif`, { bytes: new Uint8Array(777), type: 'image/gif' });
      files.objects.set('chat/channel/ch_all/img_one.jpg', { bytes: new Uint8Array(12), type: 'image/jpeg' });
      const token = await issueChatMediaToken(SECRET, 'channel:ch_all');
      const path = (key: string, t = token) => `/chat/media/${encodeURIComponent(key)}?t=${encodeURIComponent(t)}`;
      files.calls.length = 0;
      const res = await call(null, 'GET', path(`chat/channel/ch_all/${sticker}.gif`));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/gif');
      expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
      expect(res.headers.get('cross-origin-resource-policy')).toBeNull();
      expect((await res.arrayBuffer()).byteLength).toBe(777);
      expect(files.calls).toEqual([`get sticker/${sticker}.gif`]);
      // Another room's alias, extra segments and '..' never reach the sticker.
      // 其他房间的别名、多出的路径段和 '..' 都无法访问到表情。
      expect((await call(null, 'GET', path(`chat/channel/ch_team/${sticker}.gif`))).status).toBe(403);
      expect((await call(null, 'GET', path(`chat/channel/ch_team/${sticker}.gif`, await issueChatMediaToken(SECRET, 'channel:ch_team')))).status).toBe(200);
      expect((await call(null, 'GET', path(`chat/channel/ch_all/x/${sticker}.gif`))).status).toBe(404);
      expect((await call(null, 'GET', path(`chat/channel/ch_all/../ch_all/${sticker}.gif`))).status).toBe(403);
      expect((await call(null, 'GET', path(`chat/channel/ch_all/${sticker}-t-AbCdEfGhIjKlMnOpQrStUv`))).status).toBe(404);
      expect(files.calls.filter((entry) => entry.startsWith('get sticker/'))).toHaveLength(2);
      // Real chat images are served as before.
      // 真正的聊天图片照常提供。
      const image = await call(null, 'GET', path('chat/channel/ch_all/img_one.jpg'));
      expect(image.status).toBe(200);
      expect((await image.arrayBuffer()).byteLength).toBe(12);
    });

    it('accepts the hour-long tokens of older servers, and refuses another room, an expired token and a missing file', async () => {
      const key = 'chat/channel/ch_all/img_one.jpg';
      files.objects.set(key, { bytes: new Uint8Array(10), type: 'image/jpeg' });
      const path = (token: string, k = key) => `/chat/media/${encodeURIComponent(k)}?t=${encodeURIComponent(token)}`;
      const old = await signPayload(SECRET, { kind: 'media', roomId: 'channel:ch_all', exp: Date.now() + 3_600_000 });
      expect((await call(null, 'GET', path(old))).status).toBe(200);
      expect((await call(null, 'GET', path(await issueChatMediaToken(SECRET, 'channel:ch_team')))).status).toBe(403);
      expect((await call(null, 'GET', path(await signPayload(SECRET, { kind: 'media', roomId: 'channel:ch_all', exp: Date.now() - 1 })))).status).toBe(401);
      expect((await call(null, 'GET', path(await issueChatMediaToken(SECRET, 'channel:ch_all'), 'chat/channel/ch_all/img_none.jpg'))).status).toBe(404);
    });
  });
});
