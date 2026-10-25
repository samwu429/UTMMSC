import type { AdminCounts, AdminSectionKey } from '../admin/sections';
import type { ChannelIconPresetId } from '../chat/channel-icons';
import type { ChannelSummary, DirectConversationSummary, ChannelAudience, ChatPrefs, HistoryVisibility, PostPolicy } from '../chat/rooms';
import type { FileCategory, FileRecord } from '../files/categories';
import type { FriendshipState } from '../identity/friends';
import type { EnrollmentStatus, MemberProfile, MemberSelf } from '../identity/member';
import type { ActivityPost, Experience, OpenTo, PostMedia } from '../identity/profile';
import type { Role } from '../identity/roles';
import type { EventNotificationPlan, EventNotificationRow, NotificationPrefs } from '../notifications/types';

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
  /** Channels only: channel-icon/ upload or preset:<id>; null or absent shows the text tile. */
  /** 仅频道：channel-icon/ 下的上传图标或 preset:<id>；为 null 或缺省时显示文字头像。 */
  iconKey?: string | null;
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
  /** Absent from servers before migration 0018. */
  /** 迁移 0018 之前的服务器不返回。 */
  iconKey?: string | null;
  /** When the icon last changed, as toISOString writes it. */
  /** 图标最后修改的时间，格式与 toISOString 一致。 */
  iconUpdatedAt?: string | null;
}

/** POST /channels/:id/icon answers with a media token so the new image can load at once. */
/** POST /channels/:id/icon 同时返回媒体令牌，新图片可以立即加载。 */
export interface ChannelIconResponse {
  channel: AdminChannelRow;
  mediaToken?: string;
}

/** Body of POST /channels/:id/icon/preset. */
/** POST /channels/:id/icon/preset 的请求体。 */
export interface SetChannelIconPresetBody {
  id: ChannelIconPresetId;
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
  /** Omitted means DEFAULT_EVENT_NOTIFICATION_PLAN; omitted fields inside it take their defaults too. */
  /** 省略时使用 DEFAULT_EVENT_NOTIFICATION_PLAN；其中省略的字段同样取默认值。 */
  notifications?: Partial<EventNotificationPlan>;
}

/** An event in the admin list, with every notice planned for it. */
/** 管理后台列表中的活动，附带其全部通知计划。 */
export interface AdminEventRecord extends EventRecord {
  notifications: EventNotificationRow[];
}

export interface AdminEventsResponse {
  events: AdminEventRecord[];
}

export interface CreateEventResponse {
  event: AdminEventRecord;
}

/* Notifications */

export interface VapidKeyResponse {
  publicKey: string;
}

export interface NotificationPrefsResponse {
  prefs: NotificationPrefs;
}

export type UpdateNotificationPrefsBody = Partial<NotificationPrefs>;

/** Longest wait POST /notifications/test accepts before sending. */
/** POST /notifications/test 发送前可等待的最长秒数。 */
export const TEST_NOTIFICATION_DELAY_MAX = 10;

/**
 * Optional body of POST /notifications/test. A short delay lets the member leave the app first: Android
 * only puts a push in the notification shade while the app is in the background.
 * POST /notifications/test 的可选请求体。短暂等待让成员先离开 App：安卓只在 App 处于后台时才把推送放进通知栏。
 */
export interface TestNotificationBody {
  delaySeconds?: number;
}

/**
 * How the push went for the device making the request: sent; refused by the push service (failed); the
 * push service no longer knows it (gone, and the server dropped it); not attempted because of the server
 * or the push service (unavailable); or this device is not registered under the current sign-in (none).
 * 发出请求的这台设备的推送结果：已发送（sent）；被推送服务拒绝（failed）；推送服务已不认识它（gone，服务器已删除）；
 * 因服务器或推送服务的问题没有尝试（unavailable）；或这台设备没有在当前登录下登记（none）。
 */
export type TestDeviceOutcome = 'sent' | 'failed' | 'gone' | 'unavailable' | 'none';

/** Result of POST /notifications/test: devices tried, and how many accepted the push. */
/** POST /notifications/test 的结果：尝试的设备数，以及其中接受推送的数量。 */
export interface TestNotificationResponse {
  sent: number;
  failed: number;
  devices: number;
  /** Absent from servers older than this field. */
  /** 早于此字段的服务器不返回。 */
  thisDevice?: TestDeviceOutcome;
  /** Some devices were not tried because of the server or the push service, not the devices themselves. */
  /** 有设备因服务器或推送服务的问题没有尝试，而不是设备本身的问题。 */
  serviceProblem?: boolean;
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

/**
 * GET /admin/summary: the sections the viewed role sees and only the counts of those sections
 * (admin/sections.ts adminCountsFor). A count whose table is missing reads as 0.
 * GET /admin/summary：当前视角身份能看到的板块，以及仅属于这些板块的计数（见 admin/sections.ts 的 adminCountsFor）。表不存在的计数为 0。
 */
export interface AdminSummaryResponse {
  sections: AdminSectionKey[];
  counts: AdminCounts;
}

/** One sent announcement. emailed false means it was only saved here, and no member saw it. */
/** 一条已发送的公告。emailed 为 false 表示只保存在这里，没有成员看到。 */
export interface AdminAnnouncementRow {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  recipientCount: number;
  emailed: boolean;
  sentBy: { id: string; displayName: string } | null;
}

/** GET /admin/announcements?cursor=: newest first, 20 a page. */
/** GET /admin/announcements?cursor=：最新的在前，每页 20 条。 */
export interface AdminAnnouncementsResponse {
  announcements: AdminAnnouncementRow[];
  nextCursor: string | null;
}

export interface AdminMemberRow extends MemberProfile {
  email: string;
  status: 'active' | 'pending' | 'disabled';
  createdAt: string;
}
