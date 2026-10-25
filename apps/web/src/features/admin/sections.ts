import { ADMIN_SECTIONS, adminSectionsFor, canUseAdminSection, type AdminCountKey, type AdminCounts, type AdminSectionKey, type Role } from '@utmmsc/shared';

/**
 * The web side of the admin registry (packages/shared admin/sections.ts decides who sees what): routes, the old
 * ?tab= links, quick actions and the words the overview puts beside each section. Pure, so it is tested without a
 * browser. Every count is optional: a server before GET /admin/summary, or a role that may not see a count, simply
 * has none.
 * 管理后台登记表的网页部分（谁能看到什么由 packages/shared 的 admin/sections.ts 决定）：路由、旧的 ?tab= 链接、快捷操作，以及管理首页
 * 写在各板块旁边的文字。纯函数，无需浏览器即可测试。每个计数都是可选的：GET /admin/summary 上线之前的服务器，或无权查看某个计数的身份，
 * 都只是没有这个计数。
 */

/** A phrase in both languages; screens pick one with tr(zh, en). */
/** 两种语言的一句话；界面用 tr(zh, en) 选择其一。 */
export interface Phrase {
  zh: string;
  en: string;
}

export const ADMIN_HOME = '/admin';

/** English plural for a count: 1 application, 3 applications. */
/** 计数的英文单复数：1 application、3 applications。 */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function sectionPath(key: AdminSectionKey): string {
  return ADMIN_SECTIONS.find((section) => section.key === key)?.path ?? ADMIN_HOME;
}

export function sectionLabel(key: AdminSectionKey): Phrase {
  const section = ADMIN_SECTIONS.find((item) => item.key === key);
  return { zh: section?.zh ?? key, en: section?.en ?? key };
}

/** The ?tab= values of the old tabbed admin page, and the section each one lives in now. */
/** 旧版标签式管理页的 ?tab= 取值，以及它们现在各自所在的板块。 */
export const LEGACY_TABS: Readonly<Record<string, AdminSectionKey>> = {
  approvals: 'review',
  roles: 'members',
  advisors: 'advisors',
  channels: 'channels',
  events: 'events',
  announcements: 'announcements',
  moments: 'reports',
};

/**
 * Where an old /admin?tab= link goes, or null when the address has no tab. `&channel=<id>` with tab=channels opens
 * that channel, which is how chat info links to a channel's settings in both the old and the new admin. An unknown
 * tab goes to the overview.
 * 旧的 /admin?tab= 链接应去的地址；地址中没有 tab 时为 null。tab=channels 加上 `&channel=<id>` 会打开该频道，聊天信息在新旧两版管理后台
 * 中都用这种方式链接到频道设置。未知的 tab 前往管理首页。
 */
export function legacyAdminPath(search: string): string | null {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  if (tab === null) return null;
  const section = Object.prototype.hasOwnProperty.call(LEGACY_TABS, tab) ? LEGACY_TABS[tab] : undefined;
  if (!section) return ADMIN_HOME;
  const channel = params.get('channel')?.trim();
  if (section === 'channels' && channel) return `${sectionPath('channels')}/${encodeURIComponent(channel)}`;
  return sectionPath(section);
}

/** The section a pathname under /admin belongs to, or null for the overview and anything else. */
/** /admin 下某个路径所属的板块；管理首页及其他路径为 null。 */
export function sectionOfPath(pathname: string): AdminSectionKey | null {
  for (const section of ADMIN_SECTIONS) {
    if (pathname === section.path || pathname.startsWith(`${section.path}/`)) return section.key;
  }
  return null;
}

/**
 * Where /admin itself goes for a role: null for the overview, or the path of the only section when the role can use
 * exactly one (活动部部长 lands on 活动).
 * /admin 本身对某身份的去向：显示管理首页时为 null；只能使用一个板块时（例如活动部部长只有「活动」）为该板块的路径。
 */
export function adminLanding(role: Role): string | null {
  const sections = adminSectionsFor(role);
  return sections.length === 1 ? sectionPath(sections[0]!) : null;
}

/**
 * Where the back button of a section's own list goes: the overview, or 发现 for a role whose only section it is,
 * since that role never sees the overview.
 * 板块列表的返回按钮去往哪里：管理首页；若这是该身份唯一的板块，则去「发现」，因为该身份从不会看到管理首页。
 */
export function sectionBackTarget(role: Role): Phrase & { to: string } {
  return adminLanding(role) === null ? { to: ADMIN_HOME, zh: '管理', en: 'Admin' } : { to: '/discover', zh: '发现', en: 'Discover' };
}

export type QuickActionKey = 'event' | 'announcement' | 'channel' | 'advisor';

export interface QuickAction extends Phrase {
  key: QuickActionKey;
  section: AdminSectionKey;
  path: string;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: 'event', section: 'events', path: '/admin/events/new', zh: '新建活动', en: 'New event' },
  { key: 'announcement', section: 'announcements', path: '/admin/announcements/new', zh: '发布公告', en: 'New announcement' },
  { key: 'channel', section: 'channels', path: '/admin/channels/new', zh: '新建频道', en: 'New channel' },
  { key: 'advisor', section: 'advisors', path: '/admin/advisors', zh: '邀请荣誉顾问', en: 'Invite an advisor' },
];

/** The quick actions a role may take, in the overview's order. */
/** 某身份可用的快捷操作，按管理首页的顺序。 */
export function quickActionsFor(role: Role): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => canUseAdminSection(role, action.section));
}

export interface PendingItem extends Phrase {
  key: AdminCountKey;
  count: number;
  path: string;
}

/**
 * The 待处理 card: one row per count with work waiting, linking to where it is done. Empty when nothing waits.
 * 「待处理」卡片：每个有待办事项的计数一行，链接到处理它的地方。没有待办时为空。
 */
export function pendingItems(counts: AdminCounts): PendingItem[] {
  const items: PendingItem[] = [];
  const applications = counts.pendingApplications ?? 0;
  if (applications > 0) {
    items.push({
      key: 'pendingApplications',
      count: applications,
      path: '/admin/review?type=applications',
      zh: `${applications} 个入会申请待审核`,
      en: `${plural(applications, 'application', 'applications')} waiting`,
    });
  }
  const years = counts.pendingYearRequests ?? 0;
  if (years > 0) {
    items.push({
      key: 'pendingYearRequests',
      count: years,
      path: '/admin/review?type=years',
      zh: `${years} 个入学年份申请待审核`,
      en: `${plural(years, 'enrollment year request', 'enrollment year requests')} waiting`,
    });
  }
  const reports = counts.openReports ?? 0;
  if (reports > 0) {
    items.push({
      key: 'openReports',
      count: reports,
      path: '/admin/reports',
      zh: `${reports} 条动态投诉待处理`,
      en: `${plural(reports, 'report', 'reports')} open`,
    });
  }
  return items;
}

/** The value at the end of a section's row on the overview, or null when there is nothing to say. */
/** 管理首页上某板块一行末尾的取值；没有可说的内容时为 null。 */
export function sectionValue(key: AdminSectionKey, counts: AdminCounts): Phrase | null {
  switch (key) {
    case 'members': {
      const n = counts.activeMembers;
      return n === undefined ? null : { zh: `${n} 人`, en: plural(n, 'member', 'members') };
    }
    case 'advisors': {
      const n = counts.openInvites ?? 0;
      return n > 0 ? { zh: `${n} 个未使用`, en: `${n} unused` } : null;
    }
    case 'channels': {
      const n = counts.channels;
      return n === undefined ? null : { zh: `${n} 个`, en: String(n) };
    }
    case 'events': {
      const n = counts.upcomingEvents ?? 0;
      return n > 0 ? { zh: `${n} 个即将开始`, en: `${n} upcoming` } : null;
    }
    default:
      return null;
  }
}

/** The 概况 line of the desktop overview: members, channels and upcoming events, as far as the role sees them. */
/** 桌面版管理首页的「概况」一行：成员、频道和即将开始的活动，以该身份能看到的为限。 */
export function overviewFacts(counts: AdminCounts): Phrase[] {
  const facts: Phrase[] = [];
  if (counts.activeMembers !== undefined) facts.push({ zh: `成员 ${counts.activeMembers}`, en: plural(counts.activeMembers, 'member', 'members') });
  if (counts.channels !== undefined) facts.push({ zh: `频道 ${counts.channels}`, en: plural(counts.channels, 'channel', 'channels') });
  if (counts.upcomingEvents !== undefined) {
    facts.push({ zh: `即将开始的活动 ${counts.upcomingEvents}`, en: plural(counts.upcomingEvents, 'upcoming event', 'upcoming events') });
  }
  return facts;
}
