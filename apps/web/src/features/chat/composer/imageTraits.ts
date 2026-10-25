/**
 * What the first bytes of a PNG or WebP say about animation and transparency, read without decoding, so the
 * composer can tell when a canvas copy would look different from the original: a canvas keeps only the first frame
 * of an animated WebP or APNG and draws transparent pixels on white. Nothing here touches the DOM.
 * 不解码、只读 PNG 或 WebP 文件开头的字节，判断它是否为动图、是否带透明。输入框据此判断画布副本会不会和原图不一样：
 * 画布只保留动态 WebP 或 APNG 的第一帧，并把透明像素画在白底上。这里不访问 DOM。
 */

/**
 * Both fields lean to true: a header that is cut off before it can rule something out counts as having it, since
 * the cost of a wrong true is only a skipped resize.
 * 两个字段都偏向 true：文件头在能排除之前就被截断时，按具备处理，因为误判为 true 的代价只是少做一次缩放。
 */
export interface ImageTraits {
  /** An animated WebP or an APNG. */
  /** 动态 WebP 或 APNG。 */
  mayAnimate: boolean;
  /** The file has an alpha channel or a transparent colour, so some pixels may be see-through. */
  /** 文件带透明通道或透明色，因此部分像素可能是透明的。 */
  mayBeTransparent: boolean;
}

/** Enough for every chunk a PNG puts before its image data, except for files with unusually large metadata. */
/** 足以覆盖 PNG 在图像数据之前的所有块，元数据异常大的文件除外。 */
export const IMAGE_HEAD_BYTES = 64 * 1024;

const UNKNOWN: ImageTraits = { mayAnimate: true, mayBeTransparent: true };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** VP8X flag bits, from the WebP container spec. */
/** VP8X 标志位，取自 WebP 容器规范。 */
const VP8X_ALPHA = 0x10;
const VP8X_ANIMATION = 0x02;

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function uint32BigEndian(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) * 0x1000000) + (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0));
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

/**
 * IHDR always comes first and its colour type says whether there is an alpha channel (4 and 6). An acTL chunk makes
 * the file an APNG and a tRNS chunk gives it a transparent colour; both must come before the first IDAT.
 * IHDR 总是第一个块，它的颜色类型表明是否带透明通道（4 和 6）。acTL 块表示这是 APNG，tRNS 块表示有透明色；两者都必须出现在第一个 IDAT 之前。
 */
function pngTraits(bytes: Uint8Array): ImageTraits {
  if (bytes.length < 26 || ascii(bytes, 12, 4) !== 'IHDR') return { ...UNKNOWN };
  const colourType = bytes[25];
  const traits: ImageTraits = { mayAnimate: false, mayBeTransparent: colourType === 4 || colourType === 6 };
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset + 4, 4);
    if (type === 'IDAT') return traits;
    if (type === 'acTL') traits.mayAnimate = true;
    if (type === 'tRNS') traits.mayBeTransparent = true;
    // Each chunk is a 4-byte length, a 4-byte type, the data and a 4-byte CRC.
    // 每个块依次是 4 字节长度、4 字节类型、数据和 4 字节 CRC。
    offset += 12 + uint32BigEndian(bytes, offset);
  }
  // The image data was not reached, so a later acTL or tRNS cannot be ruled out.
  // 没有读到图像数据，因此无法排除后面还有 acTL 或 tRNS。
  return { ...UNKNOWN };
}

/**
 * The first chunk tells: VP8 is a lossy still without alpha, VP8L carries an alpha-is-used bit in its header, and
 * VP8X has flags for alpha and animation.
 * 第一个块即可判断：VP8 是不带透明的有损静态图，VP8L 的头部有一个「使用了透明」位，VP8X 带有透明和动画标志。
 */
function webpTraits(bytes: Uint8Array): ImageTraits {
  const chunk = bytes.length >= 16 ? ascii(bytes, 12, 4) : '';
  if (chunk === 'VP8 ') return { mayAnimate: false, mayBeTransparent: false };
  if (chunk === 'VP8L' && bytes.length >= 25) {
    // After the 0x2f signature byte: 14 bits width, 14 bits height, then the alpha bit, little-endian.
    // 在签名字节 0x2f 之后：14 位宽度、14 位高度，然后是透明位，按小端序排列。
    return { mayAnimate: false, mayBeTransparent: ((bytes[24] ?? 0) & 0x10) !== 0 };
  }
  if (chunk === 'VP8X' && bytes.length >= 21) {
    const flags = bytes[20] ?? 0;
    return { mayAnimate: (flags & VP8X_ANIMATION) !== 0, mayBeTransparent: (flags & VP8X_ALPHA) !== 0 };
  }
  return { ...UNKNOWN };
}

/** Traits of a PNG or WebP from its first bytes, or null for any other format (JPEG, GIF), which this does not read. */
/** 根据开头的字节得出 PNG 或 WebP 的特征；其他格式（JPEG、GIF）不在此读取，返回 null。 */
export function imageTraitsFromHeader(bytes: Uint8Array): ImageTraits | null {
  if (isPng(bytes)) return pngTraits(bytes);
  if (isWebp(bytes)) return webpTraits(bytes);
  return null;
}

/** Reads the first bytes of a file. Never rejects: a file that cannot be read gives null. */
/** 读取文件开头的字节。永不拒绝：无法读取的文件返回 null。 */
export async function readImageTraits(file: Blob): Promise<ImageTraits | null> {
  try {
    return imageTraitsFromHeader(new Uint8Array(await file.slice(0, IMAGE_HEAD_BYTES).arrayBuffer()));
  } catch {
    return null;
  }
}
