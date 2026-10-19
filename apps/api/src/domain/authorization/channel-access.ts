import {
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
