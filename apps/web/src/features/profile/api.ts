import type { ActivityPost, CreateExperienceBody, CreatePostBody, Experience, FeedResponse, MemberDetailResponse, MemberSelf, PresetAvatarId, PresetAvatarMotion, UpdateProfileBody, UploadedMedia } from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const profileApi = {
  detail: (id: string) => api<MemberDetailResponse>(`/members/${encodeURIComponent(id)}`),
  update: (body: UpdateProfileBody) => api<{ member: MemberSelf }>('/members/me', { method: 'PATCH', body }),
  uploadAvatar: (file: File) =>
    api<{ member: MemberSelf; mediaToken: string }>('/members/me/avatar', {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type },
    }),
  removeAvatar: () => api<{ member: MemberSelf }>('/members/me/avatar', { method: 'DELETE' }),
  choosePreset: (id: PresetAvatarId, motion: PresetAvatarMotion) =>
    api<{ member: MemberSelf }>('/members/me/avatar/preset', { method: 'POST', body: { id, motion } }),
  uploadMedia: (file: File) =>
    api<UploadedMedia>('/members/me/media', {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type },
    }),
  addExperience: (body: CreateExperienceBody) => api<{ experience: Experience }>('/members/me/experiences', { method: 'POST', body }),
  removeExperience: (id: string) => api<{ ok: true }>(`/members/me/experiences/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  feed: () => api<FeedResponse>('/members/feed'),
  addPost: (body: CreatePostBody) => api<{ post: ActivityPost }>('/members/me/posts', { method: 'POST', body }),
  removePost: (id: string) => api<{ ok: true }>(`/members/me/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
