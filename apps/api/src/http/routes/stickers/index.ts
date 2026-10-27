import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  STICKERS_PER_MEMBER_MAX,
  STICKER_ANIMATED_FRAMES_MAX,
  STICKER_ANIMATED_PIXELS_MAX,
  STICKER_DIMENSION_MAX,
  STICKER_IDS_PER_CALL_MAX,
  STICKER_MAX_BYTES,
  STICKER_MESSAGES,
  STICKER_MIME_TYPES,
  STICKER_THUMB_DIMENSION_MAX,
  STICKER_THUMB_MAX_BYTES,
  STICKER_UPLOAD_REQUEST_MAX_BYTES,
  isStickerId,
  isStickerThumbToken,
  sniffSticker,
  stickerDay,
  stickerObjectKey,
  stickerThumbKey,
  type SniffedSticker,
  type StickerAddResponse,
  type StickerBlockResponse,
  type StickerFrontResponse,
  type StickerListResponse,
  type StickerMessageKey,
  type StickerRemoveResponse,
  type StickerType,
} from '@utmmsc/shared';
import { issueProfileMediaToken } from '../../../domain/profile/media-token';
import { stickerObjectId, stickerThumbToken } from '../../../domain/stickers/ids';
import { isMissingSchemaError } from '../../../infrastructure/d1/channels';
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
  stickerFileKeys,
  uploadRefusal,
  type StickerAddResult,
  type StickerEditRefusal,
  type StickerFileState,
  type StickerGate,
  type StickerLeftovers,
  type StickerReservation,
  type StickerUpload,
  type StickerUploadRefusal,
} from '../../../infrastructure/d1/stickers';
import { putObject } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { ApiHttpError, badRequest, errorResponse, forbidden, tooMany } from '../../errors';
import { memberRateLimit, rateLimit } from '../../middleware/rate-limit';
import { requireSession } from '../../middleware/session';
import { readJson } from '../../validation';

/**
 * Custom stickers (我的表情), mounted at /stickers: the member's collection, uploads, adds from messages, moves,
 * removals and the system administrator's block. Every cap is counted in D1 inside the same transaction as the write
 * it guards (infrastructure/d1/stickers.ts); the in-memory limiters below are only the first, cheap line.
 * 自定义表情（我的表情），挂载在 /stickers：成员的表情列表、上传、从消息添加、移到最前、删除，以及系统管理员的封禁。
 * 每个上限都在 D1 中、与它所保护的写入在同一个事务里计数（infrastructure/d1/stickers.ts）；下面的内存限流只是第一道、开销很小的防线。
 */
export const stickerRoutes = new Hono<AppEnv>();

const MINUTE = 60_000;

// Before migration 0019 every sticker table is missing; answer that stickers are not available yet instead of 500.
// 迁移 0019 之前表情的表都不存在；此时回答表情功能暂不可用，而不是 500。
stickerRoutes.onError((err, c) => errorResponse(isMissingSchemaError(err) ? stickerError(503, 'schema_pending', 'pending') : err, c));

function stickerError(status: ContentfulStatusCode, code: string, key: StickerMessageKey): ApiHttpError {
  return new ApiHttpError(status, code, STICKER_MESSAGES[key]);
}

const invalidBody = () => badRequest('invalid_body', '请求格式错误');
const invalidIds = () => stickerError(400, 'invalid_ids', 'ids');
const invalidThumb = () => stickerError(400, 'invalid_thumb', 'thumb');
const tooLarge = () => stickerError(400, 'too_large', 'tooLarge');
const notFound = () => stickerError(404, 'sticker_not_found', 'notFound');

/** The answer to each refused reservation; every one's message has the refusal's own name. */
/** 每种被拒绝的预留对应的回答；每个回答的提示都与拒绝原因同名。 */
const UPLOAD_REFUSALS: Record<StickerUploadRefusal, [ContentfulStatusCode, string]> = {
  blocked: [409, 'sticker_blocked'],
  unavailable: [503, 'sticker_unavailable'],
  full: [409, 'sticker_full'],
  daily: [429, 'sticker_daily_limit'],
  clubLimit: [429, 'sticker_club_limit'],
  memberStorage: [429, 'sticker_storage_limit'],
  clubStorage: [503, 'sticker_storage_full'],
};

function uploadRefused(refusal: StickerUploadRefusal): ApiHttpError {
  const [status, code] = UPLOAD_REFUSALS[refusal];
  return stickerError(status, code, refusal);
}

function editLimited(refusal: StickerEditRefusal): ApiHttpError {
  return refusal === 'edits' ? stickerError(429, 'sticker_edit_limit', 'edits') : stickerError(429, 'sticker_club_limit', 'clubLimit');
}

/** A fresh gate for a request: today's club-local date and a token nobody else holds. */
/** 为请求生成新的闸门：社团所在地的今天和一个别人不会持有的令牌。 */
function newGate(nowMs: number): StickerGate {
  return { day: stickerDay(nowMs), token: crypto.randomUUID() };
}

/** A JSON object body; anything else is invalid_body. */
/** JSON 对象请求体；其他任何内容都是 invalid_body。 */
async function readBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    return await readJson<Record<string, unknown>>(c);
  } catch {
    throw invalidBody();
  }
}

/** `ids` of a front or remove body: 1 to 999 sticker ids, duplicates dropped keeping the first occurrence. */
/** 移到最前或删除的请求体中的 `ids`：1 到 999 个表情 id，重复的只保留第一次出现的。 */
function readIds(body: Record<string, unknown>): string[] {
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > STICKER_IDS_PER_CALL_MAX || !ids.every(isStickerId)) throw invalidIds();
  return [...new Set(ids)];
}

/**
 * 201 for a sticker that went into the collection, 200 with `duplicate` for one that moved to the front; a refusal
 * gets the answer `refuse` names for the file's state.
 * 表情加入表情列表时为 201，已有并移到最前时为 200 且 `duplicate` 为 true；被拒绝时按文件状态由 `refuse` 给出回答。
 */
function addedResponse(c: Context<AppEnv>, result: StickerAddResult, refuse: (file: StickerFileState) => ApiHttpError): Response {
  if (result.outcome === 'refused') throw refuse(result.file);
  const body: StickerAddResponse = { sticker: result.sticker, duplicate: result.outcome === 'moved', total: result.total, version: result.version };
  return c.json(body, result.outcome === 'added' ? 201 : 200);
}

/* GET /stickers?v=<version> */
/* 获取表情列表 */

/** The client's version: a plain non-negative integer, else absent. */
/** 客户端的版本号：普通的非负整数，否则视为没有。 */
function parseVersion(raw: string | undefined): number | null {
  return raw !== undefined && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
}

stickerRoutes.get('/', requireSession, memberRateLimit('stickers:list', 30, MINUTE), async (c) => {
  const member = c.get('member');
  const version = parseVersion(c.req.query('v'));
  const [result, mediaToken] = await Promise.all([
    listStickers(c.env.DB, member.id, { ...newGate(Date.now()), version }),
    issueProfileMediaToken(c.env.SESSION_SECRET),
  ]);
  let response: StickerListResponse;
  if (result.listed) response = { stickers: result.stickers, max: STICKERS_PER_MEMBER_MAX, version: result.version, mediaToken };
  else if (version !== null && result.version === version) response = { unchanged: true, max: STICKERS_PER_MEMBER_MAX, version: result.version, mediaToken };
  // The client's list is stale and today's full lists are spent.
  // 客户端的列表已过时，而今天的完整列表次数已经用完。
  else throw tooMany();
  return c.json(response);
});

/* POST /stickers/upload */
/* 上传表情 */

/** x-sticker: <sha256 of the sticker>.<sha256 of the still>.<byte length of the still>, lowercase hex. */
/** x-sticker：<表情的 sha256>.<静态缩略图的 sha256>.<静态缩略图的字节长度>，小写十六进制。 */
const UPLOAD_HEADER = /^([0-9a-f]{64})\.([0-9a-f]{64})\.([1-9][0-9]{0,5})$/;

/** The sticker as its bytes say, within every upload limit, and nothing after its real end. */
/** 字节所表明的表情：满足所有上传限制，且真正的结尾之后没有任何内容。 */
function checkSticker(file: Uint8Array): SniffedSticker {
  const sniffed = sniffSticker(file);
  if (!sniffed || sniffed.end !== file.byteLength) throw stickerError(400, 'invalid_sticker', 'unreadable');
  if (sniffed.width > STICKER_DIMENSION_MAX || sniffed.height > STICKER_DIMENSION_MAX) throw stickerError(400, 'sticker_dimensions', 'dimensions');
  if (sniffed.animated && sniffed.width * sniffed.height > STICKER_ANIMATED_PIXELS_MAX) throw stickerError(400, 'sticker_dimensions', 'animatedSize');
  if (sniffed.animated && sniffed.frames > STICKER_ANIMATED_FRAMES_MAX) throw stickerError(400, 'sticker_frames', 'frames');
  return sniffed;
}

/** The still's type: a well-formed static image within the still's size, nothing after its end. */
/** 静态缩略图的类型：格式完好的静态图片，尺寸在缩略图限制之内，结尾之后没有任何内容。 */
function checkStill(still: Uint8Array): StickerType {
  const sniffed = sniffSticker(still);
  if (
    !sniffed ||
    sniffed.end !== still.byteLength ||
    sniffed.animated ||
    sniffed.width > STICKER_THUMB_DIMENSION_MAX ||
    sniffed.height > STICKER_THUMB_DIMENSION_MAX
  ) {
    throw invalidThumb();
  }
  return sniffed.type;
}

/** R2's refusal of bytes that do not hash to the declared SHA-256. */
/** R2 因字节的哈希与声明的 SHA-256 不符而拒绝写入。 */
function isChecksumError(err: unknown): boolean {
  return /checksum|digest|sha-?256/i.test(err instanceof Error ? err.message : String(err));
}

/** R2's refusal of a write to a key written within the last second (10058); a client can cause it by racing uploads of one file. */
/** R2 因同一个键在一秒内已被写入而拒绝写入（10058）；客户端可以通过并发上传同一个文件故意造成。 */
function isRateLimitError(err: unknown): boolean {
  return /\b10058\b|concurrent request rate/i.test(errorText(err));
}

/** An error's message, for the log. */
/** 错误的文字说明，用于日志。 */
function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * What to throw for a failed R2 write of the `failed` object, once D1 is settled. A checksum mismatch is the client's
 * own (the whole body was read and its length checked), so the day stays charged, as it does for R2's per-key rate
 * limit; any other failure is refunded and passed on. What the write stored nothing of goes with its bytes, where nothing else relies on it
 * (discardStickerUpload): the pending row this request created when R2 refused the original's checksum, unless another
 * upload reserved over it, and this request's hold on its still's row when the still was never put, because R2 refused
 * the original (the still follows it) for any reason or the still itself for its checksum; the row goes once no upload
 * holds it. A pending row that may hold a stored original, this request's or a parallel one's, stays for the sweep, and
 * so does a still whose own put failed otherwise, since that put may have stored it.
 * `failed` 对象的 R2 写入失败时应抛出的错误，先处理好 D1 一侧。校验不符是客户端自己的问题（整个请求体都已读完并核对过长度），因此当天的额度不退回；
 * R2 的单键频率限制也一样不退回；其他任何失败都退回额度并原样抛出。写入一样也没有存下的内容，在没有别的地方依赖时连同其字节数一起删除（discardStickerUpload）：
 * R2 因校验不符拒绝原始文件时，删除本次请求新建的 pending 记录，除非别的上传在它之上预留过；静态缩略图从未写入时，
 * 即 R2 以任何原因拒绝了原始文件（静态缩略图在它之后才写），或因校验不符拒绝了静态缩略图本身，释放本次请求对其静态缩略图记录的持有，
 * 没有任何上传再持有时这条记录就被删除。可能存着原始文件（本次请求的或并行请求的）的 pending 记录留给清理任务；
 * 静态缩略图自己的写入因别的原因失败时也一样保留，因为那次写入可能已经存下了它。
 */
async function failedWrite(db: D1Database, upload: StickerUpload, probe: StickerReservation, err: unknown, failed: 'original' | 'still'): Promise<unknown> {
  const checksum = isChecksumError(err);
  // The still this request holds and never put: none when the member had the sticker (R6 did not run).
  // 本次请求持有、却从未写入的静态缩略图：成员已有这个表情时没有（R6 没有执行）。
  const thumb = !probe.mine && (failed === 'original' || checksum) ? upload.thumb : null;
  const pending = failed === 'original' && checksum && probe.created;
  try {
    // R2's per-key rate limit is not refunded either: racing uploads of one file can cause it on purpose.
    // R2 的单键频率限制同样不退回额度：并发上传同一个文件可以故意造成它。
    if (!checksum && !isRateLimitError(err)) await refundStickerUpload(db, upload);
    if (pending || thumb !== null) await discardStickerUpload(db, { ...upload, thumb, pending });
  } catch (cleanup) {
    console.error(checksum ? 'stickers: discarding a refused upload failed' : 'stickers: upload refund failed', errorText(cleanup));
  }
  return checksum ? stickerError(400, 'checksum_mismatch', 'checksum') : err;
}

/**
 * Deletes what this request wrote for a file blocked, being swept or gone since the reserve: a block or the sweep may
 * already have deleted the file's objects before these writes landed, and neither deletes a key again once it is
 * done, so nothing else would ever delete them. No collection can hold such a file. The sweep takes a file only after
 * the hour the reserve gave it (R4), so only an upload that outlived that hour finds it being swept or gone, and only
 * then can a newer upload have stored the same key meanwhile. Best effort: a failure is logged.
 * 为自预留以来被封禁、正被清理或已不存在的文件删除本次请求写入的内容：封禁或清理任务可能在这些写入完成之前就已删除了文件的对象，
 * 而两者完成之后都不会再删除这些键，所以这些内容不会再有别的途径删除。这样的文件不可能出现在任何表情列表中。清理任务只在预留给文件的那一小时
 * （R4）之后才会删除它，因此只有超过这一小时仍未结束的上传才会发现它正被清理或已不存在，也只有那时才可能有更新的上传在此期间存下了同一个键。
 * 尽力而为：失败时记录日志。
 */
async function deleteWritten(bucket: R2Bucket, id: string, keys: string[]): Promise<void> {
  try {
    await bucket.delete(keys);
  } catch (err) {
    console.error(`stickers: could not delete the objects of refused upload ${id}`, errorText(err));
  }
}

/**
 * After a write or the commit failed: deletes what this request wrote when the file has been blocked, claimed by the
 * sweep or deleted since the reserve, and its still alone when no row names that still any more (only for an upload
 * that outlived the hour its reserve gave the file: the sweep deleted the file with it, the file was reserved anew, and
 * the last upload to hold the row recorded anew may have released it; the new row names the original under every
 * type). The read keeps a still row it finds for good, so no release can take the row it keeps the key for. A pending
 * row it finds is the one this request's reserve wrote or was counted on (R4), so no other request's discard takes it.
 * `stillKey` is the still this request may have written, null when it wrote none. When that cannot be read,
 * everything stays: but for a block (or, past that hour, the sweep) that deleted the file's objects before these writes
 * landed, a pending or ready row names every key this request wrote, so the sweep or a block deletes them.
 * 写入或提交失败之后：如果文件自预留以来已被封禁、被清理任务认领或已被删除，就删除本次请求写入的内容；如果已没有任何记录指向本次请求的静态缩略图
 * （只有超过预留给文件的那一小时仍未结束的上传才会遇到：清理任务连同它一起删除了文件、文件之后又被重新预留，最后一个持有重新记录的那条记录的上传
 * 还可能已经释放了它；新的记录按每种类型指向原始文件），就只删除这张静态缩略图。读取时会把找到的静态缩略图记录设为永久保留，
 * 因此任何释放都不能删除为之保留键的那条记录。找到的 pending 记录正是本次请求的预留写入或计入过的那条（R4），因此别的请求的丢弃都不会删除它。
 * `stillKey` 是本次请求可能写入的静态缩略图，没有写入时为 null。无法读取这些情况时全部保留：除了在这些写入落地之前就已删除文件对象的封禁
 * （或超过那一小时之后的清理任务）之外，pending 或 ready 的记录都指向本次请求写入的每个键，清理任务或封禁会删除它们。
 */
async function deleteLeftovers(db: D1Database, bucket: R2Bucket, upload: StickerUpload, originalKey: string, stillKey: string | null): Promise<void> {
  let leftovers: StickerLeftovers;
  try {
    leftovers = await readStickerLeftovers(db, upload.id, stillKey ? upload.thumb : null);
  } catch (read) {
    console.error(`stickers: could not read the file of failed upload ${upload.id}`, errorText(read));
    return;
  }
  if (leftovers.gone) await deleteWritten(bucket, upload.id, stillKey ? [originalKey, stillKey] : [originalKey]);
  else if (stillKey && !leftovers.stillRecorded) await deleteWritten(bucket, upload.id, [stillKey]);
}

/** The bytes of one checked upload and the SHA-256s R2 verifies them against. */
/** 一次已检查的上传的字节，以及 R2 用来校验它们的 SHA-256。 */
interface UploadBytes {
  file: Uint8Array;
  still: Uint8Array;
  stillType: StickerType;
  sha: string;
  thumbSha: string;
}

/**
 * Everything after the reserve: the R2 writes, the commit, and the cleanup when any of them fails or the file went
 * meanwhile. The original is written every time, under R2's checksum. The still follows only once the original is
 * stored, and only when the member does not have the sticker yet (a repeat keeps the still already in the row); the
 * reserve has recorded it, and the commit records it again should its row have gone with the file since, so the sweep
 * or a block always knows its key. A failed commit deletes nothing of a kept file whose row names every key.
 * 预留之后的全部工作：R2 写入、提交，以及其中任何一步失败或文件在此期间消失时的清理。原始文件每次都在 R2 的校验下写入。
 * 静态缩略图只在原始文件存好之后才写入，并且只在成员还没有这个表情时写入（重复上传保留记录中已有的静态图）；预留批次已经记录了它，
 * 如果它的记录此后随文件一起被删除，提交时会重新记录，清理任务或封禁因此总能知道它的键。提交失败时，记录仍指向每一个键的文件的内容一概不删。
 */
async function storeUpload(db: D1Database, bucket: R2Bucket, upload: StickerUpload, probe: StickerReservation, bytes: UploadBytes): Promise<StickerAddResult> {
  const { id } = upload;
  const originalKey = stickerObjectKey(id, upload.type);
  const stillKey = probe.mine ? null : stickerThumbKey(id, upload.thumb);
  const written = stillKey ? [originalKey, stillKey] : [originalKey];
  try {
    await putObject(bucket, originalKey, bytes.file, STICKER_MIME_TYPES[upload.type], { sha256: bytes.sha });
  } catch (err) {
    const failure = await failedWrite(db, upload, probe, err, 'original');
    // Bytes R2 refused for their checksum were never stored; any other failure may have stored them after all.
    // 因校验不符被 R2 拒绝的字节从未存下；其他任何失败都可能实际上已经存下了它们。
    if (!isChecksumError(err)) await deleteLeftovers(db, bucket, upload, originalKey, null);
    throw failure;
  }
  if (stillKey) {
    try {
      await putObject(bucket, stillKey, bytes.still, STICKER_MIME_TYPES[bytes.stillType], { sha256: bytes.thumbSha });
    } catch (err) {
      // The original is stored: a pending row stays for the sweep, which deletes it under every type; a stored file's
      // original was only written again with the same bytes. A file blocked, being swept or gone since the reserve
      // would keep both for good (a still that fails on purpose must not bring a blocked file back), so they go, and
      // so does a still that the put may have stored after its row went with the file. A still R2 refused for its
      // checksum was never stored, so its key is left alone: its row was just discarded, and another upload may record
      // and write the same key from now on.
      // 原始文件已存好：pending 记录留给清理任务，由它按每种类型删除原始文件；已存储文件的原始文件只是以相同的字节重新写入了一次。
      // 自预留以来被封禁、正被清理或已不存在的文件会让两者永远留下（故意失败的静态图不能让被封禁的文件重新上线），因此删除它们；
      // 记录已随文件一起删除、而这次写入可能仍已存下的静态缩略图也一并删除。因校验不符被拒绝的静态缩略图从未存下，因此不碰它的键：
      // 它的记录刚刚被丢弃，此后另一次上传可能记录并写入同一个键。
      const failure = await failedWrite(db, upload, probe, err, 'still');
      await deleteLeftovers(db, bucket, upload, originalKey, isChecksumError(err) ? null : stillKey);
      throw failure;
    }
  }
  let result: StickerAddResult;
  try {
    result = await commitStickerUpload(db, {
      memberId: upload.memberId,
      id,
      thumb: probe.mine ? probe.keptThumb : upload.thumb,
      stillBytes: stillKey ? upload.requestBytes - upload.fileBytes : null,
      type: upload.type,
      width: upload.width,
      height: upload.height,
      animated: upload.animated,
      fileBytes: upload.fileBytes,
      nowMs: Date.now(),
      countToken: crypto.randomUUID(),
    });
  } catch (err) {
    await deleteLeftovers(db, bucket, upload, originalKey, stillKey);
    throw err;
  }
  // Blocked, being swept or gone since the reserve: the original and the still go, and the answer stays the same. A
  // refusal of a ready file (the collection filled up) deletes nothing: the file is in use and its still is recorded.
  // 自预留以来文件被封禁、正被清理或已不存在：原始文件和静态图都删除，回答不变。对已就绪文件的拒绝（列表已满）不删除任何内容：文件仍在使用，静态图也已记录。
  if (result.outcome === 'refused' && result.file !== 'ready') await deleteWritten(bucket, id, written);
  return result;
}

/**
 * Uploads one sticker: the still's bytes followed by the sticker's, as a raw body, so the Worker never parses a form
 * or hashes 8 MB itself. Everything that can be checked without storage is checked before the reserve batch charges
 * the caps; R2 then verifies both SHA-256s on the writes, which also happen when the file is already stored, so
 * nobody can claim a file by knowing its hash.
 * 上传一个表情：原始请求体先是静态缩略图的字节，后面是表情的字节，因此 Worker 从不解析表单，也从不自己对 8 MB 求哈希。
 * 不需要存储就能检查的内容都在预留批次计入上限之前检查完；之后 R2 在写入时校验两个 SHA-256，文件已存储时也照样写入，
 * 所以知道哈希的人也无法据此认领文件。
 */
stickerRoutes.post('/upload', rateLimit(60, MINUTE), requireSession, memberRateLimit('stickers:upload', 20, MINUTE), async (c) => {
  const member = c.get('member');
  const bucket = requireBucket(c.env);
  const declared = c.req.header('content-length') ?? '';
  if (!/^[1-9][0-9]{0,15}$/.test(declared)) throw invalidBody();
  const length = Number(declared);
  if (length > STICKER_UPLOAD_REQUEST_MAX_BYTES) throw tooLarge();
  const header = UPLOAD_HEADER.exec(c.req.header('x-sticker') ?? '');
  if (!header) throw invalidBody();
  const sha = header[1] as string;
  const thumbSha = header[2] as string;
  const stillLength = Number(header[3]);
  if (stillLength >= length) throw invalidBody();
  if (stillLength > STICKER_THUMB_MAX_BYTES) throw invalidThumb();
  if (length - stillLength > STICKER_MAX_BYTES) throw tooLarge();

  const body = new Uint8Array(await c.req.arrayBuffer());
  if (body.byteLength !== length) throw invalidBody();
  const still = body.subarray(0, stillLength);
  const file = body.subarray(stillLength);
  const sticker = checkSticker(file);
  const stillType = checkStill(still);

  const secret = c.env.SESSION_SECRET;
  const id = await stickerObjectId(secret, sha);
  const thumb = await stickerThumbToken(secret, id, thumbSha);
  const nowMs = Date.now();
  const upload: StickerUpload = {
    memberId: member.id,
    id,
    type: sticker.type,
    width: sticker.width,
    height: sticker.height,
    animated: sticker.animated,
    fileBytes: file.byteLength,
    requestBytes: length,
    thumb,
    nowMs,
    gate: newGate(nowMs),
  };
  // The reserve batch and everything after it keep running when the client goes away (the web client aborts a stalled
  // upload; waitUntil allows 30 seconds more). Once the batch is sent it may commit, charging the caps and recording
  // the keys, even if the client goes away before it answers; cut short then, or between a write and the commit or the
  // cleanup, the request could leave a charge for a still never written, or objects that nothing else deletes. So
  // waitUntil gets one promise for the reserve and the store before the reserve is awaited.
  // 预留批次及其之后的全部工作，即使客户端离开也会继续执行（网页客户端会中止停滞的上传；waitUntil 再多给 30 秒）。预留批次一旦发出就可能提交，
  // 计入上限并记录键，即使客户端在它回答之前就已离开；若此时被中断，或在写入与提交或清理之间被中断，请求可能为从未写入的静态缩略图留下一笔计费，
  // 或留下没有任何途径会删除的对象。因此在等待预留之前，就把涵盖预留和存储的同一个 promise 交给 waitUntil。
  const work = (async (): Promise<{ refusal: StickerUploadRefusal } | { result: StickerAddResult }> => {
    const probe = await reserveStickerUpload(c.env.DB, upload);
    if (!probe.reserved) return { refusal: uploadRefusal(probe, upload) };
    return { result: await storeUpload(c.env.DB, bucket, upload, probe, { file, still, stillType, sha, thumbSha }) };
  })();
  c.executionCtx.waitUntil(work.catch(() => undefined));
  const outcome = await work;
  if ('refusal' in outcome) throw uploadRefused(outcome.refusal);
  // Refused at commit: blocked, swept or filled up by a parallel request since the reserve.
  // 提交时被拒绝：自预留以来文件被封禁、被清理，或列表被并行的请求填满。
  return addedResponse(c, outcome.result, (state) => {
    if (state === 'blocked') return uploadRefused('blocked');
    if (state === 'ready') return uploadRefused('full');
    return uploadRefused('unavailable');
  });
});

/* POST /stickers/add */
/* 添加已存储的表情 */

/**
 * Adds a stored sticker, the path for a received one: one D1 row, no upload. The still is the one of the message the
 * member adds from; a sticker already in the collection moves to the front and keeps its own.
 * 添加已存储的表情，即添加收到的表情的途径：只写一行 D1，不上传。静态图取自成员添加时所在的那条消息；已在列表中的表情移到最前，并保留它自己的静态图。
 */
stickerRoutes.post('/add', requireSession, memberRateLimit('stickers:add', 60, MINUTE), async (c) => {
  const member = c.get('member');
  const body = await readBody(c);
  const { id, thumb } = body;
  if (!isStickerId(id) || (thumb !== undefined && thumb !== null && !isStickerThumbToken(thumb))) throw invalidIds();
  const nowMs = Date.now();
  const outcome = await addSticker(c.env.DB, {
    memberId: member.id,
    id,
    thumb: typeof thumb === 'string' ? thumb : null,
    nowMs,
    gate: newGate(nowMs),
    countToken: crypto.randomUUID(),
  });
  if (outcome.outcome === 'limited') throw editLimited(outcome.refusal);
  return addedResponse(c, outcome, (state) => {
    if (state === 'blocked') return uploadRefused('blocked');
    if (state === 'ready') return uploadRefused('full');
    return notFound();
  });
});

/* POST /stickers/front and POST /stickers/remove */
/* 移到最前和删除 */

const editLimit = memberRateLimit('stickers:edit', 30, MINUTE);

stickerRoutes.post('/front', requireSession, editLimit, async (c) => {
  const member = c.get('member');
  const ids = readIds(await readBody(c));
  const nowMs = Date.now();
  const result = await moveStickersToFront(c.env.DB, { memberId: member.id, ids, nowMs, gate: newGate(nowMs) });
  if (result.outcome === 'limited') throw editLimited(result.refusal);
  const response: StickerFrontResponse = { moved: result.moved, version: result.version };
  return c.json(response);
});

/** Removes rows only; the client sends it when the undo snackbar closes. No R2 call, ever. */
/** 只删除记录；客户端在撤销提示条关闭时发送。从不调用 R2。 */
stickerRoutes.post('/remove', requireSession, editLimit, async (c) => {
  const member = c.get('member');
  const ids = readIds(await readBody(c));
  const result = await removeStickers(c.env.DB, { memberId: member.id, ids, gate: newGate(Date.now()) });
  if (result.outcome === 'limited') throw editLimited(result.refusal);
  const response: StickerRemoveResponse = { removed: result.removed, total: result.total, version: result.version };
  return c.json(response);
});

/* POST /stickers/block (system administrator) */
/* 封禁表情（系统管理员） */

/** Keys one R2 delete call takes. */
/** 一次 R2 删除调用最多接受的键数。 */
const R2_DELETE_MAX = 1000;

/**
 * Blocks a sticker for good: out of every collection, its original and every still deleted from R2, its row kept
 * so the same bytes are refused from now on. Only the system administrator's real role counts, not a role they act
 * as. When the R2 delete fails the block itself has happened; repeating the request repeats the delete.
 * 永久封禁一个表情：从每个表情列表中移除，从 R2 删除原始文件和所有静态缩略图，记录保留，此后相同的字节一律被拒绝。
 * 只认系统管理员的真实身份，不认其正在扮演的身份。R2 删除失败时封禁本身已经生效；重复这个请求会重新执行删除。
 */
stickerRoutes.post('/block', requireSession, memberRateLimit('stickers:block', 10, MINUTE), async (c) => {
  if (c.get('member').role !== 'superadmin') throw forbidden(STICKER_MESSAGES.blockForbidden);
  const bucket = requireBucket(c.env);
  const { id } = await readBody(c);
  if (!isStickerId(id)) throw invalidIds();
  const read = await blockSticker(c.env.DB, id, new Date().toISOString());
  if (!read) throw notFound();
  const keys = stickerFileKeys(id, read.thumbs);
  try {
    for (let start = 0; start < keys.length; start += R2_DELETE_MAX) await bucket.delete(keys.slice(start, start + R2_DELETE_MAX));
  } catch (err) {
    console.error(`stickers: could not delete the objects of blocked ${id}`, err instanceof Error ? err.message : String(err));
    throw stickerError(503, 'sticker_unavailable', 'unavailable');
  }
  await forgetStickerThumbs(c.env.DB, id);
  const response: StickerBlockResponse = { blocked: true };
  return c.json(response);
});
