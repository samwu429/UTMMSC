import type { MiddlewareHandler } from 'hono';
import { hasPermission, type Permission } from '@utmmsc/shared';
import { readSessionToken } from '../../domain/identity/session-token';
import { sweepGraduations, viewedRole } from '../../infrastructure/d1/members';
import { findLiveSessionMember } from '../../infrastructure/d1/session-member';
import { recordGraduations, settleMember } from '../access';
import type { AppEnv } from '../context';
import { forbidden, unauthorized } from '../errors';

/**
 * Verifies the bearer token signature, then confirms the session row is live and loads the member in one query
 * (two in a row before). Disabled members are rejected even with a valid token.
 * The hourly graduation sweep runs beside that query, so the request that triggers it waits for no extra round
 * trip. Whether the member row is read before or after the sweep graduates this very member, the request gets the
 * graduated member: settleMember applies the same change to a row from before, and the follow-up work runs once,
 * from the sweep. The sweep's follow-up is scheduled even when the session turns out not to be live.
 * 校验 Bearer 令牌签名，再用一次查询确认会话记录有效并加载成员（之前是先后两次查询）。已停用成员即使令牌有效也被拒绝。
 * 每小时一次的毕业处理与这次查询并行，触发它的请求因此不必多等一次往返。无论成员记录是在毕业处理把这位成员写成毕业生之前还是之后读取的，
 * 本次请求拿到的都是毕业后的成员：settleMember 会对之前的行做同样的修改，后续处理也只由毕业处理执行一次。
 * 即使会话最终无效，毕业处理的后续工作也会照常安排。
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw unauthorized();
  const claims = await readSessionToken(c.env.SESSION_SECRET, token);
  if (!claims) throw unauthorized('登录已过期，请重新登录');
  const [session, sweep] = await Promise.allSettled([findLiveSessionMember(c.env.DB, claims.sid, claims.mid), sweepGraduations(c.env.DB)]);
  if (sweep.status === 'fulfilled' && sweep.value.length > 0) c.executionCtx.waitUntil(recordGraduations(c.env, sweep.value));
  if (session.status === 'rejected') throw session.reason;
  if (sweep.status === 'rejected') throw sweep.reason;
  const live = session.value;
  if (!live) throw unauthorized('登录已失效，请重新登录');
  const row = live.member;
  if (!row || row.status !== 'active') throw unauthorized('账号不可用');
  const member = await settleMember(c.env, c.executionCtx, row);
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
