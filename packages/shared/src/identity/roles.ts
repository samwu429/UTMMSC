/**
 * Roles form an ordered ladder. A member holds exactly one role; the admin UI assigns roles
 * and never edits individual permissions, which keeps administration understandable for
 * non-technical executives.
 * 身份是一条有序阶梯。每位成员只有一个身份；后台只分配身份，不单独编辑权限，便于非技术主席团操作。
 */
export const ROLES = [
  'student',
  'alumni',
  'department_lead',
  'executive',
  'superadmin',
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  student: '在校生',
  alumni: '毕业生',
  department_lead: '部门负责人',
  executive: '主席团',
  superadmin: '系统管理员',
};

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

const BASE_MEMBER: Permission[] = ['directory.view', 'chat.send', 'files.view'];
const LEAD: Permission[] = [...BASE_MEMBER, 'files.upload', 'events.manage'];
const EXECUTIVE: Permission[] = [
  ...LEAD,
  'chat.moderate',
  'channels.manage',
  'members.approve',
  'members.assign_role',
  'announcements.send',
];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  student: BASE_MEMBER,
  alumni: BASE_MEMBER,
  department_lead: LEAD,
  executive: EXECUTIVE,
  superadmin: PERMISSIONS,
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleRank(role: Role): number {
  return ROLES.indexOf(role);
}

/**
 * Executives may assign any role below their own; only a superadmin may create another
 * executive or superadmin. This stops a single executive from escalating peers unilaterally.
 * 主席团可分配低于自身的身份；只有系统管理员能任命主席团或系统管理员，避免单人越权提拔。
 */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (!hasPermission(actor, 'members.assign_role')) return false;
  if (actor === 'superadmin') return true;
  return roleRank(target) < roleRank(actor);
}

export function isStaffRole(role: Role): boolean {
  return roleRank(role) >= roleRank('department_lead');
}
