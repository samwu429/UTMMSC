import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ServerFrame } from '@utmmsc/shared';
import type { Env } from '../../env';
import { createSqliteD1, sqlite, type SqliteD1 } from '../../infrastructure/d1/testing/sqlite-d1';
import { createTestSqlStorage, type TestSqlStorage } from './testing/sql-storage';
import type { SocketIdentity } from './chat-room';

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
  send(ws: FakeSocket, frame: Record<string, unknown>): Promise<void>;
  authorQueries(): number;
  settle(): Promise<void>;
}

async function createRoom(): Promise<Harness> {
  (globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??= class {
    constructor(
      readonly request: string,
      readonly response: string,
    ) {}
  };
  const { ChatRoom } = await import('./chat-room');
  const storage = createTestSqlStorage();
  const d1 = createSqliteD1();
  const sockets: FakeSocket[] = [];
  const waits: Promise<unknown>[] = [];
  const deleted: string[][] = [];
  const kv = new Map<string, unknown>([['roomId', ROOM]]);
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
    acceptWebSocket: (ws: FakeSocket) => sockets.push(ws),
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
  return {
    room,
    storage,
    d1,
    deleted,
    waits,
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

describe.skipIf(!sqlite)('ChatRoom', () => {
  let h: Harness;
  beforeEach(async () => {
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
});
