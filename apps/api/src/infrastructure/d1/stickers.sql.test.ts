import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  STICKERS_PER_MEMBER_MAX,
  STICKER_CLUB_EDITS_PER_DAY,
  STICKER_CLUB_LIVE_BYTES,
  STICKER_CLUB_UPLOAD_BYTES_PER_DAY,
  STICKER_EDITS_PER_DAY,
  STICKER_FULL_LISTS_PER_DAY,
  STICKER_IDS_PER_CALL_MAX,
  STICKER_LIVE_BYTES_PER_MEMBER,
  STICKER_PENDING_TTL_MS,
  STICKER_UPLOADS_PER_DAY,
} from '@utmmsc/shared';
import { sweepStickers } from './sticker-maintenance';
import {
  addSticker,
  blockSticker,
  commitStickerUpload,
  discardStickerUpload,
  listStickers,
  moveStickersToFront,
  readStickerLeftovers,
  refundStickerUpload,
  removeStickers,
  reserveStickerUpload,
  stickerFileKeys,
  stickerPosition,
  uploadRefusal,
  type StickerGate,
  type StickerUpload,
} from './stickers';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/**
 * The sticker statements of infrastructure/d1/stickers.ts on real SQLite with D1's limits: the gates, the counters
 * they keep, the plans of the statements that touch many rows, and collections of 999. Route behaviour is tested in
 * http/routes/stickers/routes.test.ts.
 * infrastructure/d1/stickers.ts 中的表情语句在带有 D1 限制的真实 SQLite 上的检查：闸门、闸门维护的计数、涉及多行的语句的执行计划，
 * 以及 999 个表情的列表。接口行为在 http/routes/stickers/routes.test.ts 中测试。
 */

const DAY = '2026-10-26';
const NOW_MS = Date.parse('2026-10-26T16:00:00.000Z');
const ISO = new Date(NOW_MS).toISOString();
const THUMB = 'AbCdEfGhIjKlMnOpQrStUv';

/** A valid sticker id for a number: stk_ and 22 digits. */
/** 由数字得到的合法表情 id：stk_ 加 22 位数字。 */
const sid = (i: number) => `stk_${String(i).padStart(22, '0')}`;
const gate = (): StickerGate => ({ day: DAY, token: crypto.randomUUID() });

describe.skipIf(!sqlite)('sticker statements on SQLite', () => {
  let d1: SqliteD1;
  let db: D1Database;

  function member(id: string) {
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', 'active', 'student', 'student', 2026, ?, ?)",
      id,
      `${id}@mail.utoronto.ca`,
      id,
      ISO,
      ISO,
    );
  }

  /** Files numbered from..to, ready unless told otherwise. */
  /** 编号从 from 到 to 的文件，默认是 ready。 */
  function files(from: number, to: number, fields: { state?: string; blocked?: boolean; createdBy?: string | null; bytes?: number } = {}) {
    d1.exec(`WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})
      INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at, blocked_at)
      SELECT 'stk_' || printf('%022d', i), 'gif', 240, 240, ${fields.bytes ?? 1000}, 1, '${fields.state ?? 'ready'}',
             ${fields.createdBy === undefined ? "'m1'" : fields.createdBy === null ? 'NULL' : `'${fields.createdBy}'`},
             '${ISO}', '${ISO}', ${fields.blocked ? `'${ISO}'` : 'NULL'} FROM n`);
  }

  /** Puts files from..to in a member's collection, the lowest number newest, and sets the member's count. */
  /** 把编号从 from 到 to 的文件放进成员的表情列表，编号最小的最新，并设置成员的计数。 */
  function collect(memberId: string, from: number, to: number) {
    d1.exec(`WITH RECURSIVE n(i) AS (SELECT ${from} UNION ALL SELECT i + 1 FROM n WHERE i < ${to})
      INSERT INTO member_stickers (member_id, sticker_id, thumb, position, added_at)
      SELECT '${memberId}', 'stk_' || printf('%022d', i), '${THUMB}', ${stickerPosition(NOW_MS - 1_000_000)} - i * 1000, '${ISO}' FROM n`);
    d1.rows(
      `INSERT INTO sticker_counts (scope, items, version) VALUES (?, (SELECT COUNT(*) FROM member_stickers WHERE member_id = ?1), 1)
       ON CONFLICT (scope) DO UPDATE SET items = excluded.items`,
      memberId,
    );
  }

  const counts = (scope: string) =>
    d1.rows<{ items: number; live_bytes: number; version: number }>('SELECT items, live_bytes, version FROM sticker_counts WHERE scope = ?', scope)[0];
  const daily = (scope: string) =>
    d1.rows<{ uploads: number; upload_bytes: number; edits: number; lists: number }>(
      'SELECT uploads, upload_bytes, edits, lists FROM sticker_daily WHERE day = ? AND scope = ?',
      DAY,
      scope,
    )[0];
  const collection = (memberId: string) =>
    d1.rows<{ sticker_id: string }>('SELECT sticker_id FROM member_stickers WHERE member_id = ? ORDER BY position DESC, added_at DESC, sticker_id', memberId).map(
      (row) => row.sticker_id,
    );
  const realCount = (memberId: string) => d1.rows<{ n: number }>('SELECT COUNT(*) AS n FROM member_stickers WHERE member_id = ?', memberId)[0]?.n;

  beforeEach(() => {
    d1 = createSqliteD1();
    db = d1.db;
    member('m1');
    member('m2');
  });

  afterEach(() => d1.close());

  describe('listStickers', () => {
    it('lists newest first, with every field, and counts one full list', async () => {
      files(1, 3);
      collect('m1', 1, 3);
      d1.statements.length = 0;
      const result = await listStickers(db, 'm1', { ...gate(), version: null });
      expect(result.listed).toBe(true);
      expect(result.version).toBe(1);
      // The collection is read through the member's order index, each file by its primary key.
      // 表情列表通过成员的排序索引读取，每个文件按主键查找。
      const plan = d1.explain(d1.statements[1]!).join('\n');
      expect(plan).toMatch(/SEARCH m USING INDEX member_stickers_order \(member_id=\?\)/);
      expect(plan).toMatch(/SEARCH o USING INDEX sqlite_autoindex_sticker_objects_1 \(id=\?\)/);
      expect(result.stickers.map((s) => s.id)).toEqual([sid(1), sid(2), sid(3)]);
      expect(result.stickers[0]).toEqual({ id: sid(1), type: 'gif', width: 240, height: 240, bytes: 1000, animated: true, thumb: THUMB, addedAt: ISO });
      expect(daily('m1')?.lists).toBe(1);
    });

    it('honours the limit', async () => {
      files(1, 5);
      collect('m1', 1, 5);
      expect((await listStickers(db, 'm1', { ...gate(), version: null, limit: 2 })).stickers.map((s) => s.id)).toEqual([sid(1), sid(2)]);
    });

    it('never lists pending, deleting or blocked files', async () => {
      files(1, 1);
      files(2, 2, { state: 'pending' });
      files(3, 3, { state: 'deleting' });
      files(4, 4, { blocked: true });
      collect('m1', 1, 4);
      expect((await listStickers(db, 'm1', { ...gate(), version: null })).stickers.map((s) => s.id)).toEqual([sid(1)]);
    });

    it('returns no rows and counts no list when the client holds the current version', async () => {
      files(1, 3);
      collect('m1', 1, 3);
      const result = await listStickers(db, 'm1', { ...gate(), version: 1 });
      expect(result).toEqual({ listed: false, version: 1, stickers: [] });
      expect(daily('m1')).toBeUndefined();
      expect((await listStickers(db, 'm1', { ...gate(), version: 7 })).listed).toBe(true);
    });

    it('lists a member with no collection as version 0, and the budget refuses the next full list', async () => {
      expect(await listStickers(db, 'm2', { ...gate(), version: null })).toEqual({ listed: true, version: 0, stickers: [] });
      expect((await listStickers(db, 'm2', { ...gate(), version: 0 })).listed).toBe(false);
      d1.rows('UPDATE sticker_daily SET lists = ? WHERE day = ? AND scope = ?', STICKER_FULL_LISTS_PER_DAY, DAY, 'm2');
      expect(await listStickers(db, 'm2', { ...gate(), version: 5 })).toEqual({ listed: false, version: 0, stickers: [] });
      expect(daily('m2')?.lists).toBe(STICKER_FULL_LISTS_PER_DAY);
    });
  });

  describe('addSticker', () => {
    const add = (memberId: string, id: string, thumb: string | null = THUMB) =>
      addSticker(db, { memberId, id, thumb, nowMs: NOW_MS, gate: gate(), countToken: crypto.randomUUID() });

    it('adds once, then moves the row and keeps its still, with the total, the version and one edit each', async () => {
      files(1, 1);
      const first = await add('m1', sid(1));
      expect(first).toMatchObject({ outcome: 'added', total: 1, version: 1, sticker: { id: sid(1), thumb: THUMB, addedAt: ISO } });
      const again = await add('m1', sid(1), 'ZzZzZzZzZzZzZzZzZzZzZz');
      expect(again).toMatchObject({ outcome: 'moved', total: 1, version: 2, sticker: { thumb: THUMB } });
      expect(counts('m1')?.items).toBe(1);
      expect(daily('m1')?.edits).toBe(2);
      expect(daily('*')?.edits).toBe(2);
    });

    it('refuses missing, unfinished, being-swept and blocked files without changing the collection or its version', async () => {
      files(2, 2, { state: 'pending' });
      files(3, 3, { state: 'deleting' });
      files(4, 4, { blocked: true });
      expect(await add('m1', sid(1))).toMatchObject({ outcome: 'refused', file: 'missing' });
      expect(await add('m1', sid(2))).toMatchObject({ outcome: 'refused', file: 'unready' });
      expect(await add('m1', sid(3))).toMatchObject({ outcome: 'refused', file: 'unready' });
      expect(await add('m1', sid(4))).toMatchObject({ outcome: 'refused', file: 'blocked' });
      expect(collection('m1')).toEqual([]);
      expect(counts('m1')).toBeUndefined();
    });

    it('refuses a new sticker at 999, still moves one already there, and keeps items equal to the rows', async () => {
      files(1, STICKERS_PER_MEMBER_MAX + 1);
      collect('m1', 1, STICKERS_PER_MEMBER_MAX);
      expect(await add('m1', sid(STICKERS_PER_MEMBER_MAX + 1))).toMatchObject({ outcome: 'refused', file: 'ready', total: STICKERS_PER_MEMBER_MAX });
      expect(await add('m1', sid(500))).toMatchObject({ outcome: 'moved', total: STICKERS_PER_MEMBER_MAX });
      expect(collection('m1')[0]).toBe(sid(500));
      expect(realCount('m1')).toBe(STICKERS_PER_MEMBER_MAX);
    });

    it('names the edit budget that refused it, the member’s own first', async () => {
      files(1, 1);
      d1.rows('INSERT INTO sticker_daily (day, scope, edits) VALUES (?, ?, ?)', DAY, 'm1', STICKER_EDITS_PER_DAY);
      expect(await add('m1', sid(1))).toEqual({ outcome: 'limited', refusal: 'edits' });
      d1.rows('INSERT INTO sticker_daily (day, scope, edits) VALUES (?, ?, ?)', DAY, '*', STICKER_CLUB_EDITS_PER_DAY);
      expect(await add('m2', sid(1))).toEqual({ outcome: 'limited', refusal: 'clubLimit' });
      expect(collection('m1')).toEqual([]);
      expect(collection('m2')).toEqual([]);
      expect(daily('*')?.edits).toBe(STICKER_CLUB_EDITS_PER_DAY);
    });
  });

  describe('moveStickersToFront', () => {
    it('puts the ids first in the order given, ignores ids not in the collection and gives a new version', async () => {
      files(1, 6);
      collect('m1', 1, 5);
      collect('m2', 6, 6);
      const result = await moveStickersToFront(db, { memberId: 'm1', ids: [sid(4), sid(2), sid(6), sid(99)], nowMs: NOW_MS, gate: gate() });
      expect(result).toEqual({ outcome: 'moved', moved: 2, version: 2 });
      expect(collection('m1')).toEqual([sid(4), sid(2), sid(1), sid(3), sid(5)]);
      expect(collection('m2')).toEqual([sid(6)]);
      expect(daily('m1')?.edits).toBe(4);
    });

    it('moves all 999 within the harness limits, with one primary-key lookup per id over one read of the JSON', async () => {
      files(1, STICKERS_PER_MEMBER_MAX);
      collect('m1', 1, STICKERS_PER_MEMBER_MAX);
      const ids = Array.from({ length: STICKER_IDS_PER_CALL_MAX }, (_, i) => sid(STICKERS_PER_MEMBER_MAX - i));
      d1.statements.length = 0;
      expect(await moveStickersToFront(db, { memberId: 'm1', ids, nowMs: NOW_MS, gate: gate() })).toMatchObject({ outcome: 'moved', moved: STICKERS_PER_MEMBER_MAX });
      expect(collection('m1')).toEqual(ids);
      const f1 = d1.statements.find((statement) => /json_extract/.test(statement.sql));
      expect(f1).toBeDefined();
      const plan = d1.explain(f1!).join('\n');
      expect(plan).toMatch(/SEARCH member_stickers USING COVERING INDEX sqlite_autoindex_member_stickers_1 \(member_id=\? AND sticker_id=\?\)/);
      expect(plan).toMatch(/LIST SUBQUERY/);
      expect(plan).not.toMatch(/SCAN member_stickers/);
      expect(Math.max(...d1.statements.map((statement) => statement.params.length))).toBeLessThanOrEqual(14);
    });

    it('moves nothing when the edit budget is spent', async () => {
      files(1, 3);
      collect('m1', 1, 3);
      d1.rows('INSERT INTO sticker_daily (day, scope, edits) VALUES (?, ?, ?)', DAY, 'm1', STICKER_EDITS_PER_DAY - 1);
      expect(await moveStickersToFront(db, { memberId: 'm1', ids: [sid(3), sid(2)], nowMs: NOW_MS, gate: gate() })).toEqual({ outcome: 'limited', refusal: 'edits' });
      expect(collection('m1')).toEqual([sid(1), sid(2), sid(3)]);
      expect(counts('m1')?.version).toBe(1);
      expect(daily('*')).toBeUndefined();
    });
  });

  describe('removeStickers', () => {
    it('removes only the member’s own rows and keeps items equal to the rows', async () => {
      files(1, 4);
      collect('m1', 1, 3);
      collect('m2', 2, 4);
      const result = await removeStickers(db, { memberId: 'm1', ids: [sid(2), sid(4), sid(99)], gate: gate() });
      expect(result).toEqual({ outcome: 'removed', removed: 1, total: 2, version: 2 });
      expect(collection('m1')).toEqual([sid(1), sid(3)]);
      expect(collection('m2')).toEqual([sid(2), sid(3), sid(4)]);
      expect(counts('m1')?.items).toBe(realCount('m1'));
      expect(counts('m2')?.items).toBe(3);
      // Files stay: only the sweep or a block deletes them.
      // 文件保留：只有清理任务或封禁才会删除它们。
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects')[0]).toEqual({ n: 4 });
    });

    it('removes all 999 in one call within the harness limits', async () => {
      files(1, STICKERS_PER_MEMBER_MAX);
      collect('m1', 1, STICKERS_PER_MEMBER_MAX);
      const ids = Array.from({ length: STICKERS_PER_MEMBER_MAX }, (_, i) => sid(i + 1));
      expect(await removeStickers(db, { memberId: 'm1', ids, gate: gate() })).toMatchObject({ outcome: 'removed', removed: STICKERS_PER_MEMBER_MAX, total: 0 });
      expect(realCount('m1')).toBe(0);
      expect(counts('m1')?.items).toBe(0);
      expect(daily('m1')?.edits).toBe(STICKERS_PER_MEMBER_MAX);
    });

    it('removes nothing when the club budget is spent', async () => {
      files(1, 2);
      collect('m1', 1, 2);
      d1.rows('INSERT INTO sticker_daily (day, scope, edits) VALUES (?, ?, ?)', DAY, '*', STICKER_CLUB_EDITS_PER_DAY - 1);
      expect(await removeStickers(db, { memberId: 'm1', ids: [sid(1), sid(2)], gate: gate() })).toEqual({ outcome: 'limited', refusal: 'clubLimit' });
      expect(realCount('m1')).toBe(2);
      expect(counts('m1')?.items).toBe(2);
    });
  });

  describe('uploads', () => {
    /** Bytes of the still of every upload below, unless told otherwise. */
    /** 下面每次上传的静态缩略图字节数，除非另行指定。 */
    const STILL = 1000;
    const OTHER_THUMB = 'ZzZzZzZzZzZzZzZzZzZzZz';
    const upload = (memberId: string, id: string, fields: Partial<StickerUpload> = {}): StickerUpload => ({
      memberId,
      id,
      type: 'gif',
      width: 240,
      height: 200,
      animated: true,
      fileBytes: 5000,
      requestBytes: (fields.fileBytes ?? 5000) + STILL,
      thumb: THUMB,
      nowMs: NOW_MS,
      gate: gate(),
      ...fields,
    });
    /**
     * What R2 verified for the committing upload, the same as upload() unless told otherwise, and the size of the still
     * it wrote under `thumb` (null for a repeat by a member who had the sticker, which writes none).
     * R2 为提交的上传校验过的内容，除非另行指定，与 upload() 相同；以及它以 `thumb` 写入的静态缩略图的字节数
     * （已有这个表情的成员重复上传时不写入静态缩略图，为 null）。
     */
    type Verified = Pick<StickerUpload, 'type' | 'width' | 'height' | 'animated' | 'fileBytes'> & { stillBytes: number | null };
    const commit = (memberId: string, id: string, thumb: string | null = THUMB, verified: Partial<Verified> = {}) =>
      commitStickerUpload(db, {
        memberId,
        id,
        thumb,
        type: 'gif',
        width: 240,
        height: 200,
        animated: true,
        fileBytes: 5000,
        stillBytes: STILL,
        ...verified,
        nowMs: NOW_MS + 1000,
        countToken: crypto.randomUUID(),
      });
    const fileRow = (id: string) =>
      d1.rows<{ type: string; width: number; height: number; bytes: number; animated: number; state: string }>(
        'SELECT type, width, height, bytes, animated, state FROM sticker_objects WHERE id = ?',
        id,
      )[0];
    const stills = (id: string) =>
      d1.rows<{ thumb: string; bytes: number; created_by: string | null }>('SELECT thumb, bytes, created_by FROM sticker_thumbs WHERE sticker_id = ? ORDER BY thumb', id);

    it('reserves a new file as pending and records its still, with both their bytes on both totals, then commits it as ready with a row', async () => {
      const probe = await reserveStickerUpload(db, upload('m1', sid(1)));
      expect(probe).toMatchObject({ reserved: true, state: 'pending', blocked: false, mine: false, keptThumb: null, created: true, uploads: 1, uploadBytes: 6000, clubUploads: 1 });
      expect(counts('m1')?.live_bytes).toBe(5000 + STILL);
      expect(counts('*')?.live_bytes).toBe(5000 + STILL);
      expect(d1.rows('SELECT state, sweep_at, created_by FROM sticker_objects WHERE id = ?', sid(1))[0]).toEqual({
        state: 'pending',
        sweep_at: new Date(NOW_MS + 60 * 60 * 1000).toISOString(),
        created_by: 'm1',
      });
      // The still is recorded before it is written, so a request cut short after its put leaves a key the sweep knows.
      // 静态缩略图在写入之前就已记录，因此写入之后被中断的请求留下的键，清理任务也知道。
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      const result = await commit('m1', sid(1));
      expect(result).toMatchObject({ outcome: 'added', total: 1, version: 1, sticker: { id: sid(1), height: 200, thumb: THUMB } });
      expect(d1.rows('SELECT state, sweep_at FROM sticker_objects WHERE id = ?', sid(1))[0]).toEqual({
        state: 'ready',
        sweep_at: new Date(NOW_MS + 1000 + 7 * 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(counts('m1')?.live_bytes).toBe(5000 + STILL);
    });

    it('charges a stored file the same quota and the storage of its still alone, and a repeat by its owner moves it with no still', async () => {
      files(1, 1, { createdBy: 'm2' });
      const probe = await reserveStickerUpload(db, upload('m1', sid(1)));
      expect(probe).toMatchObject({ reserved: true, state: 'ready', mine: false, created: false, uploads: 1 });
      expect(counts('m1')?.live_bytes).toBe(STILL);
      // A ready file keeps what it records: the commit changes neither the row nor any total.
      // 已就绪的文件保留它记录的内容：提交既不改动记录，也不改动任何累计数。
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added', sticker: { type: 'gif', width: 240, height: 240, bytes: 1000 } });
      expect(fileRow(sid(1))).toEqual({ type: 'gif', width: 240, height: 240, bytes: 1000, animated: 1, state: 'ready' });
      expect(counts('m1')?.live_bytes).toBe(STILL);
      expect(counts('m2')).toBeUndefined();
      expect(counts('*')?.live_bytes).toBe(STILL);
      const again = await reserveStickerUpload(db, upload('m1', sid(1), { thumb: OTHER_THUMB }));
      expect(again).toMatchObject({ mine: true, keptThumb: THUMB });
      expect(await commit('m1', sid(1), again.keptThumb, { stillBytes: null })).toMatchObject({ outcome: 'moved', sticker: { thumb: THUMB } });
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(counts('m1')?.live_bytes).toBe(STILL);
      expect(daily('m1')?.uploads).toBe(2);
    });

    it('counts every new still toward both storage caps, also for a stored file, and never a still recorded already', async () => {
      files(1, 2, { createdBy: 'm2' });
      // One byte short of room for the still alone: a stored file is refused too.
      // 只差一个字节就能放下静态缩略图：已存储的文件也会被拒绝。
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm1', STICKER_LIVE_BYTES_PER_MEMBER - STILL + 1);
      const tight = upload('m1', sid(1));
      const refused = await reserveStickerUpload(db, tight);
      expect(refused).toMatchObject({ reserved: false, state: 'ready' });
      expect(uploadRefusal(refused, tight)).toBe('memberStorage');
      expect(stills(sid(1))).toEqual([]);
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER - STILL, 'm1');
      expect((await reserveStickerUpload(db, upload('m1', sid(1)))).reserved).toBe(true);
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      // The club's cap counts it the same way.
      // 全会的上限也以同样的方式计算它。
      d1.rows("UPDATE sticker_counts SET live_bytes = ? WHERE scope = '*'", STICKER_CLUB_LIVE_BYTES - STILL + 1);
      const club = upload('m2', sid(2));
      expect(uploadRefusal(await reserveStickerUpload(db, club), club)).toBe('clubStorage');
      // The same still for the same file is recorded once: a second upload of it is neither charged nor recorded again.
      // 同一个文件的同一张静态缩略图只记录一次：再次上传它既不计费，也不会再记录一次。
      d1.rows("UPDATE sticker_counts SET live_bytes = 0 WHERE scope = '*'");
      await reserveStickerUpload(db, upload('m2', sid(2)));
      await reserveStickerUpload(db, upload('m2', sid(2), { nowMs: NOW_MS + 1 }));
      expect(counts('m2')?.live_bytes).toBe(STILL);
      expect(stills(sid(2))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm2' }]);
      // A member who has the sticker writes no still, so needs no storage at all.
      // 已有这个表情的成员不写入静态缩略图，因此不需要任何存储空间。
      collect('m1', 1, 1);
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER, 'm1');
      expect(await reserveStickerUpload(db, upload('m1', sid(1), { thumb: OTHER_THUMB }))).toMatchObject({ reserved: true, mine: true });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
    });

    it('needs no room for a still a row names already: a retry after a refund, or a pick again after a removal, passes at the cap', async () => {
      files(1, 1, { createdBy: 'm2' });
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm1', STICKER_LIVE_BYTES_PER_MEMBER - STILL);
      const first = upload('m1', sid(1));
      expect(await reserveStickerUpload(db, first)).toMatchObject({ reserved: true, stillRecorded: true });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      // The still's put failed for another reason: the day comes back, the still's row and its bytes stay, and the
      // client retries with the same prepared still.
      // 静态缩略图的写入因别的原因失败：当天的额度退回，静态缩略图的记录及其字节数保留，客户端用同一张准备好的静态缩略图重试。
      await refundStickerUpload(db, first);
      const retry = upload('m1', sid(1), { nowMs: NOW_MS + 1 });
      expect(await reserveStickerUpload(db, retry)).toMatchObject({ reserved: true, mine: false });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      expect(counts('*')?.live_bytes).toBe(STILL);
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      // Committed, removed and picked again with the same still: no room needed either.
      // 提交、删除之后用同一张静态缩略图再次选择：同样不需要空间。
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added' });
      await removeStickers(db, { memberId: 'm1', ids: [sid(1)], gate: gate() });
      expect((await reserveStickerUpload(db, upload('m1', sid(1), { nowMs: NOW_MS + 2 }))).reserved).toBe(true);
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      // A fresh still needs its room: one byte short, it is refused.
      // 新的静态缩略图需要它自己的空间：只差一个字节也会被拒绝。
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER - STILL + 1, 'm1');
      const fresh = upload('m1', sid(1), { thumb: OTHER_THUMB, nowMs: NOW_MS + 3 });
      const refused = await reserveStickerUpload(db, fresh);
      expect(refused).toMatchObject({ reserved: false, stillRecorded: false });
      expect(uploadRefusal(refused, fresh)).toBe('memberStorage');
      expect(stills(sid(1))).toHaveLength(1);
      // An upload that charges nothing passes even when a total already sits over its cap (C2a charges unchecked).
      // 什么也不计入的上传，即使某个累计数已经超过上限（C2a 计入时不检查上限）也能通过。
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER + 5, 'm1');
      d1.rows("UPDATE sticker_counts SET live_bytes = ? WHERE scope = '*'", STICKER_CLUB_LIVE_BYTES + 5);
      expect((await reserveStickerUpload(db, upload('m1', sid(1), { nowMs: NOW_MS + 4 }))).reserved).toBe(true);
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER + 5);
      expect(counts('*')?.live_bytes).toBe(STICKER_CLUB_LIVE_BYTES + 5);
    });

    it('needs no room for a stored file’s still another member recorded with the same bytes, and charges nothing', async () => {
      files(1, 1, { createdBy: null });
      await reserveStickerUpload(db, upload('m2', sid(1)));
      expect(counts('m2')?.live_bytes).toBe(STILL);
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm1', STICKER_LIVE_BYTES_PER_MEMBER);
      expect(await reserveStickerUpload(db, upload('m1', sid(1), { nowMs: NOW_MS + 1 }))).toMatchObject({ reserved: true, mine: false });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      expect(counts('m2')?.live_bytes).toBe(STILL);
      expect(counts('*')?.live_bytes).toBe(STILL);
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm2' }]);
      // Its commit records nothing more and charges nothing more.
      // 它的提交不再记录任何内容，也不再计入任何字节。
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added', sticker: { thumb: THUMB } });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER);
      expect(counts('*')?.live_bytes).toBe(STILL);
    });

    it('names the club’s storage for a refused upload over a pending row of other bytes whose still is recorded already', async () => {
      // m2's upload whose bytes R2 refused left a pending row of 100 bytes and recorded the still.
      // m2 的字节被 R2 拒绝的上传留下了一条 100 字节的 pending 记录，并记录了静态缩略图。
      await reserveStickerUpload(db, upload('m2', sid(1), { fileBytes: 100 }));
      // m1 has room for the file but not for the file and a still; the club is over by one byte for the file.
      // m1 的空间放得下文件，但放不下文件加一张静态缩略图；全会的空间放文件差一个字节。
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm1', STICKER_LIVE_BYTES_PER_MEMBER - 5000 - STILL + 1);
      d1.rows("UPDATE sticker_counts SET live_bytes = ? WHERE scope = '*'", STICKER_CLUB_LIVE_BYTES - 5000 + 1);
      const real = upload('m1', sid(1));
      const probe = await reserveStickerUpload(db, real);
      expect(probe).toMatchObject({ reserved: false, state: 'pending', recordedBytes: 100, stillRecorded: true });
      expect(uploadRefusal(probe, real)).toBe('clubStorage');
      // With room in the club it passes, and only the file is charged.
      // 全会有空间时就能通过，并且只计入文件本身。
      d1.rows("UPDATE sticker_counts SET live_bytes = ? WHERE scope = '*'", STICKER_CLUB_LIVE_BYTES - 5000);
      expect((await reserveStickerUpload(db, real)).reserved).toBe(true);
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added' });
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER - STILL + 1);
    });

    it('puts back the kept still, never one that was not written, when the member removed the sticker between reserve and commit', async () => {
      files(1, 1, { createdBy: 'm2' });
      collect('m1', 1, 1);
      const probe = await reserveStickerUpload(db, upload('m1', sid(1), { thumb: OTHER_THUMB }));
      expect(probe).toMatchObject({ reserved: true, mine: true, keptThumb: THUMB });
      expect(stills(sid(1))).toEqual([]);
      await removeStickers(db, { memberId: 'm1', ids: [sid(1)], gate: gate() });
      expect(await commit('m1', sid(1), probe.keptThumb, { stillBytes: null })).toMatchObject({ outcome: 'added', sticker: { thumb: THUMB } });
      expect(d1.rows('SELECT thumb FROM member_stickers WHERE member_id = ? AND sticker_id = ?', 'm1', sid(1))).toEqual([{ thumb: THUMB }]);
      // The repeat wrote no still, so the commit records none either.
      // 重复上传没有写入静态缩略图，因此提交时也不记录任何静态缩略图。
      expect(stills(sid(1))).toEqual([]);
    });

    it('records the still again at the commit, charged once, for an upload that outlived the hour its reserve gave the file', async () => {
      const bucket = { delete: async () => undefined } as unknown as R2Bucket;
      // A stored file nobody keeps, due for the sweep. m1's reserve moves its sweep an hour off, so the sweep leaves it
      // alone while m1's upload is in flight.
      // 一个没有人收藏、清理任务已到期的已存储文件。m1 的预留把它的清理时间推迟了一小时，因此在 m1 的上传进行期间清理任务不碰它。
      files(1, 1, { createdBy: 'm2' });
      await reserveStickerUpload(db, upload('m1', sid(1)));
      expect(await sweepStickers(db, bucket, new Date(NOW_MS))).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
      // Should m1's upload outlive that hour, the sweep deletes the file with the still m1's upload recorded; m2 stores
      // the same file again before m1's commit, which then makes it ready.
      // 如果 m1 的上传超过这一小时仍未结束，清理任务会删除这个文件，连同 m1 的上传记录的静态缩略图；m2 在 m1 提交之前再次存储了同一个文件，
      // m1 的提交随后让它变为 ready。
      expect((await sweepStickers(db, bucket, new Date(NOW_MS + STICKER_PENDING_TTL_MS))).deleted).toBe(1);
      expect(counts('m1')?.live_bytes).toBe(0);
      await reserveStickerUpload(db, upload('m2', sid(1), { thumb: OTHER_THUMB, nowMs: NOW_MS + STICKER_PENDING_TTL_MS + 1 }));
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added', sticker: { thumb: THUMB } });
      expect(stills(sid(1))).toEqual([
        { thumb: THUMB, bytes: STILL, created_by: 'm1' },
        { thumb: OTHER_THUMB, bytes: STILL, created_by: 'm2' },
      ]);
      expect(counts('m1')?.live_bytes).toBe(STILL);
      expect(counts('m2')?.live_bytes).toBe(5000 + STILL);
      expect(counts('*')?.live_bytes).toBe(5000 + 2 * STILL);
      // A still that is still recorded is neither recorded nor charged again.
      // 仍有记录的静态缩略图不会再次记录，也不会再次计入。
      await commit('m2', sid(1), OTHER_THUMB);
      expect(stills(sid(1))).toHaveLength(2);
      expect(counts('m2')?.live_bytes).toBe(5000 + STILL);
      // The same after a discard, again for uploads that outlived the hour: m2's own row of a new file went with it to the
      // sweep; m1 reserved the file anew with the same still, m3 with another, and m1 discarded its still after R2
      // refused its bytes, before m2's commit marked the row it now relies on.
      // 丢弃之后也是一样，同样是超过这一小时仍未结束的上传：m2 为新文件写下的记录随文件一起被清理任务删除；m1 用同一张静态缩略图、m3 用另一张
      // 重新预留了这个文件，m1 在 R2 拒绝其字节后丢弃了自己的静态缩略图，这发生在 m2 的提交标记它现在依赖的记录之前。
      member('m3');
      await reserveStickerUpload(db, upload('m2', sid(2)));
      // m3 held m2's row for the same still too, and gives up only after m2's commit below.
      // m3 也为同一张静态缩略图持有 m2 的记录，直到下面 m2 提交之后才放弃。
      const late = upload('m3', sid(2), { nowMs: NOW_MS + 1 });
      await reserveStickerUpload(db, late);
      expect((await sweepStickers(db, bucket, new Date(NOW_MS + 2 * 60 * 60 * 1000))).deleted).toBe(1);
      expect(counts('m2')?.live_bytes).toBe(5000 + STILL);
      await reserveStickerUpload(db, upload('m1', sid(2), { nowMs: NOW_MS + 2 }));
      await reserveStickerUpload(db, upload('m3', sid(2), { thumb: OTHER_THUMB, nowMs: NOW_MS + 3 }));
      await discardStickerUpload(db, { memberId: 'm1', id: sid(2), nowMs: NOW_MS + 2, thumb: THUMB, pending: true });
      expect(stills(sid(2))).toEqual([{ thumb: OTHER_THUMB, bytes: STILL, created_by: 'm3' }]);
      expect(counts('m1')?.live_bytes).toBe(STILL + 5000);
      expect(await commit('m2', sid(2))).toMatchObject({ outcome: 'added' });
      expect(stills(sid(2))).toEqual([
        { thumb: THUMB, bytes: STILL, created_by: 'm2' },
        { thumb: OTHER_THUMB, bytes: STILL, created_by: 'm3' },
      ]);
      expect(counts('m2')?.live_bytes).toBe(5000 + 2 * STILL);
      expect(counts('m3')?.live_bytes).toBe(STILL);
      // The row recorded again is kept for good: a hold on the row the sweep deleted, given up now, cannot take it,
      // even once no collection names the still.
      // 重新记录的记录永久保留：对已被清理任务删除的那条记录的持有，现在放弃，也不能删除它，即使已没有任何表情列表指向这张静态缩略图。
      await removeStickers(db, { memberId: 'm2', ids: [sid(2)], gate: gate() });
      await discardStickerUpload(db, { ...late, pending: false });
      expect(stills(sid(2))).toHaveLength(2);
      expect(counts('m2')?.live_bytes).toBe(5000 + 2 * STILL);
      // Nothing is recorded for a file that is not usable after the commit.
      // 提交之后仍不可用的文件不记录任何静态缩略图。
      files(3, 3, { blocked: true });
      expect(await commit('m1', sid(3))).toMatchObject({ outcome: 'refused', file: 'blocked' });
      expect(await commit('m1', sid(4))).toMatchObject({ outcome: 'refused', file: 'missing' });
      expect(stills(sid(3))).toEqual([]);
    });

    it('counts a pending row of someone else’s unfinished upload as existing', async () => {
      await reserveStickerUpload(db, upload('m2', sid(1)));
      const probe = await reserveStickerUpload(db, upload('m1', sid(1)));
      expect(probe).toMatchObject({ reserved: true, state: 'pending', created: false });
      // The same still bytes give the same token: it stays recorded once, on its first uploader's total.
      // 相同的静态缩略图字节得到相同的令牌：它只记录一次，计在第一位上传者的累计数上。
      expect(counts('m1')).toBeUndefined();
      expect(counts('*')?.live_bytes).toBe(5000 + STILL);
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm2' }]);
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'added' });
      // A later reserve by the creator itself did not write the row either.
      // 创建者自己之后的预留也不算写入了这条记录。
      expect((await reserveStickerUpload(db, upload('m2', sid(1), { nowMs: NOW_MS + 5 }))).created).toBe(false);
    });

    it('commits the bytes R2 verified over a pending row that recorded others, and makes the file the committing member’s', async () => {
      const createdBy = (id: string) => d1.rows<{ created_by: string | null }>('SELECT created_by FROM sticker_objects WHERE id = ?', id)[0]?.created_by;
      // Rows as an upload whose bytes R2 refused leaves them: another type, size and dimensions than the real file.
      // 字节被 R2 拒绝的上传留下的记录：类型、大小和尺寸都与真实文件不同。
      await reserveStickerUpload(db, upload('m2', sid(1), { type: 'png', width: 16, height: 16, animated: false, fileBytes: 100 }));
      await reserveStickerUpload(db, upload('m2', sid(2), { fileBytes: 9000 }));
      expect(counts('m2')?.live_bytes).toBe(9100 + 2 * STILL);
      const probe = await reserveStickerUpload(db, upload('m1', sid(1), { fileBytes: 8000, thumb: OTHER_THUMB }));
      expect(probe).toMatchObject({ reserved: true, state: 'pending', created: false, recordedBytes: 100 });
      const result = await commit('m1', sid(1), OTHER_THUMB, { type: 'gif', width: 300, height: 200, animated: true, fileBytes: 8000 });
      expect(result).toMatchObject({ outcome: 'added', sticker: { id: sid(1), type: 'gif', width: 300, height: 200, bytes: 8000, animated: true } });
      expect(fileRow(sid(1))).toEqual({ type: 'gif', width: 300, height: 200, bytes: 8000, animated: 1, state: 'ready' });
      // The member whose bytes R2 stored carries them; the row's old creator loses what it recorded. Each still stays
      // on its own uploader's total.
      // 由 R2 存下其字节的成员承担这些字节；记录原来的创建者减去记录中的字节数。每张静态缩略图仍计在各自上传者的累计数上。
      expect(createdBy(sid(1))).toBe('m1');
      expect(counts('m1')?.live_bytes).toBe(8000 + STILL);
      expect(counts('m2')?.live_bytes).toBe(9000 + 2 * STILL);
      expect(counts('*')?.live_bytes).toBe(17000 + 3 * STILL);
      // A smaller verified size, committed by the row's own creator, moves its total down.
      // 由记录的创建者自己提交、经过校验的大小更小时，它的累计数相应减少。
      await commit('m2', sid(2), THUMB, { fileBytes: 6000 });
      expect(fileRow(sid(2))).toMatchObject({ bytes: 6000, state: 'ready' });
      expect(createdBy(sid(2))).toBe('m2');
      expect(counts('m2')?.live_bytes).toBe(6000 + 2 * STILL);
      expect(counts('*')?.live_bytes).toBe(14000 + 3 * STILL);
      // A pending row of the same size stays its creator's, and the member who commits carries nothing.
      // 大小相同的 pending 记录仍归其创建者所有，提交的成员不承担任何字节。
      await reserveStickerUpload(db, upload('m2', sid(3)));
      await commit('m1', sid(3));
      expect(createdBy(sid(3))).toBe('m2');
      expect(counts('m1')?.live_bytes).toBe(8000 + STILL);
      expect(counts('m2')?.live_bytes).toBe(11000 + 3 * STILL);
      expect(counts('*')?.live_bytes).toBe(19000 + 4 * STILL);
      // Once ready, a later commit changes nothing.
      // 变为 ready 之后，再次提交不会改变任何内容。
      await commit('m2', sid(1), THUMB, { type: 'png', width: 16, height: 16, animated: false, fileBytes: 100 });
      expect(fileRow(sid(1))).toEqual({ type: 'gif', width: 300, height: 200, bytes: 8000, animated: 1, state: 'ready' });
      expect(createdBy(sid(1))).toBe('m1');
      expect(counts('*')?.live_bytes).toBe(19000 + 4 * STILL);
    });

    it('checks the storage caps for an upload over a pending row that records another size, as for a new file', async () => {
      // A pending row whose bytes R2 refused, left by the member itself, then by another member.
      // 字节被 R2 拒绝后留下的 pending 记录，先是成员自己留下的，然后是另一位成员留下的。
      await reserveStickerUpload(db, upload('m1', sid(1), { fileBytes: 100 }));
      d1.rows('UPDATE sticker_counts SET live_bytes = ? WHERE scope = ?', STICKER_LIVE_BYTES_PER_MEMBER - 4999, 'm1');
      const real = upload('m1', sid(1));
      const probe = await reserveStickerUpload(db, real);
      expect(probe).toMatchObject({ reserved: false, state: 'pending', recordedBytes: 100 });
      expect(uploadRefusal(probe, real)).toBe('memberStorage');
      expect(daily('m1')?.uploads).toBe(1);
      // A refused reserve charges nothing, even in the millisecond of the reserve that wrote the row.
      // 被拒绝的预留不计入任何字节，即使与写入这条记录的预留发生在同一毫秒。
      expect(counts('m1')?.live_bytes).toBe(STICKER_LIVE_BYTES_PER_MEMBER - 4999);
      expect(counts('*')?.live_bytes).toBe(100 + STILL);
      // The same size counts as existing, and its still is recorded already, so it needs no storage at all.
      // 大小相同的记录视为已存在，它的静态缩略图也已有记录，因此完全不需要存储空间。
      expect((await reserveStickerUpload(db, upload('m1', sid(1), { fileBytes: 100, nowMs: NOW_MS + 1 }))).reserved).toBe(true);
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm2', STICKER_LIVE_BYTES_PER_MEMBER - 4999);
      const other = upload('m2', sid(1));
      expect(uploadRefusal(await reserveStickerUpload(db, other), other)).toBe('memberStorage');
      d1.rows('UPDATE sticker_counts SET live_bytes = 0 WHERE scope = ?', 'm2');
      d1.rows("UPDATE sticker_counts SET live_bytes = ? WHERE scope = '*'", STICKER_CLUB_LIVE_BYTES - 4999);
      expect(uploadRefusal(await reserveStickerUpload(db, other), other)).toBe('clubStorage');
      expect(daily('m2')).toBeUndefined();
      d1.rows("UPDATE sticker_counts SET live_bytes = 0 WHERE scope = '*'");
      expect((await reserveStickerUpload(db, other)).reserved).toBe(true);
    });

    it('moves no totals for a pending row blocked before its commit, and records the verified type for a repeat block', async () => {
      await reserveStickerUpload(db, upload('m1', sid(1), { type: 'png', fileBytes: 100 }));
      expect((await blockSticker(db, sid(1), ISO))?.type).toBe('png');
      // The block took the file's bytes and its still's off.
      // 封禁减去了文件和它的静态缩略图的字节数。
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect(await commit('m1', sid(1), THUMB, { type: 'gif', fileBytes: 5000 })).toMatchObject({ outcome: 'refused', file: 'blocked' });
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect((await blockSticker(db, sid(1), ISO))?.type).toBe('gif');
    });

    it('discards only the pending row the request itself created, with its own still and both their bytes, and keeps the day charged', async () => {
      const own = upload('m1', sid(1));
      await reserveStickerUpload(db, own);
      // Rows a discard must leave: another member's, the same member's from another request, one made ready, one in a
      // collection, one with another upload's still, and a blocked one. This request reserved each of them too (over
      // the other member's with a still of its own, over its other request's with the same still).
      // 丢弃时必须保留的记录：别的成员的、同一成员另一次请求的、已变为 ready 的、在表情列表中的、带有另一次上传的静态缩略图的，以及已被封禁的。
      // 本次请求也预留了它们每一个（在别的成员的记录之上用自己的静态缩略图，在自己另一次请求的记录之上用同一张静态缩略图）。
      await reserveStickerUpload(db, upload('m2', sid(2)));
      await reserveStickerUpload(db, upload('m1', sid(2), { thumb: OTHER_THUMB }));
      await reserveStickerUpload(db, upload('m1', sid(3), { nowMs: NOW_MS - 1 }));
      await reserveStickerUpload(db, upload('m1', sid(3)));
      for (const i of [4, 5, 6, 7]) await reserveStickerUpload(db, upload('m1', sid(i)));
      await commit('m1', sid(4));
      d1.rows('INSERT INTO member_stickers (member_id, sticker_id, position, added_at) VALUES (?, ?, 1, ?)', 'm2', sid(5), ISO);
      await reserveStickerUpload(db, upload('m2', sid(6), { thumb: OTHER_THUMB }));
      await blockSticker(db, sid(7), ISO);
      expect(counts('m1')?.live_bytes).toBe(5 * (5000 + STILL) + STILL);
      for (const i of [1, 2, 3, 4, 5, 6, 7]) {
        await discardStickerUpload(db, { memberId: 'm1', id: sid(i), nowMs: NOW_MS, thumb: i === 2 ? OTHER_THUMB : THUMB, pending: true });
      }
      expect(d1.rows<{ id: string }>('SELECT id FROM sticker_objects ORDER BY id').map((row) => row.id)).toEqual([2, 3, 4, 5, 6, 7].map(sid));
      expect(stills(sid(1))).toEqual([]);
      // Where the row stays, the still this request recorded goes alone with its bytes (never written either), unless
      // another request holds it (m1's other request), a collection names it (the file committed by m1) or the file is
      // blocked (the block took its bytes off).
      // 记录保留时，本次请求记录的静态缩略图单独删除并退回其字节数（它同样从未写入），除非另一次请求持有它（m1 的另一次请求）、
      // 某个表情列表指向它（m1 提交的文件），或者文件已被封禁（封禁已经减去了它的字节数）。
      expect(stills(sid(2))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm2' }]);
      expect(stills(sid(3))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(stills(sid(4))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(stills(sid(5))).toEqual([]);
      expect(stills(sid(6))).toEqual([{ thumb: OTHER_THUMB, bytes: STILL, created_by: 'm2' }]);
      expect(stills(sid(7))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(counts('m1')?.live_bytes).toBe(4 * 5000 + 2 * STILL);
      expect(counts('m2')?.live_bytes).toBe(5000 + 2 * STILL);
      expect(counts('*')?.live_bytes).toBe(5 * (5000 + STILL) - STILL);
      expect(daily('m1')?.uploads).toBe(8);
    });

    it('discards the still a refused write recorded for a stored file, with its bytes, however often it is repeated', async () => {
      files(1, 1, { createdBy: 'm2' });
      const wrong = upload('m1', sid(1));
      expect(await reserveStickerUpload(db, wrong)).toMatchObject({ reserved: true, state: 'ready', created: false });
      expect(counts('m1')?.live_bytes).toBe(STILL);
      await discardStickerUpload(db, { ...wrong, pending: true });
      expect(stills(sid(1))).toEqual([]);
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      // The stored file and its creator's total are untouched.
      // 已存储的文件及其创建者的累计数都不受影响。
      expect(fileRow(sid(1))).toEqual({ type: 'gif', width: 240, height: 240, bytes: 1000, animated: 1, state: 'ready' });
      expect(counts('m2')).toBeUndefined();
      // Repeated with fresh stills and with the same one, R2 refusing the original or the still in turn: no still row
      // is left and nothing stays charged.
      // 用新的静态缩略图和同一张静态缩略图反复进行，R2 轮流拒绝原始文件或静态缩略图：不留下任何静态缩略图记录，也没有任何计费留下。
      for (let i = 1; i <= 6; i += 1) {
        const again = upload('m1', sid(1), { thumb: i % 2 === 0 ? THUMB : `T${String(i).padStart(21, '0')}`, nowMs: NOW_MS + i });
        expect((await reserveStickerUpload(db, again)).reserved).toBe(true);
        await discardStickerUpload(db, { ...again, pending: i % 3 !== 0 });
      }
      expect(stills(sid(1))).toEqual([]);
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
      expect(daily('m1')?.uploads).toBe(7);
    });

    it('discards only the still, and leaves the pending row with its bytes to the sweep, when the original may be stored', async () => {
      const bucket = { delete: async () => undefined } as unknown as R2Bucket;
      // The original's put failed for another reason, or the still was refused for its checksum after the original was
      // stored: the still was never put, but the original may be there.
      // 原始文件的写入因别的原因失败，或者原始文件存好之后静态缩略图因校验不符被拒绝：静态缩略图从未写入，但原始文件可能已经存在。
      const own = upload('m1', sid(1));
      await reserveStickerUpload(db, own);
      await discardStickerUpload(db, { ...own, pending: false });
      expect(fileRow(sid(1))).toMatchObject({ state: 'pending', bytes: 5000 });
      expect(stills(sid(1))).toEqual([]);
      expect(counts('m1')?.live_bytes).toBe(5000);
      expect(counts('*')?.live_bytes).toBe(5000);
      // A retry with the same still is charged for it once more, and the sweep takes the rest off.
      // 用同一张静态缩略图重试时再为它计费一次，其余的由清理任务减去。
      expect(await reserveStickerUpload(db, upload('m1', sid(1), { nowMs: NOW_MS + 1 }))).toMatchObject({ reserved: true, created: false });
      expect(counts('m1')?.live_bytes).toBe(5000 + STILL);
      expect((await sweepStickers(db, bucket, new Date(NOW_MS + 2 * 60 * 60 * 1000))).deleted).toBe(1);
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('keeps a still row another request, another member or a collection names, and one of a blocked file, with its bytes', async () => {
      const holders = (i: number) => d1.rows<{ holders: number | null }>('SELECT holders FROM sticker_thumbs WHERE sticker_id = ?', sid(i))[0]?.holders;
      // Five stored files of 1000 bytes on the club's total, so the block below takes off what it should.
      // 五个 1000 字节的已存储文件计在全会的累计数上，下面的封禁因此减去的正是应当减去的字节数。
      files(1, 5, { createdBy: null });
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', ?)", 5 * 1000);
      // The same member's other request, a millisecond earlier, still holds the same still.
      // 同一位成员早一毫秒的另一次请求仍持有同一张静态缩略图。
      await reserveStickerUpload(db, upload('m1', sid(1), { nowMs: NOW_MS - 1 }));
      await reserveStickerUpload(db, upload('m1', sid(1)));
      // Another member recorded the same still for the same file first and still holds it.
      // 另一位成员先为同一文件记录了同一张静态缩略图，并且仍持有它。
      await reserveStickerUpload(db, upload('m2', sid(2)));
      await reserveStickerUpload(db, upload('m1', sid(2)));
      // A collection names the still: m2 added the file from a message that shows it.
      // 某个表情列表指向这张静态缩略图：m2 从显示它的消息中添加了这个文件。
      await reserveStickerUpload(db, upload('m1', sid(3)));
      expect(await addSticker(db, { memberId: 'm2', id: sid(3), thumb: THUMB, nowMs: NOW_MS, gate: gate(), countToken: crypto.randomUUID() })).toMatchObject({
        outcome: 'added',
      });
      // A blocked file: the block took the still's bytes off and deletes its row after the key.
      // 被封禁的文件：封禁已经减去了这张静态缩略图的字节数，并会在删除键之后删除它的记录。
      await reserveStickerUpload(db, upload('m1', sid(4)));
      await blockSticker(db, sid(4), ISO);
      expect(counts('m1')?.live_bytes).toBe(2 * STILL);
      for (const i of [1, 2, 3, 4]) await discardStickerUpload(db, { memberId: 'm1', id: sid(i), nowMs: NOW_MS, thumb: THUMB, pending: true });
      for (const [i, by] of [
        [1, 'm1'],
        [2, 'm2'],
        [3, 'm1'],
        [4, 'm1'],
      ] as const) {
        expect(stills(sid(i))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: by }]);
      }
      // The other holders keep theirs; a row nobody else holds that a grid shows or whose file is blocked is kept for good.
      // 其他持有者保留各自的持有；没有别人持有、但有表情格子显示或文件已被封禁的记录永久保留。
      expect([1, 2, 3, 4].map(holders)).toEqual([1, 1, null, null]);
      expect(counts('m1')?.live_bytes).toBe(2 * STILL);
      expect(counts('m2')?.live_bytes).toBe(STILL);
      expect(counts('*')?.live_bytes).toBe(4 * 1000 + 3 * STILL);
      // A request that recorded no still (the member had the sticker) removes none.
      // 没有记录静态缩略图的请求（成员已有这个表情）不删除任何静态缩略图。
      collect('m1', 5, 5);
      expect(await reserveStickerUpload(db, upload('m1', sid(5)))).toMatchObject({ reserved: true, mine: true });
      d1.rows('INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by) VALUES (?, ?, ?, ?, ?)', sid(5), OTHER_THUMB, ISO, STILL, 'm1');
      await discardStickerUpload(db, { memberId: 'm1', id: sid(5), nowMs: NOW_MS, thumb: null, pending: true });
      expect(stills(sid(5))).toHaveLength(1);
    });

    it('never takes a still row another upload holds, and keeps one for good once a commit or a failed write may have stored its still', async () => {
      const holders = (id: string) => d1.rows<{ holders: number | null }>('SELECT holders FROM sticker_thumbs WHERE sticker_id = ? AND thumb = ?', id, THUMB)[0]?.holders;
      files(1, 4, { createdBy: null });
      // m2's honest upload reserved after m1's wrong one recorded the same still, so it was charged nothing for it and
      // writes its key under m1's row, which it holds too.
      // m2 的正常上传在 m1 的错误上传记录了同一张静态缩略图之后才预留，因此没有为它计费，并在 m1 的记录之下写入键，它也持有这条记录。
      const wrong = upload('m1', sid(1));
      await reserveStickerUpload(db, wrong);
      expect(holders(sid(1))).toBe(1);
      expect(await reserveStickerUpload(db, upload('m2', sid(1), { nowMs: NOW_MS + 1 }))).toMatchObject({ reserved: true, stillRecorded: true });
      expect(holders(sid(1))).toBe(2);
      expect(counts('m2')).toBeUndefined();
      await discardStickerUpload(db, { ...wrong, pending: true });
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(holders(sid(1))).toBe(1);
      // Its commit records nothing more and charges nothing more: the still stays charged once, to the upload that
      // recorded it first, and is kept for good, even once no collection names it.
      // 它的提交不再记录任何内容，也不再计入任何字节：这张静态缩略图只计费一次，计在最先记录它的那次上传上，并永久保留，即使此后没有任何表情列表指向它。
      expect(await commit('m2', sid(1))).toMatchObject({ outcome: 'added', sticker: { thumb: THUMB } });
      expect(holders(sid(1))).toBeNull();
      await removeStickers(db, { memberId: 'm2', ids: [sid(1)], gate: gate() });
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(counts('m1')?.live_bytes).toBe(STILL);
      expect(counts('m2')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(STILL);
      // A commit that finds a row it never held (its own went with the file to the sweep) keeps it for good.
      // 发现一条自己从未持有的记录的提交（自己的记录已随文件一起被清理任务删除）把它设为永久保留。
      const before = upload('m1', sid(2));
      await reserveStickerUpload(db, before);
      expect(await commit('m2', sid(2))).toMatchObject({ outcome: 'added' });
      expect(holders(sid(2))).toBeNull();
      await discardStickerUpload(db, { ...before, pending: true });
      expect(stills(sid(2))).toHaveLength(1);
      // So does an upload whose write or commit failed after a put that may have stored the still.
      // 写入可能已存下静态缩略图、之后写入或提交失败的上传也是如此。
      const third = upload('m1', sid(3));
      await reserveStickerUpload(db, third);
      expect(await readStickerLeftovers(db, sid(3), THUMB)).toEqual({ gone: false, stillRecorded: true });
      expect(holders(sid(3))).toBeNull();
      await discardStickerUpload(db, { ...third, pending: true });
      expect(stills(sid(3))).toHaveLength(1);
      // One that wrote no still keeps nothing.
      // 没有写入静态缩略图的上传不保留任何记录。
      const fourth = upload('m1', sid(4));
      await reserveStickerUpload(db, fourth);
      expect(await readStickerLeftovers(db, sid(4), null)).toEqual({ gone: false, stillRecorded: false });
      expect(holders(sid(4))).toBe(1);
      await discardStickerUpload(db, { ...fourth, pending: true });
      expect(stills(sid(4))).toEqual([]);
      expect(counts('m1')?.live_bytes).toBe(3 * STILL);
      expect(counts('*')?.live_bytes).toBe(3 * STILL);
    });

    it('deletes a still row with the last hold when every upload that held it gave up, in either order, charging nobody', async () => {
      files(1, 3, { createdBy: 'm2' });
      // Two wrong hashes raced with the same still, from one member or from two: whichever gives up last takes the row
      // and the first recorder's charge, so a client cannot leave rows behind by racing them.
      // 两个错误哈希用同一张静态缩略图竞争，来自同一位成员或两位成员：最后放弃的那一个删除这条记录并退回最先记录者的计费，
      // 客户端因此无法靠让它们竞争留下记录。
      for (const [i, second, laterFirst] of [
        [1, 'm1', false],
        [2, 'm2', false],
        [3, 'm2', true],
      ] as const) {
        const first = upload('m1', sid(i));
        const other = upload(second, sid(i), { nowMs: NOW_MS + 1 });
        await reserveStickerUpload(db, first);
        await reserveStickerUpload(db, other);
        expect(stills(sid(i))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
        for (const gaveUp of laterFirst ? [other, first] : [first, other]) await discardStickerUpload(db, { ...gaveUp, pending: true });
        expect(stills(sid(i))).toEqual([]);
      }
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('m2')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('keeps the pending row a parallel upload of the same still relies on, so that upload can commit over it', async () => {
      const wrong = upload('m1', sid(1));
      expect(await reserveStickerUpload(db, wrong)).toMatchObject({ created: true });
      expect(await reserveStickerUpload(db, upload('m2', sid(1), { nowMs: NOW_MS + 1 }))).toMatchObject({ reserved: true, created: false, stillRecorded: true });
      await discardStickerUpload(db, { ...wrong, pending: true });
      expect(fileRow(sid(1))).toMatchObject({ state: 'pending' });
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(await commit('m2', sid(1))).toMatchObject({ outcome: 'added', sticker: { id: sid(1), thumb: THUMB } });
      expect(fileRow(sid(1))).toMatchObject({ state: 'ready' });
      expect(counts('m1')?.live_bytes).toBe(5000 + STILL);
      expect(counts('m2')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(5000 + STILL);
    });

    /** How many uploads may have written the original under a file's row (sticker_objects.reserves). */
    /** 可能在文件记录之下写入过原始文件的上传数量（sticker_objects.reserves）。 */
    const reserves = (id: string) => d1.rows<{ reserves: number }>('SELECT reserves FROM sticker_objects WHERE id = ?', id)[0]?.reserves;
    /** When the sweep next looks at a file (sticker_objects.sweep_at). */
    /** 清理任务下次检查某个文件的时间（sticker_objects.sweep_at）。 */
    const sweepAt = (id: string) => d1.rows<{ sweep_at: string | null }>('SELECT sweep_at FROM sticker_objects WHERE id = ?', id)[0]?.sweep_at;
    /** A bucket that records the keys the sweep deletes. */
    /** 记录清理任务删除的键的存储桶。 */
    const sweptBucket = (deleted: string[]) =>
      ({
        delete: async (keys: string[]) => {
          deleted.push(...keys);
        },
      }) as unknown as R2Bucket;
    const LATER = new Date(NOW_MS + 2 * 60 * 60 * 1000);

    it('leaves the pending row to the sweep once another upload reserved over it, even after that upload stored the original and gave up its hold', async () => {
      const deleted: string[] = [];
      // m2's honest upload reserves over the row m1's wrong hash wrote, stores the original under it and gives up its
      // hold: its still refused for its checksum (sid 1), or its original's put failed otherwise after it may have
      // landed (sid 2, refunded). Only then is m1's original refused for its checksum. The reserve counted m2 on the
      // row, so the row stays whatever m2 does after it, even when it is cut short before reading what is left.
      // m2 的正常上传在 m1 的错误哈希写入的记录之上预留，在它之下存下原始文件，然后放弃持有：它的静态缩略图因校验不符被拒绝（sid 1），
      // 或者原始文件的写入在可能已经落地之后因别的原因失败（sid 2，已退回额度）。此后 m1 的原始文件才因校验不符被拒绝。预留时已把 m2 计入这条记录，
      // 因此无论 m2 之后做什么，即使在读取剩下的内容之前就被中断，记录也会保留。
      for (const [i, refunded] of [
        [1, false],
        [2, true],
      ] as const) {
        const wrong = upload('m1', sid(i));
        expect(await reserveStickerUpload(db, wrong)).toMatchObject({ reserved: true, created: true });
        expect(reserves(sid(i))).toBe(1);
        const honest = upload('m2', sid(i), { thumb: OTHER_THUMB, nowMs: NOW_MS + 1 });
        expect(await reserveStickerUpload(db, honest)).toMatchObject({ reserved: true, state: 'pending', created: false });
        expect(reserves(sid(i))).toBe(2);
        if (refunded) await refundStickerUpload(db, honest);
        await discardStickerUpload(db, { ...honest, pending: false });
        await discardStickerUpload(db, { ...wrong, pending: true });
        // Neither still was ever written, so both went with their bytes; the row that names the stored original stays.
        // 两张静态缩略图都从未写入，因此都连同其字节数一起删除；指向已存原始文件的记录保留。
        expect(fileRow(sid(i))).toMatchObject({ state: 'pending', bytes: 5000 });
        expect(reserves(sid(i))).toBe(2);
        expect(stills(sid(i))).toEqual([]);
      }
      expect(counts('m1')?.live_bytes).toBe(2 * 5000);
      expect(counts('m2')?.live_bytes ?? 0).toBe(0);
      expect(counts('*')?.live_bytes).toBe(2 * 5000);
      expect(daily('m2')?.uploads).toBe(1);
      // The sweep deletes the original under every type and takes the bytes back off.
      // 清理任务按每种类型删除原始文件，并把字节数减回去。
      expect((await sweepStickers(db, sweptBucket(deleted), LATER)).deleted).toBe(2);
      expect(deleted).toEqual(expect.arrayContaining([...stickerFileKeys(sid(1), []), ...stickerFileKeys(sid(2), [])]));
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('leaves the pending row to the sweep when the same member reserved it twice in the same millisecond, whichever request is refused last', async () => {
      const deleted: string[] = [];
      // Both reserves carry the creator and the time R4 wrote, so R7 marks both as created. One request stores the
      // original and gives up its hold (its still refused for its checksum), then the other one's original is refused:
      // the request that wrote the row (sid 1), or the one that only reserved over it (sid 2).
      // 两次预留带有 R4 写入的同一个创建者和时间，因此 R7 把两者都标记为新建。一个请求存下原始文件后放弃持有（它的静态缩略图因校验不符被拒绝），
      // 然后另一个请求的原始文件被拒绝：它是写入这条记录的请求（sid 1），或者只是在它之上预留的请求（sid 2）。
      for (const [i, creatorLast] of [
        [1, true],
        [2, false],
      ] as const) {
        const first = upload('m1', sid(i));
        const second = upload('m1', sid(i), { thumb: OTHER_THUMB });
        expect(await reserveStickerUpload(db, first)).toMatchObject({ reserved: true, created: true });
        expect(await reserveStickerUpload(db, second)).toMatchObject({ reserved: true, created: true });
        expect(reserves(sid(i))).toBe(2);
        const [stored, refused] = creatorLast ? [second, first] : [first, second];
        await discardStickerUpload(db, { ...stored, pending: false });
        await discardStickerUpload(db, { ...refused, pending: true });
        expect(fileRow(sid(i))).toMatchObject({ state: 'pending', bytes: 5000 });
        expect(stills(sid(i))).toEqual([]);
      }
      // The file's bytes were charged once, by the reserve that wrote the row, and stay until the sweep.
      // 文件的字节数只由写入记录的那次预留计入一次，并保留到清理任务执行。
      expect(counts('m1')?.live_bytes).toBe(2 * 5000);
      expect(counts('*')?.live_bytes).toBe(2 * 5000);
      expect((await sweepStickers(db, sweptBucket(deleted), LATER)).deleted).toBe(2);
      expect(deleted).toEqual(expect.arrayContaining([...stickerFileKeys(sid(1), []), ...stickerFileKeys(sid(2), [])]));
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(0);
    });

    it('moves the sweep of every row a reserve passes over at least an hour off, keeping NULL, so the sweep leaves it to the upload in flight and collects it after the hour', async () => {
      const deleted: string[] = [];
      const HOUR_ON = new Date(NOW_MS + STICKER_PENDING_TTL_MS).toISOString();
      const WEEK_ON = new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString();
      // Stored files in nobody's collection: one due for the sweep (sid 1), one never swept (sid 2, sweep_at NULL) and
      // one the sweep looks at only in a week (sid 3); and the pending row of m1's unfinished upload, due in a minute
      // (sid 4).
      // 不在任何人表情列表中的已存文件：一个清理任务已到期（sid 1），一个永远不被清理（sid 2，sweep_at 为 NULL），一个清理任务一周后才检查（sid 3）；
      // 以及 m1 未完成的上传留下的 pending 记录，一分钟后到期（sid 4）。
      files(1, 3, { createdBy: null });
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', ?)", 3 * 1000);
      d1.rows('UPDATE sticker_objects SET sweep_at = NULL WHERE id = ?', sid(2));
      d1.rows('UPDATE sticker_objects SET sweep_at = ? WHERE id = ?', WEEK_ON, sid(3));
      expect(await reserveStickerUpload(db, upload('m1', sid(4), { nowMs: NOW_MS - STICKER_PENDING_TTL_MS + 60_000 }))).toMatchObject({ created: true });
      // m2 reserves over each: the due file and the pending row now wait an hour from this reserve, a NULL and a later
      // time stay, and only the pending row counts the reserve.
      // m2 在每个文件之上预留：到期的文件和 pending 记录现在要从这次预留起再等一小时，NULL 和更晚的时间保持不变，只有 pending 记录计入这次预留。
      for (const i of [1, 2, 3, 4]) expect(await reserveStickerUpload(db, upload('m2', sid(i), { thumb: OTHER_THUMB }))).toMatchObject({ reserved: true });
      expect([1, 2, 3, 4].map((i) => sweepAt(sid(i)))).toEqual([HOUR_ON, null, WEEK_ON, HOUR_ON]);
      expect([1, 2, 3, 4].map((i) => reserves(sid(i)))).toEqual([1, 1, 1, 2]);
      // Every run within that hour leaves them all to m2's upload.
      // 在这一小时之内的每次执行都把它们全部留给 m2 的上传。
      expect(await sweepStickers(db, sweptBucket(deleted), new Date(NOW_MS + STICKER_PENDING_TTL_MS - 1))).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
      expect(deleted).toEqual([]);
      // Once the hour is over with m2's upload unfinished, the sweep collects the due file and the pending row with every
      // key and their bytes; the NULL and the week stay.
      // 这一小时过去而 m2 的上传仍未完成时，清理任务删除到期的文件和 pending 记录，连同每个键及其字节数；NULL 和一周后的那个保留。
      expect(await sweepStickers(db, sweptBucket(deleted), new Date(NOW_MS + STICKER_PENDING_TTL_MS))).toEqual({ claimed: 2, kept: 0, deleted: 2, objects: 11 });
      expect(deleted).toEqual(expect.arrayContaining([...stickerFileKeys(sid(1), [OTHER_THUMB]), ...stickerFileKeys(sid(4), [THUMB, OTHER_THUMB])]));
      expect(d1.rows<{ id: string }>('SELECT id FROM sticker_objects ORDER BY id').map((row) => row.id)).toEqual([sid(2), sid(3)]);
      expect(counts('m1')?.live_bytes).toBe(0);
      expect(counts('m2')?.live_bytes).toBe(2 * STILL);
      expect(counts('*')?.live_bytes).toBe(2 * 1000 + 2 * STILL);
    });

    it('keeps the row an upload in flight reserved over, so a newer upload goes over it and a commit or a failed write finds every key it names', async () => {
      member('m3');
      const deleted: string[] = [];
      const OWN_THUMB = 'CcCcCcCcCcCcCcCcCcCcCc';
      // m3's wrong hash left a pending row of other bytes 59 minutes ago, due for the sweep in a minute. m2's honest
      // upload reserves over it now and stores the original and its still under it; the hourly run lands two minutes
      // later, then m1 uploads the same file. Before every reserve moved the sweep, that run claimed the row and deleted
      // the original m2 had stored, m1 wrote a new pending row, and m2's commit made that row ready while its original
      // was gone, or a failed write of m2 found no row and deleted what m1 had stored meanwhile.
      // m3 的错误哈希在 59 分钟前留下了一条别的字节的 pending 记录，一分钟后清理任务到期。m2 的正常上传现在在它之上预留，并在它之下存下原始文件和
      // 静态缩略图；两分钟后每小时一次的清理执行，然后 m1 上传同一个文件。在每次预留推迟清理时间之前，那次执行会认领这条记录并删除 m2 已存下的原始文件，
      // m1 写入新的 pending 记录，而 m2 的提交会在其原始文件已不存在时把那条记录变为 ready；或者 m2 失败的写入找不到记录，删除 m1 在此期间存下的内容。
      for (const [i, m2End] of [
        [1, 'commits'],
        [2, 'still fails'],
      ] as const) {
        const id = sid(i);
        const wrong = upload('m3', id, { fileBytes: 7000, thumb: OWN_THUMB, nowMs: NOW_MS - STICKER_PENDING_TTL_MS + 60_000 });
        expect(await reserveStickerUpload(db, wrong)).toMatchObject({ reserved: true, created: true });
        expect(await reserveStickerUpload(db, upload('m2', id))).toMatchObject({ reserved: true, state: 'pending', created: false });
        expect(await sweepStickers(db, sweptBucket(deleted), new Date(NOW_MS + 2 * 60_000))).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
        expect(await reserveStickerUpload(db, upload('m1', id, { thumb: OTHER_THUMB, nowMs: NOW_MS + 3 * 60_000 }))).toMatchObject({ reserved: true, state: 'pending', created: false });
        // One row all along, the one m3 wrote, which counted every later reserve; m3's refusal then takes only its still.
        // 始终只有一条记录，即 m3 写入的那条，它计入了之后的每次预留；m3 被拒绝后只删除它自己的静态缩略图。
        expect(d1.rows('SELECT created_by, reserves FROM sticker_objects WHERE id = ?', id)).toEqual([{ created_by: 'm3', reserves: 3 }]);
        await discardStickerUpload(db, { ...wrong, pending: true });
        expect(fileRow(id)).toMatchObject({ state: 'pending', bytes: 7000 });
        if (m2End === 'commits') {
          expect(await commit('m2', id)).toMatchObject({ outcome: 'added', sticker: { id, bytes: 5000, thumb: THUMB } });
        } else {
          // m2's still put failed otherwise after it may have landed: it finds the row it reserved over, so the route
          // deletes nothing.
          // m2 的静态缩略图写入在可能已经落地之后因别的原因失败：它找到的是自己预留时所基于的那条记录，因此接口什么也不删除。
          expect(await readStickerLeftovers(db, id, THUMB)).toEqual({ gone: false, stillRecorded: true });
        }
        expect(await commit('m1', id, OTHER_THUMB)).toMatchObject({ outcome: 'added', sticker: { id, bytes: 5000, thumb: OTHER_THUMB } });
        expect(fileRow(id)).toMatchObject({ state: 'ready', bytes: 5000 });
        expect(stills(id)).toEqual([
          { thumb: THUMB, bytes: STILL, created_by: 'm2' },
          { thumb: OTHER_THUMB, bytes: STILL, created_by: 'm1' },
        ]);
      }
      // No key was ever deleted, so each collection names a file and stills that are all stored. Every total equals the
      // bytes its rows record: each file is its verifying committer's, each still its recorder's.
      // 从未删除任何键，因此每个表情列表指向的文件和静态缩略图都仍然存在。每个累计数都等于其记录中的字节数：每个文件归校验它的提交者，
      // 每张静态缩略图归记录它的上传者。
      expect(deleted).toEqual([]);
      expect(collection('m1')).toEqual([sid(1), sid(2)]);
      expect(collection('m2')).toEqual([sid(1)]);
      expect(counts('m1')?.live_bytes).toBe(5000 + 2 * STILL);
      expect(counts('m2')?.live_bytes).toBe(5000 + 2 * STILL);
      expect(counts('m3')?.live_bytes).toBe(0);
      expect(counts('*')?.live_bytes).toBe(2 * 5000 + 4 * STILL);
      // Both files are in collections, so after the hour the sweep still takes nothing.
      // 两个文件都在表情列表中，因此这一小时之后清理任务仍然什么也不删除。
      expect(await sweepStickers(db, sweptBucket(deleted), LATER)).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
      expect(deleted).toEqual([]);
    });

    it('counts no reserve over a ready row but moves its sweep an hour off, nothing for the read of what is left, and neither for a refused reserve', async () => {
      files(1, 1, { createdBy: 'm2' });
      expect(await reserveStickerUpload(db, upload('m1', sid(1)))).toMatchObject({ reserved: true, state: 'ready' });
      expect(await readStickerLeftovers(db, sid(1), null)).toEqual({ gone: false, stillRecorded: false });
      expect(reserves(sid(1))).toBe(1);
      expect(sweepAt(sid(1))).toBe(new Date(NOW_MS + STICKER_PENDING_TTL_MS).toISOString());
      // A failed upload's read of what is left counts nothing on a pending row: its reserve wrote the row or counted it.
      // 失败的上传读取剩下的内容时不在 pending 记录上计入任何东西：它的预留写入了这条记录，或已把它计入其中。
      expect(await reserveStickerUpload(db, upload('m1', sid(2)))).toMatchObject({ created: true });
      expect(await readStickerLeftovers(db, sid(2), null)).toEqual({ gone: false, stillRecorded: false });
      expect(reserves(sid(2))).toBe(1);
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm2', STICKER_LIVE_BYTES_PER_MEMBER);
      const refused = upload('m2', sid(2), { fileBytes: 6000, nowMs: NOW_MS + 60_000 });
      expect(uploadRefusal(await reserveStickerUpload(db, refused), refused)).toBe('memberStorage');
      expect(reserves(sid(2))).toBe(1);
      expect(sweepAt(sid(2))).toBe(new Date(NOW_MS + STICKER_PENDING_TTL_MS).toISOString());
    });

    it('moves the sweep of a ready file nobody keeps an hour past each re-upload, never further, and collects it an hour after the last one', async () => {
      const deleted: string[] = [];
      // m2 stored the file, nobody keeps it and nobody ever sent it, and the sweep is due. m1 uploads it again and again
      // with bytes R2 refuses for their checksum, so it never enters a collection; m1 has three of the day's uploads left.
      // m2 存储了这个文件，没有人收藏，也从未有人发出，清理任务已到期。m1 一次又一次地重新上传它，字节都因校验不符被 R2 拒绝，
      // 因此它从未进入任何表情列表；m1 当天只剩三次上传。
      files(1, 1, { createdBy: 'm2' });
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('m2', 1000), ('*', 1000)");
      d1.rows('INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, ?, ?)', DAY, 'm1', STICKER_UPLOADS_PER_DAY - 3);
      const again = async (nowMs: number) => {
        const attempt = upload('m1', sid(1), { nowMs });
        const probe = await reserveStickerUpload(db, attempt);
        if (probe.reserved) await discardStickerUpload(db, { ...attempt, pending: false });
        return probe;
      };
      // Two in the same millisecond move the sweep an hour past it, not two hours, and the sweep leaves the due file alone.
      // 同一毫秒内的两次把清理时间推迟到它之后一小时，而不是两小时；清理任务也不碰这个已到期的文件。
      for (let i = 0; i < 2; i += 1) expect(await again(NOW_MS)).toMatchObject({ reserved: true, state: 'ready', created: false });
      expect(sweepAt(sid(1))).toBe(new Date(NOW_MS + STICKER_PENDING_TTL_MS).toISOString());
      expect(await sweepStickers(db, sweptBucket(deleted), new Date(NOW_MS + 30 * 60_000))).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
      // The third, 50 minutes on, moves it an hour past that one; the fourth is refused by m1's daily cap and moves nothing.
      // 50 分钟后的第三次把它推迟到那一次之后一小时；第四次被 m1 的每日上限拒绝，什么也不推迟。
      const last = NOW_MS + 50 * 60_000;
      expect(await again(last)).toMatchObject({ reserved: true });
      expect(uploadRefusal(await again(last + 60_000), upload('m1', sid(1)))).toBe('daily');
      expect(sweepAt(sid(1))).toBe(new Date(last + STICKER_PENDING_TTL_MS).toISOString());
      expect(daily('m1')?.uploads).toBe(STICKER_UPLOADS_PER_DAY);
      expect(await sweepStickers(db, sweptBucket(deleted), new Date(last + STICKER_PENDING_TTL_MS - 1))).toEqual({ claimed: 0, kept: 0, deleted: 0, objects: 0 });
      // Every refused still went with its bytes and the file never entered a collection, so an hour after the last
      // reserve the sweep collects it with every key and takes its creator's bytes back off.
      // 每张被拒绝的静态缩略图都连同其字节数一起删除，文件也从未进入任何表情列表，因此在最后一次预留一小时之后，清理任务删除它及其每个键，
      // 并把字节数从其创建者的累计数中减去。
      expect(stills(sid(1))).toEqual([]);
      expect(collection('m1')).toEqual([]);
      expect(deleted).toEqual([]);
      expect(await sweepStickers(db, sweptBucket(deleted), new Date(last + STICKER_PENDING_TTL_MS))).toEqual({ claimed: 1, kept: 0, deleted: 1, objects: 4 });
      expect(deleted).toEqual(stickerFileKeys(sid(1), []));
      expect(fileRow(sid(1))).toBeUndefined();
      for (const scope of ['m1', 'm2', '*']) expect(counts(scope)?.live_bytes ?? 0, scope).toBe(0);
    });

    it('keeps every total equal to the bytes its rows record, and the row that names a stored original, however three parallel uploads end', async () => {
      member('m3');
      const deleted: string[] = [];
      const swept: string[] = [];
      /** Each member's running total against the unblocked files and stills it created; the club's against all of them. */
      /** 每位成员的累计数与其创建的未封禁文件和静态缩略图相比；全会的累计数与全部相比。 */
      const balanced = () => {
        const recorded = d1.rows<{ scope: string | null; bytes: number }>(
          `SELECT scope, SUM(bytes) AS bytes FROM (
             SELECT created_by AS scope, bytes FROM sticker_objects WHERE blocked_at IS NULL
             UNION ALL
             SELECT t.created_by, t.bytes FROM sticker_thumbs t JOIN sticker_objects o ON o.id = t.sticker_id WHERE o.blocked_at IS NULL)
           GROUP BY scope`,
        );
        for (const scope of ['m1', 'm2', 'm3']) expect(counts(scope)?.live_bytes ?? 0, scope).toBe(recorded.find((row) => row.scope === scope)?.bytes ?? 0);
        expect(counts('*')?.live_bytes ?? 0, '*').toBe(recorded.reduce((sum, row) => sum + row.bytes, 0));
      };
      // m1 declares the file's hash for other bytes and writes the row (a). Then b, whose still R2 refuses for its checksum
      // once its original is stored (m2, or m1 again a millisecond later), and c, which stores the original and then
      // commits, has its still's put fail otherwise, or has its still refused like b (m3, with m1's still or one of its
      // own), reserve over the row. Their ends come in every order, each case on a day of its own so no daily cap refuses
      // a reserve.
      // m1 以文件的哈希声明别的字节并写入记录（a）。随后 b 和 c 在这条记录之上预留：b 的原始文件存好之后，静态缩略图因校验不符被 R2 拒绝
      // （m2，或晚一毫秒的 m1 本人）；c 存下原始文件之后提交，或者静态缩略图的写入因别的原因失败，或者静态缩略图像 b 一样被拒绝
      // （m3，使用 m1 的静态缩略图或自己的）。三者以每一种顺序结束，每种情况使用各自的日期，因此每日上限不会拒绝任何预留。
      const ORDERS = ['abc', 'acb', 'bac', 'bca', 'cab', 'cba'];
      const OWN_THUMB = 'CcCcCcCcCcCcCcCcCcCcCc';
      let n = 0;
      for (const cEnd of ['commits', 'still fails', 'still refused'] as const) {
        for (const [bMember, cThumb] of [
          ['m2', THUMB],
          ['m1', OWN_THUMB],
        ] as const) {
          for (const order of ORDERS) {
            n += 1;
            const id = sid(n);
            const on = () => ({ day: `day-${n}`, token: crypto.randomUUID() });
            const a = upload('m1', id, { fileBytes: 7000, gate: on() });
            const b = upload(bMember, id, { thumb: OTHER_THUMB, nowMs: NOW_MS + 1, gate: on() });
            const c = upload('m3', id, { thumb: cThumb, nowMs: NOW_MS + 2, gate: on() });
            expect(await reserveStickerUpload(db, a)).toMatchObject({ reserved: true, created: true });
            for (const other of [b, c]) expect(await reserveStickerUpload(db, other)).toMatchObject({ reserved: true, created: false });
            balanced();
            for (const end of order) {
              if (end === 'a') {
                await discardStickerUpload(db, { ...a, pending: true });
              } else if (end === 'b' || cEnd === 'still refused') {
                await discardStickerUpload(db, { ...(end === 'b' ? b : c), pending: false });
                await readStickerLeftovers(db, id, null);
              } else if (cEnd === 'commits') {
                expect(await commit('m3', id, cThumb)).toMatchObject({ outcome: 'added' });
              } else {
                await refundStickerUpload(db, c);
                expect(await readStickerLeftovers(db, id, cThumb)).toEqual({ gone: false, stillRecorded: true });
              }
              balanced();
            }
            // b and c stored the original, so the row that names it stays: ready with c's verified bytes once c committed,
            // else pending for the sweep. Only a still that was or may have been written stays recorded.
            // b 和 c 都存下了原始文件，因此指向它的记录保留：c 提交之后为 ready，带有 c 校验过的字节数；否则为 pending，留给清理任务。
            // 只有已经写入或可能已经写入的静态缩略图仍有记录。
            expect(fileRow(id)).toMatchObject(cEnd === 'commits' ? { state: 'ready', bytes: 5000 } : { state: 'pending', bytes: 7000 });
            expect(stills(id).map((still) => still.thumb)).toEqual(cEnd === 'still refused' ? [] : [cThumb]);
            if (cEnd !== 'commits') swept.push(...stickerFileKeys(id, cEnd === 'still refused' ? [] : [cThumb]));
          }
        }
      }
      // The sweep takes the 24 pending rows with the original under every type and each kept still, and every total still
      // equals what the rows left record: the 12 files c committed and c's own stills.
      // 清理任务删除 24 条 pending 记录，连同每种类型下的原始文件和每张保留的静态缩略图；每个累计数仍与剩下的记录相符：c 提交的 12 个文件和 c 自己的静态缩略图。
      expect((await sweepStickers(db, sweptBucket(deleted), LATER)).deleted).toBe(24);
      expect(deleted).toEqual(expect.arrayContaining(swept));
      balanced();
      expect(counts('m3')?.live_bytes).toBe(12 * 5000 + 6 * STILL);
    });

    it('checks a discarded still against every collection with one seek, however many members have the file', async () => {
      files(1, 1, { createdBy: null });
      for (let i = 0; i < 40; i += 1) {
        member(`c${i}`);
        collect(`c${i}`, 1, 1);
      }
      const wrong = upload('m1', sid(1), { thumb: OTHER_THUMB });
      await reserveStickerUpload(db, wrong);
      d1.statements.length = 0;
      await discardStickerUpload(db, { ...wrong, pending: true });
      expect(stills(sid(1))).toEqual([]);
      for (const statement of d1.statements.filter((s) => s.sql.includes('m.thumb = ?2'))) {
        const plan = d1.explain(statement).join('\n');
        expect(plan).toMatch(/SEARCH m USING COVERING INDEX member_stickers_sticker \(sticker_id=\? AND thumb=\?\)/);
        expect(plan).not.toMatch(/SCAN/);
      }
      expect(d1.statements.filter((s) => s.sql.includes('m.thumb = ?2'))).toHaveLength(2);
    });

    it('names each cap that refused, in order, and charges nothing', async () => {
      files(1, 1, { blocked: true });
      files(2, 2, { state: 'deleting' });
      const refused = async (u: StickerUpload) => {
        const probe = await reserveStickerUpload(db, u);
        expect(probe.reserved).toBe(false);
        return uploadRefusal(probe, u);
      };
      expect(await refused(upload('m1', sid(1)))).toBe('blocked');
      expect(await refused(upload('m1', sid(2)))).toBe('unavailable');
      d1.rows('INSERT INTO sticker_counts (scope, items) VALUES (?, ?)', 'm1', STICKERS_PER_MEMBER_MAX);
      expect(await refused(upload('m1', sid(3)))).toBe('full');
      d1.rows('UPDATE sticker_counts SET items = 0 WHERE scope = ?', 'm1');
      d1.rows('INSERT INTO sticker_daily (day, scope, uploads) VALUES (?, ?, ?)', DAY, 'm1', STICKER_UPLOADS_PER_DAY);
      expect(await refused(upload('m1', sid(3)))).toBe('daily');
      d1.rows("INSERT INTO sticker_daily (day, scope, upload_bytes) VALUES (?, '*', ?)", DAY, STICKER_CLUB_UPLOAD_BYTES_PER_DAY - 5999);
      expect(await refused(upload('m2', sid(3)))).toBe('clubLimit');
      d1.rows("UPDATE sticker_daily SET upload_bytes = 0 WHERE day = ? AND scope = '*'", DAY);
      d1.rows('INSERT INTO sticker_counts (scope, live_bytes) VALUES (?, ?)', 'm2', STICKER_LIVE_BYTES_PER_MEMBER - 4999);
      expect(await refused(upload('m2', sid(3)))).toBe('memberStorage');
      d1.rows('UPDATE sticker_counts SET live_bytes = 0 WHERE scope = ?', 'm2');
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', ?)", STICKER_CLUB_LIVE_BYTES - 4999);
      expect(await refused(upload('m2', sid(3)))).toBe('clubStorage');
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_objects WHERE id = ?', sid(3))[0]).toEqual({ n: 0 });
      expect(d1.rows('SELECT COUNT(*) AS n FROM sticker_thumbs')[0]).toEqual({ n: 0 });
      expect(daily('m2')).toBeUndefined();
      expect(daily('*')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      // A file already stored needs storage for the still alone, so the same totals let it through.
      // 已存储的文件只需要为静态缩略图留出存储空间，因此同样的累计数下它可以通过。
      files(3, 3, { createdBy: 'm1' });
      expect((await reserveStickerUpload(db, upload('m2', sid(3)))).reserved).toBe(true);
    });

    it('refunds the day on both rows and leaves the pending row and the recorded still, with their bytes, for the sweep', async () => {
      const u = upload('m1', sid(1));
      await reserveStickerUpload(db, u);
      await refundStickerUpload(db, u);
      expect(daily('m1')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      expect(daily('*')).toMatchObject({ uploads: 0, upload_bytes: 0 });
      expect(d1.rows('SELECT state FROM sticker_objects WHERE id = ?', sid(1))).toEqual([{ state: 'pending' }]);
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
      expect(counts('m1')?.live_bytes).toBe(5000 + STILL);
    });

    it('commits nothing into a collection for a file blocked between reserve and commit', async () => {
      await reserveStickerUpload(db, upload('m1', sid(1)));
      d1.rows('UPDATE sticker_objects SET blocked_at = ? WHERE id = ?', ISO, sid(1));
      expect(await commit('m1', sid(1))).toMatchObject({ outcome: 'refused', file: 'blocked' });
      expect(collection('m1')).toEqual([]);
      // The still the reserve recorded stays named, for the block to delete.
      // 预留时记录的静态缩略图仍有记录，留给封禁删除。
      expect(stills(sid(1))).toEqual([{ thumb: THUMB, bytes: STILL, created_by: 'm1' }]);
    });
  });

  describe('blockSticker', () => {
    it('blocks once, takes the file out of every collection and its bytes and its stills’ off the totals, and reads every still', async () => {
      files(1, 2, { bytes: 4000 });
      collect('m1', 1, 2);
      collect('m2', 1, 1);
      // Stills of the blocked file by its creator and by another member, and one of the other file that must stay.
      // 被封禁文件的静态缩略图，分别由其创建者和另一位成员上传；另一个文件的一张静态缩略图必须保留。
      const still = (id: string, thumb: string, bytes: number, createdBy: string) =>
        d1.rows('INSERT INTO sticker_thumbs (sticker_id, thumb, created_at, bytes, created_by) VALUES (?, ?, ?, ?, ?)', id, thumb, ISO, bytes, createdBy);
      still(sid(1), THUMB, 300, 'm1');
      still(sid(1), 'ZzZzZzZzZzZzZzZzZzZzZz', 200, 'm2');
      still(sid(2), THUMB, 50, 'm1');
      d1.rows("INSERT INTO sticker_counts (scope, live_bytes) VALUES ('*', 8550)");
      d1.rows('UPDATE sticker_counts SET live_bytes = 8350 WHERE scope = ?', 'm1');
      d1.rows('UPDATE sticker_counts SET live_bytes = 200 WHERE scope = ?', 'm2');
      d1.statements.length = 0;
      const read = await blockSticker(db, sid(1), ISO);
      expect(read?.type).toBe('gif');
      expect([...(read?.thumbs ?? [])].sort()).toEqual([THUMB, 'ZzZzZzZzZzZzZzZzZzZzZz'].sort());
      expect(collection('m1')).toEqual([sid(2)]);
      expect(collection('m2')).toEqual([]);
      expect(counts('m1')).toMatchObject({ items: 1, version: 2, live_bytes: 4050 });
      expect(counts('m2')).toMatchObject({ items: 0, version: 2, live_bytes: 0 });
      expect(counts('*')?.live_bytes).toBe(4050);
      // The sums read the file and its stills by primary key and the totals by theirs.
      // 求和按主键读取文件及其静态缩略图，再按主键读取累计数。
      const totals = d1.statements.find((statement) => statement.sql.includes('WITH gone'));
      expect(totals).toBeDefined();
      const plan = d1.explain(totals!).join('\n');
      expect(plan).toMatch(/sqlite_autoindex_sticker_thumbs_1 \(sticker_id=\?\)/);
      expect(plan).not.toMatch(/SCAN (sticker_objects|sticker_thumbs|sticker_counts)\b/);
      // A repeat keeps the first time and takes nothing off again.
      // 重复封禁保留第一次的时间，也不会再次减去。
      expect(await blockSticker(db, sid(1), '2026-10-27T00:00:00.000Z')).not.toBeNull();
      expect(d1.rows('SELECT blocked_at FROM sticker_objects WHERE id = ?', sid(1))).toEqual([{ blocked_at: ISO }]);
      expect(counts('m1')?.live_bytes).toBe(4050);
      expect(counts('*')?.live_bytes).toBe(4050);
      expect(await blockSticker(db, sid(99), ISO)).toBeNull();
    });
  });

  describe('stickerFileKeys', () => {
    it('names the original under every type, so one written over a row that records another type is never missed, then each valid still', () => {
      expect(stickerFileKeys(sid(1), [THUMB, 'short'])).toEqual([
        `sticker/${sid(1)}.gif`,
        `sticker/${sid(1)}.png`,
        `sticker/${sid(1)}.webp`,
        `sticker/${sid(1)}.jpeg`,
        `sticker/${sid(1)}-t-${THUMB}`,
      ]);
    });
  });
});
