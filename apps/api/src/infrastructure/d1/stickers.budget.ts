import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STICKERS_PER_MEMBER_MAX } from '@utmmsc/shared';
import { sweepStickers } from './sticker-maintenance';
import { findStickerRef } from './sticker-refs';
import {
  addSticker,
  blockSticker,
  commitStickerUpload,
  discardStickerUpload,
  forgetStickerThumbs,
  listStickers,
  moveStickersToFront,
  readStickerLeftovers,
  refundStickerUpload,
  removeStickers,
  reserveStickerUpload,
  type StickerGate,
} from './stickers';
import { migrationFiles } from './testing/sqlite-d1';

/**
 * The row budgets of the sticker requests (spec 2.8), on a real local D1 engine started with wrangler's
 * getPlatformProxy, since the SQLite harness counts no rows. Every migration is applied in order, one member gets a
 * full collection of 999, and each request's real helpers run against that binding; the rows_read and rows_written
 * of their statements are summed and held to the bound. Run with `npm run test:budget --workspace apps/api`.
 * A failing bound means a statement reads or writes more than designed: fix the statement, and change a bound only
 * with the reason written next to it.
 * 表情请求的行数预算（规格 2.8），运行在用 wrangler 的 getPlatformProxy 启动的真实本地 D1 引擎上，因为 SQLite 测试工具不统计行数。
 * 按顺序执行所有迁移，给一位成员 999 个表情的完整列表，然后用这个绑定调用每个请求实际使用的函数；把它们各条语句的 rows_read 和 rows_written
 * 相加，并与上限比较。运行方式：`npm run test:budget --workspace apps/api`。超出上限说明某条语句读写的行数比设计的多：应修改语句，
 * 只有在旁边写明原因时才可以修改上限。
 */

interface NodeFs {
  mkdtempSync(prefix: string): string;
  writeFileSync(path: string, data: string): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}
interface NodeOs {
  tmpdir(): string;
}
interface NodePath {
  join(...parts: string[]): string;
}
interface PlatformProxy {
  env: { DB: D1Database };
  dispose(): Promise<void>;
}
type GetPlatformProxy = (options: { configPath: string; persist: { path: string }; envFiles: string[]; remoteBindings: boolean }) => Promise<PlatformProxy>;

/** Node's own modules: the API's tsconfig has Workers types only, so they are loaded as sqlite-d1.ts loads them. */
/** Node 自带的模块：接口的 tsconfig 只有 Workers 类型，因此像 sqlite-d1.ts 那样加载。 */
function builtin<T>(id: string): T {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const module = proc?.getBuiltinModule?.(id) as T | undefined;
  if (!module) throw new Error(`${id} is not available; the budget check runs on Node 22.5 or later`);
  return module;
}

/** The statements of a migration file, comments dropped, split at the semicolons outside quotes. */
/** 迁移文件中的语句：去掉注释，在引号之外的分号处拆开。 */
function statementsOf(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i] as string;
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      current += ch;
    } else if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      current += '\n';
    } else if (ch === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

interface Meter {
  read: number;
  written: number;
  /** A statement whose result carried no row counts. */
  /** 结果中没有行数的语句。 */
  missing: boolean;
  /** Each statement with its own counts, shown when a bound fails. */
  /** 每条语句及其各自的行数，超出上限时显示。 */
  statements: { sql: string; read: number; written: number }[];
}

/**
 * A D1Database over the real one that adds up rows_read and rows_written of every statement it runs, batches
 * included. Statements are rebuilt on the real binding when they run, so batch receives its own kind.
 * 包在真实 D1Database 外面、累加其执行的每条语句（包括批次中的语句）的 rows_read 和 rows_written 的对象。
 * 语句在执行时才在真实绑定上重新创建，因此 batch 收到的是它自己的语句类型。
 */
function metered(db: D1Database, meter: Meter): D1Database {
  const record = (sql: string, result: D1Result) => {
    const meta = result.meta as Partial<D1Meta>;
    if (typeof meta.rows_read !== 'number' || typeof meta.rows_written !== 'number') meter.missing = true;
    meter.read += meta.rows_read ?? 0;
    meter.written += meta.rows_written ?? 0;
    meter.statements.push({ sql: sql.replace(/\s+/g, ' ').slice(0, 90), read: meta.rows_read ?? 0, written: meta.rows_written ?? 0 });
  };
  class Statement {
    constructor(
      readonly sql: string,
      readonly values: unknown[] = [],
    ) {}
    bind(...values: unknown[]): Statement {
      return new Statement(this.sql, values);
    }
    real(): D1PreparedStatement {
      const statement = db.prepare(this.sql);
      return this.values.length > 0 ? statement.bind(...this.values) : statement;
    }
    async all(): Promise<D1Result> {
      const result = await this.real().all();
      record(this.sql, result);
      return result;
    }
    async run(): Promise<D1Result> {
      const result = await this.real().run();
      record(this.sql, result);
      return result;
    }
    async first(column?: string): Promise<unknown> {
      const row = (await this.all()).results[0] as Record<string, unknown> | undefined;
      if (!row) return null;
      return column === undefined ? row : row[column];
    }
  }
  return {
    prepare: (sql: string) => new Statement(sql),
    batch: async (list: D1PreparedStatement[]) => {
      const statements = list as unknown as Statement[];
      const results = await db.batch(statements.map((statement) => statement.real()));
      results.forEach((result, index) => record(statements[index]?.sql ?? '', result));
      return results;
    },
  } as unknown as D1Database;
}

const C = STICKERS_PER_MEMBER_MAX;
const NOW_MS = Date.parse('2030-01-15T16:00:00.000Z');
const ISO = new Date(NOW_MS).toISOString();
const PAST = new Date(NOW_MS - 30 * 24 * 60 * 60 * 1000).toISOString();
const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';
const sid = (i: number) => `stk_${String(i).padStart(22, '0')}`;

/** Each request gets a day of its own, so no daily budget of one step refuses the next. */
/** 每个请求使用各自的日期，前一步的每日额度就不会拒绝后一步。 */
let days = 0;
function gate(): StickerGate {
  days += 1;
  return { day: `budget-${String(days).padStart(4, '0')}`, token: crypto.randomUUID() };
}

describe('sticker row budgets on a local D1 engine', () => {
  let proxy: PlatformProxy;
  let db: D1Database;
  let dir = '';
  const measured: { request: string; read: number; written: number; readMax: number; writtenMax: number }[] = [];

  /** Runs one request through the meter and holds it to its bounds. */
  /** 让一个请求经过计数器，并检查它是否在上限之内。 */
  async function within(request: string, bounds: { read: number; written: number }, run: (db: D1Database) => Promise<unknown>): Promise<Meter> {
    const meter: Meter = { read: 0, written: 0, missing: false, statements: [] };
    await run(metered(db, meter));
    measured.push({ request, read: meter.read, written: meter.written, readMax: bounds.read, writtenMax: bounds.written });
    const detail = meter.statements.map((statement) => `  ${statement.read} read, ${statement.written} written: ${statement.sql}`).join('\n');
    expect(meter.missing, `${request}: a statement carried no row counts`).toBe(false);
    expect(meter.read, `${request}: rows read\n${detail}`).toBeLessThanOrEqual(bounds.read);
    expect(meter.written, `${request}: rows written\n${detail}`).toBeLessThanOrEqual(bounds.written);
    return meter;
  }

  async function exec(sql: string, ...values: unknown[]): Promise<void> {
    await db.prepare(sql).bind(...values).run();
  }

  /** Members, files and collections, written straight to the binding (not counted). */
  /** 成员、文件和表情列表，直接写入绑定（不计数）。 */
  async function member(id: string): Promise<void> {
    await exec(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?1, ?1 || '@mail.utoronto.ca', ?1, 'x', 'active', 'student', 'student', 2030, ?2, ?2)",
      id,
      ISO,
    );
  }

  async function files(from: number, to: number, fields: { state?: string; sweepAt?: string; createdBy?: string } = {}): Promise<void> {
    await exec(
      `WITH RECURSIVE n(i) AS (SELECT ?1 UNION ALL SELECT i + 1 FROM n WHERE i < ?2)
       INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at)
       SELECT 'stk_' || printf('%022d', i), 'png', 200, 200, 1000, 0, ?3, ?4, ?5, ?6 FROM n`,
      from,
      to,
      fields.state ?? 'ready',
      fields.createdBy ?? 'm1',
      PAST,
      fields.sweepAt ?? new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
    );
  }

  async function collect(memberId: string, from: number, to: number): Promise<void> {
    await exec(
      `WITH RECURSIVE n(i) AS (SELECT ?2 UNION ALL SELECT i + 1 FROM n WHERE i < ?3)
       INSERT OR IGNORE INTO member_stickers (member_id, sticker_id, thumb, position, added_at)
       SELECT ?1, 'stk_' || printf('%022d', i), ?4, 1000000000 - i, ?5 FROM n`,
      memberId,
      from,
      to,
      THUMB,
      ISO,
    );
    await exec(
      `INSERT INTO sticker_counts (scope, items, version) VALUES (?1, (SELECT COUNT(*) FROM member_stickers WHERE member_id = ?1), 1)
       ON CONFLICT (scope) DO UPDATE SET items = excluded.items`,
      memberId,
    );
  }

  beforeAll(async () => {
    const fs = builtin<NodeFs>('node:fs');
    const os = builtin<NodeOs>('node:os');
    const path = builtin<NodePath>('node:path');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'utmmsc-budget-'));
    // A configuration of its own with only a local D1 binding, so nothing of apps/api (its .dev.vars included) is read
    // and nothing remote is reached.
    // 单独的配置，只有一个本地 D1 绑定，因此不会读取 apps/api 的任何内容（包括其 .dev.vars），也不会访问任何远程资源。
    const configPath = path.join(dir, 'wrangler.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        name: 'utmmsc-budget',
        compatibility_date: '2025-06-01',
        d1_databases: [{ binding: 'DB', database_name: 'utmmsc-budget', database_id: '00000000-0000-0000-0000-000000000000' }],
      }),
    );
    const wrangler = 'wrangler';
    const { getPlatformProxy } = (await import(/* @vite-ignore */ wrangler)) as { getPlatformProxy: GetPlatformProxy };
    proxy = await getPlatformProxy({ configPath, persist: { path: path.join(dir, 'state') }, envFiles: [], remoteBindings: false });
    db = proxy.env.DB;
    for (const migration of migrationFiles()) {
      const statements = statementsOf(migration.sql);
      if (statements.length > 0) await db.batch(statements.map((sql) => db.prepare(sql)));
    }
    await member('m1');
    await member('m2');
    await files(1, C);
    await collect('m1', 1, C);
    await files(C + 1, C + 3);
    await collect('m2', C + 1, C + 3);
  });

  afterAll(async () => {
    console.table(measured);
    await proxy?.dispose();
    try {
      if (dir) builtin<NodeFs>('node:fs').rmSync(dir, { recursive: true, force: true });
    } catch {
      // The engine may still hold its files for a moment on Windows; the temporary directory is the system's to clean.
      // 在 Windows 上引擎可能还会短暂占用文件；临时目录交给系统清理。
    }
  });

  it('GET /stickers: 10 rows read and none written when unchanged, 4c + 20 and 4 for a full list', async () => {
    const full = await within('list, full', { read: 4 * C + 20, written: 4 }, (m) => listStickers(m, 'm1', { ...gate(), version: null }));
    if (full.read === 0) {
      throw new Error(
        'The local D1 engine reported no row counts. Run this check against a throwaway remote database (wrangler d1 create utmmsc-budget, deleted after), never the production one.',
      );
    }
    await within('list, unchanged', { read: 10, written: 0 }, (m) => listStickers(m, 'm1', { ...gate(), version: 1 }));
  });

  it('POST /stickers/add: 40 rows read and 14 written', async () => {
    await files(5001, 5001);
    await within('add, new', { read: 40, written: 14 }, (m) =>
      addSticker(m, { memberId: 'm2', id: sid(5001), thumb: THUMB, nowMs: NOW_MS, gate: gate(), countToken: crypto.randomUUID() }),
    );
    await within('add, duplicate at 999', { read: 40, written: 14 }, (m) =>
      addSticker(m, { memberId: 'm1', id: sid(500), thumb: THUMB, nowMs: NOW_MS, gate: gate(), countToken: crypto.randomUUID() }),
    );
  });

  it('POST /stickers/upload: 60 rows read and 30 written for reserve and commit, reserve and discard, or a failed write and the read of what is left', async () => {
    await within('upload, new file', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm2', id: sid(6001), type: 'gif' as const, width: 240, height: 240, animated: true, fileBytes: 5000, requestBytes: 6000, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
      const probe = await reserveStickerUpload(m, upload);
      expect(probe.reserved).toBe(true);
      await commitStickerUpload(m, { ...upload, stillBytes: upload.requestBytes - upload.fileBytes, countToken: crypto.randomUUID() });
    });
    await within('upload, stored file by its owner', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm1', id: sid(7), type: 'png' as const, width: 200, height: 200, animated: false, fileBytes: 1000, requestBytes: 2000, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
      const probe = await reserveStickerUpload(m, upload);
      expect(probe).toMatchObject({ reserved: true, mine: true });
      await commitStickerUpload(m, { ...upload, thumb: probe.keptThumb, stillBytes: null, countToken: crypto.randomUUID() });
    });
    // Another member's pending row that recorded other bytes: the reserve checks the storage caps, and the commit moves
    // the file and its bytes to the committing member.
    // 另一位成员留下的、记录了别的字节数的 pending 记录：预留时检查存储上限，提交时把文件及其字节数转给提交的成员。
    await member('m3');
    const left = { memberId: 'm3', id: sid(6002), type: 'png' as const, width: 16, height: 16, animated: false, fileBytes: 100, requestBytes: 1100, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
    expect((await reserveStickerUpload(db, left)).created).toBe(true);
    // Reads raised from 60 to 62 for this case alone. R7 reads the row of the still R6 just recorded by its primary key,
    // to tell a refused reserve whether R1 needed room for the still (R1's own lookup misses here, a fresh still,
    // reading no row): 60 rows before that read, 61 with it. C2b then finds that row and keeps it for good (holders
    // NULL), so no release can take the row the key just written relies on; the upsert reads the row it updates: 61 rows
    // and 21 written with ON CONFLICT DO NOTHING, 62 and 22 with the update (measured the same way, every other case
    // unchanged but the new file's, 52 to 53 read and 24 to 25 written, within its bounds).
    // 仅这一种情况的读取上限由 60 提高到 62。R7 按主键读取 R6 刚刚记录的静态缩略图的记录，以便告诉被拒绝的预留 R1 是否需要为静态缩略图留出空间
    // （这里是新的静态缩略图，R1 自己的查找没有命中，不读取任何行）：加入这次读取之前为 60 行，之后为 61 行。C2b 随后找到这条记录并把它设为永久保留
    // （holders 为 NULL），使任何释放都不能删除刚写入的键所依赖的记录；这次插入或更新要读取它更新的那一行：使用 ON CONFLICT DO NOTHING 时
    // 读取 61 行、写入 21 行，加上这次更新后为 62 行和 22 行（以同样方式实测；其他情况除新文件外都不变，新文件的读取由 52 行变为 53 行、
    // 写入由 24 行变为 25 行，仍在其上限之内）。
    // Reads raised again, from 62 to 63, for this case alone. R4 now counts this reserve on the pending row already
    // there (reserves + 1), so the request that wrote the row cannot discard it once this upload may have stored the
    // original under it; the upsert reads and writes that row. Measured the same way: 63 rows read and 23 written,
    // against 62 and 22 with ON CONFLICT DO NOTHING. Over a ready row the conflict reads the row and writes nothing: 46,
    // 53 and 44 rows read for the three uploads over a stored file, where they were 45, 52 and 43, within their bounds;
    // every other case is unchanged.
    // 仅这一种情况的读取上限再次由 62 提高到 63。R4 现在把这次预留计入已有的 pending 记录（reserves + 1），这样一旦本次上传可能已在这条记录之下
    // 存下原始文件，写入这条记录的请求就不能再丢弃它；这次插入或更新要读取并写入这一行。以同样方式实测：读取 63 行、写入 23 行，
    // 使用 ON CONFLICT DO NOTHING 时为 62 行和 22 行。对 ready 的记录，冲突时读取该行而不写入：对已存储文件的三种上传分别读取 46、53 和 44 行，
    // 原来为 45、52 和 43 行，仍在各自的上限之内；其他情况都不变。
    // No bound moves for R4 now also moving the sweep of the row it passes over (sweep_at, MAX of the stored and the new
    // time). Measured the same way: reads unchanged (63 here); writes 24 here, where they were 23, the extra one being
    // the row's entry in sticker_objects_sweep, and over a ready row the conflict now writes the row and that entry, so
    // 9, 13 and 13 written for the three uploads over a stored file, where they were 7, 11 and 11. The read of what is
    // left no longer writes the pending row it finds: 47 read and 19 written, then 35 and 17, for the two failed writes
    // below, where they were 48 and 20, then 36 and 18.
    // R4 现在还会推迟它所经过的记录的清理时间（sweep_at，取已存时间与新时间的 MAX），但没有任何上限因此改变。以同样方式实测：读取行数不变
    // （这里为 63 行）；这里写入 24 行，原来为 23 行，多出的一行是该行在 sticker_objects_sweep 中的索引项；对 ready 的记录，冲突时现在会写入该行及其索引项，
    // 因此对已存储文件的三种上传分别写入 9、13 和 13 行，原来为 7、11 和 11 行。读取剩下的内容时不再写入找到的 pending 记录：
    // 下面两种写入失败的情况分别读取 47 行、写入 19 行，以及读取 35 行、写入 17 行，原来为 48 和 20 行，以及 36 和 18 行。
    await within('upload, over a pending row with other bytes', { read: 63, written: 30 }, async (m) => {
      const upload = { memberId: 'm2', id: sid(6002), type: 'gif' as const, width: 240, height: 240, animated: true, fileBytes: 5000, requestBytes: 6000, thumb: 'ZzZzZzZzZzZzZzZzZzZzZz', nowMs: NOW_MS + 1, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: false });
      const stillBytes = upload.requestBytes - upload.fileBytes;
      expect(await commitStickerUpload(m, { ...upload, stillBytes, countToken: crypto.randomUUID() })).toMatchObject({ outcome: 'added' });
    });
    // R2 refused the original's bytes: the reserve, then the discard of the row it created and the still it recorded.
    // R2 拒绝了原始文件的字节：预留，然后丢弃它新建的记录和它记录的静态缩略图。
    await within('upload, checksum mismatch', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm2', id: sid(6003), type: 'gif' as const, width: 240, height: 240, animated: true, fileBytes: 5000, requestBytes: 6000, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: true });
      await discardStickerUpload(m, { ...upload, pending: true });
    });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sticker_objects WHERE id = ?1').bind(sid(6003)).first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?1').bind(sid(6003)).first<{ n: number }>())?.n).toBe(0);
    // A wrong hash for a file another member stored and keeps: the reserve, then the discard of the still it recorded.
    // 对另一位成员已存储并收藏的文件的哈希不符：预留，然后丢弃它记录的静态缩略图。
    await within('upload, checksum mismatch over a stored file', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm3', id: sid(C + 1), type: 'png' as const, width: 200, height: 200, animated: false, fileBytes: 1000, requestBytes: 2000, thumb: 'ZzZzZzZzZzZzZzZzZzZzZz', nowMs: NOW_MS + 2, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: false, mine: false });
      await discardStickerUpload(m, { ...upload, pending: true });
    });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?1').bind(sid(C + 1)).first<{ n: number }>())?.n).toBe(0);
    // R2 refused the still of a file another member stored and keeps (or the original's put failed otherwise): the
    // reserve, then the discard of the still alone, which checks every collection with one seek.
    // R2 拒绝了另一位成员已存储并收藏的文件的静态缩略图（或者原始文件的写入因别的原因失败）：预留，然后只丢弃静态缩略图，
    // 检查所有表情列表时只需一次查找。
    await within('upload, still never put over a stored file', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm3', id: sid(C + 2), type: 'png' as const, width: 200, height: 200, animated: false, fileBytes: 1000, requestBytes: 2000, thumb: 'ZzZzZzZzZzZzZzZzZzZzZz', nowMs: NOW_MS + 3, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: false, mine: false });
      await discardStickerUpload(m, { ...upload, pending: false });
    });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?1').bind(sid(C + 2)).first<{ n: number }>())?.n).toBe(0);
    // The original's put of a new file failed otherwise, so it may have landed: the reserve, the refund, the discard of
    // the still never put and the read of what is left, which writes nothing for the pending row it finds (the reserve
    // wrote it, and moved its sweep an hour off).
    // 新文件的原始文件写入因别的原因失败，可能已经落地：预留、退回额度、丢弃从未写入的静态缩略图，以及读取剩下的内容，
    // 读取时不为找到的 pending 记录写入任何东西（预留写入了它，并把它的清理时间推迟了一小时）。
    await within('upload, original failed otherwise over a new file', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm2', id: sid(6004), type: 'gif' as const, width: 240, height: 240, animated: true, fileBytes: 5000, requestBytes: 6000, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: true });
      await refundStickerUpload(m, upload);
      await discardStickerUpload(m, { ...upload, pending: false });
      expect(await readStickerLeftovers(m, upload.id, null)).toEqual({ gone: false, stillRecorded: false });
    });
    // The still's put failed otherwise: the reserve, the refund and the read of what is left, which also keeps the still's
    // row for good.
    // 静态缩略图的写入因别的原因失败：预留、退回额度，以及读取剩下的内容，读取时还把静态缩略图的记录设为永久保留。
    await within('upload, still failed otherwise over a new file', { read: 60, written: 30 }, async (m) => {
      const upload = { memberId: 'm2', id: sid(6005), type: 'gif' as const, width: 240, height: 240, animated: true, fileBytes: 5000, requestBytes: 6000, thumb: THUMB, nowMs: NOW_MS, gate: gate() };
      expect(await reserveStickerUpload(m, upload)).toMatchObject({ reserved: true, created: true });
      await refundStickerUpload(m, upload);
      expect(await readStickerLeftovers(m, upload.id, upload.thumb)).toEqual({ gone: false, stillRecorded: true });
    });
    for (const [i, holders] of [
      [6004, 0],
      [6005, 1],
    ] as const) {
      expect((await db.prepare('SELECT reserves FROM sticker_objects WHERE id = ?1').bind(sid(i)).first<{ reserves: number }>())?.reserves).toBe(1);
      expect((await db.prepare('SELECT COUNT(*) AS n FROM sticker_thumbs WHERE sticker_id = ?1 AND holders IS NULL').bind(sid(i)).first<{ n: number }>())?.n).toBe(holders);
    }
  });

  // Reads raised from the spec's 3n + 30 to 5n + 30: D1 counts each id twice for reading the JSON list (json_each,
  // then the IN list's temporary table) before its primary-key lookup, and an UPDATE of the indexed position reads
  // the row and its old index entry. Measured: 14, 509 and 5,004 rows for n = 1, 100 and 999. Writes are as designed.
  // 读取上限由规格中的 3n + 30 提高到 5n + 30：D1 对每个 id 在主键查找之前读取 JSON 列表时计两次（json_each，以及 IN 列表的临时表），
  // 更新带索引的 position 时还要读取该行及其旧的索引项。实测：n = 1、100、999 时分别为 14、509、5,004 行。写入行数与设计一致。
  it('POST /stickers/front: 5n + 30 rows read and 2n + 8 written', async () => {
    for (const n of [1, 100, C]) {
      const ids = Array.from({ length: n }, (_, i) => sid(C - i));
      const result = await within(`front, n = ${n}`, { read: 5 * n + 30, written: 2 * n + 8 }, (m) => moveStickersToFront(m, { memberId: 'm1', ids, nowMs: NOW_MS + n, gate: gate() }));
      expect(result.read).toBeGreaterThan(0);
    }
  });

  // Reads raised from the spec's 4n + 30 to 7n + 30, for the same JSON list counting: the count before the delete
  // reads each id three times, the delete four (the list, the row and its two secondary index entries). Measured:
  // 17, 710 and 7,003 rows for n = 1, 100 and 999. Writes are as designed.
  // 读取上限由规格中的 4n + 30 提高到 7n + 30，原因同样是 JSON 列表的计数方式：删除之前的计数对每个 id 读三次，删除读四次
  // （列表、该行及其两个二级索引项）。实测：n = 1、100、999 时分别为 17、710、7,003 行。写入行数与设计一致。
  it('POST /stickers/remove: 7n + 30 rows read and 3n + 8 written', async () => {
    for (const n of [1, 100, C]) {
      const ids = Array.from({ length: n }, (_, i) => sid(i + 1));
      await within(`remove, n = ${n}`, { read: 7 * n + 30, written: 3 * n + 8 }, (m) => removeStickers(m, { memberId: 'm1', ids, gate: gate() }));
      await collect('m1', 1, C);
    }
  });

  // Reads raised from the spec's 3k + t + 30 to 7k + 11t + 30, and writes from 3k + t + 10 to 3k + 2t + 10: each
  // owner's total is found through the list of owners (its index entry, the temporary list and the total's primary
  // key), and each collection row deleted is read with its index entries. Each still is read for the per-scope sum of
  // the bytes it takes off (its row, the sum's two passes and grouping, its creator's total by primary key) and when
  // its row goes, and its creator's total is written. Measured with every still by another owner, k = 50: 422 rows
  // read and 113 written for t = 5, 915 and 203 for t = 50.
  // 读取上限由规格中的 3k + t + 30 提高到 7k + 11t + 30，写入上限由 3k + t + 10 提高到 3k + 2t + 10：每位收藏者的累计数要经由收藏者列表找到
  // （其索引项、临时列表和累计数的主键），删除的每一行列表记录也要连同其索引项一起读取。每张静态缩略图在按范围求和要减去的字节数时被读取
  // （其记录、求和的两遍扫描和分组、按主键读取其创建者的累计数），删除其记录时再读一次，并写入其创建者的累计数。
  // 实测（每张静态缩略图都由另一位收藏者上传，k = 50）：t = 5 时读取 422 行、写入 113 行，t = 50 时读取 915 行、写入 203 行。
  it('POST /stickers/block: 7k + 11t + 30 rows read and 3k + 2t + 10 written', async () => {
    const k = 50;
    await files(8001, 8002);
    for (let i = 0; i < k; i += 1) {
      await member(`o${i}`);
      await collect(`o${i}`, 8001, 8002);
    }
    for (const [file, t] of [
      [8001, 5],
      [8002, k],
    ] as const) {
      // Each still by another owner, the case where the block takes bytes off the most totals.
      // 每张静态缩略图都由另一位收藏者上传，即封禁要减去最多累计数的情况。
      for (let i = 0; i < t; i += 1) {
        await exec('INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by) VALUES (?1, ?2, ?3, 500, ?4)', sid(file), `T${String(i).padStart(21, '0')}`, ISO, `o${i}`);
        await exec('UPDATE sticker_counts SET live_bytes = live_bytes + 500 WHERE scope = ?1', `o${i}`);
      }
      await within(`block, k = ${k}, t = ${t}`, { read: 7 * k + 11 * t + 30, written: 3 * k + 2 * t + 10 }, async (m) => {
        const read = await blockSticker(m, sid(file), ISO);
        expect(read?.thumbs).toHaveLength(t);
        await forgetStickerThumbs(m, sid(file));
      });
    }
  });

  it('the room lookup on a cache miss: 6 rows read and 2 written', async () => {
    await files(9001, 9001);
    await within('room lookup, first send', { read: 6, written: 2 }, (m) => findStickerRef(m, sid(9001), ISO));
    await within('room lookup, later send', { read: 6, written: 2 }, (m) => findStickerRef(m, sid(9001), ISO));
  });

  // Reads raised from the spec's 6s + t + 20 to 40s + 11t + 20, and writes from 4s + t + 10 to 4s + 2t + 10: each file
  // is read through the window twice (claim, then keep) and by the read of the claims, and its delete reads the JSON
  // list, the row, the collection check, its index entries and its cascaded stills; the totals are summed once over the
  // list. Each still is read with its file's stills, by the per-scope sum (its row, the grouping, its creator's total by
  // primary key) and when it cascades, and its creator's total is written. Measured with every file and every still by
  // a creator of its own: 2,305 rows read and 251 written for s = t = 50.
  // 读取上限由规格中的 6s + t + 20 提高到 40s + 11t + 20，写入上限由 4s + t + 10 提高到 4s + 2t + 10：每个文件在范围中被读取两次（认领，然后延后），
  // 读取认领时再读一次；删除时要读取 JSON 列表、该行、列表检查、其索引项和级联删除的静态缩略图；累计数只对列表求和一次。每张静态缩略图随其文件的
  // 静态缩略图读取一次，按范围求和时（其记录、分组、按主键读取其创建者的累计数）和级联删除时各读一次，并写入其创建者的累计数。
  // 实测（每个文件和每张静态缩略图都由各自不同的创建者上传）：s = t = 50 时读取 2,305 行、写入 251 行。
  it('a sweep run: 40s + 11t + 20 rows read and 4s + 2t + 10 written', async () => {
    const s = 50;
    const t = s;
    // Every file and every still by a creator of its own, the case where each one has its own running total to update.
    // 每个文件和每张静态缩略图的创建者都各不相同，即每一个都要更新各自创建者累计数的情况。
    for (let i = 0; i < s; i += 1) {
      await member(`c${i}`);
      await member(`d${i}`);
      await files(10001 + i, 10001 + i, { state: i % 2 === 0 ? 'pending' : 'ready', sweepAt: PAST, createdBy: `c${i}` });
      await exec('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?1, 1000), (?2, 500)', `c${i}`, `d${i}`);
      await exec('INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by) VALUES (?1, ?2, ?3, 500, ?4)', sid(10001 + i), THUMB, ISO, `d${i}`);
    }
    await exec("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', 1000000) ON CONFLICT (scope) DO UPDATE SET live_bytes = 1000000");
    const bucket = { delete: async () => undefined } as unknown as R2Bucket;
    await within(`sweep, s = ${s}, t = ${t}`, { read: 40 * s + 11 * t + 20, written: 4 * s + 2 * t + 10 }, async (m) => {
      const sweep = await sweepStickers(m, bucket, new Date(NOW_MS));
      expect(sweep.deleted).toBe(s);
    });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM sticker_counts WHERE scope LIKE 'd%' AND live_bytes = 0").first<{ n: number }>())?.n).toBe(t);
  });
});
