import type {
  AdminAnnouncementsResponse,
  AdminChannelRow,
  AdminEventsResponse,
  AdminMemberRow,
  AdminSummaryResponse,
  AnnouncementBody,
  AnnouncementResponse,
  CreateChannelBody,
  CreateEventBody,
  CreateEventResponse,
  EnrollmentStatus,
  ManualApplication,
  MemberStatus,
  MemberSelf,
  Role,
  UpdateChannelBody,
} from '@utmmsc/shared';
import { api } from '../../shared/api/client';

/** A pending request to change an enrollment year, as GET /admin/enrollment-year-requests lists it. */
/** 一条待处理的入学年份修改申请，即 GET /admin/enrollment-year-requests 列出的内容。 */
export interface AdminYearRequest {
  id: string;
  memberId: string;
  displayName: string;
  email: string;
  currentYear: number;
  requestedYear: number;
  createdAt: string;
}

/** An advisor invitation not used yet. The server does not keep its email language. */
/** 一封尚未使用的荣誉顾问邀请。服务器不保存它的邮件语言。 */
export interface AdminAdvisorInvite {
  id: string;
  email: string;
  expiresAt: string;
  createdAt: string;
}

export type ReviewDecision = 'approve' | 'reject';

const enc = encodeURIComponent;

export const adminApi = {
  /** Counts for the dashboard, the sidebar and the 发现 badge; 404 on servers before it shipped. */
  /** 管理首页、侧边栏和「发现」角标用的计数；在该接口上线之前的服务器返回 404。 */
  summary: () => api<AdminSummaryResponse>('/admin/summary'),
  applications: () => api<{ applications: ManualApplication[] }>('/admin/applications'),
  decide: (id: string, decision: ReviewDecision) => api<{ ok: true }>(`/admin/applications/${enc(id)}/${decision}`, { method: 'POST' }),
  members: () => api<{ members: AdminMemberRow[] }>('/admin/members'),
  /** `enrollmentStatus` is for 撤销: kept only by a role that implies none, ignored by servers before it shipped. */
  /** `enrollmentStatus` 用于「撤销」：只有不隐含在读状态的身份才会采用；在它上线之前的服务器会忽略它。 */
  setRole: (id: string, role: Role, enrollmentStatus?: EnrollmentStatus) =>
    api<{ ok: true; role?: Role; enrollmentStatus?: EnrollmentStatus }>(`/admin/members/${enc(id)}/role`, { method: 'POST', body: { role, enrollmentStatus } }),
  setStatus: (id: string, status: MemberStatus) => api<{ ok: true }>(`/admin/members/${enc(id)}/status`, { method: 'POST', body: { status } }),
  setEnrollment: (id: string, graduationYear: number, enrollmentStatus: EnrollmentStatus) =>
    api<{ ok: true; graduationYear: number; enrollmentStatus: EnrollmentStatus }>(`/admin/members/${enc(id)}/enrollment`, {
      method: 'POST',
      body: { graduationYear, enrollmentStatus },
    }),
  setActingRole: (role: Role | null) => api<{ member: MemberSelf }>('/admin/acting-role', { method: 'POST', body: { role } }),
  enrollmentYearRequests: () => api<{ requests: AdminYearRequest[] }>('/admin/enrollment-year-requests'),
  decideEnrollmentYear: (id: string, decision: ReviewDecision) => api<{ ok: true }>(`/admin/enrollment-year-requests/${enc(id)}/${decision}`, { method: 'POST' }),
  channels: () => api<{ channels: AdminChannelRow[] }>('/channels'),
  /** One channel, for a deep link to its settings. */
  /** 单个频道，用于直接打开其设置的链接。 */
  channel: (id: string) => api<{ channel: AdminChannelRow }>(`/channels/${enc(id)}`),
  createChannel: (body: CreateChannelBody) => api<{ channel: AdminChannelRow }>('/channels', { method: 'POST', body }),
  updateChannel: (id: string, body: UpdateChannelBody) => api<{ channel: AdminChannelRow }>(`/channels/${enc(id)}`, { method: 'PATCH', body }),
  deleteChannel: (id: string) => api<{ ok: true }>(`/channels/${enc(id)}`, { method: 'DELETE' }),
  events: () => api<AdminEventsResponse>('/admin/events'),
  createEvent: (body: CreateEventBody) => api<CreateEventResponse>('/admin/events', { method: 'POST', body }),
  deleteEvent: (id: string) => api<{ ok: true }>(`/admin/events/${enc(id)}`, { method: 'DELETE' }),
  announce: (body: AnnouncementBody) => api<AnnouncementResponse>('/admin/announcements', { method: 'POST', body }),
  /** Sent announcements, newest first, 20 a page; 404 on servers before it shipped. */
  /** 已发送的公告，最新的在前，每页 20 条；在该接口上线之前的服务器返回 404。 */
  announcements: (cursor?: string | null) =>
    api<AdminAnnouncementsResponse>(cursor ? `/admin/announcements?cursor=${enc(cursor)}` : '/admin/announcements'),
  advisorInvites: () => api<{ invites: AdminAdvisorInvite[] }>('/admin/advisor-invites'),
  sendAdvisorInvite: (email: string, lang: 'zh' | 'en') =>
    api<{ ok: true; email: string; expiresAt: string }>('/admin/advisor-invites', { method: 'POST', body: { email, lang } }),
};
