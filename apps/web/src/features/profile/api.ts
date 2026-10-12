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
  uploadCover: (file: File) =>
    api<{ member: MemberSelf; mediaToken: string }>('/members/me/cover', {
      method: 'POST',
      rawBody: file,
      headers: { 'content-type': file.type },
    }),
  removeCover: () => api<{ member: MemberSelf }>('/members/me/cover', { method: 'DELETE' }),
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
  graduate: () => api<{ member: MemberSelf }>('/members/me/graduate', { method: 'POST' }),
  enrollmentYearRequest: () => api<{ request: { id: string; requestedYear: number; createdAt: string } | null }>('/members/me/enrollment-year-request'),
  submitEnrollmentYear: (graduationYear: number) =>
    api<{ request: { id: string; requestedYear: number; createdAt: string } }>('/members/me/enrollment-year-request', { method: 'POST', body: { graduationYear } }),
  cancelEnrollmentYear: () => api<{ ok: true }>('/members/me/enrollment-year-request', { method: 'DELETE' }),
};
