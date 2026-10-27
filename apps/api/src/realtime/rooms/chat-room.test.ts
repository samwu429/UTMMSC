import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ServerFrame } from '@utmmsc/shared';
import type { Env } from '../../env';
import { findStickerRef } from '../../infrastructure/d1/sticker-refs';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../infrastructure/d1/testing/sqlite-d1';
import { notifyChatMessage } from '../../infrastructure/push/chat';
import { ensureRoomSchema } from './room-schema';
import { STICKER_LOOKUP_TIMEOUT_MS } from './sticker-lookup';
import { createTestSqlStorage, type TestSqlStorage } from './testing/sql-storage';
import { SEND_QUEUE_MAX, type SocketIdentity } from './chat-room';

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    protected ctx: unknown;
    protected env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
vi.mock('../../infrastructure/push/chat', () => ({
  MESSAGE_PUSH_INTERVAL_MS: 5_000,
  notifyChatMessage: vi.fn(async () => null),
  notifyChatRetraction: vi.fn(async () => null),
}));
// The real lookup over the test D1, which a test can hold back or fail once.
// 在测试 D1 上运行的真实查询，测试可以让某一次等待或失败。
vi.mock('../../infrastructure/d1/sticker-refs', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../infrastructure/d1/sticker-refs')>();
  return { ...real, findStickerRef: vi.fn(real.findStickerRef) };
});

const realStickerRefs = await vi.importActual<typeof import('../../infrastructure/d1/sticker-refs')>('../../infrastructure/d1/sticker-refs');
const lookups = vi.mocked(findStickerRef);
const pushes = vi.mocked(notifyChatMessage);

const ROOM = 'channel:ch_all';
const IMAGE = 'chat/channel/ch_all/img_main0000000001.jpg';
const THUMB = 'chat/channel/ch_all/img_thumb000000001.jpg';
const ANN_IMAGE = 'chat/channel/ch_all/img_main0000000002.jpg';
const ANN_THUMB = 'chat/channel/ch_all/img_thumb000000002.jpg';

/** A hibernatable socket as the room sees it: tags, an attachment and the frames sent to it. */
/** 房间所见的可休眠连接：标签、附件以及发给它的帧。 */
class FakeSocket {
  readonly sent: string[] = [];
  private attachment: unknown = null;
  constructor(readonly tags: string[]) {}
  send(payload: string): void {
    this.sent.push(payload);
  }
  serializeAttachment(value: unknown): void {
    this.attachment = structuredClone(value);
  }
  deserializeAttachment(): unknown {
    return this.attachment;
  }
  close(): void {}
  frames(): ServerFrame[] {
    return this.sent.map((payload) => JSON.parse(payload) as ServerFrame);
  }
  last<T extends ServerFrame['type']>(type: T): Extract<ServerFrame, { type: T }> {
    const frame = this.frames()
      .filter((f) => f.type === type)
      .at(-1);
    if (!frame) throw new Error(`no ${type} frame`);
    return frame as Extract<ServerFrame, { type: T }>;
  }
}

interface Harness {
  room: import('./chat-room').ChatRoom;
  storage: TestSqlStorage;
  d1: SqliteD1;
  deleted: string[][];
  waits: Promise<unknown>[];
  connect(memberId: string, displayName: string): FakeSocket;
  /** Opens a socket through the room's own upgrade, which sends the ready frame. */
  /** 通过房间自己的升级流程打开连接，房间会发送 ready 帧。 */
  open(memberId: string, displayName: string): Promise<FakeSocket>;
  send(ws: FakeSocket, frame: Record<string, unknown>): Promise<void>;
  authorQueries(): number;
  settle(): Promise<void>;
}

interface RoomOptions {
  roomId?: string;
  /** Runs on the room's storage before the object starts, to leave a room as older code left it. */
  /** 在对象启动之前对房间存储执行，用于构造旧代码留下的房间。 */
  seed?: (storage: TestSqlStorage) => void;
}

async function createRoom(options: RoomOptions = {}): Promise<Harness> {
  (globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??= class {
    constructor(
      readonly request: string,
      readonly response: string,
    ) {}
  };
  const { ChatRoom } = await import('./chat-room');
  const roomId = options.roomId ?? ROOM;
  const storage = createTestSqlStorage();
  options.seed?.(storage);
  const d1 = createSqliteD1();
  const sockets: FakeSocket[] = [];
  const waits: Promise<unknown>[] = [];
  const deleted: string[][] = [];
  const kv = new Map<string, unknown>([['roomId', roomId]]);
  let ready: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: storage.sql,
      get: async (key: string) => kv.get(key),
      put: async (key: string, value: unknown) => void kv.set(key, value),
    },
    setWebSocketAutoResponse: () => undefined,
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => (ready = fn()),
    getWebSockets: (tag?: string) => sockets.filter((s) => tag === undefined || s.tags.includes(tag)),
    acceptWebSocket: (ws: FakeSocket, tags: string[] = []) => {
      ws.tags.push(...tags);
      sockets.push(ws);
    },
    waitUntil: (promise: Promise<unknown>) => void waits.push(promise),
  };
  const env = {
    DB: d1.db,
    FILES: {
      delete: async (keys: string | string[]) => void deleted.push(Array.isArray(keys) ? [...keys] : [keys]),
    },
  } as unknown as Env;
  const room = new ChatRoom(ctx as unknown as DurableObjectState, env);
  await ready;
  const now = new Date().toISOString();
  for (const [id, name] of [
    ['mem_ann', 'Ann'],
    ['mem_bob', 'Bob'],
  ]) {
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', 'active', 'student', 'student', 2025, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      name,
      now,
      now,
    );
  }
  const direct = /^direct:(.+)$/.exec(roomId);
  if (direct) {
    d1.rows("INSERT INTO direct_conversations (id, member_low, member_high, created_at) VALUES (?, 'mem_ann', 'mem_bob', ?)", direct[1], now);
  }
  return {
    room,
    storage,
    d1,
    deleted,
    waits,
    async open(memberId, displayName) {
      const pair = { 0: new FakeSocket([]), 1: new FakeSocket([]) };
      // Workers' WebSocketPair and a Response that may carry status 101, which Node's Response refuses.
      // Workers 的 WebSocketPair，以及可以带 101 状态的 Response（Node 的 Response 不接受 101）。
      vi.stubGlobal('WebSocketPair', function WebSocketPair() {
        return pair;
      });
      vi.stubGlobal(
        'Response',
        class {
          constructor(
            readonly body: unknown,
            readonly init: { status?: number } = {},
          ) {}
          get status(): number {
            return this.init.status ?? 200;
          }
        },
      );
      const headers = new Map<string, string>([
        ['upgrade', 'websocket'],
        ['x-room-identity', JSON.stringify({ memberId, displayName, role: 'student', canPost: true, access: { joinedAt: null, floorApplies: false } })],
        ['x-room-id', roomId],
        ['x-room-ticket-id', crypto.randomUUID()],
        ['x-room-ticket-exp', String(Date.now() + 60_000)],
      ]);
      try {
        const response = await room.fetch({ headers: { get: (name: string) => headers.get(name) ?? null } } as unknown as Request);
        expect(response.status).toBe(101);
      } finally {
        vi.unstubAllGlobals();
      }
      return pair[1];
    },
    connect(memberId, displayName) {
      const ws = new FakeSocket([memberId]);
      ws.serializeAttachment({
        memberId,
        displayName,
        role: 'student',
        canPost: true,
        avatarKey: null,
        access: { joinedAt: null, floorApplies: false },
        floorId: 0,
        floorReason: null,
        socketId: `socket-${memberId}-${sockets.length}`,
      } satisfies SocketIdentity);
      sockets.push(ws);
      return ws;
    },
    send: (ws, frame) => room.webSocketMessage(ws as unknown as WebSocket, JSON.stringify(frame)),
    authorQueries: () => d1.statements.filter((s) => /SELECT id, display_name, avatar_key FROM members/.test(s.sql)).length,
    settle: async () => {
      await Promise.allSettled(waits);
    },
  };
}

const imageFrame = (clientId: string, extra: Record<string, unknown> = {}) => ({
  type: 'send',
  clientId,
  text: '',
  imageKey: IMAGE,
  imageWidth: 2048,
  imageHeight: 1536,
  thumbKey: THUMB,
  ...extra,
});

const STICKER = 'stk_0123456789abcdefghijkl';
const OTHER = 'stk_otherotherotherother00';
const STILL = 'AbCdEfGhIjKlMnOpQrStUv';
const ALIAS = `chat/channel/ch_all/${STICKER}.gif`;
/** The sticker as D1 describes it, with the sender's still. */
/** D1 所描述的表情，加上发送者的静态图。 */
const STICKER_REF = { id: STICKER, type: 'gif', width: 240, height: 180, animated: true, bytes: 182044, thumb: STILL } as const;

const stickerFrame = (clientId: string, extra: Record<string, unknown> = {}) => ({ type: 'send', clientId, text: '', sticker: STICKER, stickerThumb: STILL, ...extra });
const textFrame = (clientId: string, text: string, extra: Record<string, unknown> = {}) => ({ type: 'send', clientId, text, ...extra });

/** A sticker_objects row created by Ann, ready unless told otherwise. */
/** 由 Ann 创建的 sticker_objects 记录，默认为 ready。 */
function seedSticker(d1: SqliteD1, id: string, fields: { state?: string; blockedAt?: string | null; type?: string; animated?: number } = {}): void {
  const now = new Date().toISOString();
  d1.rows(
    "INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at, blocked_at) VALUES (?, ?, 240, 180, 182044, ?, ?, 'mem_ann', ?, ?, ?)",
    id,
    fields.type ?? 'gif',
    fields.animated ?? 1,
    fields.state ?? 'ready',
    now,
    now,
    fields.blockedAt ?? null,
  );
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

/** Holds the next sticker lookup until released, then answers it from the test D1. */
/** 让下一次表情查询一直等待，放行后再从测试 D1 回答。 */
function holdNextLookup(): { release(): void } {
  const gate = deferred();
  lookups.mockImplementationOnce(async (...args) => {
    await gate.promise;
    return realStickerRefs.findStickerRef(...args);
  });
  return { release: () => gate.resolve() };
}

/** Every message frame a socket received, in order. */
/** 某个连接收到的全部 message 帧，按顺序排列。 */
function received(ws: FakeSocket): ChatMessage[] {
  return ws.frames().flatMap((f) => (f.type === 'message' ? [f.message] : []));
}

describe.skipIf(!sqlite)('ChatRoom', () => {
  let h: Harness;
  beforeEach(async () => {
    lookups.mockClear();
    pushes.mockClear();
    h = await createRoom();
  });
  afterEach(async () => {
    await h.settle();
    vi.useRealTimers();
    h.storage.close();
    h.d1.close();
  });

  describe('image thumbnails', () => {
    it('stores the thumbnail beside the image and sends it live and in history', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(ann, imageFrame('c1'));
      const live = bob.last('message').message;
      expect(live).toMatchObject({ imageKey: IMAGE, thumbKey: THUMB, imageWidth: 2048, imageHeight: 1536 });
      expect(h.storage.raw.prepare('SELECT image_key, thumb_key FROM messages').all()).toEqual([{ image_key: IMAGE, thumb_key: THUMB }]);

      await h.send(bob, { type: 'history', requestId: 'r1' });
      expect(bob.last('history_result').messages.map((m: ChatMessage) => m.thumbKey)).toEqual([THUMB]);
    });

    it('sends null for an image without a thumbnail and for text', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('c1', { thumbKey: undefined }));
      await h.send(ann, { type: 'send', clientId: 'c2', text: 'hello' });
      await h.send(ann, { type: 'history', requestId: 'r1' });
      expect(ann.last('history_result').messages.map((m: ChatMessage) => [m.imageKey, m.thumbKey])).toEqual([
        [IMAGE, null],
        [null, null],
      ]);
    });

    it('refuses a thumbnail from another room', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('c1', { thumbKey: 'chat/channel/ch_other/img_x.jpg' }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '图片无效', clientId: 'c1' });
      await h.send(ann, imageFrame('c2', { thumbKey: 'chat/channel/ch_all/../ch_other/img_x.jpg' }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', clientId: 'c2' });
      expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM messages').all()[0]?.n).toBe(0);
    });

    it('refuses a thumbnail without an image', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, { type: 'send', clientId: 'c1', text: 'hi', thumbKey: THUMB });
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', clientId: 'c1' });
    });

    it('drops a thumbnail that names the image itself', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('c1', { thumbKey: IMAGE }));
      expect(ann.last('message').message.thumbKey).toBeNull();
    });

    it('a recall clears both keys and deletes both objects in one call', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(ann, imageFrame('c1'));
      const id = ann.last('message').message.id;
      await h.send(ann, { type: 'recall', messageId: id });
      await h.settle();
      expect(bob.last('recalled')).toMatchObject({ messageId: id });
      expect(h.deleted).toEqual([[IMAGE, THUMB]]);
      expect(h.storage.raw.prepare('SELECT image_key, thumb_key FROM messages').all()).toEqual([{ image_key: null, thumb_key: null }]);
      await h.send(bob, { type: 'history', requestId: 'r1' });
      expect(bob.last('history_result').messages[0]).toMatchObject({ recalled: true, imageKey: null, thumbKey: null });
    });

    it('a delete clears both keys and deletes both objects', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('c1'));
      const id = ann.last('message').message.id;
      await h.send(ann, { type: 'delete', messageId: id });
      await h.settle();
      expect(ann.last('deleted')).toMatchObject({ messageId: id, by: 'author' });
      expect(h.deleted).toEqual([[IMAGE, THUMB]]);
      expect(h.storage.raw.prepare('SELECT thumb_key FROM messages').all()).toEqual([{ thumb_key: null }]);
    });

    it('a duplicate send is answered from the stored row, thumbnail included', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('c1'));
      await h.send(ann, imageFrame('c1'));
      const echoes = ann.frames().filter((f) => f.type === 'message');
      expect(echoes).toHaveLength(2);
      expect(echoes.map((f) => (f.type === 'message' ? f.message.thumbKey : null))).toEqual([THUMB, THUMB]);
      expect(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM messages').all()[0]?.n).toBe(1);
    });

    it("refuses a key another message already names, so nobody can delete or replace someone else's photo", async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(bob, imageFrame('b1'));
      const own = { imageKey: ANN_IMAGE, thumbKey: ANN_THUMB };
      for (const [clientId, keys] of [
        ['a1', { ...own, thumbKey: IMAGE }],
        ['a2', { ...own, thumbKey: THUMB }],
        ['a3', { ...own, imageKey: THUMB }],
        // Bob's image with Ann's picture as its thumbnail would show her picture in his row.
        // 用 Bob 的图片配上 Ann 的图片作缩略图，会让他的消息行显示她的图片。
        ['a4', { ...own, imageKey: IMAGE }],
        ['a5', { imageKey: IMAGE, thumbKey: undefined }],
      ] as const) {
        await h.send(ann, imageFrame(clientId, keys));
        expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '图片无效', clientId });
      }
      expect(h.storage.raw.prepare('SELECT author_id FROM messages').all()).toEqual([{ author_id: 'mem_bob' }]);

      // Her own fresh upload goes through, and deleting it removes only her objects.
      // 她自己新上传的图片可以发送，删除时只删除她自己的对象。
      await h.send(ann, imageFrame('a6', own));
      const id = ann.last('message').message.id;
      await h.send(ann, { type: 'delete', messageId: id });
      await h.settle();
      expect(h.deleted).toEqual([[ANN_IMAGE, ANN_THUMB]]);
    });

    it("never lets a borrower's withdrawal delete the uploader's photo, in rows from before the check", async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(bob, imageFrame('b1'));
      const bobId = bob.last('message').message.id;
      await h.send(ann, imageFrame('a1', { imageKey: ANN_IMAGE, thumbKey: ANN_THUMB }));
      const annId = ann.last('message').message.id;
      h.storage.raw.prepare('UPDATE messages SET thumb_key = ? WHERE id = ?').run(IMAGE, annId);

      await h.send(ann, { type: 'delete', messageId: annId });
      await h.settle();
      expect(h.deleted).toEqual([[ANN_IMAGE]]);
      // Once no other row names them, Bob's recall deletes his objects.
      // 没有其他行再使用它们之后，Bob 撤回时会删除他的对象。
      await h.send(bob, { type: 'recall', messageId: bobId });
      await h.settle();
      expect(h.deleted).toEqual([[ANN_IMAGE], [IMAGE, THUMB]]);
    });

    it("still deletes the uploader's photo when they withdraw it first, though a borrower's older row names it", async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(bob, imageFrame('b1'));
      const bobId = bob.last('message').message.id;
      await h.send(ann, imageFrame('a1', { imageKey: ANN_IMAGE, thumbKey: ANN_THUMB }));
      const annId = ann.last('message').message.id;
      h.storage.raw.prepare('UPDATE messages SET image_key = ? WHERE id = ?').run(IMAGE, annId);

      await h.send(bob, { type: 'recall', messageId: bobId });
      await h.settle();
      expect(h.deleted).toEqual([[IMAGE, THUMB]]);
      await h.send(ann, { type: 'delete', messageId: annId });
      await h.settle();
      expect(h.deleted).toEqual([
        [IMAGE, THUMB],
        [IMAGE, ANN_THUMB],
      ]);
    });

    it("keeps a photo while the same author's other row still shows it", async () => {
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(bob, imageFrame('b1'));
      const firstId = bob.last('message').message.id;
      await h.send(bob, imageFrame('b2', { imageKey: ANN_IMAGE, thumbKey: ANN_THUMB }));
      const secondId = bob.last('message').message.id;
      h.storage.raw.prepare('UPDATE messages SET image_key = ?, thumb_key = ? WHERE id = ?').run(IMAGE, THUMB, secondId);

      await h.send(bob, { type: 'recall', messageId: firstId });
      await h.settle();
      expect(h.deleted).toEqual([]);
      await h.send(bob, { type: 'delete', messageId: secondId });
      await h.settle();
      expect(h.deleted).toEqual([[IMAGE, THUMB]]);
    });
  });

  describe('author cache', () => {
    async function seedMessages(): Promise<{ ann: FakeSocket; bob: FakeSocket }> {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(ann, { type: 'send', clientId: 'a1', text: 'one' });
      await h.send(bob, { type: 'send', clientId: 'b1', text: 'two' });
      return { ann, bob };
    }

    it('reads D1 for the first history page and not for the next ones', async () => {
      const { ann, bob } = await seedMessages();
      await h.send(ann, { type: 'history', requestId: 'r1' });
      expect(h.authorQueries()).toBe(1);
      await h.send(bob, { type: 'history', requestId: 'r2' });
      await h.send(ann, { type: 'history', requestId: 'r3' });
      expect(h.authorQueries()).toBe(1);
      expect(bob.last('history_result').messages.map((m: ChatMessage) => m.author.displayName)).toEqual(['Ann', 'Bob']);
    });

    it('shows the current name from D1 rather than the one stored with the row', async () => {
      const { ann } = await seedMessages();
      h.d1.rows("UPDATE members SET display_name = 'Annabel' WHERE id = 'mem_ann'");
      await h.send(ann, { type: 'history', requestId: 'r1' });
      expect(ann.last('history_result').messages.map((m: ChatMessage) => m.author.displayName)).toEqual(['Annabel', 'Bob']);
    });

    it('takes a refreshed name at once, without reading D1', async () => {
      const { ann } = await seedMessages();
      await h.send(ann, { type: 'history', requestId: 'r1' });
      await h.room.refreshAuthor({ id: 'mem_bob', displayName: 'Robert', avatarKey: 'avatar/mem_bob/new.jpg' });
      await h.send(ann, { type: 'history', requestId: 'r2' });
      expect(h.authorQueries()).toBe(1);
      const bobRow = ann.last('history_result').messages.find((m: ChatMessage) => m.author.id === 'mem_bob');
      expect(bobRow?.author).toEqual({ id: 'mem_bob', displayName: 'Robert', avatarKey: 'avatar/mem_bob/new.jpg' });
    });

    it('reads D1 again after five minutes', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
      const { ann } = await seedMessages();
      await h.send(ann, { type: 'history', requestId: 'r1' });
      vi.setSystemTime(new Date('2026-10-24T12:04:59.000Z'));
      await h.send(ann, { type: 'history', requestId: 'r2' });
      expect(h.authorQueries()).toBe(1);
      vi.setSystemTime(new Date('2026-10-24T12:05:01.000Z'));
      await h.send(ann, { type: 'history', requestId: 'r3' });
      expect(h.authorQueries()).toBe(2);
    });

    it('falls back to the stored names when D1 fails on the first page', async () => {
      const { ann } = await seedMessages();
      await h.settle();
      h.d1.rows("UPDATE members SET display_name = 'Annabel' WHERE id = 'mem_ann'");
      h.d1.raw.exec('ALTER TABLE members RENAME TO members_gone');
      await h.send(ann, { type: 'history', requestId: 'r1' });
      expect(ann.last('history_result').messages.map((m: ChatMessage) => m.author.displayName)).toEqual(['Ann', 'Bob']);
    });
  });

  describe('stickers', () => {
    beforeEach(() => {
      seedSticker(h.d1, STICKER);
      seedSticker(h.d1, OTHER, { type: 'png', animated: 0 });
    });

    const storedRows = () => h.storage.raw.prepare('SELECT id, text, image_key, thumb_key, image_w, image_h, sticker_json FROM messages ORDER BY id').all();
    const rowCount = () => Number(h.storage.raw.prepare('SELECT COUNT(*) AS n FROM messages').all()[0]?.n ?? 0);

    it('says in the ready frame that the room takes stickers', async () => {
      const ann = await h.open('mem_ann', 'Ann');
      expect(ann.last('ready')).toMatchObject({ type: 'ready', roomId: ROOM, memberId: 'mem_ann', visibility: true, stickers: true });
    });

    it('stores the description from D1 with the sender’s still, and sends old clients the alias as a photo', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      // Fields a client might add are ignored: the room describes the sticker from D1 only.
      // 客户端可能附加的字段一律忽略：房间只按 D1 描述表情。
      await h.send(ann, stickerFrame('s1', { width: 1, height: 1, bytes: 1, animated: false, stickerType: 'png' }));
      const live = bob.last('message').message;
      expect(live).toMatchObject({ kind: 'user', text: '', imageKey: ALIAS, imageWidth: 240, imageHeight: 180, thumbKey: null, clientId: null });
      expect(live.sticker).toEqual(STICKER_REF);
      expect(ann.last('message')).toMatchObject({ clientId: 's1', message: { clientId: 's1', sticker: STICKER_REF } });

      expect(storedRows()).toEqual([
        { id: live.id, text: '[表情]', image_key: null, thumb_key: null, image_w: null, image_h: null, sticker_json: JSON.stringify(STICKER_REF) },
      ]);
      expect(h.d1.rows<{ sent_at: string | null }>('SELECT sent_at FROM sticker_objects WHERE id = ?', STICKER)[0]?.sent_at).toEqual(expect.any(String));

      await h.send(bob, { type: 'history', requestId: 'r1' });
      const [stored] = bob.last('history_result').messages;
      expect(stored).toMatchObject({ text: '', imageKey: ALIAS, imageWidth: 240, imageHeight: 180, thumbKey: null, sticker: STICKER_REF });
    });

    it('sends without a still, and sends the same sticker again from the cache', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1', { stickerThumb: undefined }));
      expect(ann.last('message').message.sticker).toEqual({ ...STICKER_REF, thumb: null });
      await h.send(ann, stickerFrame('s2'));
      expect(ann.last('message').message.sticker).toEqual(STICKER_REF);
      expect(rowCount()).toBe(2);
      expect(lookups).toHaveBeenCalledTimes(1);
    });

    it('sends a sticker as a reply, and quotes a sticker as [表情] with hasSticker until it is recalled', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(bob, textFrame('b1', 'hello'));
      const helloId = bob.last('message').message.id;
      await h.send(ann, stickerFrame('s1', { replyToId: helloId }));
      const reply = bob.last('message').message;
      expect(reply.sticker).toEqual(STICKER_REF);
      expect(reply.replyTo).toMatchObject({ id: helloId, excerpt: 'hello', state: 'ok' });

      await h.send(bob, textFrame('b2', 'nice', { replyToId: reply.id }));
      expect(ann.last('message').message.replyTo).toEqual({
        id: reply.id,
        authorId: 'mem_ann',
        authorName: 'Ann',
        excerpt: '[表情]',
        hasImage: false,
        hasSticker: true,
        state: 'ok',
      });

      await h.send(ann, { type: 'recall', messageId: reply.id });
      await h.send(ann, { type: 'history', requestId: 'r1' });
      const quote = ann.last('history_result').messages.at(-1)?.replyTo;
      expect(quote).toMatchObject({ id: reply.id, state: 'recalled', excerpt: '', hasImage: false });
      expect(quote?.hasSticker ?? false).toBe(false);
    });

    it('refuses unknown, pending, deleting and blocked ids with the clientId, and asks D1 again each time', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const ids = { pending: 'stk_pendingpendingpending0', deleting: 'stk_deletingdeletingdelet0', blocked: 'stk_blockedblockedblocked0', unknown: 'stk_unknownunknownunknown0' };
      seedSticker(h.d1, ids.pending, { state: 'pending' });
      seedSticker(h.d1, ids.deleting, { state: 'deleting' });
      seedSticker(h.d1, ids.blocked, { blockedAt: new Date().toISOString() });
      for (const [name, id] of Object.entries(ids)) {
        await h.send(ann, stickerFrame(`x-${name}`, { sticker: id }));
        expect(ann.last('error'), name).toEqual({ type: 'error', code: 'invalid_frame', message: '这个表情已失效', clientId: `x-${name}` });
      }
      await h.send(ann, stickerFrame('again', { sticker: ids.blocked }));
      expect(ann.last('error')).toMatchObject({ message: '这个表情已失效', clientId: 'again' });
      expect(lookups).toHaveBeenCalledTimes(5);
      expect(rowCount()).toBe(0);
    });

    it('answers a D1 failure with 表情暂不可用，请稍后再试 and does not remember it', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      lookups.mockRejectedValueOnce(new Error('D1_ERROR: no such table: sticker_objects'));
      await h.send(ann, stickerFrame('s1'));
      expect(ann.last('error')).toEqual({ type: 'error', code: 'invalid_frame', message: '表情暂不可用，请稍后再试', clientId: 's1' });
      expect(rowCount()).toBe(0);
      await h.send(ann, stickerFrame('s1'));
      expect(ann.last('message').message.sticker).toEqual(STICKER_REF);
    });

    it('answers a sticker frame the protocol refuses with its clientId', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1', { text: 'hi' }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '消息格式错误', clientId: 's1' });
      await h.send(ann, stickerFrame('s2', { sticker: 'stk_short' }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', clientId: 's2' });
      expect(lookups).not.toHaveBeenCalled();
    });

    it('refuses a photo that names a sticker alias as its image or its thumbnail', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, imageFrame('a1', { imageKey: ALIAS, thumbKey: undefined }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '图片无效', clientId: 'a1' });
      await h.send(ann, imageFrame('a2', { thumbKey: `chat/channel/ch_all/${OTHER}.png` }));
      expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '图片无效', clientId: 'a2' });
      expect(rowCount()).toBe(0);
      // A real upload in the same room still goes through.
      // 同一房间里真正的上传仍然可以发送。
      await h.send(ann, imageFrame('a3'));
      expect(ann.last('message').message.imageKey).toBe(IMAGE);
    });

    it('answers a resent clientId from the stored row, sticker included', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      await h.send(ann, stickerFrame('s1'));
      const echoes = ann.frames().filter((f) => f.type === 'message');
      expect(echoes).toHaveLength(2);
      for (const echo of echoes) expect(echo).toMatchObject({ clientId: 's1', message: { sticker: STICKER_REF, imageKey: ALIAS } });
      expect(rowCount()).toBe(1);
    });

    it('recall and delete clear sticker_json, broadcast as usual and never delete a file', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(ann, stickerFrame('s1'));
      const recalledId = ann.last('message').message.id;
      await h.send(ann, stickerFrame('s2', { sticker: OTHER }));
      const deletedId = ann.last('message').message.id;

      await h.send(ann, { type: 'recall', messageId: recalledId });
      expect(bob.last('recalled')).toMatchObject({ messageId: recalledId });
      await h.send(ann, { type: 'delete', messageId: deletedId });
      expect(bob.last('deleted')).toMatchObject({ messageId: deletedId, by: 'author' });
      await h.settle();
      expect(h.deleted).toEqual([]);
      expect(storedRows().map((r) => [r.text, r.sticker_json])).toEqual([
        ['', null],
        ['', null],
      ]);

      await h.send(bob, { type: 'history', requestId: 'r1' });
      for (const message of bob.last('history_result').messages) {
        expect(message).toMatchObject({ text: '', imageKey: null, imageWidth: null, imageHeight: null, thumbKey: null });
        expect(message.sticker ?? null).toBeNull();
      }
    });

    it('a moderator removal of a sticker never deletes a file either', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      const id = ann.last('message').message.id;
      const mod = h.connect('mem_bob', 'Bob');
      mod.serializeAttachment({ ...(mod.deserializeAttachment() as SocketIdentity), role: 'president' });
      await h.send(mod, { type: 'delete', messageId: id });
      await h.settle();
      expect(ann.last('deleted')).toMatchObject({ messageId: id, by: 'moderator' });
      expect(h.deleted).toEqual([]);
    });

    it('reads rows a version 7 Worker withdrew, which kept their sticker_json, as withdrawn in history and in quotes', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      const bob = h.connect('mem_bob', 'Bob');
      await h.send(ann, stickerFrame('s1'));
      const recalledId = ann.last('message').message.id;
      await h.send(ann, stickerFrame('s2'));
      const deletedId = ann.last('message').message.id;
      await h.send(bob, textFrame('b1', 'nice', { replyToId: recalledId }));
      // The recall and delete statements of version 7, which do not know sticker_json.
      // 版本 7 的撤回和删除语句，它们不知道 sticker_json。
      h.storage.raw
        .prepare("UPDATE messages SET recalled = 1, text = '', image_key = NULL, thumb_key = NULL, image_w = NULL, image_h = NULL, rev = rev + 10 WHERE id = ?")
        .run(recalledId);
      h.storage.raw
        .prepare("UPDATE messages SET deleted = 1, deleted_by = 'author', text = '', image_key = NULL, thumb_key = NULL, image_w = NULL, image_h = NULL, rev = rev + 10 WHERE id = ?")
        .run(deletedId);
      expect(storedRows().filter((r) => r.sticker_json !== null)).toHaveLength(2);

      await h.send(bob, { type: 'history', requestId: 'r1' });
      const [recalled, deleted, reply] = bob.last('history_result').messages;
      expect(recalled).toMatchObject({ id: recalledId, recalled: true, text: '', imageKey: null, imageWidth: null, imageHeight: null, thumbKey: null });
      expect(deleted).toMatchObject({ id: deletedId, deleted: true, text: '', imageKey: null, thumbKey: null });
      for (const message of [recalled, deleted]) expect(message?.sticker ?? null).toBeNull();
      expect(reply?.replyTo).toMatchObject({ id: recalledId, state: 'recalled', excerpt: '', hasImage: false });
      expect(reply?.replyTo?.hasSticker ?? false).toBe(false);

      // Withdrawing it again does nothing new, and still deletes no file.
      // 再次撤回或删除不会有新的变化，也仍然不删除任何文件。
      await h.send(ann, { type: 'delete', messageId: recalledId });
      await h.settle();
      expect(h.deleted).toEqual([]);
    });

    it('shows a live row with a broken sticker_json as its stored text', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      h.storage.raw.prepare("UPDATE messages SET sticker_json = '{' WHERE client_id = 's1'").run();
      await h.send(ann, { type: 'history', requestId: 'r1' });
      const [row] = ann.last('history_result').messages;
      expect(row).toMatchObject({ text: '[表情]', imageKey: null, imageWidth: null, imageHeight: null });
      expect(row?.sticker ?? null).toBeNull();
    });

    it('gives the chat list kind sticker with [表情], and pushes [表情] with no text', async () => {
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      const summary = await h.room.summaryFor({ memberId: 'mem_bob', access: { joinedAt: null, floorApplies: false } });
      expect(summary.lastMessage).toMatchObject({ kind: 'sticker', text: '[表情]', authorId: 'mem_ann', authorName: 'Ann' });
      expect(summary.unreadCount).toBe(1);
      expect(pushes).toHaveBeenCalledTimes(1);
      expect(pushes.mock.calls[0]?.[1]).toMatchObject({ roomId: ROOM, authorName: 'Ann', text: '', hasImage: false, hasSticker: true, mentions: [] });
    });

    it('writes [表情] as the DM preview and uses the DM’s own alias', async () => {
      h.storage.close();
      h.d1.close();
      h = await createRoom({ roomId: 'direct:dm_1' });
      seedSticker(h.d1, STICKER);
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      expect(ann.last('message').message.imageKey).toBe(`chat/direct/dm_1/${STICKER}.gif`);
      await h.settle();
      expect(h.d1.rows("SELECT last_preview FROM direct_conversations WHERE id = 'dm_1'")).toEqual([{ last_preview: '[表情]' }]);
      expect(pushes.mock.calls.at(-1)?.[1]).toMatchObject({ roomId: 'direct:dm_1', text: '', hasSticker: true });

      await h.send(ann, { type: 'recall', messageId: ann.last('message').message.id });
      await h.settle();
      expect(h.d1.rows("SELECT last_preview FROM direct_conversations WHERE id = 'dm_1'")).toEqual([{ last_preview: '撤回了一条消息' }]);
    });

    it('upgrades a version 7 room to version 8, keeping its rows, and sends stickers in it', async () => {
      h.storage.close();
      h.d1.close();
      h = await createRoom({
        seed: (storage) => {
          ensureRoomSchema(storage.sql);
          storage.raw.exec(`
            ALTER TABLE messages DROP COLUMN sticker_json;
            UPDATE meta SET value = '7' WHERE key = 'schema_version';
            INSERT INTO messages (author_id, author_name, text, created_at, rev) VALUES ('mem_bob', 'Bob', 'from before', '2026-10-01T00:00:00.000Z', 1);
          `);
        },
      });
      seedSticker(h.d1, STICKER);
      expect(h.storage.raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").all()).toEqual([{ value: '8' }]);
      const ann = h.connect('mem_ann', 'Ann');
      await h.send(ann, stickerFrame('s1'));
      await h.send(ann, { type: 'history', requestId: 'r1' });
      const [old, sent] = ann.last('history_result').messages;
      expect(old).toMatchObject({ text: 'from before', imageKey: null });
      expect(old?.sticker ?? null).toBeNull();
      expect(sent?.sticker).toEqual(STICKER_REF);
    });

    describe('send order', () => {
      it('stores a sticker whose lookup waits on D1 before the text sent right behind it', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        const held = holdNextLookup();
        const sticker = h.send(ann, stickerFrame('s1'));
        const text = h.send(ann, textFrame('t1', 'right after'));
        await Promise.resolve();
        expect(received(bob)).toEqual([]);
        held.release();
        await Promise.all([sticker, text]);
        const [first, second] = received(bob);
        expect(first?.sticker).toEqual(STICKER_REF);
        expect(second?.text).toBe('right after');
        expect((first?.id ?? 0) < (second?.id ?? 0)).toBe(true);
      });

      it('keeps two stickers in order when the first misses the cache and the second hits it', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        await h.send(ann, stickerFrame('o0', { sticker: OTHER }));
        const held = holdNextLookup();
        const miss = h.send(ann, stickerFrame('s1'));
        const hit = h.send(ann, stickerFrame('o1', { sticker: OTHER }));
        await Promise.resolve();
        expect(received(bob).map((m) => m.sticker?.id)).toEqual([OTHER]);
        held.release();
        await Promise.all([miss, hit]);
        expect(received(bob).map((m) => m.sticker?.id)).toEqual([OTHER, STICKER, OTHER]);
        expect(lookups).toHaveBeenCalledTimes(2);
      });

      it('never delays another member’s send', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        const held = holdNextLookup();
        const sticker = h.send(ann, stickerFrame('s1'));
        await h.send(bob, textFrame('b1', 'meanwhile'));
        expect(received(ann).map((m) => m.text)).toEqual(['meanwhile']);
        held.release();
        await sticker;
        const [text, sent] = received(bob);
        expect(text?.text).toBe('meanwhile');
        expect(sent?.sticker).toEqual(STICKER_REF);
        expect((text?.id ?? 0) < (sent?.id ?? 0)).toBe(true);
      });

      it('gives up on a lookup that never answers after five seconds, and the queue moves on', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        lookups.mockImplementationOnce(() => new Promise(() => undefined));
        const sticker = h.send(ann, stickerFrame('s1'));
        const text = h.send(ann, textFrame('t1', 'waiting'));
        await vi.advanceTimersByTimeAsync(STICKER_LOOKUP_TIMEOUT_MS - 1);
        expect(received(bob)).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.all([sticker, text]);
        expect(ann.last('error')).toEqual({ type: 'error', code: 'invalid_frame', message: '表情暂不可用，请稍后再试', clientId: 's1' });
        expect(received(bob).map((m) => m.text)).toEqual(['waiting']);
        await h.send(ann, textFrame('t2', 'and on'));
        expect(received(bob).map((m) => m.text)).toEqual(['waiting', 'and on']);
      });

      it('refuses a sticker when the member was muted during its lookup', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const held = holdNextLookup();
        const sticker = h.send(ann, stickerFrame('s1'));
        const until = new Date(Date.now() + 10 * 60_000).toISOString();
        h.storage.raw.prepare('INSERT INTO mutes (member_id, until) VALUES (?, ?)').run('mem_ann', until);
        held.release();
        await sticker;
        expect(ann.last('error')).toEqual({ type: 'error', code: 'muted', message: '你已被禁言', clientId: 's1', mutedUntil: until });
        expect(rowCount()).toBe(0);
      });

      it('checks the quoted message after the lookup, so one recalled meanwhile is refused', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        await h.send(bob, textFrame('b1', 'soon gone'));
        const targetId = bob.last('message').message.id;
        const held = holdNextLookup();
        const sticker = h.send(ann, stickerFrame('s1', { replyToId: targetId }));
        await h.send(bob, { type: 'recall', messageId: targetId });
        held.release();
        await sticker;
        expect(ann.last('error')).toMatchObject({ code: 'invalid_frame', message: '引用的消息不存在', clientId: 's1' });
        expect(rowCount()).toBe(1);
      });

      /** Every clientId starting with `prefix` that a socket got an answer for, a message or an error, in order. */
      /** 某个连接收到回复（消息或错误）的、以 `prefix` 开头的全部 clientId，按顺序排列。 */
      const answered = (ws: FakeSocket, prefix: string) =>
        ws.frames().flatMap((f) => ((f.type === 'message' || f.type === 'error') && f.clientId?.startsWith(prefix) ? [f.clientId] : []));
      const queueIds = (prefix: string) => Array.from({ length: SEND_QUEUE_MAX }, (_, i) => `${prefix}${i}`);

      /**
       * Fills a member's queue behind a held lookup of `sticker`: SEND_QUEUE_MAX sends in all, every one taken and
       * none answered while the lookup waits.
       * 在被挡住的 `sticker` 查询之后填满成员的队列：共 SEND_QUEUE_MAX 次发送，每一次都被接收，查询等待期间都没有得到回复。
       */
      function fillQueue(ws: FakeSocket, sticker: string, prefix: string): { release(): void; sends: Promise<void>[] } {
        const held = holdNextLookup();
        const sends = queueIds(prefix).map((id, i) => h.send(ws, i === 0 ? stickerFrame(id, { sticker }) : textFrame(id, `queued ${id}`)));
        expect(answered(ws, prefix)).toEqual([]);
        return { release: held.release, sends };
      }

      it('refuses a send at once while SEND_QUEUE_MAX of the member’s sends wait, and takes sends again once the queue drains', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
        const ann = h.connect('mem_ann', 'Ann');
        const bob = h.connect('mem_bob', 'Bob');
        const first = fillQueue(ann, STICKER, 'first-');
        // One more is answered at once, before the lookup ends, with its clientId so the client fails only that item.
        // 再多一次会在查询结束之前立即得到回复，并带上 clientId，客户端只让这一项失败。
        const over = h.send(ann, textFrame('over', 'one too many'));
        expect(ann.last('error')).toEqual({ type: 'error', code: 'rate_limited', message: '发送太快，请稍候', clientId: 'over' });
        await over;
        expect(received(bob)).toEqual([]);

        first.release();
        await Promise.all(first.sends);
        // Every send taken was answered once and in order, with the usual checks: the leading ones were stored and the
        // rest were refused by the rate limit when their turn came.
        // 每次被接收的发送都按顺序得到一次回复，并照常检查：前面的被保存，其余的轮到时被限流拒绝。
        const ids = queueIds('first-');
        expect(answered(ann, 'first-')).toEqual(ids);
        const stored = h.storage.raw
          .prepare('SELECT client_id FROM messages ORDER BY id')
          .all()
          .map((r) => r.client_id);
        expect(stored.length).toBeGreaterThan(0);
        expect(stored).toEqual(ids.slice(0, stored.length));
        const refused = ann.frames().flatMap((f) => (f.type === 'error' && f.clientId?.startsWith('first-') ? [f] : []));
        expect(refused.map((f) => f.clientId)).toEqual(ids.slice(stored.length));
        for (const f of refused) expect(f.code).toBe('rate_limited');
        expect(stored).not.toContain('over');

        // Once the queue has drained and the rate window has passed, sends go through again, and a second flood is cut
        // at exactly SEND_QUEUE_MAX, so nothing of the first one is still counted.
        // 队列清空、限流窗口过去之后，发送重新可以通过；第二次大量发送同样恰好在 SEND_QUEUE_MAX 处被截断，说明第一次的计数已全部归还。
        vi.setSystemTime(new Date('2026-10-24T12:00:11.000Z'));
        await h.send(ann, textFrame('after', 'back to normal'));
        expect(ann.last('message')).toMatchObject({ clientId: 'after', message: { text: 'back to normal' } });
        const second = fillQueue(ann, OTHER, 'second-');
        const overAgain = h.send(ann, textFrame('over-again', 'one too many'));
        expect(ann.last('error')).toEqual({ type: 'error', code: 'rate_limited', message: '发送太快，请稍候', clientId: 'over-again' });
        second.release();
        await Promise.all([...second.sends, overAgain]);
        expect(answered(ann, 'second-')).toEqual(queueIds('second-'));
      });

      it('gives back the places of queued sends that throw, so the member is never left refused', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const first = fillQueue(ann, STICKER, 'first-');
        // From here every send throws at the mute check, the held one included.
        // 从这里开始，每次发送都会在禁言检查处抛出异常，被挡住的那次也一样。
        h.storage.raw.exec('ALTER TABLE mutes RENAME TO mutes_gone');
        first.release();
        await Promise.all(first.sends);
        const failures = errors.mock.calls.filter(([message]) => message === 'chat: a queued send failed');
        errors.mockRestore();
        h.storage.raw.exec('ALTER TABLE mutes_gone RENAME TO mutes');
        expect(failures).toHaveLength(SEND_QUEUE_MAX);
        expect(answered(ann, 'first-')).toEqual([]);

        const second = fillQueue(ann, OTHER, 'second-');
        const over = h.send(ann, textFrame('over', 'one too many'));
        expect(ann.last('error')).toMatchObject({ code: 'rate_limited', clientId: 'over' });
        second.release();
        await Promise.all([...second.sends, over]);
        expect(answered(ann, 'second-')).toEqual(queueIds('second-'));
      });

      it('answers a resend of a stored message from its row while the queue is full, never with a refusal', async () => {
        const ann = h.connect('mem_ann', 'Ann');
        await h.send(ann, textFrame('kept', 'stored before'));
        const first = fillQueue(ann, STICKER, 'first-');
        // The ack of 'kept' was lost, so the client sends it again while the queue is full.
        // 'kept' 的确认丢失了，客户端在队列已满时再次发送它。
        await h.send(ann, textFrame('kept', 'stored before'));
        const kept = ann.frames().flatMap((f) => ((f.type === 'message' || f.type === 'error') && f.clientId === 'kept' ? [f] : []));
        expect(kept.map((f) => f.type)).toEqual(['message', 'message']);
        expect(kept[1]).toMatchObject({ clientId: 'kept', message: { text: 'stored before' } });
        expect(h.storage.raw.prepare("SELECT id FROM messages WHERE client_id = 'kept'").all()).toHaveLength(1);
        first.release();
        await Promise.all(first.sends);
        expect(answered(ann, 'first-')).toEqual(queueIds('first-'));
      });
    });
  });
});
