/**
 * Channel icons that admins can change. channels.icon_key holds either an uploaded R2 key under channel-icon/
 * (the 256 px image, with its 96 px thumbnail beside it under a -96 suffix) or preset:<id> for a bundled preset.
 * NULL keeps the text tile, which is also the placeholder and the fallback everywhere an icon shows.
 * 管理员可以更换的频道图标。channels.icon_key 保存 channel-icon/ 下上传的 R2 键（256px 图片，96px 缩略图在同一目录、带 -96 后缀），
 * 或内置预设的 preset:<id>。为 NULL 时显示文字头像；文字头像也是所有显示图标之处的占位和兜底。
 */

export const CHANNEL_ICON_SIZE = 256;
export const CHANNEL_ICON_THUMB_SIZE = 96;
/** WebP where the browser can encode it, JPEG where it cannot (Safari). The icon and its thumbnail share one type. */
/** 浏览器能编码时用 WebP，不能时（Safari）用 JPEG。图标与缩略图使用同一种类型。 */
export const CHANNEL_ICON_TYPES = ['image/webp', 'image/jpeg'] as const;
export type ChannelIconType = (typeof CHANNEL_ICON_TYPES)[number];
export const CHANNEL_ICON_MAX_BYTES = 256 * 1024;
export const CHANNEL_ICON_THUMB_MAX_BYTES = 64 * 1024;

export const CHANNEL_ICON_PRESETS = [
  { id: 'announce', zh: '公告', en: 'Announcements' },
  { id: 'chat', zh: '闲聊', en: 'General' },
  { id: 'academic', zh: '学术', en: 'Academic' },
  { id: 'events', zh: '活动', en: 'Events' },
  { id: 'tech', zh: '科技', en: 'Technology' },
  { id: 'publicity', zh: '宣传', en: 'Publicity' },
  { id: 'sponsor', zh: '赞助', en: 'Sponsorship' },
  { id: 'alumni', zh: '校友', en: 'Alumni' },
] as const;
export type ChannelIconPresetId = (typeof CHANNEL_ICON_PRESETS)[number]['id'];

const PRESET_PREFIX = 'preset:';
export const CHANNEL_ICON_KEY_PREFIX = 'channel-icon/';

/**
 * channel-icon/<channelId>/<name>.<webp|jpg>, where the name is randomId('cic'): cic_ and 16 base64url characters.
 * The fixed length keeps an upload apart from its -96 thumbnail, and the character set rules out '..' and '/'.
 * channel-icon/<频道 id>/<名称>.<webp|jpg>，名称为 randomId('cic')：cic_ 加 16 个 base64url 字符。固定长度使上传图片与其 -96
 * 缩略图不会混淆，字符集也排除了 '..' 和 '/'。
 */
const UPLOAD_KEY = /^channel-icon\/[A-Za-z0-9_-]{1,64}\/cic_[A-Za-z0-9_-]{16}\.(?:webp|jpg)$/;
const THUMB_KEY = /^channel-icon\/[A-Za-z0-9_-]{1,64}\/cic_[A-Za-z0-9_-]{16}-96\.(?:webp|jpg)$/;

export function isChannelIconPresetId(id: string): id is ChannelIconPresetId {
  return CHANNEL_ICON_PRESETS.some((preset) => preset.id === id);
}

/** 'preset:announce' for 'announce'. */
/** 'announce' 对应 'preset:announce'。 */
export function channelIconPresetKey(id: ChannelIconPresetId): string {
  return `${PRESET_PREFIX}${id}`;
}

/** The preset a stored key names, or null for an upload, no icon or an unknown preset. */
/** 已存键所指的预设；上传的图标、没有图标或未知预设时为 null。 */
export function channelIconPresetId(key: string | null | undefined): ChannelIconPresetId | null {
  if (!key?.startsWith(PRESET_PREFIX)) return null;
  const id = key.slice(PRESET_PREFIX.length);
  return isChannelIconPresetId(id) ? id : null;
}

/** Whether a key is an uploaded 256 px icon (not its thumbnail). */
/** 键是否为上传的 256px 图标（不是缩略图）。 */
export function isChannelIconUploadKey(key: string): boolean {
  return UPLOAD_KEY.test(key);
}

/** Whether a key is an uploaded icon or its thumbnail, the two objects media routes may serve. */
/** 键是否为上传的图标或其缩略图，即媒体接口可以提供的两种对象。 */
export function isChannelIconObjectKey(key: string): boolean {
  return UPLOAD_KEY.test(key) || THUMB_KEY.test(key);
}

/** Whether a key may be stored in channels.icon_key: an upload or a known preset. */
/** 键能否存入 channels.icon_key：上传的图标或已知预设。 */
export function isChannelIconKey(key: string): boolean {
  return isChannelIconUploadKey(key) || channelIconPresetId(key) !== null;
}

/** The 96 px thumbnail beside an upload: .../cic_x.webp becomes .../cic_x-96.webp. Other keys come back unchanged. */
/** 上传图标旁的 96px 缩略图：.../cic_x.webp 变为 .../cic_x-96.webp。其他键原样返回。 */
export function channelIconThumbKey(key: string): string {
  return isChannelIconUploadKey(key) ? key.replace(/\.(webp|jpg)$/, '-96.$1') : key;
}

/** File extension for an icon type. */
/** 图标类型对应的文件扩展名。 */
export function channelIconExtension(type: ChannelIconType): 'webp' | 'jpg' {
  return type === 'image/webp' ? 'webp' : 'jpg';
}

export function isChannelIconType(type: string): type is ChannelIconType {
  return (CHANNEL_ICON_TYPES as readonly string[]).includes(type);
}
