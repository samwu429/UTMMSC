import type { EnrollmentStatus } from '../identity/member';
import type { Role } from '../identity/roles';

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

/** Who may post. Reading is governed by audience; posting can be narrower. */
/** 谁可以发言。阅读由受众决定，发言可更窄。 */
export const POST_POLICIES = ['members', 'staff'] as const;
export type PostPolicy = (typeof POST_POLICIES)[number];

export const POST_POLICY_LABELS: Record<PostPolicy, string> = {
  members: '所有人可发言',
  staff: '仅负责人及以上可发言',
};

export interface ChannelSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  unreadCount: number;
  lastMessageAt: string | null;
}

export interface DirectConversationSummary {
  id: string;
  peer: {
    id: string;
    displayName: string;
    role: Role;
    enrollmentStatus: EnrollmentStatus;
    graduationYear: number;
  };
  lastMessageAt: string | null;
  lastPreview: string | null;
  unreadCount: number;
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
