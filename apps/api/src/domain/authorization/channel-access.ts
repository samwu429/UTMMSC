import { hasPermission, isStaffRole, type ChannelAudience, type EnrollmentStatus, type PostPolicy, type Role } from '@utmmsc/shared';

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
 * Reading: implicit audiences match on enrollment status, executives see everything,
 * custom channels require a membership row.
 * 阅读：隐式受众按在校/毕业匹配，主席团可见全部，自定义频道需成员记录。
 */
export function canReadChannel(channel: ChannelAccessInput, actor: ActorInput): boolean {
  if (hasPermission(actor.role, 'channels.manage')) return true;
  switch (channel.audience) {
    case 'all':
      return true;
    case 'student':
    case 'alumni':
      return channel.audience === actor.enrollmentStatus;
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
