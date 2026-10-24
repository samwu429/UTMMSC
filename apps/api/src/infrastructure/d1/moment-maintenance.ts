import type { Env } from '../../env';
import { isMissingSchemaError } from './channels';

/** An upload no post has used after this long is abandoned: the composer publishes within minutes. */
/** 上传超过这么久仍没有动态使用，就视为已放弃：编辑器通常几分钟内就会发表。 */
export const MOMENT_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Rows of each kind (used, unused) one run looks at, so the objects it deletes fit in one bucket.delete call. */
/** 每次执行查看的每类记录数（被使用的、未被使用的），这样要删除的对象一次 bucket.delete 调用就能删完。 */
export const MOMENT_SWEEP_BATCH = 100;
/**
 * Rows put back per statement when the bucket refuses. D1 binds at most 100 parameters per statement, and each
 * row binds three (key, member, time).
 * 存储桶拒绝删除时每条语句放回的记录数。D1 每条语句最多绑定 100 个参数，每条记录绑定三个（键、成员、时间）。
 */
const RESTORE_CHUNK = 33;

export interface MomentUploadSweep {
  /** Abandoned upload rows looked at in this run. */
  /** 本次执行查看的已放弃上传记录数。 */
  checked: number;
  /** Objects deleted from R2 because no post uses them. */
  /** 因没有动态使用而从 R2 删除的对象数。 */
  deleted: number;
  /** Keys a post does use, whose rows were dropped and whose objects stay. */
  /** 有动态在使用的键：删除其记录，保留其对象。 */
  kept: number;
}

interface ClaimedUpload {
  object_key: string;
  member_id: string;
  created_at: string;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/** The oldest MOMENT_SWEEP_BATCH rows older than ?1 (bound with ?2 = MOMENT_SWEEP_BATCH). Uses moment_uploads_created. */
/** 早于 ?1 的最早 MOMENT_SWEEP_BATCH 条记录（?2 绑定为 MOMENT_SWEEP_BATCH）。使用 moment_uploads_created 索引。 */
const STALE = 'object_key IN (SELECT object_key FROM moment_uploads WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)';

/** The row's key is some post_media row's file or preview. Uses post_media_object and post_media_preview. */
/** 这条记录的键是某条 post_media 记录的原文件或预览图。使用 post_media_object 和 post_media_preview 索引。 */
const IN_USE = `(EXISTS (SELECT 1 FROM post_media pm WHERE pm.object_key = moment_uploads.object_key)
  OR EXISTS (SELECT 1 FROM post_media pm WHERE pm.preview_key = moment_uploads.object_key))`;

/** Puts claimed rows back as they were, so the next run tries their objects again. Skips members deleted meanwhile. */
/** 把认领的记录原样放回，下次执行时再次尝试删除其对象。跳过期间已删除的成员。 */
async function restoreUploads(db: D1Database, rows: readonly ClaimedUpload[]): Promise<void> {
  await db.batch(
    chunks(rows, RESTORE_CHUNK).map((chunk) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO moment_uploads (object_key, member_id, created_at)
           SELECT column1, column2, column3 FROM (VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')})
           WHERE column2 IN (SELECT id FROM members)`,
        )
        .bind(...chunk.flatMap((row) => [row.object_key, row.member_id, row.created_at])),
    ),
  );
}

/**
 * One pass over uploads older than MOMENT_UPLOAD_TTL_MS, oldest first, at most MOMENT_SWEEP_BATCH used and
 * MOMENT_SWEEP_BATCH unused rows. Rows whose key a post uses as its file or its preview are dropped and their
 * objects stay. Every other row is claimed by deleting it before its object goes, in the same statement that
 * checks no post uses it; a publish then finds the row gone and stores nothing (momentPublishWrites), so no post
 * can point at a deleted object. The claimed objects go in one bucket.delete call, and when it fails the rows
 * are put back, so the next run tries again.
 * 对超过 MOMENT_UPLOAD_TTL_MS 的上传记录做一次清理，最早的优先，被使用的和未被使用的各最多 MOMENT_SWEEP_BATCH 条。
 * 键被某条动态用作原文件或预览图的记录直接删除，保留其对象。其余记录在删除对象之前先被认领：在核对没有动态使用它的同一条语句中删除记录；
 * 之后的发表会发现记录已不存在而什么也不保存（momentPublishWrites），因此不会有动态指向已删除的对象。认领的对象放在一次 bucket.delete
 * 调用中删除；调用失败时放回这些记录，下次执行会重试。
 */
export async function sweepMomentUploads(db: D1Database, bucket: R2Bucket, now: Date = new Date()): Promise<MomentUploadSweep> {
  const cutoff = new Date(now.getTime() - MOMENT_UPLOAD_TTL_MS).toISOString();
  // Used rows go first, so they never fill the window the claim looks at.
  // 先删除被使用的记录，它们就不会占满认领时查看的范围。
  const [used, claimed] = await db.batch([
    db.prepare(`DELETE FROM moment_uploads WHERE ${STALE} AND ${IN_USE} RETURNING object_key`).bind(cutoff, MOMENT_SWEEP_BATCH),
    db.prepare(`DELETE FROM moment_uploads WHERE ${STALE} AND NOT ${IN_USE} RETURNING object_key, member_id, created_at`).bind(cutoff, MOMENT_SWEEP_BATCH),
  ]);
  const kept = (used?.results ?? []).length;
  const orphans = (claimed?.results ?? []) as ClaimedUpload[];
  if (orphans.length > 0) {
    try {
      await bucket.delete(orphans.map((row) => row.object_key));
    } catch (err) {
      await restoreUploads(db, orphans);
      throw err;
    }
  }
  return { checked: kept + orphans.length, deleted: orphans.length, kept };
}

/**
 * The cron's moments housekeeping. Without a bucket nothing was ever uploaded, and before migration 0016 there
 * is no table yet; both do nothing. Never throws.
 * 定时任务中好友动态的整理工作。没有存储桶时从未上传过文件，迁移 0016 之前还没有这张表；两种情况都什么也不做。从不抛出异常。
 */
export async function runMomentsMaintenance(env: Env, now: Date = new Date()): Promise<void> {
  if (!env.FILES) return;
  try {
    const sweep = await sweepMomentUploads(env.DB, env.FILES, now);
    if (sweep.deleted > 0) console.log(`moments: deleted ${sweep.deleted} unused uploads`);
  } catch (err) {
    if (!isMissingSchemaError(err)) console.error('moments: upload sweep failed', err instanceof Error ? err.message : String(err));
  }
}
