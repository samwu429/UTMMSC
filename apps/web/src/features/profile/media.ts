import { isPresetAvatarId } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';
import { API_BASE_URL } from '../../shared/api/config';

export function mediaUrl(key: string, token: string): string {
  return `${API_BASE_URL}/members/media/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
}

/** Preset avatars are GIF files on the site, so the browser keeps them animated. Uploads come from storage. */
/** 自带头像是站内 GIF，浏览器会一直播放。自己上传的头像从存储读取。 */
export function avatarImageSrc(avatarKey: string | null | undefined, token: string | null): string | null {
  if (!avatarKey) return null;
  if (avatarKey.startsWith('preset:')) {
    const id = avatarKey.slice('preset:'.length);
    if (!isPresetAvatarId(id)) return null;
    return `${import.meta.env.BASE_URL}avatars/${id}.gif`;
  }
  if (!token) return null;
  return mediaUrl(avatarKey, token);
}

export function useMediaUrl(key: string | null | undefined): string | null {
  const token = useSessionStore((s) => s.mediaToken);
  if (!key || !token) return null;
  return mediaUrl(key, token);
}
