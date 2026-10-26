/**
 * D1 on real SQLite for tests: prepare, bind, first, all, run, raw, batch and exec over node:sqlite, with the
 * migrations in apps/api/migrations. node:sqlite is loaded through process.getBuiltinModule because Vitest
 * cannot import it, and the API's tsconfig has Workers types only, so the parts used are typed here. On Node
 * before 22.5 `sqlite` is null and the SQL tests skip with describe.skipIf(!sqlite).
 * 测试用的、运行在真实 SQLite 上的 D1：基于 node:sqlite 实现 prepare、bind、first、all、run、raw、batch 和 exec，
 * 并使用 apps/api/migrations 中的迁移。Vitest 无法 import node:sqlite，因此通过 process.getBuiltinModule 加载；
 * 接口的 tsconfig 只有 Workers 类型，所以用到的部分在这里自行声明。Node 22.5 之前 `sqlite` 为 null，SQL 测试用 describe.skipIf(!sqlite) 跳过。
 */

type SqliteValue = null | number | bigint | string | Uint8Array;
type SqliteRow = Record<string, unknown>;

interface SqliteStatement {
  all(...params: SqliteValue[]): SqliteRow[];
  run(...params: SqliteValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  /** Missing before Node 22.16; the adapter then tells reads from writes by the SQL text. */
  /** Node 22.16 之前没有；此时适配器根据 SQL 文本区分读和写。 */
  columns?(): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { enableForeignKeyConstraints?: boolean }) => SqliteDatabase;
}

interface FsModule {
  readdirSync(path: URL): string[];
  readFileSync(path: URL, encoding: 'utf8'): string;
}

function builtin<T>(id: string): T | null {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  try {
    return (proc?.getBuiltinModule?.(id) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/** node:sqlite, or null where this Node has none. */
/** node:sqlite；当前 Node 没有时为 null。 */
export const sqlite: SqliteModule | null = builtin<SqliteModule>('node:sqlite');
const fs: FsModule | null = builtin<FsModule>('node:fs');

const MIGRATIONS = new URL('../../../../migrations/', import.meta.url);

export interface Migration {
  /** The file name, such as 0016_moments.sql. */
  /** 文件名，例如 0016_moments.sql。 */
  name: string;
  /** The leading number, 16 for 0016_moments.sql. */
  /** 开头的编号，0016_moments.sql 为 16。 */
  number: number;
  sql: string;
}

/** Every migration file in order. */
/** 按顺序排列的全部迁移文件。 */
export function migrationFiles(): Migration[] {
  if (!fs) throw new Error('node:fs is not available');
  return fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .map((name) => ({ name, number: Number(name.slice(0, 4)), sql: fs.readFileSync(new URL(name, MIGRATIONS), 'utf8') }));
}

export interface RecordedStatement {
  sql: string;
  params: unknown[];
}

export interface SqliteD1 {
  db: D1Database;
  raw: SqliteDatabase;
  /** Every statement run through `db`, in order, batches included. */
  /** 通过 `db` 执行的每一条语句，按顺序记录，包括批次中的语句。 */
  statements: RecordedStatement[];
  /** Runs SQL directly, for seeding rows. */
  /** 直接执行 SQL，用于写入测试数据。 */
  exec(sql: string): void;
  /** Rows of one statement run directly, as plain objects. */
  /** 直接执行一条语句得到的行，转换为普通对象。 */
  rows<T = SqliteRow>(sql: string, ...params: unknown[]): T[];
  /** Applies the migrations numbered from `from` through `to`. */
  /** 执行编号从 `from` 到 `to` 的迁移。 */
  migrate(options?: { from?: number; to?: number }): void;
  /** The detail lines of EXPLAIN QUERY PLAN for a statement, such as one taken from `statements`. */
  /** 一条语句（例如取自 `statements`）的 EXPLAIN QUERY PLAN 明细行。 */
  explain(statement: RecordedStatement): string[];
  close(): void;
}

/** The value types D1 binds. Booleans become 1 and 0 as D1 stores them; undefined is refused as D1 refuses it. */
/** D1 可以绑定的值类型。布尔值与 D1 一样存为 1 和 0；undefined 与 D1 一样被拒绝。 */
function toSqlite(value: unknown): SqliteValue {
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'bigint') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value '${String(value)}'`);
}

const READS = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)\b|\bRETURNING\b/i;

function d1Error(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`D1_ERROR: ${message}`, { cause: err });
}

function plain(row: SqliteRow): SqliteRow {
  return { ...row };
}

/** D1's own limits, far below SQLite's defaults, so a statement that passes here also runs in production. */
/** D1 自己的上限，远低于 SQLite 的默认值；在这里通过的语句在生产环境也能运行。 */
export const D1_LIMITS = { boundParameters: 100, statementBytes: 100_000, compoundTerms: 5 } as const;

/** The SQL with string literals, quoted names and comments blanked out, so keywords inside them are not counted. */
/** 把字符串字面量、带引号的名称和注释替换为空白后的 SQL，其中的关键字因此不会被计入。 */
function codeOnly(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length));
}

/**
 * The most terms any one compound SELECT in the statement has: UNION, UNION ALL, INTERSECT and EXCEPT are counted
 * per parenthesis level, since a compound inside a subquery is a compound of its own.
 * 语句中任一复合 SELECT 的最多项数：按括号层级统计 UNION、UNION ALL、INTERSECT 和 EXCEPT，因为子查询中的复合查询是独立的一个。
 */
export function compoundTerms(sql: string): number {
  const levels = [0];
  let most = 1;
  for (const match of codeOnly(sql).matchAll(/\(|\)|\b(?:UNION|INTERSECT|EXCEPT)\b/gi)) {
    const token = match[0];
    if (token === '(') levels.push(0);
    else if (token === ')') most = Math.max(most, (levels.pop() ?? 0) + 1);
    else levels[levels.length - 1] = (levels[levels.length - 1] ?? 0) + 1;
  }
  for (const count of levels) most = Math.max(most, count + 1);
  return most;
}

/** Refuses a statement D1 would refuse for its size, its bound values or its compound SELECTs. */
/** 拒绝 D1 会因大小、绑定值数量或复合 SELECT 而拒绝的语句。 */
function checkD1Limits(sql: string, params: readonly SqliteValue[]): void {
  if (new TextEncoder().encode(sql).length > D1_LIMITS.statementBytes) throw new Error('SQL statement too long (D1 allows 100 KB)');
  if (params.length > D1_LIMITS.boundParameters) throw new Error(`too many SQL variables: ${params.length} (D1 allows ${D1_LIMITS.boundParameters})`);
  const terms = compoundTerms(sql);
  if (terms > D1_LIMITS.compoundTerms) throw new Error(`too many terms in compound SELECT: ${terms} (D1 allows ${D1_LIMITS.compoundTerms})`);
}

/**
 * A fresh in-memory database behind a D1Database. Foreign keys are enforced, as D1 always does. With
 * `migrate: false` nothing is applied, so a test can migrate in steps and seed rows in between.
 * 一个全新的内存数据库，并以 D1Database 的形式提供。与 D1 一样始终启用外键约束。`migrate: false` 时不执行任何迁移，
 * 测试可以分步迁移，并在中间写入数据。
 */
export function createSqliteD1(options: { migrate?: boolean } = {}): SqliteD1 {
  if (!sqlite) throw new Error('node:sqlite is not available');
  const raw = new sqlite.DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  const statements: RecordedStatement[] = [];
  const scalar = (sql: string): number => Number(raw.prepare(sql).all()[0]?.value ?? 0);

  function execute(sql: string, params: SqliteValue[]): D1Result<SqliteRow> {
    statements.push({ sql, params: [...params] });
    const started = Date.now();
    try {
      checkD1Limits(sql, params);
      const prepared = raw.prepare(sql);
      const reads = typeof prepared.columns === 'function' ? prepared.columns().length > 0 : READS.test(sql);
      let results: SqliteRow[] = [];
      let changes = 0;
      if (reads) {
        const before = scalar('SELECT total_changes() AS value');
        results = prepared.all(...params).map(plain);
        if (scalar('SELECT total_changes() AS value') !== before) changes = scalar('SELECT changes() AS value');
      } else {
        changes = Number(prepared.run(...params).changes);
      }
      return {
        success: true,
        results,
        meta: {
          duration: Date.now() - started,
          size_after: 0,
          rows_read: results.length,
          rows_written: changes,
          last_row_id: scalar('SELECT last_insert_rowid() AS value'),
          changed_db: changes > 0,
          changes,
        },
      };
    } catch (err) {
      throw d1Error(err);
    }
  }

  function statement(sql: string, params: SqliteValue[] = []): D1PreparedStatement {
    const prepared = {
      bind: (...values: unknown[]) => statement(sql, values.map(toSqlite)),
      first: async (column?: string) => {
        const row = execute(sql, params).results[0];
        if (!row) return null;
        if (column === undefined) return row;
        if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
        return row[column];
      },
      all: async () => execute(sql, params),
      run: async () => execute(sql, params),
      raw: async (rawOptions?: { columnNames?: boolean }) => {
        const rows = execute(sql, params).results;
        const values = rows.map((row) => Object.values(row));
        return rawOptions?.columnNames ? [Object.keys(rows[0] ?? {}), ...values] : values;
      },
      /** For batch: the SQL and values this statement carries. */
      /** 供 batch 使用：这条语句携带的 SQL 和参数值。 */
      toSqlite: () => ({ sql, params }),
    };
    return prepared as unknown as D1PreparedStatement;
  }

  async function batch(list: D1PreparedStatement[]): Promise<D1Result[]> {
    raw.exec('BEGIN');
    try {
      const results = list.map((item) => {
        const { sql, params } = (item as unknown as { toSqlite: () => { sql: string; params: SqliteValue[] } }).toSqlite();
        return execute(sql, params);
      });
      raw.exec('COMMIT');
      return results;
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    batch,
    exec: async (sql: string) => {
      const started = Date.now();
      try {
        raw.exec(sql);
      } catch (err) {
        throw d1Error(err);
      }
      return { count: sql.split(';').filter((part) => part.trim()).length, duration: Date.now() - started };
    },
    withSession: () => ({ prepare: (sql: string) => statement(sql), batch, getBookmark: () => null }),
    dump: async () => {
      throw new Error('dump is not supported');
    },
  } as unknown as D1Database;

  const d1: SqliteD1 = {
    db,
    raw,
    statements,
    exec: (sql) => raw.exec(sql),
    rows: <T = SqliteRow>(sql: string, ...params: unknown[]) => raw.prepare(sql).all(...params.map(toSqlite)).map(plain) as T[],
    migrate: ({ from = 0, to = Number.POSITIVE_INFINITY } = {}) => {
      for (const migration of migrationFiles()) {
        if (migration.number < from || migration.number > to) continue;
        try {
          raw.exec(migration.sql);
        } catch (err) {
          throw new Error(`${migration.name}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
        }
      }
    },
    explain: ({ sql, params }) =>
      raw
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params.map(toSqlite))
        .map((row) => String(row.detail)),
    close: () => raw.close(),
  };
  if (options.migrate !== false) d1.migrate();
  return d1;
}
