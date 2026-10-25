import {
  ROLE_GROUPS,
  canAssignRole,
  canHoldEnrollment,
  isHonoraryRole,
  isOfficeRole,
  roleTier,
  shouldGraduate,
  type AdminMemberRow,
  type EnrollmentStatus,
  type Role,
} from '@utmmsc/shared';
import { sectionPath, type Phrase } from '../sections';

/**
 * 成员与身份 without the screens: filters and their counts, search, grouping, who holds each office, what the viewer
 * may change and which roles they may give. The server checks every change again; these rules only decide what the
 * screens offer. Pure, so it is tested without a browser.
 * 不含界面的「成员与身份」：筛选及其计数、搜索、分组、各职位由谁担任、查看者能修改什么以及能任命哪些身份。服务器会再次检查每一项修改；
 * 这些规则只决定界面提供哪些选项。纯函数，无需浏览器即可测试。
 */

export const MEMBER_FILTERS = ['all', 'presidium', 'heads', 'members', 'honorary', 'disabled'] as const;
export type MemberFilter = (typeof MEMBER_FILTERS)[number];

export const MEMBER_FILTER_LABELS: Record<MemberFilter, Phrase> = {
  all: { zh: '全部', en: 'All' },
  presidium: { zh: '主席团', en: 'Presidium' },
  heads: { zh: '部门部长', en: 'Department heads' },
  members: { zh: '成员', en: 'Members' },
  honorary: { zh: '荣誉顾问', en: 'Honorary advisors' },
  disabled: { zh: '已停用', en: 'Disabled' },
};

/** The ROLE_GROUPS label each role filter shows. */
/** 每个身份筛选对应的 ROLE_GROUPS 分组名。 */
const FILTER_GROUP: Record<Exclude<MemberFilter, 'all' | 'disabled'>, string> = {
  presidium: '主席团',
  heads: '部门',
  members: '成员',
  honorary: '荣誉顾问',
};

/** Groups from the highest tier down, the way the list is read: who runs the club first. */
/** 分组从最高档位往下排列，与阅读列表的顺序一致：先看到社团的负责人。 */
export const GROUP_ORDER = ['系统', '主席团', '部门', '荣誉顾问', '成员'] as const;

export function membersPath(id?: string, search = ''): string {
  const base = sectionPath('members');
  return `${id ? `${base}/${encodeURIComponent(id)}` : base}${search}`;
}

export function readMemberFilter(raw: string | null): MemberFilter {
  return MEMBER_FILTERS.find((filter) => filter === raw) ?? 'all';
}

export function groupOf(role: Role): string {
  return ROLE_GROUPS.find((group) => group.roles.includes(role))?.label ?? '成员';
}

function roleOrder(role: Role): number {
  const group = ROLE_GROUPS.find((item) => item.roles.includes(role));
  return group ? group.roles.indexOf(role) : 0;
}

/**
 * Role filters show members who can act in that role, so a disabled former head is under 已停用, not 部门部长. 全部
 * shows everyone.
 * 身份筛选只显示能以该身份行事的成员，因此已停用的前任部长出现在「已停用」中，而不在「部门部长」中。「全部」显示所有人。
 */
export function matchesFilter(member: AdminMemberRow, filter: MemberFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'disabled') return member.status === 'disabled';
  if (member.status === 'disabled') return false;
  return groupOf(member.role) === FILTER_GROUP[filter];
}

export function filterCounts(members: readonly AdminMemberRow[]): Record<MemberFilter, number> {
  const counts = Object.fromEntries(MEMBER_FILTERS.map((filter) => [filter, 0])) as Record<MemberFilter, number>;
  for (const member of members) {
    for (const filter of MEMBER_FILTERS) if (matchesFilter(member, filter)) counts[filter] += 1;
  }
  return counts;
}

/** Lowercased text the search runs against: name, email and every name given for the role. */
/** 搜索所依据的小写文字：姓名、邮箱以及该身份的所有名称。 */
export function searchText(member: AdminMemberRow, roleNames: (role: Role) => readonly string[]): string {
  return [member.displayName, member.email, ...roleNames(member.role)].join('\n').toLocaleLowerCase();
}

/** Every word of the query must appear; an empty query matches everything. */
/** 查询中的每个词都必须出现；空查询匹配所有内容。 */
export function matchesQuery(text: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => text.includes(word));
}

export interface MemberGroup {
  /** The ROLE_GROUPS label, such as 主席团. */
  /** ROLE_GROUPS 的分组名，例如「主席团」。 */
  label: string;
  members: AdminMemberRow[];
}

/**
 * The list grouped by role group, highest tier first. Inside a group: the order of its roles (主席 before 秘书长),
 * active before disabled, then by name.
 * 按身份分组的列表，最高档位在前。组内：按该组身份的顺序（主席在秘书长之前），在用的在已停用的之前，然后按姓名排列。
 */
export function groupMembers(members: readonly AdminMemberRow[], locale: 'zh' | 'en' = 'zh'): MemberGroup[] {
  const collator = new Intl.Collator(locale === 'en' ? 'en' : 'zh-Hans-CN', { sensitivity: 'base', numeric: true });
  const byGroup = new Map<string, AdminMemberRow[]>();
  for (const member of members) {
    const label = groupOf(member.role);
    const list = byGroup.get(label);
    if (list) list.push(member);
    else byGroup.set(label, [member]);
  }
  const groups: MemberGroup[] = [];
  for (const label of GROUP_ORDER) {
    const list = byGroup.get(label);
    if (!list) continue;
    list.sort(
      (a, b) =>
        roleOrder(a.role) - roleOrder(b.role) ||
        Number(a.status === 'disabled') - Number(b.status === 'disabled') ||
        collator.compare(a.displayName, b.displayName) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    groups.push({ label, members: list });
  }
  return groups;
}

/** The first `limit` rows across the groups, for a long list shown 50 at a time. */
/** 跨分组的前 `limit` 行，用于每次显示 50 行的长列表。 */
export function limitGroups(groups: readonly MemberGroup[], limit: number): { groups: MemberGroup[]; hidden: number } {
  const shown: MemberGroup[] = [];
  let left = Math.max(0, limit);
  let hidden = 0;
  for (const group of groups) {
    if (left <= 0) {
      hidden += group.members.length;
      continue;
    }
    const members = group.members.slice(0, left);
    hidden += group.members.length - members.length;
    left -= members.length;
    shown.push({ label: group.label, members });
  }
  return { groups: shown, hidden };
}

/**
 * Who holds each constitution office now. As on the server, only active members occupy an office.
 * 现在各章程职位由谁担任。与服务器一致，只有在用的成员占用职位。
 */
export function officeHolders(members: readonly AdminMemberRow[]): Map<Role, AdminMemberRow> {
  const holders = new Map<Role, AdminMemberRow>();
  for (const member of members) {
    if (member.status === 'active' && isOfficeRole(member.role) && !holders.has(member.role)) holders.set(member.role, member);
  }
  return holders;
}

/**
 * Why the viewer can't change this member, or null when they can: their own account, someone at or above their
 * tier, or an honorary advisor (system admin only). The same tests as the server's role and status routes.
 * 查看者不能修改这位成员的原因，可以修改时为 null：本人的账号、档位不低于自己的人，或荣誉顾问（只有系统管理员可以）。与服务器的身份和
 * 状态接口检查相同。
 */
export type EditBlock = 'self' | 'rank' | 'honorary';

export function editBlock(viewer: { id: string; role: Role }, target: Pick<AdminMemberRow, 'id' | 'role'>): EditBlock | null {
  if (viewer.id === target.id) return 'self';
  if (viewer.role === 'superadmin') return null;
  if (isHonoraryRole(target.role)) return 'honorary';
  if (roleTier(target.role) >= roleTier(viewer.role)) return 'rank';
  return null;
}

export type RoleBlock = 'held' | 'superadmin_only' | 'graduated';

export interface RoleChoice {
  role: Role;
  block: RoleBlock | null;
  /** The active holder, when the office is taken. */
  /** 职位已有人担任时的在用担任者。 */
  holder: AdminMemberRow | null;
}

export interface RoleChoiceGroup {
  label: string;
  choices: RoleChoice[];
}

/**
 * The role picker: every role grouped as ROLE_GROUPS, each with the reason it can't be given, if any. The member's
 * own role is always open. The 系统 group shows only to a system admin.
 * 身份选择：按 ROLE_GROUPS 分组的所有身份，各自附带不能任命的原因（如有）。成员当前的身份总是可选。「系统」分组只对系统管理员显示。
 */
export function roleChoices(viewerRole: Role, target: AdminMemberRow, holders: ReadonlyMap<Role, AdminMemberRow>, now: Date = new Date()): RoleChoiceGroup[] {
  const graduated = shouldGraduate(target.graduationYear, 'student', now);
  return ROLE_GROUPS.filter((group) => group.label !== '系统' || viewerRole === 'superadmin').map((group) => ({
    label: group.label,
    choices: group.roles.map((role): RoleChoice => {
      if (role === target.role) return { role, block: null, holder: null };
      if (!canAssignRole(viewerRole, role)) return { role, block: 'superadmin_only', holder: null };
      const holder = isOfficeRole(role) ? (holders.get(role) ?? null) : null;
      if (holder && holder.id !== target.id) return { role, block: 'held', holder };
      if (role === 'student' && graduated) return { role, block: 'graduated', holder: null };
      return { role, block: null, holder: null };
    }),
  }));
}

/**
 * Five years after enrollment, and for honorary advisors, the enrollment status can only be 毕业生.
 * 入学满五年后，以及荣誉顾问，在读状态只能是毕业生。
 */
export function enrollmentLocked(member: Pick<AdminMemberRow, 'role' | 'graduationYear'>, now: Date = new Date()): boolean {
  return shouldGraduate(member.graduationYear, 'student', now) || !canHoldEnrollment(member.role, 'student');
}

/** The status a correction will store: a year five or more years back, or a role that can't be a student, means 毕业生. */
/** 更正后将保存的状态：入学年份在五年或更早之前，或该身份不能是在校生，都意味着毕业生。 */
export function correctedStatus(member: Pick<AdminMemberRow, 'role'>, year: number, status: EnrollmentStatus, now: Date = new Date()): EnrollmentStatus {
  return shouldGraduate(year, 'student', now) || !canHoldEnrollment(member.role, status) ? 'alumni' : status;
}

/** A member after an enrollment correction: 在校生 and 毕业生 follow the status, as on the server. */
/** 入学信息更正后的成员：与服务器一致，在校生和毕业生随在读状态变化。 */
export function withEnrollment(member: AdminMemberRow, graduationYear: number, enrollmentStatus: EnrollmentStatus): AdminMemberRow {
  const role: Role =
    member.role === 'student' && enrollmentStatus === 'alumni' ? 'alumni' : member.role === 'alumni' && enrollmentStatus === 'student' ? 'student' : member.role;
  return { ...member, graduationYear, enrollmentStatus, role };
}

/** A member after a role change; the server says which enrollment status went with it. */
/** 身份修改后的成员；服务器会告知随之而来的在读状态。 */
export function withRole(member: AdminMemberRow, role: Role, enrollmentStatus?: EnrollmentStatus): AdminMemberRow {
  return { ...member, role, enrollmentStatus: enrollmentStatus ?? member.enrollmentStatus };
}

export function replaceMember(list: readonly AdminMemberRow[] | undefined, next: AdminMemberRow): AdminMemberRow[] | undefined {
  return list?.map((member) => (member.id === next.id ? next : member));
}
