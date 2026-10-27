import { afterEach, describe, expect, it } from 'vitest';
import { sqlite } from '../../infrastructure/d1/testing/sqlite-d1';
import { SCHEMA_VERSION, currentRev, ensureRoomSchema, nextRev } from './room-schema';
import { createTestSqlStorage, type TestSqlStorage } from './testing/sql-storage';

function columns(storage: TestSqlStorage, table: string): string[] {
  return storage.raw
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String(row.name));
}

function indexes(storage: TestSqlStorage, table: string): string[] {
  return storage.raw
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .map((row) => String(row.name));
}

function version(storage: TestSqlStorage): number {
  return Number(storage.raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").all()[0]?.value ?? 0);
}

/** The messages table and meta row of a room last opened by the version 5 code, before thumbnails existed. */
/** 由版本 5 的代码最后打开过的房间（缩略图出现之前）所具有的 messages 表和 meta 行。 */
function version5Room(storage: TestSqlStorage): void {
  storage.raw.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, author_id TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL,
      image_key TEXT, created_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, recalled INTEGER NOT NULL DEFAULT 0,
      avatar_key TEXT, kind TEXT NOT NULL DEFAULT 'user', system_json TEXT, reply_to_id INTEGER,
      mention_all INTEGER NOT NULL DEFAULT 0, client_id TEXT, image_w INTEGER, image_h INTEGER, deleted_by TEXT,
      rev INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO meta (key, value) VALUES ('schema_version', '5'), ('rev', '7');
    INSERT INTO messages (author_id, author_name, text, image_key, created_at) VALUES ('mem_a', 'A', '', 'chat/channel/ch_all/img_old.jpg', '2026-10-01T00:00:00.000Z');
  `);
}

/** A room last opened by the version 7 code, before stickers: thumb_key and the image key indexes, no sticker_json. */
/** 由版本 7 的代码最后打开过的房间（表情出现之前）：有 thumb_key 和图片键索引，没有 sticker_json。 */
function version7Room(storage: TestSqlStorage): void {
  ensureRoomSchema(storage.sql);
  storage.raw.exec(`
    ALTER TABLE messages DROP COLUMN sticker_json;
    UPDATE meta SET value = '7' WHERE key = 'schema_version';
    UPDATE meta SET value = '12' WHERE key = 'rev';
    INSERT INTO messages (author_id, author_name, text, image_key, thumb_key, created_at, rev)
    VALUES ('mem_a', 'A', '', 'chat/channel/ch_all/img_old.jpg', 'chat/channel/ch_all/img_oldthumb.jpg', '2026-10-01T00:00:00.000Z', 12);
  `);
}

describe.skipIf(!sqlite)('room schema', () => {
  let storage: TestSqlStorage;
  afterEach(() => storage.close());

  it('creates a new room at the current version, with thumb_key, sticker_json and the image key indexes', () => {
    storage = createTestSqlStorage();
    ensureRoomSchema(storage.sql);
    expect(SCHEMA_VERSION).toBe(8);
    expect(version(storage)).toBe(8);
    expect(columns(storage, 'messages')).toEqual(expect.arrayContaining(['thumb_key', 'sticker_json']));
    expect(indexes(storage, 'messages')).toEqual(expect.arrayContaining(['messages_image_key', 'messages_thumb_key']));
    expect(currentRev(storage.sql)).toBe(0);
  });

  it('adds thumb_key to a version 5 room and keeps its rows and revision', () => {
    storage = createTestSqlStorage();
    version5Room(storage);
    ensureRoomSchema(storage.sql);
    expect(version(storage)).toBe(SCHEMA_VERSION);
    expect(columns(storage, 'messages')).toEqual(expect.arrayContaining(['thumb_key', 'sticker_json']));
    const rows = storage.raw.prepare('SELECT image_key, thumb_key, sticker_json FROM messages').all();
    expect(rows).toEqual([{ image_key: 'chat/channel/ch_all/img_old.jpg', thumb_key: null, sticker_json: null }]);
    expect(currentRev(storage.sql)).toBe(7);
    expect(nextRev(storage.sql)).toBe(8);
  });

  it('adds sticker_json to a version 7 room and keeps its rows, keys and revision', () => {
    storage = createTestSqlStorage();
    version7Room(storage);
    expect(columns(storage, 'messages')).not.toContain('sticker_json');
    ensureRoomSchema(storage.sql);
    expect(version(storage)).toBe(8);
    expect(columns(storage, 'messages')).toContain('sticker_json');
    expect(storage.raw.prepare('SELECT image_key, thumb_key, sticker_json, rev FROM messages').all()).toEqual([
      { image_key: 'chat/channel/ch_all/img_old.jpg', thumb_key: 'chat/channel/ch_all/img_oldthumb.jpg', sticker_json: null, rev: 12 },
    ]);
    expect(indexes(storage, 'messages')).toEqual(expect.arrayContaining(['messages_image_key', 'messages_thumb_key']));
    expect(currentRev(storage.sql)).toBe(12);
  });

  it('reads one row and does nothing else once a room is current', () => {
    storage = createTestSqlStorage();
    ensureRoomSchema(storage.sql);
    storage.statements.length = 0;
    ensureRoomSchema(storage.sql);
    expect(storage.statements).toHaveLength(2);
    expect(storage.statements[1]).toMatch(/^SELECT value FROM meta/);
  });

  it('can run again over a room whose columns were already added', () => {
    storage = createTestSqlStorage();
    ensureRoomSchema(storage.sql);
    storage.raw.exec("UPDATE meta SET value = '5' WHERE key = 'schema_version'");
    expect(() => ensureRoomSchema(storage.sql)).not.toThrow();
    expect(version(storage)).toBe(SCHEMA_VERSION);
  });

  it('indexes image_key and thumb_key in a version 6 room, and the key lookup uses them', () => {
    storage = createTestSqlStorage();
    ensureRoomSchema(storage.sql);
    storage.raw.exec("DROP INDEX messages_image_key; DROP INDEX messages_thumb_key; UPDATE meta SET value = '6' WHERE key = 'schema_version'");
    ensureRoomSchema(storage.sql);
    expect(version(storage)).toBe(SCHEMA_VERSION);
    expect(indexes(storage, 'messages')).toEqual(expect.arrayContaining(['messages_image_key', 'messages_thumb_key']));
    // The statement of ChatRoom.rowsNamingKeys, for two keys.
    // ChatRoom.rowsNamingKeys 的语句，两个键时的形式。
    const plan = storage.raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT image_key AS key, id, author_id FROM messages WHERE image_key IN (?, ?)
         UNION ALL SELECT thumb_key AS key, id, author_id FROM messages WHERE thumb_key IN (?, ?)`,
      )
      .all('a', 'b', 'a', 'b')
      .map((row) => String(row.detail))
      .join('\n');
    expect(plan).toMatch(/SEARCH messages USING INDEX messages_image_key/);
    expect(plan).toMatch(/SEARCH messages USING INDEX messages_thumb_key/);
    expect(plan).not.toMatch(/SCAN messages/);
  });
});
