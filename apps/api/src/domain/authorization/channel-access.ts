import {
  ROLES,
  hasPermission,
  isHonoraryRole,
  isStaffRole,
  roleTier,
  type ChannelAudience,
  type EnrollmentStatus,
  type PostPolicy,
  type Role,
} from '@utmmsc/shared';

export interface ChannelAccessInput {
  audience: ChannelAudience;
  postPolicy: PostPolicy;
  isMember: boolean;
}

export interface ActorInput {
  role: Role;
  enrollmentStatus: EnrollmentStatus;
}

/**
 * Reading: implicit audiences match enrollment or office group, channel managers see everything,
 * custom channels require a membership row.
 * 阅读：隐式受众按在校状态或职位分组匹配，能管频道的人可见全部，自定义频道需成员记录。
 */
export function canReadChannel(channel: ChannelAccessInput, actor: ActorInput): boolean {
  if (hasPermission(actor.role, 'channels.manage')) return true;
  switch (channel.audience) {
    case 'all':
      return true;
    case 'student':
    case 'alumni':
      return channel.audience === actor.enrollmentStatus;
    case 'honorary':
      return isHonoraryRole(actor.role);
    case 'heads':
      return roleTier(actor.role) === 1;
    case 'officers':
      return roleTier(actor.role) === 2;
    case 'staff':
      return isStaffRole(actor.role);
    case 'custom':
      return channel.isMember;
  }
}

export function canPostInChannel(channel: ChannelAccessInput, actor: ActorInput): boolean {
  if (!canReadChannel(channel, actor)) return false;
  if (!hasPermission(actor.role, 'chat.send')) return false;
  if (channel.postPolicy === 'staff') return isStaffRole(actor.role);
  return true;
}

/** Database-side form of an audience: who can read the channel, excluding the channels.manage override. */
/** 受众在数据库查询中的形式：谁能读该频道，不含 channels.manage 的全局可见。 */
export type AudienceRoleFilter =
  | { kind: 'all' }
  | { kind: 'enrollment'; status: EnrollmentStatus }
  | { kind: 'roles'; roles: Role[] }
  | { kind: 'custom' };

/**
 * Role lists come from the same predicates canReadChannel uses, so a new role never needs a second edit.
 * 身份列表由 canReadChannel 所用的同一组判断生成，新增身份时无需另行修改。
 */
export function audienceRoleFilter(audience: ChannelAudience): AudienceRoleFilter {
  switch (audience) {
    case 'all':
      return { kind: 'all' };
    case 'student':
    case 'alumni':
      return { kind: 'enrollment', status: audience };
    case 'honorary':
      return { kind: 'roles', roles: ROLES.filter(isHonoraryRole) };
    case 'heads':
      return { kind: 'roles', roles: ROLES.filter((role) => roleTier(role) === 1) };
    case 'officers':
      return { kind: 'roles', roles: ROLES.filter((role) => roleTier(role) === 2) };
    case 'staff':
      return { kind: 'roles', roles: ROLES.filter(isStaffRole) };
    case 'custom':
      return { kind: 'custom' };
  }
}
