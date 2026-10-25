/**
 * Reads the real format and pixel size of an uploaded JPEG or WebP from its bytes, without decoding it. Uploads
 * carry a declared type the client chose, so routes that need a particular format and size (channel icons) check
 * it here instead of trusting the declaration. Anything this cannot read is refused.
 * 从上传文件的字节中读出 JPEG 或 WebP 的真实格式和像素尺寸，不做解码。上传附带的类型由客户端声明，
 * 因此需要特定格式和尺寸的接口（频道图标）在这里检查，而不是相信声明。凡是读不出的一律拒绝。
 */

export type SniffedImageType = 'image/jpeg' | 'image/webp';

export interface SniffedImage {
  type: SniffedImageType;
  width: number;
  height: number;
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (u16le(bytes, at) + u16le(bytes, at + 2) * 0x10000) >>> 0;
}

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** Baseline, extended sequential and progressive Huffman frames: what browsers and phone cameras write. */
/** 基线、扩展顺序和渐进式的哈夫曼帧：浏览器和手机相机写出的正是这几种。 */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
/** Every other start-of-frame marker: lossless, hierarchical or arithmetic coding, which is refused. */
/** 其余的帧起始标记：无损、分层或算术编码，一律拒绝。 */
const JPEG_OTHER_FRAMES = new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * A JPEG: SOI, then marker segments up to the first SOF0, SOF1 or SOF2, whose header gives the size. The file must
 * also end with EOI, so a cut-off upload is refused instead of showing half an image.
 * JPEG：以 SOI 开头，随后是若干标记段，直到第一个 SOF0、SOF1 或 SOF2，其头部给出尺寸。文件还必须以 EOI 结尾，
 * 这样被截断的上传会被拒绝，而不是显示半张图。
 */
export function sniffJpeg(bytes: Uint8Array): SniffedImage | null {
  const length = bytes.length;
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[length - 2] !== 0xff || bytes[length - 1] !== 0xd9) return null;
  let at = 2;
  while (at < length) {
    if (bytes[at] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker.
    // 标记之前可以有任意个 0xFF 填充字节。
    while (at < length && bytes[at] === 0xff) at += 1;
    if (at >= length) return null;
    const marker = bytes[at] ?? 0;
    at += 1;
    // The scan, a second SOI or the end came before any frame header; a stuffed 00 belongs only inside scan data.
    // 在任何帧头之前就出现了扫描数据、第二个 SOI 或结束标记；填充的 00 只会出现在扫描数据里。
    if (marker === 0xda || marker === 0xd9 || marker === 0xd8 || marker === 0x00) return null;
    // Restart markers and TEM stand alone, with no length.
    // 重启标记和 TEM 单独出现，没有长度字段。
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (at + 2 > length) return null;
    const segment = u16be(bytes, at);
    if (segment < 2 || at + segment > length) return null;
    if (JPEG_FRAMES.has(marker)) {
      // Length (2), precision (1), height (2), width (2), component count (1).
      // 长度（2）、精度（1）、高度（2）、宽度（2）、分量数（1）。
      if (segment < 8) return null;
      const height = u16be(bytes, at + 3);
      const width = u16be(bytes, at + 5);
      if (width === 0 || height === 0) return null;
      return { type: 'image/jpeg', width, height };
    }
    if (JPEG_OTHER_FRAMES.has(marker)) return null;
    at += segment;
  }
  return null;
}

/** VP8X flag for an animated image. */
/** VP8X 中表示动画图片的标志位。 */
const VP8X_ANIMATION = 0x02;

/**
 * A WebP: a RIFF container of type WEBP whose first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended, with
 * the canvas size). The RIFF size and the first chunk must fit in the bytes, so a cut-off upload is refused.
 * Animated images are refused too: an icon is a still.
 * WebP：类型为 WEBP 的 RIFF 容器，第一个块是 VP8（有损）、VP8L（无损）或 VP8X（扩展格式，带画布尺寸）。
 * RIFF 大小和第一个块都必须在字节范围之内，被截断的上传因此会被拒绝。动画图片也会被拒绝：图标是静态的。
 */
export function sniffWebp(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length < 20 || !ascii(bytes, 0, 'RIFF') || !ascii(bytes, 8, 'WEBP')) return null;
  const riffEnd = 8 + u32le(bytes, 4);
  if (riffEnd > bytes.length) return null;
  const chunkSize = u32le(bytes, 16);
  const data = 20;
  if (data + chunkSize > riffEnd) return null;
  if (ascii(bytes, 12, 'VP8 ')) {
    // A 3-byte frame tag (bit 0 clear on a key frame), the start code 9D 01 2A, then 14-bit width and height.
    // 3 字节的帧标签（关键帧的第 0 位为 0）、起始码 9D 01 2A，然后是 14 位的宽和高。
    if (chunkSize < 10) return null;
    if (((bytes[data] ?? 1) & 0x01) !== 0) return null;
    if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
    const width = u16le(bytes, data + 6) & 0x3fff;
    const height = u16le(bytes, data + 8) & 0x3fff;
    if (width === 0 || height === 0) return null;
    return { type: 'image/webp', width, height };
  }
  if (ascii(bytes, 12, 'VP8L')) {
    // The signature 0x2F, then 14 bits of width - 1, 14 bits of height - 1, 1 alpha bit and a 3-bit version of 0.
    // 签名 0x2F，然后是 14 位的宽减 1、14 位的高减 1、1 位透明标志和值为 0 的 3 位版本号。
    if (chunkSize < 5 || bytes[data] !== 0x2f) return null;
    const bits = u32le(bytes, data + 1);
    if (bits >>> 29 !== 0) return null;
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(bytes, 12, 'VP8X')) {
    // Flags (1), reserved (3), then 24-bit canvas width - 1 and height - 1.
    // 标志（1）、保留（3），然后是 24 位的画布宽减 1 和高减 1。
    if (chunkSize < 10) return null;
    if (((bytes[data] ?? 0) & VP8X_ANIMATION) !== 0) return null;
    return { type: 'image/webp', width: u24le(bytes, data + 4) + 1, height: u24le(bytes, data + 7) + 1 };
  }
  return null;
}

/** The format and size of a JPEG or WebP, or null for anything else, including truncated files. */
/** JPEG 或 WebP 的格式和尺寸；其他任何内容（包括被截断的文件）返回 null。 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes[0] === 0xff) return sniffJpeg(bytes);
  if (bytes[0] === 0x52) return sniffWebp(bytes);
  return null;
}
