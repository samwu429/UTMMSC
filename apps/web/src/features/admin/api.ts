import type {
  AdminMemberRow,
  AnnouncementBody,
  AnnouncementResponse,
  ChannelAudience,
  CreateChannelBody,
  CreateEventBody,
  EventRecord,
  ManualApplication,
  MemberStatus,
  MemberSelf,
  PostPolicy,
  Role,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

export const adminApi = {
  applications: () => api<{ applications: ManualApplication[] }>('/admin/applications'),
  decide: (id: string, decision: 'approve' | 'reject') => api<{ ok: true }>(`/admin/applications/${encodeURIComponent(id)}/${decision}`, { method: 'POST' }),
  members: () => api<{ members: AdminMemberRow[] }>('/admin/members'),
  setRole: (id: string, role: Role) => api<{ ok: true }>(`/admin/members/${encodeURIComponent(id)}/role`, { method: 'POST', body: { role } }),
  setStatus: (id: string, status: MemberStatus) => api<{ ok: true }>(`/admin/members/${encodeURIComponent(id)}/status`, { method: 'POST', body: { status } }),
  setEnrollment: (id: string, graduationYear: number, enrollmentStatus: 'student' | 'alumni') =>
    api<{ ok: true; graduationYear: number; enrollmentStatus: 'student' | 'alumni' }>(`/admin/members/${encodeURIComponent(id)}/enrollment`, {
      method: 'POST',
      body: { graduationYear, enrollmentStatus },
    }),
  setActingRole: (role: Role | null) => api<{ member: MemberSelf }>('/admin/acting-role', { method: 'POST', body: { role } }),
  enrollmentYearRequests: () =>
    api<{
      requests: { id: string; memberId: string; displayName: string; email: string; currentYear: number; requestedYear: number; createdAt: string }[];
    }>('/admin/enrollment-year-requests'),
  decideEnrollmentYear: (id: string, decision: 'approve' | 'reject') =>
    api<{ ok: true }>(`/admin/enrollment-year-requests/${encodeURIComponent(id)}/${decision}`, { method: 'POST' }),
  channels: () =>
    api<{
      channels: {
        id: string;
        slug: string;
        name: string;
        description: string | null;
        audience: ChannelAudience;
        postPolicy: PostPolicy;
        createdAt: string;
        lastMessageAt: string | null;
      }[];
    }>('/channels'),
  createChannel: (body: CreateChannelBody) => api<{ channel: unknown }>('/channels', { method: 'POST', body }),
  deleteChannel: (id: string) => api<{ ok: true }>(`/channels/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  events: () => api<{ events: EventRecord[] }>('/admin/events'),
  createEvent: (body: CreateEventBody) => api<{ event: EventRecord }>('/admin/events', { method: 'POST', body }),
  deleteEvent: (id: string) => api<{ ok: true }>(`/admin/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  announce: (body: AnnouncementBody) => api<AnnouncementResponse>('/admin/announcements', { method: 'POST', body }),
  advisorInvites: () =>
    api<{ invites: { id: string; email: string; expiresAt: string; createdAt: string }[] }>('/admin/advisor-invites'),
  sendAdvisorInvite: (email: string, lang: 'zh' | 'en') =>
    api<{ ok: true; email: string; expiresAt: string }>('/admin/advisor-invites', { method: 'POST', body: { email, lang } }),
};
