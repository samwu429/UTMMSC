import { sqlite, type SqliteDatabase } from '../../../infrastructure/d1/testing/sqlite-d1';

/**
 * A Durable Object's SqlStorage on real SQLite (node:sqlite), for tests of the room. It covers what the room
 * uses: exec with bindings, several statements in one exec without bindings (as the schema does), and cursors with
 * toArray, one, rowsRead and rowsWritten. On Node without node:sqlite `sqlite` is null and the tests skip.
 * 运行在真实 SQLite（node:sqlite）上的 Durable Object SqlStorage，供房间测试使用。它覆盖房间用到的部分：带绑定参数的 exec、
 * 不带绑定参数时一次执行多条语句（结构初始化就是这样），以及带 toArray、one、rowsRead 和 rowsWritten 的游标。
 * 没有 node:sqlite 的 Node 上 `sqlite` 为 null，测试会跳过。
 */
export interface TestSqlStorage {
  sql: SqlStorage;
  raw: SqliteDatabase;
  /** Every statement run through `sql`, in order. */
  /** 通过 `sql` 执行的每一条语句，按顺序记录。 */
  statements: string[];
  close(): void;
}

type Value = null | number | bigint | string | Uint8Array;

function toValue(value: unknown): Value {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`SqlStorage cannot bind ${typeof value}`);
}

function cursor(rows: Record<string, SqlStorageValue>[], written: number): SqlStorageCursor<Record<string, SqlStorageValue>> {
  let index = 0;
  const result = {
    toArray: () => rows,
    one: () => {
      if (rows.length !== 1) throw new Error(`Expected exactly one result from SQL query, but got ${rows.length}.`);
      return rows[0];
    },
    raw: function* () {
      for (const row of rows) yield Object.values(row);
    },
    next: () => (index < rows.length ? { done: false, value: rows[index++] } : { done: true, value: undefined }),
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    columnNames: rows[0] ? Object.keys(rows[0]) : [],
    rowsRead: rows.length,
    rowsWritten: written,
  };
  return result as unknown as SqlStorageCursor<Record<string, SqlStorageValue>>;
}

const READS = /^\s*(SELECT|WITH|PRAGMA|VALUES)\b|\bRETURNING\b/i;

export function createTestSqlStorage(): TestSqlStorage {
  if (!sqlite) throw new Error('node:sqlite is not available');
  const raw = new sqlite.DatabaseSync(':memory:');
  const statements: string[] = [];
  const totalChanges = () => Number(raw.prepare('SELECT total_changes() AS n').all()[0]?.n ?? 0);

  const exec = (query: string, ...bindings: unknown[]) => {
    statements.push(query);
    if (bindings.length === 0 && query.split(';').filter((part) => part.trim()).length > 1) {
      const before = totalChanges();
      raw.exec(query);
      return cursor([], totalChanges() - before);
    }
    const prepared = raw.prepare(query);
    const params = bindings.map(toValue);
    const reads = typeof prepared.columns === 'function' ? prepared.columns().length > 0 : READS.test(query);
    if (!reads) return cursor([], Number(prepared.run(...params).changes));
    const before = totalChanges();
    const rows = prepared.all(...params).map((row) => ({ ...row }) as Record<string, SqlStorageValue>);
    return cursor(rows, totalChanges() - before);
  };

  return {
    sql: { exec, databaseSize: 0 } as unknown as SqlStorage,
    raw,
    statements,
    close: () => raw.close(),
  };
}
