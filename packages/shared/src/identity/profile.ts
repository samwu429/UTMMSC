/** Profile fields and activity posts shared by the member page and the API. */
/** 成员页与接口共用的资料字段和动态。 */

export const OPEN_TO = ['internship', 'fulltime', 'study', 'research', 'alumni', 'project'] as const;
export type OpenTo = (typeof OPEN_TO)[number];

export const OPEN_TO_LABELS: Record<OpenTo, string> = {
  internship: '实习',
  fulltime: '全职',
  study: '升学',
  research: '科研',
  alumni: '校友交流',
  project: '项目合作',
};

export const HEADLINE_MAX = 80;
export const ABOUT_MAX = 800;
export const LOCATION_MAX = 40;
export const SKILL_MAX_COUNT = 12;
export const SKILL_MAX_LENGTH = 20;
export const POST_MAX = 500;
export const EXPERIENCE_LIMIT = 8;
export const AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const COVER_MAX_BYTES = 8 * 1024 * 1024;

/** Built-in avatars. Animated is `preset:<id>`. Still is `preset:<id>:still`. */
/** 自带头像。动态版为 `preset:<id>`，静态版为 `preset:<id>:still`。 */
export const PRESET_AVATARS = [
  { id: 'woman-cute-gold', label: '女 · 可爱 · 黄' },
  { id: 'woman-cool-purple', label: '女 · 帅气 · 紫' },
  { id: 'man-cute-purple', label: '男 · 可爱 · 紫' },
  { id: 'man-cool-gold', label: '男 · 帅气 · 黄' },
] as const;

export type PresetAvatarId = (typeof PRESET_AVATARS)[number]['id'];
export type PresetAvatarMotion = 'animated' | 'still';

export function isPresetAvatarId(id: string): id is PresetAvatarId {
  return PRESET_AVATARS.some((item) => item.id === id);
}

export function presetAvatarKey(id: PresetAvatarId, motion: PresetAvatarMotion = 'animated'): string {
  return motion === 'still' ? `preset:${id}:still` : `preset:${id}`;
}

/** The preset and motion a stored avatar key names, or null when it is not a known preset. */
/** 已存头像键所指的预设及动静版本；不是已知预设时为 null。 */
export function parsePresetAvatarKey(avatarKey: string): { id: PresetAvatarId; motion: PresetAvatarMotion } | null {
  if (!avatarKey.startsWith('preset:')) return null;
  const rest = avatarKey.slice('preset:'.length);
  const still = rest.endsWith(':still');
  const id = still ? rest.slice(0, -':still'.length) : rest;
  if (!isPresetAvatarId(id)) return null;
  return { id, motion: still ? 'still' : 'animated' };
}

/**
 * The original files, a 640 px GIF and a 512 px PNG. They stay deployed for builds that still ask for them, but
 * current builds draw the WebP files of presetAvatarWebpFile.
 * 最初的文件：640px 的 GIF 和 512px 的 PNG。它们仍然部署着，供仍在请求它们的旧版本使用；当前版本使用 presetAvatarWebpFile 的 WebP 文件。
 */
export function presetAvatarFile(avatarKey: string): { id: PresetAvatarId; ext: 'gif' | 'png' } | null {
  const preset = parsePresetAvatarKey(avatarKey);
  return preset ? { id: preset.id, ext: preset.motion === 'still' ? 'png' : 'gif' } : null;
}

/** Pixel sizes the preset WebP files come in. */
/** 预设头像 WebP 文件的像素尺寸。 */
export const PRESET_AVATAR_SIZES = [128, 256] as const;
export type PresetAvatarSize = (typeof PRESET_AVATAR_SIZES)[number];

/**
 * The file for an avatar drawn this many CSS pixels wide: lists (up to 48 px) take the 128 file; anything larger,
 * such as 我的 (56 px), the moments cover (64 px), the profile (80 px) and the chooser, takes the 256 file.
 * 按显示宽度（CSS 像素）选择文件：列表（不超过 48px）使用 128 文件；更大的头像，例如「我的」（56px）、动态封面（64px）、
 * 个人资料页（80px）和头像选择，使用 256 文件。
 */
export function presetAvatarSizeFor(displayPx: number): PresetAvatarSize {
  return displayPx <= 48 ? 128 : 256;
}

/**
 * The WebP file name under avatars/ for a preset key: <id>-<size>.webp, animated, or <id>-<size>-still.webp. The
 * member's choice is kept, so an animated choice stays animated, except that reducedMotion always gives the still.
 * Null when the key is not a known preset.
 * 预设头像键在 avatars/ 下对应的 WebP 文件名：动态版为 <id>-<尺寸>.webp，静态版为 <id>-<尺寸>-still.webp。保留成员的选择，
 * 选了动态版就显示动态版，只有 reducedMotion 时一律使用静态版。不是已知预设时为 null。
 */
export function presetAvatarWebpFile(avatarKey: string, size: PresetAvatarSize, reducedMotion = false): string | null {
  const preset = parsePresetAvatarKey(avatarKey);
  if (!preset) return null;
  const still = reducedMotion || preset.motion === 'still';
  return `${preset.id}-${size}${still ? '-still' : ''}.webp`;
}
export const MOMENT_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const MOMENT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const MOMENT_IMAGE_LIMIT = 9;

export const MOMENT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const MOMENT_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'] as const;

export interface Experience {
  id: string;
  title: string;
  organization: string;
  startYear: number | null;
  endYear: number | null;
  current: boolean;
  description: string | null;
}

export interface PostMedia {
  key: string;
  contentType: string;
  kind: 'image' | 'video';
  /**
   * Pixel size with EXIF orientation applied, a JPEG preview at most 720px on the long edge (a scaled photo or
   * a video's first frame), and a video's length. Absent or null for media posted before they were recorded.
   * 按 EXIF 方向得到的像素尺寸、长边不超过 720px 的 JPEG 预览图（照片的缩小版或视频的第一帧），以及视频时长。
   * 记录这些信息之前发布的媒体没有这些字段，或为 null。
   */
  width?: number | null;
  height?: number | null;
  previewKey?: string | null;
  durationMs?: number | null;
}

export interface ActivityPost {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorHeadline: string | null;
  authorAvatarKey: string | null;
  media: PostMedia[];
}
