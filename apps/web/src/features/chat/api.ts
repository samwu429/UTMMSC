import type { ChatImageUploadResponse, ChatOverviewResponse, OpenDirectResponse, RoomTicketResponse, TranslateMessageResponse } from '@utmmsc/shared';
import { api } from '../../shared/api/client';
import { API_BASE_URL } from '../../shared/api/config';

export interface RoomTicket extends RoomTicketResponse {
  mediaToken: string;
}

export const chatApi = {
  overview: () => api<ChatOverviewResponse>('/chat/overview'),
  openDirect: (memberId: string) => api<OpenDirectResponse>('/chat/direct', { method: 'POST', body: { memberId } }),
  ticket: (roomId: string) => api<RoomTicket>(`/chat/rooms/${encodeURIComponent(roomId)}/ticket`, { method: 'POST' }),
  uploadImage: (roomId: string, file: File) =>
    api<ChatImageUploadResponse>(`/chat/rooms/${encodeURIComponent(roomId)}/images`, {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type },
    }),
  mediaUrl: (imageKey: string, mediaToken: string) => `${API_BASE_URL}/chat/media/${encodeURIComponent(imageKey)}?t=${encodeURIComponent(mediaToken)}`,
  translate: (text: string) => api<TranslateMessageResponse>('/chat/translate', { method: 'POST', body: { text } }),
};
