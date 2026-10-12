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

export async function putObject(bucket: R2Bucket, key: string, body: ReadableStream | ArrayBuffer, contentType: string): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function getObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
  return bucket.get(key);
}

export async function deleteObject(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/**
 * Serves an object, including byte ranges, so a video element can start and seek.
 * 按字节范围返回对象，视频才能开始播放和拖动进度。
 */
export async function mediaObjectResponse(bucket: R2Bucket, key: string, request: Request): Promise<Response | null> {
  const head = await bucket.head(key);
  if (!head) return null;
  const size = head.size;
  const type = head.httpMetadata?.contentType ?? 'application/octet-stream';
  const range = request.headers.get('range');
  let offset = 0;
  let length = size;
  let status = 200;
  let contentRange: string | undefined;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
    if (!match) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : Math.min(start + 1024 * 1024 - 1, size - 1);
    if (!Number.isInteger(start) || start >= size || end < start) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    offset = start;
    length = end - start + 1;
    status = 206;
    contentRange = `bytes ${start}-${end}/${size}`;
  }
  const object = await bucket.get(key, length === size && offset === 0 ? undefined : { range: { offset, length } });
  if (!object) return null;
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-type': type,
    'content-length': String(length),
    'cache-control': 'private, max-age=86400',
  });
  if (contentRange) headers.set('content-range', contentRange);
  return new Response(object.body, { status, headers });
}
