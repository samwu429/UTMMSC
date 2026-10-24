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

/** Built-in avatars. Animated is `preset:<id>` (gif). Still is `preset:<id>:still` (png). */
/** 自带头像。动态版为 `preset:<id>`（gif），静态版为 `preset:<id>:still`（png）。 */
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

export function presetAvatarFile(avatarKey: string): { id: PresetAvatarId; ext: 'gif' | 'png' } | null {
  if (!avatarKey.startsWith('preset:')) return null;
  const rest = avatarKey.slice('preset:'.length);
  const still = rest.endsWith(':still');
  const id = still ? rest.slice(0, -':still'.length) : rest;
  if (!isPresetAvatarId(id)) return null;
  return { id, ext: still ? 'png' : 'gif' };
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
