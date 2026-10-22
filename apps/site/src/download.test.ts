import { describe, expect, it } from 'vitest';
import { ANDROID_APK_KEY, etagListMatches, parseByteRange, rangeStillValid, serveAndroidApk } from './download';

const UPLOADED = new Date('2026-10-01T12:00:00.500Z');
const URL_ = 'https://utmmsc.com/download/android';

function fakeBucket(bytes: Uint8Array | null, etag = 'abc123') {
  const calls: string[] = [];
  const meta = () => ({ key: ANDROID_APK_KEY, size: bytes?.length ?? 0, etag, httpEtag: `"${etag}"`, uploaded: UPLOADED });
  const bucket = {
    async head(key: string) {
      calls.push('head');
      return bytes && key === ANDROID_APK_KEY ? meta() : null;
    },
    async get(key: string, options?: { range?: { offset: number; length: number } }) {
      const range = options?.range;
      calls.push(range ? `get ${range.offset}+${range.length}` : 'get');
      if (!bytes || key !== ANDROID_APK_KEY) return null;
      const slice = range ? bytes.slice(range.offset, range.offset + range.length) : bytes;
      return { ...meta(), body: new Response(slice).body };
    },
  };
  return { calls, bucket: bucket as unknown as R2Bucket };
}

const TEN = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

async function bytesOf(response: Response): Promise<number[]> {
  return [...new Uint8Array(await response.arrayBuffer())];
}

describe('parseByteRange', () => {
  it('reads closed, open and suffix ranges', () => {
    expect(parseByteRange('bytes=0-4', 10)).toEqual({ start: 0, end: 4 });
    expect(parseByteRange('bytes=5-', 10)).toEqual({ start: 5, end: 9 });
    expect(parseByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange('BYTES=2-2', 10)).toEqual({ start: 2, end: 2 });
  });

  it('clamps the end and an oversized suffix to the file', () => {
    expect(parseByteRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
    expect(parseByteRange('bytes=-50', 10)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange('bytes=0-99999999999999999999', 10)).toEqual({ start: 0, end: 9 });
  });

  it('reports ranges that start past the end', () => {
    expect(parseByteRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=99999999999999999999-', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable');
  });

  it('ignores missing, malformed and multi-range headers', () => {
    expect(parseByteRange(null, 10)).toBeNull();
    expect(parseByteRange('', 10)).toBeNull();
    expect(parseByteRange('bytes=-', 10)).toBeNull();
    expect(parseByteRange('bytes=5-2', 10)).toBeNull();
    expect(parseByteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(parseByteRange('items=0-1', 10)).toBeNull();
    expect(parseByteRange('bytes=a-b', 10)).toBeNull();
  });
});

describe('etagListMatches', () => {
  it('matches strong, weak, listed and wildcard tags', () => {
    expect(etagListMatches('"abc"', '"abc"')).toBe(true);
    expect(etagListMatches('W/"abc"', '"abc"')).toBe(true);
    expect(etagListMatches('"x", "abc"', '"abc"')).toBe(true);
    expect(etagListMatches('*', '"abc"')).toBe(true);
  });

  it('does not match other or missing tags', () => {
    expect(etagListMatches('"x"', '"abc"')).toBe(false);
    expect(etagListMatches(null, '"abc"')).toBe(false);
  });
});

describe('rangeStillValid', () => {
  it('allows a range without If-Range', () => {
    expect(rangeStillValid(null, '"abc"', UPLOADED)).toBe(true);
  });

  it('needs the exact strong ETag', () => {
    expect(rangeStillValid('"abc"', '"abc"', UPLOADED)).toBe(true);
    expect(rangeStillValid('"old"', '"abc"', UPLOADED)).toBe(false);
    expect(rangeStillValid('W/"abc"', '"abc"', UPLOADED)).toBe(false);
  });

  it('needs the upload time to the second', () => {
    expect(rangeStillValid(UPLOADED.toUTCString(), '"abc"', UPLOADED)).toBe(true);
    expect(rangeStillValid(new Date(UPLOADED.getTime() - 60_000).toUTCString(), '"abc"', UPLOADED)).toBe(false);
    expect(rangeStillValid('not a date', '"abc"', UPLOADED)).toBe(false);
  });
});

describe('serveAndroidApk', () => {
  it('streams the installer as an attachment', async () => {
    const { bucket, calls } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_), bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="UTMMSC.apk"');
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('etag')).toBe('"abc123"');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(await bytesOf(response)).toEqual([...TEN]);
    expect(calls).toEqual(['get']);
  });

  it('answers HEAD from metadata only', async () => {
    const { bucket, calls } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { method: 'HEAD' }), bucket);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.body).toBeNull();
    expect(calls).toEqual(['head']);
  });

  it('shows a bilingual page when the installer is missing', async () => {
    const { bucket } = fakeBucket(null);
    const response = await serveAndroidApk(new Request(URL_), bucket);
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await response.text();
    expect(html).toContain('安卓安装包暂未发布');
    expect(html).toContain('The Android app is not available yet.');

    const head = await serveAndroidApk(new Request(URL_, { method: 'HEAD' }), bucket);
    expect(head.status).toBe(404);
    expect(head.body).toBeNull();
  });

  it('serves a single byte range', async () => {
    const { bucket, calls } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { headers: { range: 'bytes=2-4' } }), bucket);
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(response.headers.get('content-length')).toBe('3');
    expect(await bytesOf(response)).toEqual([2, 3, 4]);
    expect(calls).toEqual(['head', 'get 2+3']);
  });

  it('rejects a range past the end', async () => {
    const { bucket } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { headers: { range: 'bytes=20-' } }), bucket);
    expect(response.status).toBe(416);
    expect(response.headers.get('content-range')).toBe('bytes */10');
  });

  it('sends the whole file when If-Range no longer matches', async () => {
    const { bucket } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { headers: { range: 'bytes=2-4', 'if-range': '"old"' } }), bucket);
    expect(response.status).toBe(200);
    expect(await bytesOf(response)).toEqual([...TEN]);
  });

  it('revalidates with If-None-Match', async () => {
    const { bucket, calls } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { headers: { 'if-none-match': '"abc123"' } }), bucket);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"abc123"');
    expect(calls).toEqual(['head']);

    const changed = await serveAndroidApk(new Request(URL_, { headers: { 'if-none-match': '"older"' } }), bucket);
    expect(changed.status).toBe(200);
    expect(await bytesOf(changed)).toEqual([...TEN]);
  });

  it('allows only GET and HEAD', async () => {
    const { bucket } = fakeBucket(TEN);
    const response = await serveAndroidApk(new Request(URL_, { method: 'POST' }), bucket);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });
});
