const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

const FALLBACK_NAME = 'download';
/** Android allows 255 bytes per file name; this leaves room for the extension. */
/** Android 每个文件名最多 255 字节；这里给扩展名留出空间。 */
const STEM_MAX_BYTES = 180;
// Path separators, characters Windows and Android refuse, and # % ? which would break the file:// address handed to the share sheet.
// 路径分隔符、Windows 和 Android 不接受的字符，以及会破坏交给分享面板的 file:// 地址的 # % ?。
const UNSAFE = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|', '#', '%']);
const EXTENSION = /\.([A-Za-z0-9]{1,10})$/;

function replaceUnsafe(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || UNSAFE.has(char) ? '_' : char;
  }
  return out;
}

export function extensionForMime(mimeType: string | null | undefined): string | null {
  const type = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[type] ?? null;
}

function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

function truncateBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let out = '';
  for (const char of text) {
    bytes += utf8Bytes(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    out += char;
  }
  return out;
}

function trimEdges(text: string): string {
  return text.replace(/^[\s.]+|[\s.]+$/g, '');
}

/**
 * A file name that is safe to write in the app's cache and hand to the share sheet. Unsafe characters
 * become _, a name without an extension gets one from the MIME type, and long names are shortened while
 * keeping the extension.
 * 可以安全写入应用缓存并交给分享面板的文件名。不安全的字符换成 _，没有扩展名时按 MIME 类型补上，过长的名字会缩短但保留扩展名。
 */
export function safeFileName(name: string, mimeType?: string | null): string {
  let cleaned = trimEdges(replaceUnsafe(name));
  const known = extensionForMime(mimeType);
  if (!EXTENSION.test(cleaned) && known) cleaned = `${cleaned || FALLBACK_NAME}.${known}`;
  const match = EXTENSION.exec(cleaned);
  const extension = match ? match[0] : '';
  const stem = trimEdges(truncateBytes(trimEdges(cleaned.slice(0, cleaned.length - extension.length)), STEM_MAX_BYTES));
  return `${stem || FALLBACK_NAME}${extension}`;
}

/** Byte ranges for writing a file in pieces; an empty file still gets one empty piece. */
/** 分段写入文件时的字节范围；空文件也会得到一个空段。 */
export function byteChunks(size: number, chunkBytes: number): { start: number; end: number }[] {
  if (!(chunkBytes > 0)) throw new RangeError('chunkBytes must be positive');
  if (size <= 0) return [{ start: 0, end: 0 }];
  const chunks: { start: number; end: number }[] = [];
  for (let start = 0; start < size; start += chunkBytes) chunks.push({ start, end: Math.min(size, start + chunkBytes) });
  return chunks;
}

/** The base64 payload of a data: URL, as FileReader.readAsDataURL returns it. */
/** data: 地址里的 base64 内容，即 FileReader.readAsDataURL 返回的格式。 */
export function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? '' : dataUrl.slice(comma + 1);
}
