import type { ChannelSummary, DirectConversationSummary, ChannelAudience, ChatPrefs, HistoryVisibility, PostPolicy } from '../chat/rooms';
import type { FileCategory, FileRecord } from '../files/categories';
import type { FriendshipState } from '../identity/friends';
import type { EnrollmentStatus, MemberProfile, MemberSelf } from '../identity/member';
import type { ActivityPost, Experience, OpenTo, PostMedia } from '../identity/profile';
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
  enrollmentStatus?: EnrollmentStatus;
  graduationYear?: number;
  major?: string;
  /** Present only for the external honorary advisor invite link. */
  /** 仅校外荣誉顾问邀请链接会带上。 */
  invite?: string;
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
  /** Lets image and video tags load member media without sending the session header. */
  /** 供图片和视频标签加载成员媒体，无需附带会话头。 */
  mediaToken: string;
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

export interface UpdateProfileBody {
  headline?: string | null;
  about?: string | null;
  location?: string | null;
  major?: string | null;
  skills?: string[];
  openTo?: OpenTo[];
}

export interface CreateExperienceBody {
  title: string;
  organization: string;
  startYear: number;
  endYear?: number | null;
  current: boolean;
  description?: string | null;
}

export interface CreatePostBody {
  text?: string;
  media?: Pick<PostMedia, 'key' | 'contentType'>[];
}

export interface UploadedMedia {
  key: string;
  contentType: string;
  kind: PostMedia['kind'];
}

export interface MemberDetailResponse {
  member: MemberProfile;
  experiences: Experience[];
  posts: ActivityPost[];
  mediaToken: string;
  friendship: FriendshipState;
}

export interface FriendCard {
  member: MemberProfile;
  requestedAt: string;
}

export interface FriendSummary {
  incoming: FriendCard[];
  outgoingIds: string[];
  friendIds: string[];
}

export interface FeedResponse {
  posts: ActivityPost[];
  mediaToken: string;
}

/* Chat */

export interface ChatOverviewResponse {
  channels: ChannelSummary[];
  direct: DirectConversationSummary[];
}

/** What the chat screen and the chat info page show about one room. */
/** 聊天页与聊天信息页展示的房间信息。 */
export interface RoomMeta {
  roomId: string;
  kind: 'channel' | 'direct';
  /** Channel name, or the peer's display name for a direct conversation. */
  /** 频道名称；私聊时为对方的显示名。 */
  title: string;
  description: string | null;
  memberCount: number;
  peer?: { id: string; displayName: string; avatarKey: string | null };
  audience?: ChannelAudience;
  postPolicy?: PostPolicy;
  historyVisibility?: HistoryVisibility;
  canPost: boolean;
  canModerate: boolean;
  /** Members this viewer may not moderate here because they rank at or above them. Absent when nobody is exempt. */
  /** 因档位不低于观看者、观看者在此不能处理的成员。没有这样的成员时不返回。 */
  moderationExempt?: string[];
  canManage: boolean;
  prefs: ChatPrefs;
}

export interface RoomTicketResponse {
  ticket: string;
  roomId: string;
  socketUrl: string;
  /** False when the member may read the room but the post policy excludes them. */
  /** 成员能看这个房间、但发言规则不允许时为 false。 */
  canPost: boolean;
  /** Lets image tags load this room's chat images. */
  /** 供图片标签加载本房间的聊天图片。 */
  mediaToken: string;
  /** Present only when the ticket was requested with ?meta=1. */
  /** 仅在以 ?meta=1 领取票据时返回。 */
  room?: RoomMeta;
}

export interface RoomMemberCard {
  id: string;
  displayName: string;
  avatarKey: string | null;
  role: Role;
}

export interface RoomMembersResponse {
  members: RoomMemberCard[];
  total: number;
  /** Cursor for the next page, or null on the last page. */
  /** 下一页的游标；最后一页为 null。 */
  next: string | null;
}

/** `hidden: true` hides the room from the list until a newer message arrives. */
/** `hidden: true` 会把房间从列表里隐藏，直到有更新的消息。 */
export interface UpdateChatPrefsBody {
  pinned?: boolean;
  muted?: boolean;
  markedUnread?: boolean;
  hidden?: boolean;
}

export interface ChatPrefsResponse {
  prefs: ChatPrefs;
}

/** Rows below beforeId are gone for the caller only. */
/** 只对调用者而言，beforeId 以下的消息已清空。 */
export interface ClearChatHistoryResponse {
  ok: true;
  beforeId: number;
}

export interface CreateChannelBody {
  name: string;
  description?: string;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  memberIds?: string[];
  historyVisibility?: HistoryVisibility;
}

export interface UpdateChannelBody {
  name?: string;
  description?: string | null;
  audience?: ChannelAudience;
  postPolicy?: PostPolicy;
  memberIds?: string[];
  historyVisibility?: HistoryVisibility;
}

export interface AdminChannelRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  createdAt: string;
  lastMessageAt: string | null;
  memberIds: string[];
  historyVisibility?: HistoryVisibility;
}

export interface OpenDirectResponse {
  conversationId: string;
}

export interface TranslateMessageResponse {
  text: string;
  sourceLang: 'zh-CN' | 'en';
  targetLang: 'zh-CN' | 'en';
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
