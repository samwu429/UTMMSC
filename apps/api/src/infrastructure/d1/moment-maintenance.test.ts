import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import { MOMENT_SWEEP_BATCH, runMomentsMaintenance, sweepMomentUploads } from './moment-maintenance';
import { momentPublishWrites } from './moments';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/** A bucket that records each delete call, or fails every one; `during` runs inside the call, before it settles. */
/** 记录每次删除调用的存储桶，或者让每次删除都失败；`during` 在调用之中、结束之前执行。 */
function fakeBucket(options: { fail?: boolean; during?: () => Promise<void> } = {}) {
  const deletes: string[][] = [];
  const bucket = {
    delete: async (keys: string | string[]) => {
      await options.during?.();
      if (options.fail) throw new Error('R2 unavailable');
      deletes.push(Array.isArray(keys) ? [...keys] : [keys]);
    },
  };
  return { bucket: bucket as unknown as R2Bucket, deletes };
}

const NOW = new Date('2026-10-24T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const sorted = (calls: string[][]) => calls.map((keys) => [...keys].sort());

describe.skipIf(!sqlite)('sweepMomentUploads on the real schema', () => {
  let d1: SqliteD1;
  let db: D1Database;

  function upload(key: string, createdAt: string, memberId = 'm1') {
    d1.rows('INSERT INTO moment_uploads (object_key, member_id, created_at) VALUES (?, ?, ?)', key, memberId, createdAt);
  }

  function attach(id: string, objectKey: string, previewKey: string | null) {
    d1.rows(
      `INSERT INTO post_media (id, post_id, object_key, content_type, kind, sort_order, created_at, preview_key)
       VALUES (?, 'p1', ?, 'image/jpeg', 'image', 0, ?, ?)`,
      id,
      objectKey,
      ago(HOUR),
      previewKey,
    );
  }

  function uploadRows(): { object_key: string; member_id: string; created_at: string }[] {
    return d1.rows('SELECT object_key, member_id, created_at FROM moment_uploads ORDER BY object_key');
  }

  const uploadKeys = () => uploadRows().map((row) => row.object_key);

  /** A publish of one photo by m1, as POST /moments/posts writes it; true when it was stored. */
  /** 按 POST /moments/posts 的写法由 m1 发表一张照片；保存成功时为 true。 */
  async function publish(postId: string, key: string): Promise<boolean> {
    const ts = new Date().toISOString();
    const writes = momentPublishWrites(
      db,
      db.prepare("INSERT INTO posts (id, member_id, body, created_at) VALUES (?, 'm1', '', ?)").bind(postId, ts),
      'm1',
      postId,
      [{ key, contentType: 'image/jpeg', kind: 'image' }],
      ts,
    );
    return !writes.refused(await db.batch(writes.statements));
  }

  beforeEach(() => {
    d1 = createSqliteD1();
    db = d1.db;
    for (const id of ['m1', 'm2']) {
      d1.rows(
        `INSERT INTO members (id, email, display_name, password_hash, role, enrollment_status, graduation_year, created_at, updated_at)
         VALUES (?, ?, 'A', 'x', 'student', 'student', 2026, ?, ?)`,
        id,
        `${id}@mail.utoronto.ca`,
        ago(HOUR),
        ago(HOUR),
      );
    }
    d1.rows("INSERT INTO posts (id, member_id, body, created_at) VALUES ('p1', 'm1', '', ?)", ago(HOUR));
  });

  afterEach(() => d1?.close());

  it('deletes abandoned objects in one call and drops their rows', async () => {
    upload('moments/m1/a.jpg', ago(25 * HOUR));
    upload('moments/m1/b.jpg', ago(48 * HOUR));
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 2, deleted: 2, kept: 0 });
    expect(sorted(deletes)).toEqual([['moments/m1/a.jpg', 'moments/m1/b.jpg']]);
    expect(uploadKeys()).toEqual([]);
  });

  it('never deletes a key a post uses as its file or its preview', async () => {
    upload('moments/m1/file.jpg', ago(30 * HOUR));
    upload('moments/m1/preview.jpg', ago(30 * HOUR));
    upload('moments/m1/orphan.jpg', ago(30 * HOUR));
    attach('pm1', 'moments/m1/file.jpg', 'moments/m1/preview.jpg');
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 3, deleted: 1, kept: 2 });
    expect(deletes).toEqual([['moments/m1/orphan.jpg']]);
    expect(uploadKeys()).toEqual([]);
  });

  it('leaves uploads younger than a day alone', async () => {
    upload('moments/m1/fresh.jpg', ago(23 * HOUR));
    upload('moments/m1/edge.jpg', ago(24 * HOUR));
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 0, deleted: 0, kept: 0 });
    expect(deletes).toEqual([]);
    expect(uploadKeys()).toEqual(['moments/m1/edge.jpg', 'moments/m1/fresh.jpg']);
  });

  it('takes at most one batch per run, oldest first, in one bucket call', async () => {
    for (let i = 0; i < MOMENT_SWEEP_BATCH + 20; i += 1) upload(`moments/m1/${String(i).padStart(3, '0')}.jpg`, ago((200 - i) * HOUR));
    const { bucket, deletes } = fakeBucket();
    const sweep = await sweepMomentUploads(db, bucket, NOW);
    expect(sweep).toEqual({ checked: MOMENT_SWEEP_BATCH, deleted: MOMENT_SWEEP_BATCH, kept: 0 });
    expect(deletes).toHaveLength(1);
    expect(sorted(deletes)[0]).toEqual(Array.from({ length: MOMENT_SWEEP_BATCH }, (_, i) => `moments/m1/${String(i).padStart(3, '0')}.jpg`));
    expect(uploadKeys()).toHaveLength(20);
    expect(uploadKeys()[0]).toBe(`moments/m1/${MOMENT_SWEEP_BATCH}.jpg`);
  });

  it('drops used rows in the same run, so a full window of them never stalls the claim', async () => {
    for (let i = 0; i < MOMENT_SWEEP_BATCH; i += 1) {
      const key = `moments/m1/used${String(i).padStart(3, '0')}.jpg`;
      upload(key, ago((300 - i) * HOUR));
      attach(`pm${i}`, key, null);
    }
    upload('moments/m1/orphan.jpg', ago(30 * HOUR));
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: MOMENT_SWEEP_BATCH + 1, deleted: 1, kept: MOMENT_SWEEP_BATCH });
    expect(deletes).toEqual([['moments/m1/orphan.jpg']]);
    expect(uploadKeys()).toEqual([]);
  });

  it('claims each row before its object goes, so a publish meanwhile stores nothing', async () => {
    upload('moments/m1/late.jpg', ago(30 * HOUR));
    let stored: boolean | null = null;
    const { bucket, deletes } = fakeBucket({
      during: async () => {
        stored = await publish('p_late', 'moments/m1/late.jpg');
      },
    });
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 1, deleted: 1, kept: 0 });
    expect(stored).toBe(false);
    expect(deletes).toEqual([['moments/m1/late.jpg']]);
    expect(d1.rows("SELECT COUNT(*) AS n FROM posts WHERE id = 'p_late'")).toEqual([{ n: 0 }]);
    expect(d1.rows("SELECT COUNT(*) AS n FROM post_media WHERE object_key = 'moments/m1/late.jpg'")).toEqual([{ n: 0 }]);
  });

  it('leaves an object a publish took first, even an old one', async () => {
    upload('moments/m1/kept.jpg', ago(30 * HOUR));
    expect(await publish('p_kept', 'moments/m1/kept.jpg')).toBe(true);
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 0, deleted: 0, kept: 0 });
    expect(deletes).toEqual([]);
    expect(d1.rows("SELECT post_id FROM post_media WHERE object_key = 'moments/m1/kept.jpg'")).toEqual([{ post_id: 'p_kept' }]);
  });

  it('puts the claimed rows back as they were when the bucket refuses, so the next run tries again', async () => {
    upload('moments/m1/a.jpg', ago(30 * HOUR));
    upload('moments/m2/b.jpg', ago(40 * HOUR), 'm2');
    const before = uploadRows();
    const { bucket } = fakeBucket({ fail: true });
    await expect(sweepMomentUploads(db, bucket, NOW)).rejects.toThrow('R2 unavailable');
    expect(uploadRows()).toEqual(before);

    const retry = fakeBucket();
    expect(await sweepMomentUploads(db, retry.bucket, NOW)).toEqual({ checked: 2, deleted: 2, kept: 0 });
    expect(sorted(retry.deletes)).toEqual([['moments/m1/a.jpg', 'moments/m2/b.jpg']]);
  });

  it('does not put back the rows of a member deleted while the bucket refused', async () => {
    upload('moments/m1/a.jpg', ago(30 * HOUR));
    upload('moments/m2/b.jpg', ago(40 * HOUR), 'm2');
    const { bucket } = fakeBucket({
      fail: true,
      during: async () => {
        d1.rows("DELETE FROM members WHERE id = 'm2'");
      },
    });
    await expect(sweepMomentUploads(db, bucket, NOW)).rejects.toThrow('R2 unavailable');
    expect(uploadKeys()).toEqual(['moments/m1/a.jpg']);
  });

  it('asks the bucket nothing when only used keys are left', async () => {
    upload('moments/m1/file.jpg', ago(30 * HOUR));
    attach('pm1', 'moments/m1/file.jpg', null);
    const { bucket, deletes } = fakeBucket();
    expect(await sweepMomentUploads(db, bucket, NOW)).toEqual({ checked: 1, deleted: 0, kept: 1 });
    expect(deletes).toEqual([]);
    expect(uploadKeys()).toEqual([]);
  });

  it('uses the created, object and preview indexes in both statements', async () => {
    d1.statements.length = 0;
    await sweepMomentUploads(db, fakeBucket().bucket, NOW);
    expect(d1.statements).toHaveLength(2);
    for (const statement of d1.statements) {
      const plan = d1.explain(statement).join('\n');
      expect(plan).toMatch(/moment_uploads_created/);
      expect(plan).toMatch(/post_media_object/);
      expect(plan).toMatch(/post_media_preview/);
      expect(plan).not.toMatch(/SCAN (moment_uploads|post_media|pm)\b/);
    }
  });
});

describe('runMomentsMaintenance', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function failingDb(message: string): D1Database {
    const fail = async () => {
      throw new Error(message);
    };
    const statement = { bind: () => statement, all: fail, run: fail, first: fail };
    return { prepare: () => statement, batch: fail } as unknown as D1Database;
  }

  it('does nothing without a bucket', async () => {
    const env = { DB: failingDb('should not be asked') } as unknown as Env;
    await runMomentsMaintenance(env, NOW);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('stays quiet before migration 0016', async () => {
    const env = { DB: failingDb('D1_ERROR: no such table: moment_uploads: SQLITE_ERROR'), FILES: fakeBucket().bucket } as unknown as Env;
    await expect(runMomentsMaintenance(env, NOW)).resolves.toBeUndefined();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs any other failure instead of throwing', async () => {
    const env = { DB: failingDb('D1_ERROR: database is locked'), FILES: fakeBucket().bucket } as unknown as Env;
    await expect(runMomentsMaintenance(env, NOW)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('moments: upload sweep failed', 'D1_ERROR: database is locked');
  });
});
