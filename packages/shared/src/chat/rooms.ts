import type { EnrollmentStatus } from '../identity/member';
import type { Role } from '../identity/roles';
import type { SystemEvent } from './protocol';

/**
 * Channel audience decides who may enter without an explicit membership row.
 * Enrollment and role groups are implicit; `custom` requires membership.
 * 频道受众决定无需成员记录即可进入的人群。在校/身份分组为隐式；`custom` 需要成员记录。
 */
export const CHANNEL_AUDIENCES = ['all', 'student', 'alumni', 'honorary', 'heads', 'officers', 'staff', 'custom'] as const;
export type ChannelAudience = (typeof CHANNEL_AUDIENCES)[number];

export const CHANNEL_AUDIENCE_LABELS: Record<ChannelAudience, string> = {
  all: '全体成员',
  student: '在校生',
  alumni: '毕业生',
  honorary: '荣誉顾问',
  heads: '部门部长',
  officers: '主席团',
  staff: '负责人及以上',
  custom: '指定成员',
};

export const CHANNEL_AUDIENCE_LABELS_EN: Record<ChannelAudience, string> = {
  all: 'All members',
  student: 'Students',
  alumni: 'Graduates',
  honorary: 'Honorary advisors',
  heads: 'Department heads',
  officers: 'Presidium',
  staff: 'Staff and above',
  custom: 'Selected members',
};

/** Who may post. Reading is governed by audience; posting can be narrower. */
/** 谁可以发言。阅读由受众决定，发言可更窄。 */
export const POST_POLICIES = ['members', 'staff'] as const;
export type PostPolicy = (typeof POST_POLICIES)[number];

export const POST_POLICY_LABELS: Record<PostPolicy, string> = {
  members: '所有人可发言',
  staff: '仅负责人及以上可发言',
};

export const POST_POLICY_LABELS_EN: Record<PostPolicy, string> = {
  members: 'Anyone can post',
  staff: 'Staff and above can post',
};

/**
 * Whether members who join a channel later can read what was said before they joined. This is the
 * owner's switch; the default follows WeChat and must equal the column default in migration 0013.
 * 之后加入频道的成员能否看到加入之前的消息。这是负责人可调的开关；默认与微信一致，且必须等于迁移 0013 中的列默认值。
 */
export const HISTORY_VISIBILITIES = ['since_join', 'all'] as const;
export type HistoryVisibility = (typeof HISTORY_VISIBILITIES)[number];
export const DEFAULT_HISTORY_VISIBILITY: HistoryVisibility = 'since_join';

export const HISTORY_VISIBILITY_LABELS: Record<HistoryVisibility, { zh: string; en: string }> = {
  since_join: { zh: '仅显示加入后的消息', en: 'Only messages after joining' },
  all: { zh: '新成员可查看全部历史', en: 'New members see full history' },
};

/**
 * History floor for one member in one room, computed by the Worker. joinedAt is null for direct
 * messages and for members who were already there when the policy started.
 * 某成员在某房间的历史下限，由 Worker 计算。私聊以及策略生效时已在房间里的成员，joinedAt 为 null。
 */
export interface RoomAccess {
  joinedAt: string | null;
  floorApplies: boolean;
}

/** Per-member list settings for one room, synced across devices. */
/** 成员对某个房间的列表设置，在各设备间同步。 */
export interface ChatPrefs {
  pinned: boolean;
  muted: boolean;
  markedUnread: boolean;
  hiddenAt: string | null;
}

/**
 * What the newest row is. 'sticker' carries '[表情]' as its text, which builds that predate the kind show as is.
 * 最新一条的类型。'sticker' 的 text 为 '[表情]'，早于这个类型的版本会直接显示它。
 */
export type LastMessageKind = 'text' | 'image' | 'recalled' | 'moderator_deleted' | 'deleted' | 'system' | 'sticker';

/** Newest row a member may see, for the conversation list. `text` is empty for every non-text kind but 'sticker'. */
/** 会话列表用的、成员可见的最新一条。除 'sticker' 外，非文字类型的 `text` 一律为空。 */
export interface LastMessagePreview {
  id: number;
  kind: LastMessageKind;
  authorId: string;
  authorName: string;
  text: string;
  at: string;
  system: SystemEvent | null;
}

export interface RoomMemberSummary {
  unreadCount: number;
  firstUnreadId: number | null;
  firstMentionId: number | null;
  lastMessage: LastMessagePreview | null;
  joinedAt: string | null;
}

export interface ChannelSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessage?: LastMessagePreview | null;
  joinedAt?: string | null;
  mentionedMe?: boolean;
  prefs?: ChatPrefs;
  historyVisibility?: HistoryVisibility;
  /** channel-icon/ upload or preset:<id> (chat/channel-icons.ts); null or absent shows the text tile. */
  /** channel-icon/ 下的上传图标或 preset:<id>（见 chat/channel-icons.ts）；为 null 或缺省时显示文字头像。 */
  iconKey?: string | null;
}

export interface DirectConversationSummary {
  id: string;
  peer: {
    id: string;
    displayName: string;
    role: Role;
    enrollmentStatus: EnrollmentStatus;
    graduationYear: number;
    avatarKey?: string | null;
  };
  lastMessageAt: string | null;
  /** Chinese-only line kept for old clients; new clients render lastMessage. */
  /** 仅中文的一行，为旧客户端保留；新客户端使用 lastMessage。 */
  lastPreview: string | null;
  unreadCount: number;
  lastMessage?: LastMessagePreview | null;
  /** Always false: direct messages have no mentions. */
  /** 恒为 false：私聊没有 @。 */
  mentionedMe?: boolean;
  prefs?: ChatPrefs;
}

/**
 * Room identifiers encode their kind so a single Durable Object class can serve both.
 * 房间标识符带有类型前缀，使同一个 Durable Object 类可同时服务频道与私聊。
 */
export function channelRoomId(channelId: string): string {
  return `channel:${channelId}`;
}

export function directRoomId(conversationId: string): string {
  return `direct:${conversationId}`;
}

export function parseRoomId(roomId: string): { kind: 'channel' | 'direct'; id: string } | null {
  const sep = roomId.indexOf(':');
  if (sep < 0) return null;
  const kind = roomId.slice(0, sep);
  const id = roomId.slice(sep + 1);
  if (!id) return null;
  if (kind === 'channel' || kind === 'direct') return { kind, id };
  return null;
}

/** Orders two member ids so a direct conversation has one canonical pair. */
/** 对两个成员 id 排序，使私聊只有一个规范配对。 */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}
