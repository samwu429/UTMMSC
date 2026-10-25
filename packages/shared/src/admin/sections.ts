/**
 * The one permission registry for admin. It decides who may open admin, which sections each role sees, and which
 * counts GET /admin/summary returns. Everything reads the viewed role (MemberSelf.role, which is the test identity
 * while a system admin tests another role), so a test shows exactly that role's admin. The server stays the
 * authority on every action.
 * 管理后台唯一的权限登记表。它决定谁能进入管理后台、每种身份能看到哪些板块，以及 GET /admin/summary 返回哪些计数。
 * 一律按当前视角的身份（MemberSelf.role；系统管理员测试其他身份时就是测试身份）判断，因此测试时看到的正是那个身份的后台。
 * 每个操作仍以服务端为准。
 */
import { hasPermission, type Role } from '../identity/roles';

export const ADMIN_SECTION_KEYS = ['review', 'members', 'advisors', 'channels', 'events', 'announcements', 'reports'] as const;
export type AdminSectionKey = (typeof ADMIN_SECTION_KEYS)[number];

/** Sidebar groups: 成员 People, 内容 Content, 安全 Safety. The overview sits above them. */
/** 侧边栏分组：成员、内容、安全。管理首页在它们之上。 */
export const ADMIN_SECTION_GROUPS = ['people', 'content', 'safety'] as const;
export type AdminSectionGroup = (typeof ADMIN_SECTION_GROUPS)[number];

export const ADMIN_SECTION_GROUP_LABELS: Record<AdminSectionGroup, { zh: string; en: string }> = {
  people: { zh: '成员', en: 'People' },
  content: { zh: '内容', en: 'Content' },
  safety: { zh: '安全', en: 'Safety' },
};

export const ADMIN_COUNT_KEYS = [
  'pendingApplications',
  'pendingYearRequests',
  'openReports',
  'activeMembers',
  'disabledMembers',
  'channels',
  'upcomingEvents',
  'openInvites',
  'announcementRecipients',
] as const;
export type AdminCountKey = (typeof ADMIN_COUNT_KEYS)[number];
export type AdminCounts = Partial<Record<AdminCountKey, number>>;

export interface AdminSectionInfo {
  key: AdminSectionKey;
  group: AdminSectionGroup;
  zh: string;
  en: string;
  /** Route of the section's list, under /admin. */
  /** 板块列表的路由，位于 /admin 之下。 */
  path: string;
  /** Counts that add up to the section's red badge: work waiting for someone. */
  /** 合计为板块红色角标的计数：等待处理的事项。 */
  badge: readonly AdminCountKey[];
}

/** In sidebar order. */
/** 按侧边栏顺序排列。 */
export const ADMIN_SECTIONS: readonly AdminSectionInfo[] = [
  { key: 'review', group: 'people', zh: '待审核', en: 'Review', path: '/admin/review', badge: ['pendingApplications', 'pendingYearRequests'] },
  { key: 'members', group: 'people', zh: '成员与身份', en: 'Members and roles', path: '/admin/members', badge: [] },
  { key: 'advisors', group: 'people', zh: '荣誉顾问邀请', en: 'Advisor invitations', path: '/admin/advisors', badge: [] },
  { key: 'channels', group: 'content', zh: '频道', en: 'Channels', path: '/admin/channels', badge: [] },
  { key: 'events', group: 'content', zh: '活动', en: 'Events', path: '/admin/events', badge: [] },
  { key: 'announcements', group: 'content', zh: '公告', en: 'Announcements', path: '/admin/announcements', badge: [] },
  { key: 'reports', group: 'safety', zh: '动态投诉', en: 'Update reports', path: '/admin/reports', badge: ['openReports'] },
];

/** 入会申请: anyone who approves members. */
/** 入会申请：能审核成员的人。 */
export function canReviewApplications(role: Role): boolean {
  return hasPermission(role, 'members.approve');
}

/** 入学年份申请: the system admin only, by the viewed role, so a test as another role hides them. */
/** 入学年份申请：只有系统管理员，按当前视角的身份判断，测试其他身份时不显示。 */
export function canReviewYearRequests(role: Role): boolean {
  return role === 'superadmin';
}

const SECTION_ACCESS: Record<AdminSectionKey, (role: Role) => boolean> = {
  review: (role) => canReviewApplications(role) || canReviewYearRequests(role),
  members: (role) => hasPermission(role, 'members.assign_role'),
  advisors: (role) => role === 'superadmin',
  channels: (role) => hasPermission(role, 'channels.manage'),
  events: (role) => hasPermission(role, 'events.manage'),
  announcements: (role) => hasPermission(role, 'announcements.send'),
  // The club's content moderation permission, the same one that moderates channels.
  // 社团的内容管理权限，与管理频道发言的权限相同。
  reports: (role) => hasPermission(role, 'chat.moderate'),
};

export function canUseAdminSection(role: Role, key: AdminSectionKey): boolean {
  return SECTION_ACCESS[key](role);
}

/** The sections a role sees, in sidebar order. */
/** 某身份能看到的板块，按侧边栏顺序排列。 */
export function adminSectionsFor(role: Role): AdminSectionKey[] {
  return ADMIN_SECTION_KEYS.filter((key) => SECTION_ACCESS[key](role));
}

/** Whether admin shows at all: the role sees at least one section. */
/** 是否显示管理入口：该身份至少能看到一个板块。 */
export function canOpenAdmin(member: { role: Role } | null | undefined): boolean {
  return member != null && adminSectionsFor(member.role).length > 0;
}

const COUNT_ACCESS: Record<AdminCountKey, (role: Role) => boolean> = {
  pendingApplications: canReviewApplications,
  pendingYearRequests: canReviewYearRequests,
  openReports: SECTION_ACCESS.reports,
  activeMembers: SECTION_ACCESS.members,
  disabledMembers: SECTION_ACCESS.members,
  channels: SECTION_ACCESS.channels,
  upcomingEvents: SECTION_ACCESS.events,
  openInvites: SECTION_ACCESS.advisors,
  announcementRecipients: SECTION_ACCESS.announcements,
};

/** The counts GET /admin/summary may return to a role: only those of sections it can use. */
/** GET /admin/summary 可以返回给某身份的计数：只包括其能使用的板块的计数。 */
export function adminCountsFor(role: Role): AdminCountKey[] {
  return ADMIN_COUNT_KEYS.filter((key) => COUNT_ACCESS[key](role));
}

/** A section's red badge: the sum of its waiting counts the summary returned. */
/** 板块的红色角标：摘要中该板块等待处理的计数之和。 */
export function adminBadgeCount(key: AdminSectionKey, counts: AdminCounts): number {
  const section = ADMIN_SECTIONS.find((item) => item.key === key);
  return (section?.badge ?? []).reduce((sum, countKey) => sum + (counts[countKey] ?? 0), 0);
}

/** Everything waiting, for the red count on 发现 → 管理. */
/** 所有等待处理的事项，用于「发现 → 管理」上的红色数字。 */
export function adminPendingTotal(counts: AdminCounts): number {
  return ADMIN_SECTIONS.reduce((sum, section) => sum + adminBadgeCount(section.key, counts), 0);
}
