import type { MiddlewareHandler } from 'hono';
import { hasPermission, type Permission } from '@utmmsc/shared';
import { readSessionToken } from '../../domain/identity/session-token';
import { findMemberById, graduateDueMembers, viewedRole } from '../../infrastructure/d1/members';
import { isSessionLive } from '../../infrastructure/d1/sessions';
import type { AppEnv } from '../context';
import { forbidden, unauthorized } from '../errors';

/**
 * Verifies the bearer token signature, confirms the session row is live, and loads the member.
 * Disabled members are rejected even with a valid token.
 * 校验 Bearer 令牌签名，确认会话记录有效，并加载成员。已停用成员即使令牌有效也被拒绝。
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();
  const claims = await readSessionToken(c.env.SESSION_SECRET, token);
  if (!claims) throw unauthorized('登录已过期，请重新登录');
  const live = await isSessionLive(c.env.DB, claims.sid, claims.mid);
  if (!live) throw unauthorized('登录已失效，请重新登录');
  await graduateDueMembers(c.env.DB);
  const member = await findMemberById(c.env.DB, claims.mid);
  if (!member || member.status !== 'active') throw unauthorized('账号不可用');
  c.set('member', member);
  c.set('sessionId', claims.sid);
  await next();
};

export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const member = c.get('member');
    if (!hasPermission(viewedRole(member), permission)) throw forbidden();
    await next();
  };
}
