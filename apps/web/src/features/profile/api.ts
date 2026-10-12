import type { ActivityPost, CreateExperienceBody, Experience, FeedResponse, MemberDetailResponse, MemberSelf, UpdateProfileBody } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const profileApi = {
  detail: (id: string) => api<MemberDetailResponse>(`/members/${encodeURIComponent(id)}`),
  update: (body: UpdateProfileBody) => api<{ member: MemberSelf }>('/members/me', { method: 'PATCH', body }),
  addExperience: (body: CreateExperienceBody) => api<{ experience: Experience }>('/members/me/experiences', { method: 'POST', body }),
  removeExperience: (id: string) => api<{ ok: true }>(`/members/me/experiences/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  feed: () => api<FeedResponse>('/members/feed'),
  addPost: (text: string) => api<{ post: ActivityPost }>('/members/me/posts', { method: 'POST', body: { text } }),
  removePost: (id: string) => api<{ ok: true }>(`/members/me/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
