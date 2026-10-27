import { CHAT_IMAGE_MAX_BYTES } from '../files/categories';
import { NOTIFICATION_TIME_ZONE, wallClockAt } from '../notifications/schedule';

/**
 * Custom stickers (我的表情): the shared description of one sticker file, the limits every side enforces, the
 * server's refusal messages and the R2 key shapes. A sticker is stored once per file, content-addressed by a keyed
 * hash of its bytes, at sticker/<id>.<type>; each uploader's still sits beside it at sticker/<id>-t-<thumb>.
 * 自定义表情（我的表情）：单个表情文件的共享描述、各端都要遵守的上限、服务端的拒绝提示以及 R2 键的格式。每个文件只存一份，
 * 以其字节的带密钥哈希作为内容地址，存放在 sticker/<id>.<type>；每位上传者的静态缩略图放在旁边的 sticker/<id>-t-<thumb>。
 */

/** File types a sticker can have, named by the sniffed bytes, never by a file name or a declared type. */
/** 表情文件可以使用的类型，由嗅探到的字节决定，从不依据文件名或声明的类型。 */
export const STICKER_TYPES = ['gif', 'png', 'webp', 'jpeg'] as const;
export type StickerType = (typeof STICKER_TYPES)[number];

/** The content type each sticker type is stored and served with. */
/** 每种表情类型存储和提供时使用的内容类型。 */
export const STICKER_MIME_TYPES: Readonly<Record<StickerType, string>> = {
  gif: 'image/gif',
  png: 'image/png',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

/**
 * One sticker as a message, a collection row and the panel describe it. Everything but `thumb` comes from the
 * stored file row; `thumb` names the still this member or this message shows (sticker/<id>-t-<thumb>), or null.
 * 消息、表情列表记录和表情面板所描述的一个表情。除 `thumb` 以外都来自已保存的文件记录；`thumb` 指明这位成员或这条消息显示的静态图
 * （sticker/<id>-t-<thumb>），没有时为 null。
 */
export interface StickerRef {
  id: string;
  type: StickerType;
  width: number;
  height: number;
  animated: boolean;
  bytes: number;
  thumb: string | null;
}

const MIB = 1024 * 1024;
/** Side of the square whose area is the animated limit; also the number its message names. */
/** 动图面积上限对应的正方形边长，也是提示中写出的数字。 */
const ANIMATED_SIDE = 1024;

/** Stickers one member can keep, as in WeChat. */
/** 每位成员最多可保存的表情数，与微信相同。 */
export const STICKERS_PER_MEMBER_MAX = 999;
/** Largest sticker file, the same as a chat photo. */
/** 表情文件的最大字节数，与聊天图片相同。 */
export const STICKER_MAX_BYTES = CHAT_IMAGE_MAX_BYTES;
/** Longest side of any sticker file; the client resizes static files above it. */
/** 任何表情文件的最长边；静态文件超过时由客户端缩小。 */
export const STICKER_DIMENSION_MAX = 2048;
/** Width times height of an animated file, so wide or tall stickers are not refused needlessly. */
/** 动图的宽乘高上限，这样较宽或较高的表情不会被无谓地拒绝。 */
export const STICKER_ANIMATED_PIXELS_MAX = ANIMATED_SIDE * ANIMATED_SIDE;
/** Frames of an animated file. */
/** 动图的帧数上限。 */
export const STICKER_ANIMATED_FRAMES_MAX = 300;
/** Blocks, chunks and sub-blocks one sniff may walk before it gives up. */
/** 一次嗅探最多遍历的块、数据块和子块数，超过即放弃。 */
export const STICKER_SNIFF_STEPS_MAX = 60_000;
/** Long edge static files are re-encoded to when above it (every JPEG is re-encoded). */
/** 静态文件长边超过此值时重新编码到此尺寸（所有 JPEG 都会重新编码）。 */
export const STICKER_STATIC_LONG_EDGE = 720;
/** Long edge of the still the client makes. */
/** 客户端生成的静态缩略图的长边。 */
export const STICKER_THUMB_LONG_EDGE = 240;
/** Longest side of a still the upload route accepts. */
/** 上传接口接受的静态缩略图的最长边。 */
export const STICKER_THUMB_DIMENSION_MAX = 256;
/** Largest still. */
/** 静态缩略图的最大字节数。 */
export const STICKER_THUMB_MAX_BYTES = 96 * 1024;
/** Largest upload body: the still followed by the sticker. */
/** 上传请求体的最大字节数：静态缩略图加上表情文件。 */
export const STICKER_UPLOAD_REQUEST_MAX_BYTES = STICKER_MAX_BYTES + STICKER_THUMB_MAX_BYTES;
/** Ids one front or remove call may name: the whole collection, so one 全选 then 删除 is one call. */
/** 一次移到最前或删除调用可以包含的 id 数：整个表情列表，因此全选后删除只需一次调用。 */
export const STICKER_IDS_PER_CALL_MAX = STICKERS_PER_MEMBER_MAX;
/** Uploads per member per club-local day. */
/** 每位成员每个社团本地日的上传次数。 */
export const STICKER_UPLOADS_PER_DAY = 30;
/** Upload bytes (file plus still) per member per club-local day. */
/** 每位成员每个社团本地日的上传字节数（文件加静态缩略图）。 */
export const STICKER_UPLOAD_BYTES_PER_DAY = 40 * MIB;
/** Ids added, moved or removed per member per club-local day. */
/** 每位成员每个社团本地日可添加、移动或删除的 id 数。 */
export const STICKER_EDITS_PER_DAY = 2000;
/** Full lists per member per club-local day; lists answered "unchanged" are free. */
/** 每位成员每个社团本地日的完整列表次数；回答「未变化」的列表不计。 */
export const STICKER_FULL_LISTS_PER_DAY = 30;
/** Bytes of files and stills a member created that still exist. */
/** 成员创建且仍然存在的文件和静态缩略图的字节数上限。 */
export const STICKER_LIVE_BYTES_PER_MEMBER = 300 * MIB;
/** Uploads by the whole club per club-local day. */
/** 全会每个社团本地日的上传次数。 */
export const STICKER_CLUB_UPLOADS_PER_DAY = 500;
/** Upload bytes of the whole club per club-local day. */
/** 全会每个社团本地日的上传字节数。 */
export const STICKER_CLUB_UPLOAD_BYTES_PER_DAY = 300 * MIB;
/** Ids added, moved or removed by the whole club per club-local day. */
/** 全会每个社团本地日可添加、移动或删除的 id 数。 */
export const STICKER_CLUB_EDITS_PER_DAY = 5000;
/** Sticker bytes the club may store, 40 % of R2's free 10 GB. */
/** 全会可存储的表情字节数，为 R2 免费 10 GB 的 40%。 */
export const STICKER_CLUB_LIVE_BYTES = 4 * 1024 * MIB;
/** An upload that never finished is swept after this long. */
/** 一直没有完成的上传在这么久之后被清理。 */
export const STICKER_PENDING_TTL_MS = 60 * 60 * 1000;
/** A file never sent and in nobody's collection is swept after this long. */
/** 从未发出、也不在任何人表情列表中的文件在这么久之后被清理。 */
export const STICKER_UNSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Files one pick may add. */
/** 一次选择最多可以添加的文件数。 */
export const STICKER_PICK_MAX = 9;

/**
 * The stored text of a sticker message, and its label in lists, pushes and quotes for builds that predate stickers.
 * 表情消息保存的文字；对于早于表情功能的版本，也是它在列表、推送和引用中的显示文字。
 */
export const STICKER_TEXT = '[表情]';

/**
 * The server's refusals, in Chinese on the wire; their English lives in apps/web/src/shared/api/errors/stickers.ts.
 * The numbers come from the limits above, so changing a limit changes its message.
 * 服务端的拒绝提示，线路上为中文；英文在 apps/web/src/shared/api/errors/stickers.ts。其中的数字取自上面的上限，修改上限时提示会随之改变。
 */
export const STICKER_MESSAGES = {
  tooLarge: `表情不能超过 ${STICKER_MAX_BYTES / MIB}MB`,
  dimensions: `图片太大，长宽不能超过 ${STICKER_DIMENSION_MAX} 像素`,
  animatedSize: `动图太大，长宽不能超过 ${ANIMATED_SIDE} 像素`,
  frames: `动图帧数太多，不能超过 ${STICKER_ANIMATED_FRAMES_MAX} 帧`,
  unreadable: '无法识别这张图片',
  thumb: '添加失败，请重试',
  checksum: '上传的文件不完整，请重试',
  ids: '操作失败，请重试',
  notFound: '这个表情已失效',
  blocked: '这个表情已被停用',
  full: `最多添加 ${STICKERS_PER_MEMBER_MAX} 个表情，请先删除一些`,
  daily: '今天上传的表情太多了，请明天再试',
  edits: '今天整理表情的次数太多了，请明天再试',
  clubLimit: '表情功能今天已达上限，请明天再试',
  memberStorage: '你上传的表情太多了，暂时不能再上传',
  clubStorage: '表情存储空间已满，请联系主席团',
  pending: '表情功能暂不可用',
  unavailable: '表情暂不可用，请稍后再试',
  blockForbidden: '只有系统管理员可以封禁表情',
} as const;

export type StickerMessageKey = keyof typeof STICKER_MESSAGES;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * The club-local date (America/Toronto) as YYYY-MM-DD: the day every daily sticker count belongs to, so 明天 in a
 * refusal is true for the club.
 * 社团所在地（America/Toronto）的日期，格式为 YYYY-MM-DD：每个表情日计数所属的那一天，因此拒绝提示中的「明天」对社团而言是准确的。
 */
export function stickerDay(nowMs: number): string {
  const w = wallClockAt(nowMs, NOTIFICATION_TIME_ZONE);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

const STICKER_ID = /^stk_[A-Za-z0-9_-]{22}$/;
const THUMB_TOKEN = /^[A-Za-z0-9_-]{22}$/;
/**
 * sticker/<id>.<type> or sticker/<id>-t-<thumb>. The id and the token have fixed lengths and a character set
 * without '.' or '/', so the two shapes never overlap and nothing can climb out of sticker/.
 * sticker/<id>.<type> 或 sticker/<id>-t-<thumb>。id 和令牌长度固定，字符集不含 '.' 和 '/'，因此两种格式不会混淆，也无法跳出 sticker/。
 */
const OBJECT_KEY = /^sticker\/stk_[A-Za-z0-9_-]{22}(?:\.(?:gif|png|webp|jpeg)|-t-[A-Za-z0-9_-]{22})$/;
/** The file name an old-client alias ends with: <id>.<type>. */
/** 旧客户端别名结尾的文件名：<id>.<type>。 */
const ALIAS_NAME = /^stk_[A-Za-z0-9_-]{22}\.(?:gif|png|webp|jpeg)$/;

/** Whether a value is a sticker id: stk_ and 22 base64url characters. */
/** 值是否为表情 id：stk_ 加 22 个 base64url 字符。 */
export function isStickerId(value: unknown): value is string {
  return typeof value === 'string' && STICKER_ID.test(value);
}

/** Whether a value is a still's token: 22 base64url characters. */
/** 值是否为静态缩略图的令牌：22 个 base64url 字符。 */
export function isStickerThumbToken(value: unknown): value is string {
  return typeof value === 'string' && THUMB_TOKEN.test(value);
}

export function isStickerType(value: unknown): value is StickerType {
  return typeof value === 'string' && (STICKER_TYPES as readonly string[]).includes(value);
}

/** The original file: sticker/<id>.<type>. */
/** 原始文件：sticker/<id>.<type>。 */
export function stickerObjectKey(id: string, type: StickerType): string {
  return `sticker/${id}.${type}`;
}

/** One uploader's still: sticker/<id>-t-<thumb>. */
/** 某位上传者的静态缩略图：sticker/<id>-t-<thumb>。 */
export function stickerThumbKey(id: string, thumb: string): string {
  return `sticker/${id}-t-${thumb}`;
}

/** Whether a key is a sticker original or still, the two sticker objects media routes may serve. */
/** 键是否为表情原始文件或静态缩略图，即媒体接口可以提供的两种表情对象。 */
export function isStickerObjectKey(key: string): boolean {
  return OBJECT_KEY.test(key);
}

/** The room's own image prefix, chat/<kind>/<id>/, built the way chatImageKey builds it. */
/** 房间自己的图片前缀 chat/<类型>/<id>/，与 chatImageKey 的构造方式相同。 */
function roomPrefix(roomId: string): string {
  return `chat/${roomId.replace(':', '/')}/`;
}

/**
 * The key old clients load a sticker message from: chat/<kind>/<roomId>/<id>.<type>. It is never stored; the chat
 * media route serves the original for it. Real chat uploads are named img_<16>.<ext>, so the two never collide.
 * 旧客户端加载表情消息所用的键：chat/<类型>/<房间 id>/<id>.<type>。它从不实际存储，聊天媒体接口会为它提供原始文件。
 * 真正的聊天上传命名为 img_<16>.<ext>，两者不会冲突。
 */
export function stickerAliasKey(roomId: string, sticker: Pick<StickerRef, 'id' | 'type'>): string {
  return `${roomPrefix(roomId)}${sticker.id}.${sticker.type}`;
}

/**
 * The sticker original an alias names, when the key is exactly this room's prefix followed by one alias file name;
 * null for anything else: real chat images, stills, another room's alias, extra segments or '..'.
 * 当键恰好是本房间的前缀加上一个别名文件名时，返回别名所指的表情原始文件；其他情况一律为 null：真正的聊天图片、静态缩略图、
 * 其他房间的别名、多出的路径段或 '..'。
 */
export function stickerKeyForAlias(roomId: string, key: string): string | null {
  const prefix = roomPrefix(roomId);
  if (!key.startsWith(prefix) || key.includes('..')) return null;
  const name = key.slice(prefix.length);
  return ALIAS_NAME.test(name) ? `sticker/${name}` : null;
}

/**
 * Whether a file name, or the last segment of a key, has the shape of a sticker alias (<id>.<type>). The room
 * refuses such names in a message's image and thumbnail keys, so no alias is ever stored.
 * 文件名或键的最后一段是否具有表情别名的格式（<id>.<type>）。房间会拒绝消息的图片键和缩略图键中出现这样的名字，因此别名从不被存储。
 */
export function isStickerAliasName(name: string): boolean {
  return ALIAS_NAME.test(name.slice(name.lastIndexOf('/') + 1));
}

/**
 * Widest and tallest size a received description may claim. Equal to IMAGE_DIMENSION_MAX in protocol.ts (a test
 * keeps them equal); defined here so this file imports nothing from the protocol, which imports it.
 * 收到的描述可以声明的最大宽高。与 protocol.ts 中的 IMAGE_DIMENSION_MAX 相等（由测试保证）；在这里单独定义，
 * 使本文件不必从引用它的协议文件中导入任何内容。
 */
const REF_DIMENSION_MAX = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= REF_DIMENSION_MAX;
}

/**
 * A sticker description as received, or null when any field is wrong. Dimensions are checked leniently, against the
 * general image bound rather than the upload limits, so changing a limit later never hides a row. A `thumb` that is
 * not a token becomes null without invalidating the rest. Applying it twice gives the same result.
 * 收到的表情描述；任何字段有误时为 null。尺寸只按一般图片的上限宽松检查，而不按上传上限，所以以后修改上限也不会让已有的消息消失。
 * 不是令牌的 `thumb` 变为 null，但不影响其余部分。重复调用结果相同。
 */
export function normalizeStickerRef(value: unknown): StickerRef | null {
  if (!isRecord(value)) return null;
  const { id, type, width, height, animated, bytes, thumb } = value;
  if (!isStickerId(id) || !isStickerType(type)) return null;
  if (!isDimension(width) || !isDimension(height)) return null;
  if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
  if (typeof animated !== 'boolean') return null;
  return { id, type, width, height, animated, bytes, thumb: isStickerThumbToken(thumb) ? thumb : null };
}
