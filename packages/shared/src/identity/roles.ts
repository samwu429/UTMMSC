/**
 * Offices follow the constitution: four Presidium officers and five Department Heads.
 * A member holds one role. The admin screen assigns that role and never edits raw permissions.
 * 职位按章程：主席团四人、部门部长五人。每人只有一个身份。后台只任命身份，不单独改权限。
 */

export const ROLES = [
  'student',
  'alumni',
  'honorary_alumni',
  'honorary_external',
  'head_technology',
  'head_academic',
  'head_publicity',
  'head_sponsorship',
  'head_events',
  'secretary_general',
  'vp_finance',
  'vp_audit',
  'president',
  'superadmin',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  student: '在校生',
  alumni: '毕业生',
  honorary_alumni: '校友荣誉顾问',
  honorary_external: '校外荣誉顾问',
  head_technology: '科技部部长',
  head_academic: '学术部部长',
  head_publicity: '宣传部部长',
  head_sponsorship: '赞助部部长',
  head_events: '活动部部长',
  secretary_general: '秘书长',
  vp_finance: '财务副主席',
  vp_audit: '监督审计副主席',
  president: '主席',
  superadmin: '系统管理员',
};

/** One line so the person assigning an office can see what it unlocks. */
/** 任命时能看到这个职位在系统里能做什么。 */
export const ROLE_DUTIES: Record<Role, string> = {
  student: '普通成员。',
  alumni: '普通成员。',
  honorary_alumni: '校友荣誉顾问。权限与普通成员相同。只能由系统管理员指定，可以有多人。',
  honorary_external: '校外荣誉顾问。权限与普通成员相同。只能通过系统管理员的邀请注册，可以有多人。',
  head_technology: '官网、系统和项目。可上传文件。只属于科技部。',
  head_academic: '学术互助。可上传文件。只属于学术部。',
  head_publicity: '宣传与招新。可上传文件。只属于宣传部。',
  head_sponsorship: '审查赞助。可上传文件。只属于赞助部。',
  head_events: '策划活动。可发布活动并上传文件。只属于活动部。',
  secretary_general: '会员名单、会议通知和档案。可审核入会、上传文件、发通知。',
  vp_finance: '收支与预算。可上传财务文件。不能签字以外的管理。',
  vp_audit: '监督账目和档案。不能改职位，也不能代签。',
  president: '统筹运作。可任命部长、审核成员、管频道、发公告和活动。',
  superadmin: '系统账号，权限齐全。不是章程职位。',
};

export const ROLE_GROUPS: { label: string; roles: Role[] }[] = [
  { label: '成员', roles: ['student', 'alumni'] },
  { label: '荣誉顾问', roles: ['honorary_alumni', 'honorary_external'] },
  { label: '部门', roles: ['head_technology', 'head_academic', 'head_publicity', 'head_sponsorship', 'head_events'] },
  { label: '主席团', roles: ['president', 'secretary_general', 'vp_finance', 'vp_audit'] },
  { label: '系统', roles: ['superadmin'] },
];

export const PERMISSIONS = [
  'directory.view',
  'chat.send',
  'chat.moderate',
  'channels.manage',
  'files.view',
  'files.upload',
  'events.manage',
  'members.approve',
  'members.assign_role',
  'announcements.send',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MEMBER: Permission[] = ['directory.view', 'chat.send', 'files.view'];
const FILES: Permission[] = [...MEMBER, 'files.upload'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  student: MEMBER,
  alumni: MEMBER,
  honorary_alumni: MEMBER,
  honorary_external: MEMBER,
  head_technology: FILES,
  head_academic: FILES,
  head_publicity: FILES,
  head_sponsorship: FILES,
  head_events: [...FILES, 'events.manage'],
  secretary_general: [...FILES, 'members.approve', 'announcements.send'],
  vp_finance: FILES,
  vp_audit: MEMBER,
  president: [
    ...FILES,
    'events.manage',
    'chat.moderate',
    'channels.manage',
    'members.approve',
    'members.assign_role',
    'announcements.send',
  ],
  superadmin: PERMISSIONS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Members 0, department heads 1, presidium 2, system admin 3. Peers share a tier. */
/** 成员 0，部长 1，主席团 2，系统管理员 3。同级职位档位相同。 */
export function roleTier(role: Role): number {
  if (role === 'superadmin') return 3;
  if (role === 'president' || role === 'secretary_general' || role === 'vp_finance' || role === 'vp_audit') return 2;
  if (role.startsWith('head_')) return 1;
  return 0;
}

/** Constitution offices are unique. Member statuses, honorary advisors, and the system account are not. */
/** 章程职位同时只能有一人。在校、毕业、荣誉顾问和系统账号不限人数。 */
export function isOfficeRole(role: Role): boolean {
  return roleTier(role) === 1 || roleTier(role) === 2;
}

export function isHonoraryRole(role: Role): boolean {
  return role === 'honorary_alumni' || role === 'honorary_external';
}

/** External advisors are not campus members, so year and program are not shown. */
/** 校外荣誉顾问不是校内成员，不展示入学年份和专业。 */
export function showsEnrollment(role: Role): boolean {
  return role !== 'honorary_external';
}

/**
 * The president appoints department heads and members. Presidium seats, honorary advisors,
 * and the system account are not assigned from that screen. A department head cannot appoint anyone.
 * 主席可任命部长和普通成员。主席团、荣誉顾问和系统账号不从这里任命。部长不能任命他人。
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (isHonoraryRole(target)) return actor === 'superadmin';
  if (!hasPermission(actor, 'members.assign_role')) return false;
  if (actor === 'superadmin') return true;
  if (actor === 'president') return roleTier(target) <= 1;
  return false;
}

export function isStaffRole(role: Role): boolean {
  return roleTier(role) >= 1;
}

/** Title shown beside a name. Ordinary students and alumni have no extra title. */
/** 显示在姓名旁边的头衔。在校生和毕业生没有额外头衔。 */
export function roleTitle(role: Role): string | null {
  return isStaffRole(role) || isHonoraryRole(role) ? ROLE_LABELS[role] : null;
}
