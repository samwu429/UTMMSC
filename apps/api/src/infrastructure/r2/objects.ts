import type { FileCategory } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';

/** Object keys carry their category prefix so the bucket layout mirrors the file library. */
/** 对象键带分类前缀，使存储桶结构与文件库一致。 */
export function libraryObjectKey(category: FileCategory, fileName: string): string {
  const safeName = fileName.replace(/[^\w.\-\u4e00-\u9fff]+/g, '_').slice(0, 120);
  return `${category}/${randomId('obj')}-${safeName}`;
}

export function chatImageKey(roomId: string, contentType: string): string {
  const ext = contentType.split('/')[1] ?? 'bin';
  return `chat/${roomId.replace(':', '/')}/${randomId('img')}.${ext}`;
}

/**
 * Whether a key is one of this room's chat images (chat/<kind>/<id>/...), images and thumbnails alike. The room
 * accepts only these in a message, and /chat/media serves them only with this room's token.
 * 键是否属于本房间的聊天图片（chat/<类型>/<id>/...），图片和缩略图都一样。房间只接受这样的键出现在消息中，
 * /chat/media 也只凭本房间的令牌提供它们。
 */
export function isRoomImageKey(roomId: string, key: string): boolean {
  return key.startsWith(`chat/${roomId.replace(':', '/')}/`) && !key.includes('..');
}

/**
 * Cache-Control for media. A key is never written with different bytes: uploads get a new random key, and a
 * content-addressed key (a sticker) is only ever rewritten with the same bytes, checked by R2. So a copy the browser
 * holds can never go stale: it keeps it for a year without asking again. Private, because the URL carries a media
 * token.
 * 媒体文件的 Cache-Control。同一个键从不写入不同的字节：上传使用新的随机键，按内容寻址的键（表情）只会以经 R2 校验的相同字节重新写入。
 * 所以浏览器持有的副本不会过时：保留一年，期间不再询问。设为 private，因为网址里带有媒体令牌。
 */
export const IMMUTABLE_MEDIA_CACHE = 'private, max-age=31536000, immutable';

/**
 * Sent with every media response, beside nosniff: a file opened directly can never run as a page on the API's
 * origin, whatever its bytes hold. Image and video elements ignore it. There is deliberately no
 * cross-origin-resource-policy: old builds load images from workers.dev on another origin.
 * 与 nosniff 一起随每个媒体响应发送：直接打开的文件无论字节内容是什么，都不能作为页面在接口的源上运行。图片和视频元素会忽略它。
 * 这里有意不设 cross-origin-resource-policy：旧版本从另一个源 workers.dev 加载图片。
 */
export const MEDIA_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

export interface PutObjectOptions {
  /** Stored with the object, for clients that read the bucket directly; media routes set their own header. */
  /** 与对象一同保存，供直接读取存储桶的客户端使用；媒体接口自行设置响应头。 */
  cacheControl?: string;
  /** SHA-256 of the body as hex; R2 refuses the put when the bytes do not hash to it. */
  /** 请求体的 SHA-256（十六进制）；字节的哈希与之不符时，R2 拒绝写入。 */
  sha256?: string;
}

export async function putObject(
  bucket: R2Bucket,
  key: string,
  body: ReadableStream | ArrayBuffer | ArrayBufferView,
  contentType: string,
  options: PutObjectOptions = {},
): Promise<void> {
  await bucket.put(key, body, {
    httpMetadata: { contentType, ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}) },
    ...(options.sha256 ? { sha256: options.sha256 } : {}),
  });
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

export interface MediaResponseOptions {
  /** Defaults to IMMUTABLE_MEDIA_CACHE. */
  /** 默认为 IMMUTABLE_MEDIA_CACHE。 */
  cacheControl?: string;
}

/** A single byte range a request asked for: bytes=a-b, bytes=a- or bytes=-n. */
/** 请求所要的单个字节范围：bytes=a-b、bytes=a- 或 bytes=-n。 */
export type RequestedRange = { start: number; end: number | null } | { suffix: number };

/**
 * The Range header as one byte range, or null when there is none or it is not one valid byte range (several
 * ranges, another unit, garbage). The whole file is then served, which HTTP allows, and which R2 does too.
 * 把 Range 请求头解析为单个字节范围；没有该请求头，或它不是一个有效的字节范围（多个范围、其他单位、乱码）时为 null。
 * 此时返回整个文件，这是 HTTP 允许的做法，R2 也是这样处理的。
 */
export function parseRangeHeader(value: string | null): RequestedRange | null {
  const match = value === null ? null : /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') return { suffix: Number(to) };
  const start = Number(from);
  const end = to === '' ? null : Number(to);
  if (!Number.isSafeInteger(start) || (end !== null && (!Number.isSafeInteger(end) || end < start))) return null;
  return { start, end };
}

/** The bytes a requested range covers in an object of `size` bytes, or null when it cannot be satisfied. */
/** 所请求的范围在 `size` 字节的对象中覆盖的字节；无法满足时为 null。 */
export function requestedSpan(range: RequestedRange, size: number): { start: number; end: number } | null {
  if ('suffix' in range) {
    const length = Math.min(range.suffix, size);
    return length > 0 ? { start: size - length, end: size - 1 } : null;
  }
  if (range.start >= size) return null;
  return { start: range.start, end: Math.min(range.end ?? size - 1, size - 1) };
}

/** The bytes R2 actually returned, as it reports them on the object. */
/** R2 实际返回的字节，即对象上报告的范围。 */
export function servedSpan(range: R2Range, size: number): { start: number; end: number } | null {
  if ('suffix' in range) return requestedSpan({ suffix: range.suffix }, size);
  const start = range.offset ?? 0;
  const length = range.length ?? size - start;
  if (!Number.isSafeInteger(start) || start < 0 || start >= size || !(length > 0)) return null;
  return { start, end: Math.min(start + length, size) - 1 };
}

/** Entity tags in an If-Match or If-None-Match value; '*' matches any. */
/** If-Match 或 If-None-Match 中的实体标签；'*' 与任何标签匹配。 */
function etagListMatches(value: string, etag: string): boolean {
  return value.split(',').some((part) => {
    const tag = part.trim().replace(/^W\//, '');
    return tag === '*' || tag === `"${etag}"` || tag === etag;
  });
}

/**
 * R2 sends no body when a condition fails. If-Match and If-Unmodified-Since failing means the browser holds a
 * different file (412); otherwise If-None-Match or If-Modified-Since matched and its copy is current (304).
 * 条件不满足时 R2 不返回正文。If-Match 或 If-Unmodified-Since 不满足，说明浏览器持有的是另一份文件（412）；
 * 否则是 If-None-Match 或 If-Modified-Since 命中，浏览器的副本仍是最新的（304）。
 */
function failedConditionStatus(request: Request, object: R2Object): 304 | 412 {
  const ifMatch = request.headers.get('if-match');
  if (ifMatch !== null && !etagListMatches(ifMatch, object.etag)) return 412;
  const ifUnmodifiedSince = Date.parse(request.headers.get('if-unmodified-since') ?? '');
  if (Number.isFinite(ifUnmodifiedSince) && Math.floor(object.uploaded.getTime() / 1000) * 1000 > ifUnmodifiedSince) return 412;
  return 304;
}

function hasBody(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return 'body' in object;
}

function unsatisfiable(size: number): Response {
  return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}`, 'content-security-policy': MEDIA_CONTENT_SECURITY_POLICY } });
}

/**
 * Serves a media object with a single R2 call (two R2 calls before: head, then get). R2 evaluates the Range
 * header, so a video element can start and seek, and the conditional headers, so a browser revalidating a file it
 * already holds gets 304 without the bytes. The ETag lets it ask; immutable caching means it rarely needs to.
 * An open-ended range (bytes=a-) gets the rest of the file, streamed, as R2 returns it.
 * 只用一次 R2 调用返回媒体对象（之前是两次：先 head 再 get）。Range 请求头由 R2 处理，视频才能开始播放和拖动进度；条件请求头也由 R2 处理，
 * 浏览器重新验证已有的文件时得到 304，不必再下载。ETag 让浏览器可以发起验证；不可变缓存让它很少需要这样做。
 * 不带结尾的范围（bytes=a-）按 R2 的返回得到文件的剩余部分，以流式传送。
 */
export async function mediaObjectResponse(
  bucket: R2Bucket,
  key: string,
  request: Request,
  options: MediaResponseOptions = {},
): Promise<Response | null> {
  const requested = parseRangeHeader(request.headers.get('range'));
  let object: R2Object | R2ObjectBody | null;
  try {
    object = await bucket.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (err) {
    // R2 may throw for a range it cannot satisfy ("The requested range is not satisfiable (10039)"); only then is
    // a second call made, to name the size. Any other failure is not the browser's fault and is passed on.
    // R2 遇到无法满足的范围时可能抛出异常（"The requested range is not satisfiable (10039)"）；只有这时才做第二次调用，以便给出文件大小。
    // 其他失败不是浏览器的问题，原样抛出。
    if (!requested || !/range/i.test(err instanceof Error ? err.message : String(err))) throw err;
    const head = await bucket.head(key);
    return head ? unsatisfiable(head.size) : null;
  }
  if (!object) return null;

  const headers = new Headers({
    'cache-control': options.cacheControl ?? IMMUTABLE_MEDIA_CACHE,
    etag: object.httpEtag,
    'x-content-type-options': 'nosniff',
    'content-security-policy': MEDIA_CONTENT_SECURITY_POLICY,
  });
  if (!hasBody(object)) return new Response(null, { status: failedConditionStatus(request, object), headers });

  const size = object.size;
  headers.set('accept-ranges', 'bytes');
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
  if (requested) {
    // R2 answers a range past the end with the whole file; the browser asked for bytes that do not exist.
    // R2 对超出文件末尾的范围返回整个文件；而浏览器要的是不存在的字节。
    if (!requestedSpan(requested, size)) {
      await object.body.cancel();
      return unsatisfiable(size);
    }
    // Content-Range always describes the bytes in the body, which are the ones R2 returned. Without a range on the
    // object the body is the whole file, which is a valid answer to any Range request.
    // Content-Range 始终描述正文中的字节，也就是 R2 返回的那些。对象上没有范围时，正文就是整个文件，这对任何 Range 请求都是合法的回答。
    const span = object.range ? servedSpan(object.range, size) : null;
    if (span) {
      headers.set('content-range', `bytes ${span.start}-${span.end}/${size}`);
      headers.set('content-length', String(span.end - span.start + 1));
      return new Response(object.body, { status: 206, headers });
    }
  }
  headers.set('content-length', String(size));
  return new Response(object.body, { status: 200, headers });
}
