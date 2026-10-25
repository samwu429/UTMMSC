import type { AdminMemberRow, EnrollmentStatus, Role } from '@utmmsc/shared';
import { adminApi } from '../api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';
import { replaceMember, withRole } from './memberRules';

/** The cache key of the member list, shared with every screen that needs it (the channel member picker too). */
/** 成员列表的缓存键，所有需要它的界面共用（频道成员选择也是）。 */
export const MEMBERS_KEY = 'members';

const loadMembers = async () => (await adminApi.members()).members;

export function useMembers(enabled = true): AdminQuery<AdminMemberRow[]> {
  return useAdminQuery(MEMBERS_KEY, loadMembers, { enabled });
}

/** The member as the cache has it now, for an undo that runs after the screen has moved on. */
/** 缓存中此刻的成员数据，用于在界面已经离开之后才执行的撤销。 */
export function cachedMember(id: string): AdminMemberRow | undefined {
  return adminCache.read<AdminMemberRow[]>(MEMBERS_KEY).data?.find((member) => member.id === id);
}

export function storeMember(next: AdminMemberRow): void {
  adminCache.mutate<AdminMemberRow[]>(MEMBERS_KEY, (list) => replaceMember(list, next));
}

/**
 * 撤销 of a role change: the old role and the enrollment status the member had with it, since 在校生 and 毕业生 move
 * the status as well and giving back an office alone would keep the new one. The cache takes what the server answers.
 * 撤销身份修改：恢复原来的身份以及当时的在读状态，因为在校生和毕业生也会改变在读状态，只恢复职位会保留新的状态。缓存采用服务器的答复。
 */
export async function restoreRole(id: string, role: Role, enrollmentStatus: EnrollmentStatus): Promise<void> {
  const res = await adminApi.setRole(id, role, enrollmentStatus);
  const current = cachedMember(id);
  if (current) storeMember(withRole(current, role, res.enrollmentStatus ?? enrollmentStatus));
}
