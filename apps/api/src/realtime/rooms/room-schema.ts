/**
 * Versioned schema for one ChatRoom's SQLite storage. The version lives in a meta table, so a room
 * that wakes from hibernation reads one row instead of replaying every ALTER. Every step is
 * additive and safe to repeat.
 * 单个 ChatRoom 的 SQLite 存储结构，带版本号。版本号存在 meta 表中，房间从休眠中唤醒时只读一行，而不是重放每条 ALTER。每一步都只做增加，重复执行也安全。
 */

const SCHEMA_VERSION = 5;

function readMeta(sql: SqlStorage, key: string): string | null {
  const row = sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
  return row?.value ?? null;
}

/** Rooms created before a column existed get it here. Adding a column twice is expected. */
/** 在某列出现之前创建的房间在这里补上该列。列已存在时再添加是正常情况。 */
function addColumn(sql: SqlStorage, statement: string): void {
  try {
    sql.exec(statement);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate column/i.test(message)) return;
    throw err;
  }
}

export function ensureRoomSchema(sql: SqlStorage): void {
  sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  if (Number(readMeta(sql, 'schema_version') ?? 0) >= SCHEMA_VERSION) return;

  sql.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      text TEXT NOT NULL,
      image_key TEXT,
      created_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      recalled INTEGER NOT NULL DEFAULT 0,
      avatar_key TEXT
    );
    CREATE TABLE IF NOT EXISTS read_cursors (
      member_id TEXT PRIMARY KEY,
      last_read_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mutes (
      member_id TEXT PRIMARY KEY,
      until TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS used_tickets (
      jti TEXT PRIMARY KEY,
      exp INTEGER NOT NULL
    );
  `);
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN recalled INTEGER NOT NULL DEFAULT 0');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN avatar_key TEXT');
  addColumn(sql, "ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'");
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN system_json TEXT');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN reply_to_id INTEGER');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN mention_all INTEGER NOT NULL DEFAULT 0');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN client_id TEXT');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN image_w INTEGER');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN image_h INTEGER');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN deleted_by TEXT');
  addColumn(sql, 'ALTER TABLE messages ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');

  sql.exec(`
    CREATE TABLE IF NOT EXISTS mentions (
      member_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      PRIMARY KEY (member_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS hidden_messages (
      member_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      rev INTEGER NOT NULL,
      PRIMARY KEY (member_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS member_state (
      member_id TEXT PRIMARY KEY,
      clear_id INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS push_throttle (
      member_id TEXT PRIMARY KEY,
      last_push_at INTEGER NOT NULL,
      last_mention_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS push_sent (
      member_id TEXT PRIMARY KEY,
      message_id INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS messages_author_client ON messages (author_id, client_id) WHERE client_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS messages_created ON messages (created_at);
    CREATE INDEX IF NOT EXISTS messages_rev ON messages (rev);
    CREATE INDEX IF NOT EXISTS hidden_messages_rev ON hidden_messages (member_id, rev);
    CREATE INDEX IF NOT EXISTS messages_reply_to ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS push_sent_message ON push_sent (message_id);
  `);
  sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', '0')");
  sql.exec(
    "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    String(SCHEMA_VERSION),
  );
}

/**
 * Room revision. Every change to a stored row (send, recall, delete, rename) and every hide takes the
 * next value, so a reconnecting client can ask for everything that changed after the revision it saw.
 * 房间版本号。每次修改已存行（发送、撤回、删除、改名）以及每次隐藏都会取下一个值，重连的客户端据此请求它看到的版本之后的全部变更。
 */
export function currentRev(sql: SqlStorage): number {
  return Number(readMeta(sql, 'rev') ?? 0);
}

export function nextRev(sql: SqlStorage): number {
  const row = sql
    .exec<{ value: string }>(
      "INSERT INTO meta (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) RETURNING value",
    )
    .one();
  return Number(row.value);
}
