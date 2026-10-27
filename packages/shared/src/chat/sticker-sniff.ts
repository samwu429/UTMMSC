import { STICKER_SNIFF_STEPS_MAX, type StickerType } from './stickers';

/**
 * Reads a sticker file's real format, size, frame count, transparency and exact end from its bytes, without decoding
 * it. The server checks every upload with it and the client prepares every pick with it, so both decide the same way.
 * Every format walks the whole file, one step per block, chunk or sub-block; past STICKER_SNIFF_STEPS_MAX the answer
 * is null, which bounds the CPU a crafted file can cost. Anything that is not a well-formed file is null.
 * The API's own sniffImage (apps/api/src/domain/media/image-sniff.ts) stays separate: channel icons depend on it.
 * 不做解码，从字节中读出表情文件的真实格式、尺寸、帧数、是否可能透明以及确切的结尾。服务端用它检查每次上传，客户端用它准备每个选中的文件，
 * 因此两端的判断一致。每种格式都遍历整个文件，每个块、数据块或子块计一步；超过 STICKER_SNIFF_STEPS_MAX 时返回 null，
 * 从而限制精心构造的文件所能消耗的 CPU。凡不是格式完好的文件都返回 null。
 * 接口自己的 sniffImage（apps/api/src/domain/media/image-sniff.ts）保持独立：频道图标依赖它。
 */

export interface SniffedSticker {
  type: StickerType;
  width: number;
  height: number;
  /** More than one frame. */
  /** 多于一帧。 */
  animated: boolean;
  /** 1 for static files. */
  /** 静态文件为 1。 */
  frames: number;
  /** The byte length of the well-formed file; anything after it is not part of the image. */
  /** 格式完好的文件的字节长度；其后的内容都不属于这张图片。 */
  end: number;
  /** False only when the format guarantees every pixel is opaque. */
  /** 只有当格式保证每个像素都不透明时才为 false。 */
  mayBeTransparent: boolean;
}

function u16le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u16be(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u24le(bytes: Uint8Array, at: number): number {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8) | ((bytes[at + 2] ?? 0) << 16);
}

function u32le(bytes: Uint8Array, at: number): number {
  return (u16le(bytes, at) + u16le(bytes, at + 2) * 0x10000) >>> 0;
}

function u32be(bytes: Uint8Array, at: number): number {
  return (u16be(bytes, at) * 0x10000 + u16be(bytes, at + 2)) >>> 0;
}

function ascii(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * A four-character chunk name as the big-endian number u32be reads, so chunk types compare as numbers. The
 * constants below that call it are marked pure, so the web app's bundler can leave this file out of the entry chunk,
 * which reaches it only through the package index and never calls it.
 * 四字符的数据块名称，按 u32be 读出的大端数值表示，使数据块类型可以按数值比较。下面调用它的常量标记为纯调用，
 * 网页应用的打包工具因此可以把本文件留在入口代码块之外：入口只是经由包的索引引用到它，从不调用。
 */
function fourcc(text: string): number {
  return ((text.charCodeAt(0) << 24) | (text.charCodeAt(1) << 16) | (text.charCodeAt(2) << 8) | text.charCodeAt(3)) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** The format named by the first bytes only, without reading further. */
/** 只看开头的几个字节判断格式，不再继续读取。 */
export function detectStickerType(bytes: Uint8Array): StickerType | null {
  if (ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) return 'gif';
  if (bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return 'png';
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

/** Bytes of a GIF colour table whose flag and size sit in this packed byte; 0 when the flag is clear. */
/** 由这个打包字节中的标志和大小所描述的 GIF 颜色表的字节数；标志未设置时为 0。 */
function gifColourTable(packed: number): number {
  return (packed & 0x80) !== 0 ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
}

/**
 * GIF: the logical screen, grown to cover every frame's rectangle, gives the size; then extension blocks (0x21), image
 * descriptors (0x2C, one frame each) and the trailer (0x3B), whose index plus one is the end. Each block's data is a
 * run of sub-blocks closed by a zero length. A graphic control extension with the transparency flag marks the file as
 * possibly transparent.
 * GIF：逻辑屏幕给出尺寸，并扩大到覆盖每一帧的矩形；之后是扩展块（0x21）、图像描述符（0x2C，每个一帧）和结束符（0x3B），
 * 结束符的位置加一即为结尾。每个块的数据是一串以长度 0 结束的子块。带透明标志的图形控制扩展表示文件可能透明。
 */
function sniffGif(bytes: Uint8Array): SniffedSticker | null {
  const length = bytes.length;
  if (length < 13) return null;
  let width = u16le(bytes, 6);
  let height = u16le(bytes, 8);
  if (width === 0 || height === 0) return null;
  let at = 13 + gifColourTable(bytes[10] ?? 0);
  let frames = 0;
  let transparent = false;
  let steps = 0;
  while (at < length) {
    steps += 1;
    if (steps > STICKER_SNIFF_STEPS_MAX) return null;
    const introducer = bytes[at];
    if (introducer === 0x3b) {
      if (frames === 0) return null;
      return { type: 'gif', width, height, animated: frames > 1, frames, end: at + 1, mayBeTransparent: transparent };
    }
    if (introducer === 0x21) {
      const label = bytes[at + 1];
      at += 2;
      // Graphic control extension: a 4-byte sub-block whose first byte holds the transparency flag in bit 0.
      // 图形控制扩展：一个 4 字节的子块，其第一个字节的第 0 位是透明标志。
      if (label === 0xf9 && bytes[at] === 4 && ((bytes[at + 1] ?? 0) & 0x01) !== 0) transparent = true;
    } else if (introducer === 0x2c) {
      // Separator, left, top, width, height (10 bytes with the packed byte), a local colour table, the LZW code size.
      // 分隔符、左、上、宽、高（连同打包字节共 10 字节），然后是局部颜色表和 LZW 编码长度。
      if (at + 10 > length) return null;
      const frameWidth = u16le(bytes, at + 5);
      const frameHeight = u16le(bytes, at + 7);
      if (frameWidth === 0 || frameHeight === 0) return null;
      // Browsers decode every frame at its own rectangle, and grow the canvas to fit a first frame past the screen. The
      // size is the union of the screen and every frame, so the limits on it bound what any frame costs a viewer. A
      // later frame past the canvas can make it larger than what is shown, which only leaves margins in the box.
      // 浏览器按每一帧自己的矩形解码，并扩大画布以容纳超出屏幕的第一帧。尺寸取屏幕与每一帧的并集，
      // 因此对尺寸的限制约束了观看者解码任何一帧的开销。超出画布的后续帧可能使尺寸大于实际显示的大小，这只会让显示框留出空白。
      width = Math.max(width, u16le(bytes, at + 1) + frameWidth);
      height = Math.max(height, u16le(bytes, at + 3) + frameHeight);
      at += 10 + gifColourTable(bytes[at + 9] ?? 0) + 1;
      frames += 1;
    } else {
      return null;
    }
    for (;;) {
      if (at >= length) return null;
      steps += 1;
      if (steps > STICKER_SNIFF_STEPS_MAX) return null;
      const size = bytes[at] ?? 0;
      at += 1 + size;
      if (size === 0) break;
    }
  }
  return null;
}

const IHDR = /* @__PURE__ */ fourcc('IHDR');
const IDAT = /* @__PURE__ */ fourcc('IDAT');
const IEND = /* @__PURE__ */ fourcc('IEND');
const ACTL = /* @__PURE__ */ fourcc('acTL');
const FCTL = /* @__PURE__ */ fourcc('fcTL');
const TRNS = /* @__PURE__ */ fourcc('tRNS');

/**
 * PNG: the signature, IHDR first (size, and colour types 4 and 6 carry alpha), then every chunk up to IEND, whose
 * end is the file's end; the CRCs are not checked. tRNS adds transparency. An acTL before the first IDAT declaring
 * more than one frame makes an APNG, whose frames are its fcTL chunks; a count that differs from acTL is refused.
 * PNG：签名，IHDR 在最前（尺寸；颜色类型 4 和 6 带透明通道），然后是直到 IEND 的每个数据块，IEND 的结尾就是文件的结尾；不检查 CRC。
 * tRNS 表示有透明。第一个 IDAT 之前出现、声明多于一帧的 acTL 表示 APNG，其帧数为 fcTL 数据块的个数；与 acTL 不一致时拒绝。
 */
function sniffPng(bytes: Uint8Array): SniffedSticker | null {
  const length = bytes.length;
  if (length < 8 + 25 || u32be(bytes, 8) !== 13 || u32be(bytes, 12) !== IHDR) return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width === 0 || height === 0) return null;
  const colourType = bytes[25];
  let transparent = colourType === 4 || colourType === 6;
  let declared: number | null = null;
  let controls = 0;
  let seenData = false;
  let steps = 0;
  let at = 8;
  while (at + 12 <= length) {
    steps += 1;
    if (steps > STICKER_SNIFF_STEPS_MAX) return null;
    const size = u32be(bytes, at);
    const type = u32be(bytes, at + 4);
    const next = at + 12 + size;
    if (next > length) return null;
    if (type === IHDR && at !== 8) return null;
    if (type === IDAT) seenData = true;
    else if (type === ACTL && !seenData && size >= 8) declared = u32be(bytes, at + 8);
    else if (type === FCTL) controls += 1;
    else if (type === TRNS) transparent = true;
    else if (type === IEND) {
      if (!seenData) return null;
      const animated = declared !== null && declared > 1;
      if (animated && controls !== declared) return null;
      return { type: 'png', width, height, animated, frames: animated ? controls : 1, end: next, mayBeTransparent: transparent };
    }
    at = next;
  }
  return null;
}

const VP8 = /* @__PURE__ */ fourcc('VP8 ');
const VP8L = /* @__PURE__ */ fourcc('VP8L');
const VP8X = /* @__PURE__ */ fourcc('VP8X');
const ANMF = /* @__PURE__ */ fourcc('ANMF');
const ALPH = /* @__PURE__ */ fourcc('ALPH');
/** VP8X flags: an animation, and an alpha channel. */
/** VP8X 标志位：动画，以及透明通道。 */
const VP8X_ANIMATION = 0x02;
const VP8X_ALPHA = 0x10;

/**
 * WebP: RIFF <size> WEBP, whose end is 8 + size, padded to even. The chunks inside (8 bytes plus their size, padded to
 * even) must land exactly on that end. The first chunk is VP8 (lossy), VP8L (lossless, with an alpha bit) or VP8X
 * (extended: the canvas size, the animation and alpha flags); an animated file's frames are its ANMF chunks.
 * WebP：RIFF <大小> WEBP，结尾为 8 加大小，补齐为偶数。其中的数据块（8 字节加各自大小，补齐为偶数）必须恰好落在这个结尾上。
 * 第一个数据块是 VP8（有损）、VP8L（无损，带透明位）或 VP8X（扩展格式：画布尺寸、动画和透明标志）；动画文件的帧数为 ANMF 数据块的个数。
 */
function sniffWebp(bytes: Uint8Array): SniffedSticker | null {
  const length = bytes.length;
  if (length < 20) return null;
  const size = u32le(bytes, 4);
  const end = 8 + size + (size & 1);
  if (end > length) return null;
  let width = 0;
  let height = 0;
  let transparent = false;
  let extended = false;
  let animation = false;
  let image = false;
  let frames = 0;
  let steps = 0;
  let at = 12;
  while (at < end) {
    steps += 1;
    if (steps > STICKER_SNIFF_STEPS_MAX) return null;
    if (at + 8 > end) return null;
    const type = u32be(bytes, at);
    const chunk = u32le(bytes, at + 4);
    const data = at + 8;
    const next = data + chunk + (chunk & 1);
    if (next > end) return null;
    if (at === 12) {
      if (type === VP8) {
        // A 3-byte frame tag (bit 0 clear on a key frame), the start code 9D 01 2A, then 14-bit width and height.
        // 3 字节的帧标签（关键帧的第 0 位为 0）、起始码 9D 01 2A，然后是 14 位的宽和高。
        if (chunk < 10 || ((bytes[data] ?? 1) & 0x01) !== 0) return null;
        if (bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) return null;
        width = u16le(bytes, data + 6) & 0x3fff;
        height = u16le(bytes, data + 8) & 0x3fff;
        image = true;
      } else if (type === VP8L) {
        // The signature 0x2F, then 14 bits of width - 1, 14 bits of height - 1, 1 alpha bit and a 3-bit version of 0.
        // 签名 0x2F，然后是 14 位的宽减 1、14 位的高减 1、1 位透明标志和值为 0 的 3 位版本号。
        if (chunk < 5 || bytes[data] !== 0x2f) return null;
        const bits = u32le(bytes, data + 1);
        if (bits >>> 29 !== 0) return null;
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
        transparent = ((bits >>> 28) & 1) === 1;
        image = true;
      } else if (type === VP8X) {
        // Flags (1), reserved (3), then 24-bit canvas width - 1 and height - 1.
        // 标志（1）、保留（3），然后是 24 位的画布宽减 1 和高减 1。
        if (chunk < 10) return null;
        const flags = bytes[data] ?? 0;
        animation = (flags & VP8X_ANIMATION) !== 0;
        transparent = (flags & VP8X_ALPHA) !== 0;
        width = u24le(bytes, data + 4) + 1;
        height = u24le(bytes, data + 7) + 1;
        extended = true;
      } else {
        return null;
      }
    } else if (extended) {
      if (type === ANMF) frames += 1;
      else if (type === VP8 || type === VP8L) image = true;
      else if (type === ALPH) transparent = true;
    }
    at = next;
  }
  if (width === 0 || height === 0) return null;
  // An animation needs frames; a still needs its image data.
  // 动画需要有帧；静态图片需要有图像数据。
  if (animation ? frames === 0 : !image) return null;
  const count = animation ? frames : 1;
  return { type: 'webp', width, height, animated: count > 1, frames: count, end, mayBeTransparent: transparent };
}

/** Baseline, extended sequential and progressive Huffman frames: what browsers and phone cameras write. */
/** 基线、扩展顺序和渐进式的哈夫曼帧：浏览器和手机相机写出的正是这几种。 */
const JPEG_FRAMES = /* @__PURE__ */ new Set([0xc0, 0xc1, 0xc2]);
/** Every other start-of-frame marker: lossless, hierarchical or arithmetic coding, which is refused. */
/** 其余的帧起始标记：无损、分层或算术编码，一律拒绝。 */
const JPEG_OTHER_FRAMES = /* @__PURE__ */ new Set([0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * JPEG: SOI, then marker segments up to the first SOF0, SOF1 or SOF2, whose header gives the size. Entropy-coded data
 * is not walked, so the end cannot be found inside the file: the last two bytes must be EOI and the end is the
 * length. A JPEG with anything after its EOI is therefore null; the client re-encodes every JPEG before uploading.
 * JPEG：以 SOI 开头，随后是若干标记段，直到第一个 SOF0、SOF1 或 SOF2，其头部给出尺寸。熵编码数据不做遍历，因此无法在文件内部找到结尾：
 * 最后两个字节必须是 EOI，结尾就是文件长度。EOI 之后还有内容的 JPEG 因此返回 null；客户端上传前会重新编码每个 JPEG。
 */
function sniffJpeg(bytes: Uint8Array): SniffedSticker | null {
  const length = bytes.length;
  if (length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  if (bytes[length - 2] !== 0xff || bytes[length - 1] !== 0xd9) return null;
  let at = 2;
  let steps = 0;
  while (at < length) {
    if (bytes[at] !== 0xff) return null;
    // Any number of 0xFF fill bytes may come before a marker; each counts as a step.
    // 标记之前可以有任意个 0xFF 填充字节；每个都计一步。
    while (at < length && bytes[at] === 0xff) {
      steps += 1;
      if (steps > STICKER_SNIFF_STEPS_MAX) return null;
      at += 1;
    }
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
      return { type: 'jpeg', width, height, animated: false, frames: 1, end: length, mayBeTransparent: false };
    }
    if (JPEG_OTHER_FRAMES.has(marker)) return null;
    at += segment;
  }
  return null;
}

/**
 * The sticker a file holds, or null when it is not a well-formed GIF, PNG (APNG included), WebP or JPEG, or when
 * reading it would take more than STICKER_SNIFF_STEPS_MAX steps. `end` can be below the length: the caller cuts
 * (client) or refuses (server) whatever follows.
 * 文件中的表情；不是格式完好的 GIF、PNG（包括 APNG）、WebP 或 JPEG，或读取它需要超过 STICKER_SNIFF_STEPS_MAX 步时为 null。
 * `end` 可能小于文件长度：其后的内容由调用方截掉（客户端）或拒绝（服务端）。
 */
export function sniffSticker(bytes: Uint8Array): SniffedSticker | null {
  switch (detectStickerType(bytes)) {
    case 'gif':
      return sniffGif(bytes);
    case 'png':
      return sniffPng(bytes);
    case 'webp':
      return sniffWebp(bytes);
    case 'jpeg':
      return sniffJpeg(bytes);
    default:
      return null;
  }
}
