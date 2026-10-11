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
