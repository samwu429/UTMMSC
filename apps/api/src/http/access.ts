import type { Env } from '../env';
import { recordEligibilityChange } from '../infrastructure/d1/channel-joins';
import { listChannels } from '../infrastructure/d1/channels';
import { findMemberById, settleEnrollment, viewedActor, type EnrollmentRow, type Graduation, type MemberRow } from '../infrastructure/d1/members';
import { revokeMemberEverywhere } from './rooms';

/**
 * Gives a member a real join time for every audience channel they can newly read after a role or
 * enrollment change, and drops it for channels they can no longer read. Runs before their sockets are
 * revoked, so the re-issued ticket already sees the new join time.
 * 身份或在读状态变化后，为成员新能阅读的每个受众频道记录真实的加入时间，并删除其不再能阅读的频道记录。在关闭其连接之前执行，重新签发的票据就能用上新的加入时间。
 */
export async function recordJoinChanges(env: Env, before: EnrollmentRow): Promise<void> {
  const after = await findMemberById(env.DB, before.id);
  if (!after) return;
  await recordEligibilityChange(env.DB, before.id, viewedActor(before), viewedActor(after), await listChannels(env.DB));
}

/**
 * Settles the member's enrollment for this request. When this request is the one that graduated them,
 * their join times move and their sockets close, as after an admin change.
 * 为本次请求结算成员的在读状态。若正是本次请求把其写成毕业生，就像管理员修改之后一样更新加入时间并关闭其连接。
 */
export async function settleMember(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, row: MemberRow): Promise<MemberRow> {
  const { member, graduated } = await settleEnrollment(env.DB, row);
  if (graduated) {
    // The graduation is already written, so a failed join update must not fail the member's own request.
    // 毕业状态已经写入，加入时间更新失败不能让成员自己的请求失败。
    try {
      await recordJoinChanges(env, row);
    } catch (err) {
      console.error('graduation join times failed', err);
    }
    ctx.waitUntil(revokeMemberEverywhere(env, row.id));
  }
  return member;
}

/**
 * Join times and socket revocation for the members a graduation sweep just moved. Each member is handled
 * on its own, so one failure does not stop the rest.
 * 为毕业处理刚刚写成毕业生的成员更新加入时间并关闭连接。每人单独处理，一人失败不影响其他人。
 */
export async function recordGraduations(env: Env, graduated: readonly Graduation[]): Promise<void> {
  if (graduated.length === 0) return;
  const channels = await listChannels(env.DB);
  const results = await Promise.allSettled(
    graduated.map(async ({ before, after }) => {
      await recordEligibilityChange(env.DB, before.id, viewedActor(before), viewedActor(after), channels);
      await revokeMemberEverywhere(env, before.id);
    }),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) console.error(`graduation sweep: follow-up failed for ${failed} of ${results.length} members`);
}
