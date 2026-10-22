import { hasPermission, roleTier, type Role } from '../identity/roles';

export type ModerationDecision = 'ok' | 'no_permission' | 'direct' | 'outranked';

/** Moderation is a channel tool; in a direct conversation each side can only manage their own messages. */
/** 管理操作只用于频道；私聊中双方都只能处理自己的消息。 */
export function canModerateRoom(roomKind: 'channel' | 'direct', actorRole: Role): boolean {
  return roomKind === 'channel' && hasPermission(actorRole, 'chat.moderate');
}

/**
 * Whether a member may remove someone else's message or mute someone. The target must sit in a lower tier
 * than the actor; the system admin may act on anyone, so only the system admin can moderate the system
 * admin. `targetRole` is the target's real role, or null when the account no longer exists.
 * 成员能否删除别人的消息或禁言别人。对方的档位必须低于操作者；系统管理员可以处理任何人，因此只有系统管理员能处理系统管理员。
 * `targetRole` 是对方的真实身份；账号已不存在时为 null。
 */
export function decideModeration(input: { roomKind: 'channel' | 'direct'; actorRole: Role; targetRole: Role | null }): ModerationDecision {
  if (!hasPermission(input.actorRole, 'chat.moderate')) return 'no_permission';
  if (input.roomKind !== 'channel') return 'direct';
  if (input.actorRole === 'superadmin' || input.targetRole === null) return 'ok';
  return roleTier(input.targetRole) < roleTier(input.actorRole) ? 'ok' : 'outranked';
}
