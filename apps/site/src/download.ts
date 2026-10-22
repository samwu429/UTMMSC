import { ANDROID_MISSING } from './pages';

/** Upload the release build here; the route always serves the latest one. */
/** 发布版安装包上传到这里；该路由总是提供最新的一份。 */
export const ANDROID_APK_KEY = 'downloads/android/UTMMSC.apk';

const APK_HEADERS = {
  'content-type': 'application/vnd.android.package-archive',
  'content-disposition': 'attachment; filename="UTMMSC.apk"',
  'cache-control': 'public, max-age=300',
  'accept-ranges': 'bytes',
  'x-content-type-options': 'nosniff',
};

export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Reads a single `bytes=` range against the file size. null means the header is absent, malformed or
 * asks for several ranges, so the whole file is sent; 'unsatisfiable' means 416.
 * 按文件大小解析单个 `bytes=` 范围。null 表示没有该请求头、格式不对或请求了多个范围，此时发送整个文件；'unsatisfiable' 表示返回 416。
 */
export function parseByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const first = match[1] ?? '';
  const last = match[2] ?? '';
  if (!first && !last) return null;
  if (!first) {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (last && Number(last) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end: last ? Math.min(Number(last), size - 1) : size - 1 };
}

/** Weak comparison, as If-None-Match uses. */
/** 弱比较，与 If-None-Match 的规则一致。 */
export function etagListMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => bare(tag) === bare(etag));
}

/**
 * If-Range lets a resumed download continue only while the file is unchanged: a strong ETag must match
 * exactly, a date must equal the upload time to the second. Otherwise the whole file is sent again.
 * If-Range 只在文件未变时允许续传：强 ETag 必须完全一致，日期必须精确到秒等于上传时间。否则重新发送整个文件。
 */
export function rangeStillValid(ifRange: string | null, etag: string, uploaded: Date): boolean {
  if (!ifRange) return true;
  const value = ifRange.trim();
  if (value.startsWith('"') || value.startsWith('W/')) return value === etag;
  const date = Date.parse(value);
  return !Number.isNaN(date) && Math.floor(uploaded.getTime() / 1000) * 1000 === date;
}

function headersFor(object: R2Object, extra: Record<string, string>): Headers {
  return new Headers({ ...APK_HEADERS, etag: object.httpEtag, 'last-modified': object.uploaded.toUTCString(), ...extra });
}

function missing(method: string): Response {
  return new Response(method === 'HEAD' ? null : ANDROID_MISSING, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * GET and HEAD for /download/android. A plain GET reads the installer once; Range, If-Range and
 * If-None-Match first read its metadata so resumed downloads and revalidation work.
 * /download/android 的 GET 与 HEAD。普通 GET 只读取一次安装包；带 Range、If-Range 或 If-None-Match 时先读取元数据，以支持续传和缓存校验。
 */
export async function serveAndroidApk(request: Request, bucket: R2Bucket): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  const conditional = request.headers.has('range') || request.headers.has('if-none-match');
  if (method === 'GET' && !conditional) {
    const object = await bucket.get(ANDROID_APK_KEY);
    if (!object) return missing(method);
    return new Response(object.body, { headers: headersFor(object, { 'content-length': String(object.size) }) });
  }

  const meta = await bucket.head(ANDROID_APK_KEY);
  if (!meta) return missing(method);
  if (etagListMatches(request.headers.get('if-none-match'), meta.httpEtag)) {
    return new Response(null, {
      status: 304,
      headers: { etag: meta.httpEtag, 'last-modified': meta.uploaded.toUTCString(), 'cache-control': APK_HEADERS['cache-control'] },
    });
  }
  const range = rangeStillValid(request.headers.get('if-range'), meta.httpEtag, meta.uploaded) ? parseByteRange(request.headers.get('range'), meta.size) : null;
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: headersFor(meta, { 'content-range': `bytes */${meta.size}`, 'content-length': '0' }) });
  }
  const partial = range ? { 'content-range': `bytes ${range.start}-${range.end}/${meta.size}`, 'content-length': String(range.end - range.start + 1) } : null;
  if (method === 'HEAD') {
    return new Response(null, { status: partial ? 206 : 200, headers: headersFor(meta, partial ?? { 'content-length': String(meta.size) }) });
  }

  const object = await bucket.get(ANDROID_APK_KEY, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined);
  if (!object) return missing(method);
  if (partial && object.etag !== meta.etag) {
    // The installer was replaced between the two reads, so the range may not fit; send the new one whole.
    // 两次读取之间安装包被替换，范围可能不再适用；改为整份发送新的安装包。
    await object.body.cancel();
    return serveAndroidApk(new Request(request.url, { method: 'GET' }), bucket);
  }
  return new Response(object.body, { status: partial ? 206 : 200, headers: headersFor(object, partial ?? { 'content-length': String(object.size) }) });
}
