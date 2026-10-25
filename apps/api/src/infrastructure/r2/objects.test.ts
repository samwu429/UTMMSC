import { describe, expect, it } from 'vitest';
import {
  IMMUTABLE_MEDIA_CACHE,
  chatImageKey,
  isRoomImageKey,
  mediaObjectResponse,
  parseRangeHeader,
  putObject,
  requestedSpan,
  servedSpan,
} from './objects';

const SIZE = 1000;
const ETAG = 'cbecbdb0fdd5cec1e242493b6008cc79';
const UPLOADED = new Date('2026-10-01T12:00:00.000Z');
const bytes = Uint8Array.from({ length: SIZE }, (_, i) => i % 256);

type Mode = 'local' | 'throws' | 'no-range';

/**
 * R2 as the local runtime behaves (measured with wrangler dev against a 1000-byte object): Range and conditional
 * headers are read from Headers, a range it cannot serve gives the whole file, and a failed condition gives the
 * object without a body. 'throws' raises R2's range error instead; 'no-range' ignores the Range header and
 * returns the whole file without a range on the object.
 * 本地运行时中 R2 的行为（用 wrangler dev 对一个 1000 字节的对象测得）：从 Headers 读取 Range 和条件请求头，无法提供的范围返回整个文件，
 * 条件不满足时返回不带正文的对象。'throws' 改为抛出 R2 的范围错误；'no-range' 忽略 Range 请求头，返回整个文件且对象上不带范围。
 */
function fakeBucket(mode: Mode = 'local') {
  const calls: string[] = [];
  const meta = { key: 'k', size: SIZE, etag: ETAG, httpEtag: `"${ETAG}"`, uploaded: UPLOADED, httpMetadata: { contentType: 'image/jpeg' } };
  const span = (headers: Headers): { offset: number; length: number } | 'bad' => {
    const m = /^bytes=(\d*)-(\d*)$/.exec(headers.get('range') ?? '');
    if (!m || (m[1] === '' && m[2] === '')) return { offset: 0, length: SIZE };
    if (m[1] === '') {
      const n = Number(m[2]);
      return n >= SIZE ? { offset: 0, length: SIZE } : { offset: SIZE - n, length: n };
    }
    const start = Number(m[1]);
    if (start >= SIZE) return 'bad';
    const end = m[2] === '' ? SIZE - 1 : Math.min(Number(m[2]), SIZE - 1);
    return { offset: start, length: end - start + 1 };
  };
  const conditionFails = (h: Headers): boolean => {
    const tags = (v: string) => v.split(',').map((t) => t.trim().replace(/^W\//, ''));
    const none = h.get('if-none-match');
    if (none && tags(none).some((t) => t === '*' || t === `"${ETAG}"`)) return true;
    const match = h.get('if-match');
    if (match && !tags(match).some((t) => t === '*' || t === `"${ETAG}"`)) return true;
    const since = Date.parse(h.get('if-modified-since') ?? '');
    if (Number.isFinite(since) && UPLOADED.getTime() <= since) return true;
    const unmodified = Date.parse(h.get('if-unmodified-since') ?? '');
    return Number.isFinite(unmodified) && UPLOADED.getTime() > unmodified;
  };
  const bucket = {
    head: async (key: string) => {
      calls.push(`head ${key}`);
      return key === 'missing' ? null : meta;
    },
    get: async (key: string, options?: { range?: unknown; onlyIf?: unknown }) => {
      calls.push(`get ${key}`);
      if (key === 'missing') return null;
      const range = options?.range instanceof Headers && mode !== 'no-range' ? span(options.range) : { offset: 0, length: SIZE };
      if (range === 'bad' && mode === 'throws') throw new Error('get: The requested range is not satisfiable (10039)');
      const served = range === 'bad' ? { offset: 0, length: SIZE } : range;
      const object = { ...meta, ...(mode === 'no-range' ? {} : { range: served }) };
      if (options?.onlyIf instanceof Headers && conditionFails(options.onlyIf)) return object;
      return { ...object, body: new Response(bytes.slice(served.offset, served.offset + served.length)).body };
    },
    put: async (key: string, _value: unknown, options?: R2PutOptions) => {
      calls.push(`put ${key} ${JSON.stringify(options?.httpMetadata)}`);
      return meta;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, calls };
}

async function serve(headers: Record<string, string> = {}, mode: Mode = 'local', key = 'avatar/mem_1/a.jpg') {
  const { bucket, calls } = fakeBucket(mode);
  const res = await mediaObjectResponse(bucket, key, new Request('https://api.test/media', { headers }));
  const body = res && res.body ? new Uint8Array(await res.arrayBuffer()) : null;
  return { res, body, calls };
}

describe('parseRangeHeader', () => {
  it('reads one byte range in each of its three forms', () => {
    expect(parseRangeHeader('bytes=0-99')).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader('bytes=900-')).toEqual({ start: 900, end: null });
    expect(parseRangeHeader('bytes=-50')).toEqual({ suffix: 50 });
    expect(parseRangeHeader(' bytes=5-5 ')).toEqual({ start: 5, end: 5 });
  });

  it('is null for no header, several ranges, another unit, a reversed range and garbage', () => {
    for (const value of [null, '', 'bytes=-', 'bytes=0-1,5-6', 'items=0-1', 'bytes=10-5', 'bytes=abc', `bytes=${'9'.repeat(30)}-`]) {
      expect(parseRangeHeader(value)).toBeNull();
    }
  });
});

describe('requestedSpan and servedSpan', () => {
  it('clamp to the object and refuse a start past its end', () => {
    expect(requestedSpan({ start: 990, end: 2000 }, SIZE)).toEqual({ start: 990, end: 999 });
    expect(requestedSpan({ start: 1000, end: null }, SIZE)).toBeNull();
    expect(requestedSpan({ suffix: 5000 }, SIZE)).toEqual({ start: 0, end: 999 });
    expect(requestedSpan({ suffix: 0 }, SIZE)).toBeNull();
    expect(servedSpan({ offset: 900, length: 100 }, SIZE)).toEqual({ start: 900, end: 999 });
    expect(servedSpan({ offset: 900 }, SIZE)).toEqual({ start: 900, end: 999 });
    expect(servedSpan({ suffix: 50 }, SIZE)).toEqual({ start: 950, end: 999 });
    expect(servedSpan({ offset: 1000, length: 1 }, SIZE)).toBeNull();
  });
});

describe('mediaObjectResponse', () => {
  it('serves the whole file with one R2 call, an ETag and immutable caching', async () => {
    const { res, body, calls } = await serve();
    expect(res?.status).toBe(200);
    expect(calls).toEqual(['get avatar/mem_1/a.jpg']);
    expect(res?.headers.get('etag')).toBe(`"${ETAG}"`);
    expect(res?.headers.get('cache-control')).toBe(IMMUTABLE_MEDIA_CACHE);
    expect(res?.headers.get('content-type')).toBe('image/jpeg');
    expect(res?.headers.get('content-length')).toBe('1000');
    expect(res?.headers.get('accept-ranges')).toBe('bytes');
    expect(res?.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body?.length).toBe(SIZE);
  });

  it('answers 304 without the bytes when the browser holds the file', async () => {
    const held: Record<string, string>[] = [
      { 'if-none-match': `"${ETAG}"` },
      { 'if-none-match': `W/"${ETAG}"` },
      { 'if-modified-since': new Date('2026-10-02T00:00:00Z').toUTCString() },
    ];
    for (const headers of held) {
      const { res, body, calls } = await serve(headers);
      expect(res?.status).toBe(304);
      expect(body).toBeNull();
      expect(res?.headers.get('etag')).toBe(`"${ETAG}"`);
      expect(res?.headers.get('cache-control')).toBe(IMMUTABLE_MEDIA_CACHE);
      expect(calls).toHaveLength(1);
    }
    const { res } = await serve({ 'if-none-match': `"${ETAG}"`, range: 'bytes=0-1' });
    expect(res?.status).toBe(304);
  });

  it('serves the file when the browser holds another one', async () => {
    expect((await serve({ 'if-none-match': '"other"' })).res?.status).toBe(200);
  });

  it('answers 412 when If-Match or If-Unmodified-Since fails', async () => {
    expect((await serve({ 'if-match': '"other"' })).res?.status).toBe(412);
    expect((await serve({ 'if-unmodified-since': new Date('2026-09-01T00:00:00Z').toUTCString() })).res?.status).toBe(412);
  });

  it('serves byte ranges, so a video can start and seek', async () => {
    const first = await serve({ range: 'bytes=0-99' });
    expect(first.res?.status).toBe(206);
    expect(first.res?.headers.get('content-range')).toBe('bytes 0-99/1000');
    expect(first.res?.headers.get('content-length')).toBe('100');
    expect(first.body?.[99]).toBe(99);
    expect(first.calls).toHaveLength(1);

    const rest = await serve({ range: 'bytes=900-' });
    expect(rest.res?.headers.get('content-range')).toBe('bytes 900-999/1000');
    expect(rest.body?.length).toBe(100);

    const tail = await serve({ range: 'bytes=-50' });
    expect(tail.res?.headers.get('content-range')).toBe('bytes 950-999/1000');
    expect(tail.body?.[0]).toBe(950 % 256);

    const past = await serve({ range: 'bytes=990-2000' });
    expect(past.res?.headers.get('content-range')).toBe('bytes 990-999/1000');
  });

  it('answers 416 for a range past the end, whether R2 gives the whole file or throws', async () => {
    for (const mode of ['local', 'throws'] as const) {
      const { res, calls } = await serve({ range: 'bytes=1000-' }, mode);
      expect(res?.status).toBe(416);
      expect(res?.headers.get('content-range')).toBe('bytes */1000');
      expect(calls).toHaveLength(mode === 'throws' ? 2 : 1);
    }
  });

  it('serves the whole file for a Range it does not take, as HTTP allows', async () => {
    for (const range of ['bytes=0-1,5-6', 'items=0-1', 'bytes=abc']) {
      const { res, body } = await serve({ range });
      expect(res?.status).toBe(200);
      expect(body?.length).toBe(SIZE);
    }
  });

  it('serves the whole file when R2 returns no range for a ranged read', async () => {
    const { res, body } = await serve({ range: 'bytes=0-99' }, 'no-range');
    expect(res?.status).toBe(200);
    expect(body?.length).toBe(SIZE);
  });

  it('is null for a missing object and passes on other R2 failures', async () => {
    expect((await serve({}, 'local', 'missing')).res).toBeNull();
    const failing = { get: async () => Promise.reject(new Error('R2 down')) } as unknown as R2Bucket;
    await expect(mediaObjectResponse(failing, 'k', new Request('https://api.test/'))).rejects.toThrow('R2 down');
    await expect(mediaObjectResponse(failing, 'k', new Request('https://api.test/', { headers: { range: 'bytes=0-1' } }))).rejects.toThrow('R2 down');
  });

  it('takes another Cache-Control when asked', async () => {
    const { bucket } = fakeBucket();
    const res = await mediaObjectResponse(bucket, 'k', new Request('https://api.test/'), { cacheControl: 'private, max-age=60' });
    expect(res?.headers.get('cache-control')).toBe('private, max-age=60');
  });
});

describe('chat image keys', () => {
  it('belong to their room only', () => {
    const key = chatImageKey('channel:ch_all', 'image/jpeg');
    expect(key).toMatch(/^chat\/channel\/ch_all\/img_[A-Za-z0-9_-]+\.jpeg$/);
    expect(isRoomImageKey('channel:ch_all', key)).toBe(true);
    expect(isRoomImageKey('channel:ch_al', key)).toBe(false);
    expect(isRoomImageKey('direct:dm_1', key)).toBe(false);
    expect(isRoomImageKey('channel:ch_all', 'chat/channel/ch_all/../ch_x/img.jpg')).toBe(false);
    expect(isRoomImageKey('channel:ch_all', 'avatar/mem_1/x.jpg')).toBe(false);
  });
});

describe('putObject', () => {
  it('stores the type, and Cache-Control only when given', async () => {
    const { bucket, calls } = fakeBucket();
    await putObject(bucket, 'a', new ArrayBuffer(1), 'image/png');
    await putObject(bucket, 'b', new ArrayBuffer(1), 'image/webp', { cacheControl: IMMUTABLE_MEDIA_CACHE });
    expect(calls).toEqual(['put a {"contentType":"image/png"}', `put b {"contentType":"image/webp","cacheControl":"${IMMUTABLE_MEDIA_CACHE}"}`]);
  });
});
