import { presetAvatarFile } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';
import { API_BASE_URL } from '../../shared/api/config';

export function mediaUrl(key: string, token: string): string {
  return `${API_BASE_URL}/members/media/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
}

/** Animated presets are GIFs, so they keep moving everywhere. Still presets are PNGs. */
/** 动态版是 GIF，走到哪都在动。静态版是 PNG。 */
export function avatarImageSrc(avatarKey: string | null | undefined, token: string | null): string | null {
  if (!avatarKey) return null;
  const preset = presetAvatarFile(avatarKey);
  if (avatarKey.startsWith('preset:')) {
    if (!preset) return null;
    return `${import.meta.env.BASE_URL}avatars/${preset.id}.${preset.ext}`;
  }
  if (!token) return null;
  return mediaUrl(avatarKey, token);
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
