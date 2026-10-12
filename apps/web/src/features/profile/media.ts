import { useSessionStore } from '../../shared/session/store';
import { API_BASE_URL } from '../../shared/api/config';

export function mediaUrl(key: string, token: string): string {
  return `${API_BASE_URL}/members/media/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
}

export function useMediaUrl(key: string | null | undefined): string | null {
  const token = useSessionStore((s) => s.mediaToken);
  if (!key || !token) return null;
  return mediaUrl(key, token);
}
