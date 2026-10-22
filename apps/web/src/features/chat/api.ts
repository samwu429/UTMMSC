import type {
  ChatImageUploadResponse,
  ChatOverviewResponse,
  ChatPrefsResponse,
  ClearChatHistoryResponse,
  OpenDirectResponse,
  RoomMembersResponse,
  RoomMeta,
  RoomTicketResponse,
  TranslateMessageResponse,
  UpdateChatPrefsBody,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';
import { API_BASE_URL } from '../../shared/api/config';

function roomPath(roomId: string, rest: string): string {
  return `/chat/rooms/${encodeURIComponent(roomId)}/${rest}`;
}

export const chatApi = {
  overview: () => api<ChatOverviewResponse>('/chat/overview'),
  openDirect: (memberId: string) => api<OpenDirectResponse>('/chat/direct', { method: 'POST', body: { memberId } }),
  /** `meta` adds the room header data; only the first ticket of a screen needs it. */
  /** `meta` 会附带房间头部信息；只有进入页面时的第一张票据需要。 */
  ticket: (roomId: string, options: { meta?: boolean } = {}) =>
    api<RoomTicketResponse>(roomPath(roomId, options.meta ? 'ticket?meta=1' : 'ticket'), { method: 'POST' }),
  info: (roomId: string) => api<RoomMeta>(roomPath(roomId, 'info')),
  members: (roomId: string, options: { q?: string; after?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (options.q) params.set('q', options.q);
    if (options.after) params.set('after', options.after);
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return api<RoomMembersResponse>(roomPath(roomId, query ? `members?${query}` : 'members'));
  },
  updatePrefs: (roomId: string, body: UpdateChatPrefsBody) => api<ChatPrefsResponse>(roomPath(roomId, 'prefs'), { method: 'PATCH', body }),
  markAllRead: (roomId: string) => api<{ ok: true }>(roomPath(roomId, 'read'), { method: 'POST' }),
  /** Clears the room for the caller only, on all of their devices. */
  /** 只为调用者清空此房间，覆盖其所有设备。 */
  clearHistory: (roomId: string) => api<ClearChatHistoryResponse>(roomPath(roomId, 'clear'), { method: 'POST' }),
  uploadImage: (roomId: string, file: File) =>
    api<ChatImageUploadResponse>(roomPath(roomId, 'images'), {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type },
    }),
  mediaUrl: (imageKey: string, mediaToken: string) => `${API_BASE_URL}/chat/media/${encodeURIComponent(imageKey)}?t=${encodeURIComponent(mediaToken)}`,
  translate: (text: string) => api<TranslateMessageResponse>('/chat/translate', { method: 'POST', body: { text } }),
};
