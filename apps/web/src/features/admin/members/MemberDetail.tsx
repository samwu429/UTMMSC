import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { showsEnrollment, type AdminMemberRow, type MemberStatus } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { adminApi } from '../api';
import { AdminScreen } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { refreshAdminSummary } from '../state/summaryStore';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { formatDay, useRoleNames } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';
import { StatusBadge } from '../ui/StatusBadge';
import { storeMember, useMembers } from './memberData';
import { editBlock, enrollmentLocked, membersPath, type EditBlock } from './memberRules';

const BLOCK_TEXT: Record<EditBlock, [string, string]> = {
  self: ['不能修改自己的身份和账号状态。', "You can't change your own role or account status."],
  rank: ['你不能修改职位不低于你的成员。', "You can't change members at or above your level."],
  honorary: ['只有系统管理员可以修改荣誉顾问。', 'Only a system administrator can change honorary advisors.'],
};

/**
 * The frame of a member's screens (detail and pickers): the member from the cached list, with loading, a failed load
 * and a member who is not in the list.
 * 成员各界面（详情和选择界面）的外框：成员数据取自缓存的列表，并处理加载中、加载失败以及列表中没有这位成员的情况。
 */
export function useMemberScreen(id: string) {
  const members = useMembers();
  const member = members.data?.find((item) => item.id === id);
  const fallback = !member ? (
    !members.data ? (
      members.error ? (
        <LoadFailed error={members.error} onRetry={() => void members.refresh()} />
      ) : (
        <ListSkeleton rows={4} />
      )
    ) : (
      <MissingMember />
    )
  ) : null;
  return { members, member, fallback };
}

function MissingMember() {
  const { tr } = useLabels();
  return <EmptyBlock title={tr('找不到这位成员', "This member couldn't be found")} hint={tr('可能已被删除，或链接有误。', 'They may have been removed, or the link is wrong.')} />;
}

function statusLabel(status: MemberStatus, tr: (zh: string, en: string) => string): string {
  if (status === 'active') return tr('在用', 'Active');
  if (status === 'disabled') return tr('已停用', 'Disabled');
  return tr('未激活', 'Not active');
}

function Header({ member }: { member: AdminMemberRow }) {
  const { tr, locale } = useLabels();
  return (
    <AdminGroup>
      <div className="flex items-center gap-4 px-4 py-4">
        <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-16 w-16 text-xl" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="truncate text-[20px] font-semibold leading-7 text-wx-ink">{member.displayName}</span>
            {member.status === 'disabled' ? <StatusBadge tone="danger">{tr('已停用', 'Disabled')}</StatusBadge> : null}
          </p>
          <p className="truncate text-[14px] text-wx-meta">{member.email}</p>
          <p className="text-[13px] text-wx-meta">{tr(`${formatDay(member.createdAt, locale)} 加入`, `Joined ${formatDay(member.createdAt, locale)}`)}</p>
        </div>
      </div>
    </AdminGroup>
  );
}

/**
 * A member's screen, /admin/members/:id: role, enrollment (corrected by the system admin only), account status and
 * a link to the profile, with 停用账号 or 恢复账号 at the bottom. Rows the viewer can't change are static, and the
 * footer says why.
 * 成员的界面，/admin/members/:id：身份、入学信息（只有系统管理员可以更正）、账号状态以及资料链接，底部为「停用账号」或「恢复账号」。
 * 查看者不能修改的行是静态的，并在底部说明原因。
 */
export function MemberDetail({ id }: { id: string }) {
  const { tr, year, enrollment } = useLabels();
  const roleNames = useRoleNames();
  const self = useSessionStore((s) => s.member);
  const insetGroups = useInsetGroups();
  const { search } = useLocation();
  const confirm = useAdminConfirm();
  const { member, fallback } = useMemberScreen(id);
  const [busy, setBusy] = useState(false);
  const list = membersPath(undefined, search);
  const back = { to: list, label: tr('成员与身份', 'Members and roles') };

  if (!member || !self) {
    return (
      <AdminScreen title={tr('成员', 'Member')} back={back} escapeTo={list}>
        {fallback}
      </AdminScreen>
    );
  }

  const block = editBlock(self, member);
  // Enrollment follows the viewed role too: a system admin testing another role sees that role's screen.
  // 入学信息同样按当前视角的身份判断：系统管理员测试其他身份时看到的是那个身份的界面。
  const enrollmentEditable = self.role === 'superadmin' && showsEnrollment(member.role);
  const sub = (screen: string) => `${membersPath(member.id)}/${screen}${search}`;
  const name = member.displayName;

  async function changeStatus(next: MemberStatus) {
    if (busy || !member) return;
    if (next === 'disabled') {
      const ok = await confirm({
        title: tr(`停用${name}的账号？`, `Disable ${name}'s account?`),
        body: tr('对方会立刻在所有设备上退出，恢复之前不能再登录。', "They're signed out on every device right away and can't sign in until you restore the account."),
        confirmLabel: tr('停用', 'Disable'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await adminApi.setStatus(member.id, next);
      storeMember({ ...member, status: next });
      refreshAdminSummary();
      toast(next === 'disabled' ? tr('已停用', 'Disabled') : tr('已恢复', 'Restored'));
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminScreen title={tr('成员', 'Member')} back={back} escapeTo={list}>
      <Header member={member} />
      <AdminGroup>
        <AdminCell label={tr('身份', 'Role')} value={roleNames[member.role]} to={block ? undefined : sub('role')} />
        {showsEnrollment(member.role) ? (
          <AdminCell label={tr('入学年份', 'Enrollment year')} value={year(member.graduationYear)} to={enrollmentEditable ? sub('year') : undefined} />
        ) : null}
        {showsEnrollment(member.role) ? (
          <AdminCell
            label={tr('在读状态', 'Enrollment status')}
            value={enrollment(member.enrollmentStatus)}
            to={enrollmentEditable && !enrollmentLocked(member) ? sub('status') : undefined}
          />
        ) : null}
        <AdminCell label={tr('账号状态', 'Account status')} value={statusLabel(member.status, tr)} />
      </AdminGroup>
      <AdminGroup>
        <AdminCell label={tr('查看资料', 'View profile')} to={`/directory/${encodeURIComponent(member.id)}`} />
      </AdminGroup>
      {!block ? (
        <AdminGroup>
          {member.status === 'disabled' ? (
            <AdminCell label={busy ? tr('正在恢复…', 'Restoring…') : tr('恢复账号', 'Restore account')} onClick={() => void changeStatus('active')} disabled={busy} chevron={false} />
          ) : (
            <AdminCell label={busy ? tr('正在停用…', 'Disabling…') : tr('停用账号', 'Disable account')} onClick={() => void changeStatus('disabled')} disabled={busy} danger />
          )}
        </AdminGroup>
      ) : null}
      <div className={`space-y-1 pt-3 text-[13px] leading-relaxed text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>
        {block ? <p>{tr(...BLOCK_TEXT[block])}</p> : null}
        {enrollmentEditable && enrollmentLocked(member) ? (
          <p>{tr('入学已满五年，或荣誉顾问，在读状态只能是毕业生。', 'Five years after enrollment, and for honorary advisors, the status can only be graduate.')}</p>
        ) : null}
        {!enrollmentEditable && showsEnrollment(member.role) ? <p>{tr('入学年份只有系统管理员能改。', 'Only a system administrator can change enrollment years.')}</p> : null}
      </div>
    </AdminScreen>
  );
}
