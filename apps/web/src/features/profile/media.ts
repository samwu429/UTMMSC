import { presetAvatarKey, presetAvatarSizeFor, presetAvatarWebpFile, type PresetAvatarId, type PresetAvatarMotion, type PresetAvatarSize } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';
import { API_BASE_URL } from '../../shared/api/config';

export function mediaUrl(key: string, token: string): string {
  return `${API_BASE_URL}/members/media/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
}

/** Most avatars are list avatars, 40 CSS px. */
/** 大多数头像是列表头像，40 CSS px。 */
export const LIST_AVATAR_PX = 40;

export interface AvatarSrcOptions {
  /** CSS pixels the avatar is drawn at, which picks the 128 or 256 preset file. */
  /** 头像的显示尺寸（CSS 像素），据此选择 128 或 256 的预设文件。 */
  displayPx?: number;
  /** Forces the preset file size, for a small avatar on a page that deserves the sharper file. */
  /** 强制使用某个尺寸的预设文件，用于值得用更清晰文件的页面上的小头像。 */
  presetSize?: PresetAvatarSize;
  /** The system asks for less motion, so an animated preset shows its still file. */
  /** 系统要求减弱动态效果，因此动态预设显示静态文件。 */
  reducedMotion?: boolean;
}

/** A preset avatar's WebP file under the app's base path. */
/** 预设头像在应用基础路径下的 WebP 文件地址。 */
export function presetAvatarSrc(id: PresetAvatarId, motion: PresetAvatarMotion, size: PresetAvatarSize, reducedMotion = false): string {
  return `${import.meta.env.BASE_URL}avatars/${presetAvatarWebpFile(presetAvatarKey(id, motion), size, reducedMotion) ?? ''}`;
}

/**
 * The image address of an avatar key. Presets are small WebP files: 128 px for lists, 256 px above 48 CSS px. An
 * animated choice stays animated, except with reduced motion. Uploaded photos come from the media route.
 * 头像键对应的图片地址。预设头像是小巧的 WebP 文件：列表用 128px，超过 48 CSS px 用 256px。选择了动态版就保持动态，
 * 只有减弱动态效果时例外。上传的照片来自媒体接口。
 */
export function avatarImageSrc(avatarKey: string | null | undefined, token: string | null, options: AvatarSrcOptions = {}): string | null {
  if (!avatarKey) return null;
  if (avatarKey.startsWith('preset:')) {
    const size = options.presetSize ?? presetAvatarSizeFor(options.displayPx ?? LIST_AVATAR_PX);
    const file = presetAvatarWebpFile(avatarKey, size, options.reducedMotion === true);
    return file ? `${import.meta.env.BASE_URL}avatars/${file}` : null;
  }
  if (!token) return null;
  return mediaUrl(avatarKey, token);
}

/**
 * The CSS pixel size a Tailwind class list gives an avatar: the unprefixed h-N (N spacing units of 4px) or h-[Npx].
 * Null when the classes do not say.
 * Tailwind 类名给头像的 CSS 像素尺寸：不带前缀的 h-N（N 个 4px 间距单位）或 h-[Npx]。类名没有说明时为 null。
 */
export function avatarPxFromClass(className: string): number | null {
  for (const token of className.split(/\s+/)) {
    const units = /^h-(\d+(?:\.5)?)$/.exec(token);
    if (units) return Number(units[1]) * 4;
    const pixels = /^h-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
    if (pixels) return Number(pixels[1]);
  }
  return null;
}

export function coverImageSrc(coverKey: string | null | undefined, token: string | null): string | null {
  if (!coverKey || !token) return null;
  return mediaUrl(coverKey, token);
}

export function useMediaUrl(key: string | null | undefined): string | null {
  const token = useSessionStore((s) => s.mediaToken);
  if (!key || !token) return null;
  return mediaUrl(key, token);
}
