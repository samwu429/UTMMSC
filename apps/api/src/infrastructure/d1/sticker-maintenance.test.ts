import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { STICKER_SWEEP_BATCH, runStickerMaintenance, sweepStickers } from './sticker-maintenance';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/** A bucket that records each delete call, or fails every one. */
/** 记录每次删除调用的存储桶，或者让每次删除都失败。 */
function fakeBucket(options: { fail?: boolean } = {}) {
  const deletes: string[][] = [];
  const bucket = {
    delete: async (keys: string | string[]) => {
      if (options.fail) throw new Error('R2 unavailable');
      deletes.push(Array.isArray(keys) ? [...keys] : [keys]);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, deletes };
}

const NOW = new Date('2026-10-26T16:17:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
const sid = (i: number) => `stk_${String(i).padStart(22, '0')}`;
const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';
const OTHER_THUMB = 'ZzZzZzZzZzZzZzZzZzZzZz';

describe.skipIf(!sqlite)('sweepStickers on the real schema', () => {
  let d1: SqliteD1;
  let db: D1Database;

  function file(
    i: number,
    fields: { state?: string; sweepAt?: string; sentAt?: string | null; blockedAt?: string | null; createdBy?: string | null; bytes?: number; type?: string } = {},
  ) {
    d1.rows(
      `INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sent_at, sweep_at, blocked_at)
       VALUES (?, ?, 240, 240, ?, 0, ?, ?, ?, ?, ?, ?)`,
      sid(i),
      fields.type ?? 'png',
      fields.bytes ?? 1000,
      fields.state ?? 'ready',
      fields.createdBy === undefined ? 'm1' : fields.createdBy,
      at(-10 * DAY_MS),
      fields.sentAt ?? null,
      fields.sweepAt ?? at(-HOUR),
      fields.blockedAt ?? null,
    );
  }

  function still(i: number, thumb: string, fields: { bytes?: number; createdBy?: string | null } = {}) {
    d1.rows(
      'INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by) VALUES (?, ?, ?, ?, ?)',
      sid(i),
      thumb,
      at(-DAY_MS),
      fields.bytes ?? 0,
      fields.createdBy ?? null,
    );
  }

  /** The original under every type, as stickerFileKeys names it. */
  /** 每种类型下的原始文件，与 stickerFileKeys 列出的一致。 */
  const originals = (i: number) => ['gif', 'png', 'webp', 'jpeg'].map((type) => `sticker/${sid(i)}.${type}`);

  function collect(memberId: string, i: number) {
    d1.rows("INSERT INTO member_stickers (member_id, sticker_id, thumb, position, added_at) VALUES (?, ?, NULL, 1, ?)", memberId, sid(i), at(-DAY_MS));
  }

  const ids = () => d1.rows<{ id: string; state: string }>('SELECT id, state FROM sticker_objects ORDER BY id');
  const liveBytes = (scope: string) => d1.rows<{ live_bytes: number }>('SELECT live_bytes FROM sticker_counts WHERE scope = ?', scope)[0]?.live_bytes;

  beforeEach(() => {
    d1 = createSqliteD1();
    db = d1.db;
    for (const id of ['m1', 'm2']) {
      d1.rows(
        "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', 'active', 'student', 'student', 2026, ?, ?)",
        id,
        `${id}@mail.utoronto.ca`,
        id,
        at(-30 * DAY_MS),
        at(-30 * DAY_MS),
      );
    }
  });

  afterEach(() => d1.close());

  it('deletes an abandoned upload with its objects after an hour, and leaves a younger one', async () => {
    // The row records a png, as one written for bytes R2 refused would; the original a later upload wrote is a gif.
    // 记录中是 png，就像为被 R2 拒绝的字节写下的记录那样；之后的上传写入的原始文件是 gif。
    file(1, { state: 'pending', type: 'png' });
    file(2, { state: 'pending', sweepAt: at(HOUR / 2) });
    still(1, THUMB);
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toEqual({ claimed: 1, kept: 0, deleted: 1, objects: 5 });
    expect(deletes).toEqual([[...originals(1), `sticker/${sid(1)}-t-${THUMB}`]]);
    expect(deletes[0]).toContain(`sticker/${sid(1)}.gif`);
    expect(ids()).toEqual([{ id: sid(2), state: 'pending' }]);
    expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')[0]).toEqual({ n: 0 });
  });

  it('gives a stored file still in a collection another week, and deletes one in nobody’s collection', async () => {
    file(1);
    file(2);
    collect('m2', 1);
    still(2, THUMB);
    still(2, OTHER_THUMB);
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toEqual({ claimed: 1, kept: 1, deleted: 1, objects: 6 });
    expect([...(deletes[0] ?? [])].sort()).toEqual([`sticker/${sid(2)}-t-${OTHER_THUMB}`, `sticker/${sid(2)}-t-${THUMB}`, ...originals(2)].sort());
    expect(d1.rows('SELECT id, state, sweep_at FROM sticker_objects')).toEqual([{ id: sid(1), state: 'ready', sweep_at: at(7 * DAY_MS) }]);
  });

  it('never claims a sent or a blocked file, even long past its time', async () => {
    file(1, { sentAt: at(-5 * DAY_MS), sweepAt: at(-30 * DAY_MS) });
    file(2, { blockedAt: at(-DAY_MS), sweepAt: at(-30 * DAY_MS) });
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
    expect(deletes).toEqual([]);
    expect(ids()).toEqual([
      { id: sid(1), state: 'ready' },
      { id: sid(2), state: 'ready' },
    ]);
  });

  it('leaves the claims when the bucket fails, and the next run finishes them', async () => {
    file(1);
    file(2, { state: 'pending' });
    await expect(sweepStickers(db, fakeBucket({ fail: true }).bucket, NOW)).rejects.toThrow('R2 unavailable');
    expect(ids()).toEqual([
      { id: sid(1), state: 'deleting' },
      { id: sid(2), state: 'deleting' },
    ]);
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, new Date(NOW.getTime() + HOUR))).toMatchObject({ deleted: 2, objects: 8 });
    expect(deletes).toHaveLength(1);
    expect(ids()).toEqual([]);
  });

  it('takes the deleted bytes of the files and of their stills off each creator’s and the club’s running totals, never below zero', async () => {
    file(1, { bytes: 3000 });
    file(2, { bytes: 2000, state: 'pending' });
    file(3, { bytes: 500, createdBy: 'm2' });
    file(4, { bytes: 700, createdBy: null });
    file(5, { bytes: 9000 });
    collect('m1', 5);
    // Stills of deleted files by their creator, by another member and by nobody, and one of the kept file.
    // 被删除文件的静态缩略图，分别由其创建者、另一位成员上传和无人认领；另有一张属于保留下来的文件。
    still(1, THUMB, { bytes: 40, createdBy: 'm1' });
    still(1, OTHER_THUMB, { bytes: 60, createdBy: 'm2' });
    still(3, THUMB, { bytes: 25, createdBy: 'm1' });
    still(4, THUMB, { bytes: 10 });
    still(5, THUMB, { bytes: 80, createdBy: 'm1' });
    d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('m1', 14145), ('m2', 100), ('*', 15415)");
    const { bucket } = fakeBucket();
    d1.statements.length = 0;
    expect(await sweepStickers(db, bucket, NOW)).toMatchObject({ deleted: 4 });
    expect(liveBytes('m1')).toBe(9080);
    expect(liveBytes('m2')).toBe(0);
    expect(liveBytes('*')).toBe(9080);
    // The bytes are summed once over the listed ids, never over every file or still a creator made, and joined to the
    // totals by primary key.
    // 字节数只按列表中的 id 求和一次，从不读取某位创建者做过的所有文件或静态缩略图，再按主键与累计数关联。
    const totals = d1.statements.find((statement) => statement.sql.includes('UPDATE sticker_counts'));
    expect(totals).toBeDefined();
    const plan = d1.explain(totals!).join('\n');
    expect(plan).not.toMatch(/sticker_objects_creator/);
    expect(plan).not.toMatch(/SCAN (sticker_objects|sticker_thumbs|sticker_counts)\b/);
    expect(plan).not.toMatch(/SCAN t\b/);
    expect(plan).toMatch(/sqlite_autoindex_sticker_objects_1 \(id=\?\)/);
    expect(plan).toMatch(/sqlite_autoindex_sticker_thumbs_1 \(sticker_id=\?\)/);
  });

  it('keeps a claimed file that was blocked before the run finished it, and takes nothing off for it', async () => {
    file(1, { state: 'deleting', blockedAt: at(-1000), bytes: 4000 });
    d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('m1', 4000), ('*', 4000)");
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
    expect(deletes).toEqual([]);
    expect(ids()).toEqual([{ id: sid(1), state: 'deleting' }]);
    expect(liveBytes('*')).toBe(4000);
  });

  it('deletes daily counts older than two days with the rest', async () => {
    for (const day of ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']) {
      d1.rows('INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, ?, 1)', day, 'm1');
      d1.rows("INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, '*', 1)", day);
    }
    await sweepStickers(db, fakeBucket().bucket, NOW);
    expect(d1.rows<{ day: string }>('SELECT DISTINCT day FROM sticker_daily ORDER BY day').map((row) => row.day)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('looks at no more than 50 files a run, oldest first, in one bucket call', async () => {
    for (let i = 1; i <= STICKER_SWEEP_BATCH + 10; i += 1) file(i, { sweepAt: at(-(200 - i) * HOUR) });
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toEqual({ claimed: STICKER_SWEEP_BATCH, kept: 0, deleted: STICKER_SWEEP_BATCH, objects: 4 * STICKER_SWEEP_BATCH });
    expect(deletes).toHaveLength(1);
    expect(ids().map((row) => row.id)).toEqual(Array.from({ length: 10 }, (_, i) => sid(STICKER_SWEEP_BATCH + 1 + i)));
  });

  it('keeps files whose stills do not fit in one call for the next run', async () => {
    file(1);
    file(2);
    for (let i = 0; i < 600; i += 1) {
      const thumb = `T${String(i).padStart(21, '0')}`;
      still(1, thumb);
      still(2, thumb);
    }
    const { bucket, deletes } = fakeBucket();
    expect(await sweepStickers(db, bucket, NOW)).toMatchObject({ claimed: 2, deleted: 1, objects: 604 });
    expect(deletes.map((keys) => keys.length)).toEqual([604]);
    expect(ids()).toEqual([{ id: sid(2), state: 'deleting' }]);
    expect(await sweepStickers(db, bucket, NOW)).toMatchObject({ deleted: 1, objects: 604 });
    expect(ids()).toEqual([]);
  });
});

describe('runStickerMaintenance', () => {
  it('does nothing without a bucket', async () => {
    const prepare = vi.fn();
    await runStickerMaintenance({ DB: { prepare, batch: prepare } } as unknown as Env, NOW);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('never throws: before migration 0019 it is quiet, any other failure is logged', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failing = (message: string) =>
        ({
          DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => Promise.reject(new Error(message)) },
          FILES: fakeBucket().bucket,
        }) as unknown as Env;
      await runStickerMaintenance(failing('D1_ERROR: no such table: sticker_objects'), NOW);
      expect(error).not.toHaveBeenCalled();
      await runStickerMaintenance(failing('D1_ERROR: database is locked'), NOW);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });
});
