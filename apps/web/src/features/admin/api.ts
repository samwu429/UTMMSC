import type {
  AdminMemberRow,
  AnnouncementBody,
  AnnouncementResponse,
  CreateChannelBody,
  CreateEventBody,
  EventRecord,
  ManualApplication,
  MemberStatus,
  MemberSelf,
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
  createChannel: (body: CreateChannelBody) => api<{ channel: unknown }>('/channels', { method: 'POST', body }),
  events: () => api<{ events: EventRecord[] }>('/admin/events'),
  createEvent: (body: CreateEventBody) => api<{ event: EventRecord }>('/admin/events', { method: 'POST', body }),
  deleteEvent: (id: string) => api<{ ok: true }>(`/admin/events/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  announce: (body: AnnouncementBody) => api<AnnouncementResponse>('/admin/announcements', { method: 'POST', body }),
};
