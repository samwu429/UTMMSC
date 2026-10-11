import type { ChannelSummary, DirectConversationSummary, ChannelAudience, PostPolicy } from '../chat/rooms';
import type { FileCategory, FileRecord } from '../files/categories';
import type { EnrollmentStatus, MemberProfile, MemberSelf } from '../identity/member';
import type { Role } from '../identity/roles';

/** Error envelope returned by every failing API call. */
/** 所有失败请求返回的错误结构。 */
export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/* Auth */

export interface RequestCodeBody {
  email: string;
  purpose: 'register' | 'reset';
}

export interface RegisterBody {
  email: string;
  code: string;
  password: string;
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major?: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface ResetPasswordBody {
  email: string;
  code: string;
  password: string;
}

export interface ChangePasswordBody {
  currentPassword: string;
  newPassword: string;
}

export interface SessionResponse {
  token: string;
  expiresAt: string;
  member: MemberSelf;
}

export interface ManualApplicationBody {
  email: string;
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major?: string;
  note?: string;
}

export interface ManualApplication {
  id: string;
  email: string;
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

/* Directory */

export interface DirectoryQuery {
  q?: string;
  enrollmentStatus?: EnrollmentStatus;
  graduationYear?: number;
  cursor?: string;
}

export interface DirectoryResponse {
  members: MemberProfile[];
  nextCursor: string | null;
}

/* Chat */

export interface ChatOverviewResponse {
  channels: ChannelSummary[];
  direct: DirectConversationSummary[];
}

export interface RoomTicketResponse {
  ticket: string;
  roomId: string;
  socketUrl: string;
}

export interface CreateChannelBody {
  name: string;
  description?: string;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  memberIds?: string[];
}

export interface UpdateChannelBody {
  name?: string;
  description?: string;
  postPolicy?: PostPolicy;
}

export interface OpenDirectResponse {
  conversationId: string;
}

/* Files */

export interface FileListResponse {
  files: FileRecord[];
}

export interface FileUploadResponse {
  file: FileRecord;
}

export interface ChatImageUploadResponse {
  imageKey: string;
}

export type FileCategoryParam = FileCategory;

/* Home */

export interface DailyCardResponse {
  date: string;
  weekday: string;
  weather: {
    temperatureC: number;
    apparentC: number;
    description: string;
    precipitationChance: number | null;
  } | null;
  events: EventRecord[];
}

export interface EventRecord {
  id: string;
  title: string;
  startsAt: string;
  location: string | null;
  description: string | null;
}

export interface CreateEventBody {
  title: string;
  startsAt: string;
  location?: string;
  description?: string;
}

/* Admin */

export interface AssignRoleBody {
  role: Role;
}

export interface AnnouncementBody {
  title: string;
  body: string;
  sendEmail: boolean;
}

export interface AnnouncementResponse {
  recipientCount: number;
  emailed: boolean;
}

export interface AdminMemberRow extends MemberProfile {
  email: string;
  status: 'active' | 'pending' | 'disabled';
  createdAt: string;
}
