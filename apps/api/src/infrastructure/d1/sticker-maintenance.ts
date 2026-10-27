import { stickerDay, STICKER_UNSENT_TTL_MS } from '@utmmsc/shared';
import type { Env } from '../../env';
import { isMissingSchemaError } from './channels';
import { parseThumbs, stickerFileKeys } from './stickers';

/**
 * The hourly sticker sweep (cron 17 * * * *, its own invocation). It looks only at files nobody has sent and nobody
 * blocked whose sweep_at has passed: an upload that never finished (pending, after an hour) and a stored file in
 * nobody's collection (ready, after a week) are deleted with every object; a stored file still in a collection gets
 * another week. A file is claimed (state deleting) in the same statement that checks it is unsent and in no
 * collection, and add, upload and the room refuse deleting files, so a claimed file can never gain a reference before
 * it goes. Every upload's reserve moves the file's sweep_at to at least an hour after it (reserveStickerUpload, R4),
 * so the sweep never claims a file an upload in flight reserved over: that upload's writes, commit and cleanup all end
 * well inside that hour. Nothing else deletes a sticker object, except a block.
 * 每小时一次的表情清理（定时任务 17 * * * *，独立的一次调用）。它只查看没有人发送过、没有被封禁且 sweep_at 已到的文件：一直没有完成的上传
 * （pending，一小时后）和不在任何人表情列表中的已存文件（ready，一周后）连同所有对象一起删除；仍在某人列表中的已存文件再延后一周。
 * 文件在核对它从未发出、也不在任何列表中的同一条语句里被认领（state 变为 deleting），而添加、上传和房间都拒绝 deleting 的文件，
 * 因此被认领的文件在删除之前不可能获得新的引用。每次上传的预留都把文件的 sweep_at 至少推迟到预留之后一小时（reserveStickerUpload，R4），
 * 因此清理任务永远不会认领正在进行的上传在其之上预留的文件：那次上传的写入、提交和清理都远在这一小时之内结束。除了封禁，没有别的途径会删除表情对象。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Files one run looks at, oldest sweep_at first. */
/** 每次执行查看的文件数，sweep_at 最早的优先。 */
export const STICKER_SWEEP_BATCH = 50;
/** Keys one R2 delete call takes; stills beyond it wait for the next run. */
/** 一次 R2 删除调用最多接受的键数；超出的静态缩略图留到下次执行。 */
export const STICKER_SWEEP_KEYS_MAX = 1000;
/** Daily count rows older than this are deleted. */
/** 早于这个时间的每日计数记录会被删除。 */
export const STICKER_DAILY_KEEP_MS = 2 * DAY_MS;

export interface StickerSweep {
  /** Files claimed for deletion in this run, including claims an earlier run left. */
  /** 本次执行认领待删除的文件数，包括之前的执行留下的认领。 */
  claimed: number;
  /** Stored files still in a collection, given another week. */
  /** 仍在某人表情列表中、再延后一周的已存文件数。 */
  kept: number;
  /** Files deleted with all their objects. */
  /** 连同所有对象一起删除的文件数。 */
  deleted: number;
  /** R2 keys deleted: the original under every type (stickerFileKeys) and each still. */
  /** 删除的 R2 键数：每种类型下的原始文件（stickerFileKeys）和每张静态缩略图。 */
  objects: number;
}

/** The window one run looks at (?1 now, ?2 STICKER_SWEEP_BATCH). Uses sticker_objects_sweep. */
/** 每次执行查看的范围（?1 为现在，?2 为 STICKER_SWEEP_BATCH）。使用 sticker_objects_sweep 索引。 */
const WINDOW = 'id IN (SELECT id FROM sticker_objects WHERE sent_at IS NULL AND blocked_at IS NULL AND sweep_at <= ?1 ORDER BY sweep_at, id LIMIT ?2)';

/** Some collection holds the file. Uses member_stickers_sticker. */
/** 某个表情列表中有这个文件。使用 member_stickers_sticker 索引。 */
const COLLECTED = 'EXISTS (SELECT 1 FROM member_stickers m WHERE m.sticker_id = sticker_objects.id)';

/**
 * The rows this run finishes (?1 the JSON list of ids whose objects were deleted): still claimed, still unblocked and
 * in no collection. A file blocked meanwhile keeps its row as the blocklist, and the block already took its bytes off.
 * 本次执行收尾的记录（?1 为对象已被删除的 id 的 JSON 列表）：仍处于认领状态、仍未被封禁且不在任何表情列表中。期间被封禁的文件保留记录作为封禁名单，
 * 其字节数也已由封禁减去。
 */
const FINISHED = `id IN (SELECT value FROM json_each(?1)) AND state = 'deleting' AND blocked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM member_stickers m WHERE m.sticker_id = sticker_objects.id)`;

interface ClaimedFile {
  id: string;
  thumbs: string | null;
}

/**
 * One run: claim and keep in one batch, delete the claimed files' objects in one R2 call, then finish them in one
 * batch (their stills' rows cascade), take their bytes and their stills' off each creator's and the club's running
 * totals and delete daily rows older than two days. When the R2 call fails it throws and the claims stay for the next
 * run. No still can be recorded for a claimed file (the upload's reserve refuses it), so the stills read with the
 * claims are all the finish deletes.
 * 一次执行：在一个批次中认领和延后，用一次 R2 调用删除被认领文件的对象，再用一个批次收尾（其静态缩略图的记录随之级联删除），
 * 把文件及其静态缩略图的字节数从各自创建者和全会的累计数中减去，并删除两天前的每日记录。R2 调用失败时抛出异常，认领保留到下次执行。
 * 被认领的文件不会再记录任何静态缩略图（上传的预留批次会拒绝它），因此随认领读出的静态缩略图就是收尾时删除的全部。
 */
export async function sweepStickers(db: D1Database, bucket: R2Bucket, now: Date = new Date()): Promise<StickerSweep> {
  const nowIso = now.toISOString();
  const [claim, keep, read] = await db.batch([
    // (b) Claim every file of the window that nobody keeps: pending, ready in no collection, and claims left earlier.
    // (b) 认领范围内没有人收藏的所有文件：pending、不在任何列表中的 ready，以及之前留下的认领。
    db
      .prepare(`UPDATE sticker_objects SET state = 'deleting' WHERE ${WINDOW} AND sent_at IS NULL AND blocked_at IS NULL AND NOT ${COLLECTED}`)
      .bind(nowIso, STICKER_SWEEP_BATCH),
    // (a) The rest of the window is stored and in a collection: the sweep looks again in a week.
    // (a) 范围内其余的文件已存好且在某个列表中：清理任务一周后再检查。
    db
      .prepare(`UPDATE sticker_objects SET sweep_at = ?3 WHERE ${WINDOW} AND state = 'ready' AND ${COLLECTED}`)
      .bind(nowIso, STICKER_SWEEP_BATCH, new Date(now.getTime() + STICKER_UNSENT_TTL_MS).toISOString()),
    // (c) Every claimed file with its stills, oldest first.
    // (c) 所有被认领的文件及其静态缩略图，最早的优先。
    db
      .prepare(
        `SELECT o.id, (SELECT json_group_array(t.thumb) FROM sticker_thumbs t WHERE t.sticker_id = o.id) AS thumbs
         FROM sticker_objects o
         WHERE o.sent_at IS NULL AND o.blocked_at IS NULL AND o.state = 'deleting' AND o.sweep_at <= ?1
         ORDER BY o.sweep_at, o.id LIMIT ?2`,
      )
      .bind(nowIso, STICKER_SWEEP_BATCH),
  ]);
  const claimed = (read?.results ?? []) as ClaimedFile[];

  // As many files as one call can delete; a file whose stills do not fit waits for the next run. A single file
  // with more keys than one call takes is deleted over several calls, so it can never stall the sweep.
  // 一次调用能删除的文件数；静态缩略图放不下的文件留到下次执行。键数超过一次调用上限的单个文件分几次调用删除，因此不会卡住清理任务。
  const done: string[] = [];
  const keys: string[] = [];
  for (const file of claimed) {
    const own = stickerFileKeys(file.id, parseThumbs(file.thumbs));
    if (keys.length + own.length > STICKER_SWEEP_KEYS_MAX && done.length > 0) break;
    done.push(file.id);
    keys.push(...own);
    if (keys.length >= STICKER_SWEEP_KEYS_MAX) break;
  }
  for (let start = 0; start < keys.length; start += STICKER_SWEEP_KEYS_MAX) await bucket.delete(keys.slice(start, start + STICKER_SWEEP_KEYS_MAX));

  const ids = JSON.stringify(done);
  const [, finished] = await db.batch([
    // Each creator's and the club's running totals lose the bytes of the files that go and of their stills, before the
    // stills' rows cascade. The files are read once (done), their stills by primary key from that list, the sums taken
    // once per scope (one member may have created a file and stills) and joined to the totals by primary key, so the
    // cost grows with the files and stills, not with them times their creators.
    // 在静态缩略图的记录级联删除之前，每位创建者和全会的累计数减去被删除文件及其静态缩略图的字节数。文件只读取一次（done），其静态缩略图按主键从这份列表中查找，
    // 总和按范围只计算一次（同一位成员可能既创建了文件也创建了静态缩略图），再按主键与累计数关联，因此开销随文件和静态缩略图的数量增长，
    // 而不是随它们乘以创建者人数增长。
    db
      .prepare(
        `WITH done (id, scope, bytes) AS MATERIALIZED (SELECT id, created_by, bytes FROM sticker_objects WHERE ${FINISHED}),
              per (scope, bytes) AS MATERIALIZED (
                SELECT scope, SUM(bytes) FROM (
                  SELECT scope, bytes FROM done
                  UNION ALL
                  SELECT t.created_by, t.bytes FROM done CROSS JOIN sticker_thumbs t ON t.sticker_id = done.id)
                GROUP BY scope)
         UPDATE sticker_counts SET live_bytes = MAX(0, live_bytes - totals.bytes)
         FROM (SELECT scope, bytes FROM per UNION ALL SELECT '*', SUM(bytes) FROM per) AS totals
         WHERE sticker_counts.scope = totals.scope AND totals.bytes > 0`,
      )
      .bind(ids),
    // The rows go; their sticker_thumbs rows cascade. RETURNING counts the files alone (an engine may count the
    // cascaded rows in meta.changes).
    // 删除记录；其 sticker_thumbs 记录随之级联删除。RETURNING 只统计文件本身（有的引擎会把级联删除的行也算进 meta.changes）。
    db.prepare(`DELETE FROM sticker_objects WHERE ${FINISHED} RETURNING id`).bind(ids),
    // Daily counts older than two days, a primary-key range.
    // 两天前的每日计数，按主键范围删除。
    db.prepare('DELETE FROM sticker_daily WHERE day < ?1').bind(stickerDay(now.getTime() - STICKER_DAILY_KEEP_MS)),
  ]);
  return { claimed: claim?.meta.changes ?? 0, kept: keep?.meta.changes ?? 0, deleted: finished?.results.length ?? 0, objects: keys.length };
}

/**
 * The cron's sticker housekeeping. Without a bucket nothing was ever uploaded, and before migration 0019 there are no
 * tables yet; both do nothing. Never throws.
 * 定时任务中表情的整理工作。没有存储桶时从未上传过文件，迁移 0019 之前还没有这些表；两种情况都什么也不做。从不抛出异常。
 */
export async function runStickerMaintenance(env: Env, now: Date = new Date()): Promise<void> {
  if (!env.FILES) return;
  try {
    const sweep = await sweepStickers(env.DB, env.FILES, now);
    if (sweep.deleted > 0) console.log(`stickers: deleted ${sweep.deleted} unused files (${sweep.objects} keys)`);
  } catch (err) {
    if (!isMissingSchemaError(err)) console.error('stickers: sweep failed', err instanceof Error ? err.message : String(err));
  }
}
