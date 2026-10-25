import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ADMIN_ENROLLMENT_YEAR_MIN, ENROLLMENT_STATUSES, enrollmentYearMax, type EnrollmentStatus, type Role } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { snackbar } from '../../../shared/ui/snackbar';
import { toast } from '../../../shared/ui/toast';
import { adminApi } from '../api';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { refreshAdminSummary } from '../state/summaryStore';
import { useRoleNames } from '../ui/labels';
import { useAdminConfirm } from '../ui/overlayGate';
import { RadioList } from '../ui/RadioList';
import { restoreRole, storeMember } from './memberData';
import { useMemberScreen } from './MemberDetail';
import { correctedStatus, editBlock, enrollmentLocked, membersPath, officeHolders, roleChoices, withEnrollment, withRole, type RoleChoice } from './memberRules';

/** The member's own screen, the one every picker returns to. */
/** 成员自己的界面，每个选择界面都返回到这里。 */
function useMemberBack(id: string) {
  const { tr } = useLabels();
  const { search } = useLocation();
  const to = `${membersPath(id)}${search}`;
  return { to, label: tr('成员', 'Member') };
}

/**
 * 身份: every role grouped as the constitution groups them, each with what it may do, and why it can't be given when
 * it can't (held by someone, system admin only, five years since enrollment). Choosing saves at once and offers 撤销,
 * which gives the old role back, and the enrollment status that 在校生 or 毕业生 moved with it.
 * 「身份」：按章程分组的所有身份，各自说明能做什么；不能任命时说明原因（已有人担任、只有系统管理员可以指定、入学已满五年）。选择后立即保存，
 * 并提供「撤销」，恢复原来的身份，以及随在校生或毕业生一起改变的在读状态。
 */
export function RolePicker({ id }: { id: string }) {
  const { tr, duty, group } = useLabels();
  const roleNames = useRoleNames();
  const self = useSessionStore((s) => s.member);
  const goBack = useAdminBack();
  const back = useMemberBack(id);
  const { members, member, fallback } = useMemberScreen(id);
  const holders = useMemo(() => officeHolders(members.data ?? []), [members.data]);
  const [busy, setBusy] = useState<Role | null>(null);

  function reason(choice: RoleChoice): string | null {
    if (choice.block === 'held') return tr(`已由${choice.holder?.displayName ?? ''}担任`, `Held by ${choice.holder?.displayName ?? 'someone else'}`);
    if (choice.block === 'superadmin_only') return tr('只有系统管理员可以指定', 'Only a system administrator can assign this');
    if (choice.block === 'graduated') return tr('入学已满五年', 'Five years since enrollment');
    return null;
  }

  async function undo(previousRole: Role, previousStatus: EnrollmentStatus) {
    try {
      await restoreRole(id, previousRole, previousStatus);
      refreshAdminSummary();
      toast(tr('已撤销', 'Undone'));
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  async function pick(role: Role) {
    if (!member || busy) return;
    const previousRole = member.role;
    const previousStatus = member.enrollmentStatus;
    setBusy(role);
    try {
      const res = await adminApi.setRole(member.id, role);
      storeMember(withRole(member, role, res.enrollmentStatus));
      refreshAdminSummary();
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
      return;
    }
    snackbar({
      text: tr(`已任命为${roleNames[role]}`, `Appointed as ${roleNames[role]}`),
      action: { label: tr('撤销', 'Undo'), onAction: () => void undo(previousRole, previousStatus) },
    });
    goBack(back.to);
  }

  const blocked = member && self ? editBlock(self, member) : null;
  return (
    <AdminScreen title={tr('身份', 'Role')} back={back} escapeTo={back.to}>
      {member && self ? (
        blocked ? (
          <p className="px-4 py-10 text-center text-[15px] text-wx-meta">{tr('你不能修改这位成员的身份。', "You can't change this member's role.")}</p>
        ) : (
          <>
            <p className="px-4 pb-1 pt-3 text-[13px] text-wx-meta lg:px-1">{tr(`为${member.displayName}选择身份，选择后立即生效。`, `Choose a role for ${member.displayName}. It takes effect at once.`)}</p>
            {roleChoices(self.role, member, holders).map((item) => (
              <RadioList
                key={item.label}
                title={group(item.label)}
                label={group(item.label)}
                value={member.role}
                busy={busy}
                onSelect={(role) => void pick(role)}
                items={item.choices.map((choice) => ({ value: choice.role, label: roleNames[choice.role], detail: duty(choice.role), disabledReason: reason(choice) }))}
              />
            ))}
          </>
        )
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}

/** Brings the chosen row into view, for a long list such as the years. */
/** 让所选的一行进入视野，用于年份这类较长的列表。 */
function useScrollToChecked(ready: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    ref.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: 'center' });
  }, [ready]);
  return ref;
}

/**
 * 入学年份, for the system admin: any year from 1990 to five years ahead. A correction is confirmed first, with what
 * it will do (five years back makes the member a graduate), then saved.
 * 「入学年份」，供系统管理员使用：1990 年到五年之后的任意年份。更正前先确认，并说明会发生什么（五年或更早之前会把成员记为毕业生），然后保存。
 */
export function YearPicker({ id }: { id: string }) {
  const { tr, year } = useLabels();
  const self = useSessionStore((s) => s.member);
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const back = useMemberBack(id);
  const { member, fallback } = useMemberScreen(id);
  const [busy, setBusy] = useState<string | null>(null);
  const listRef = useScrollToChecked(Boolean(member));

  const years = useMemo(() => {
    const list: number[] = [];
    for (let value = enrollmentYearMax(); value >= ADMIN_ENROLLMENT_YEAR_MIN; value -= 1) list.push(value);
    if (member && !list.includes(member.graduationYear)) list.unshift(member.graduationYear);
    return list;
  }, [member]);

  async function pick(value: string) {
    if (!member || busy) return;
    const next = Number(value);
    const status = correctedStatus(member, next, member.enrollmentStatus);
    const due = status === 'alumni' && member.enrollmentStatus === 'student';
    const ok = await confirm({
      title: tr(`把入学年份改为 ${next}？`, `Change the enrollment year to ${next}?`),
      body: due
        ? tr('入学已满五年，会记为毕业生。成员自己不能改这个数字。', 'Five years have passed since enrollment, so this member will be recorded as a graduate. Members cannot change this number themselves.')
        : tr('成员自己不能改这个数字。', 'Members cannot change this number themselves.'),
      confirmLabel: tr('更正', 'Correct'),
    });
    if (!ok) return;
    setBusy(value);
    try {
      const res = await adminApi.setEnrollment(member.id, next, status);
      storeMember(withEnrollment(member, res.graduationYear, res.enrollmentStatus));
      toast(tr('已保存', 'Saved'));
      goBack(back.to);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <AdminScreen title={tr('入学年份', 'Enrollment year')} back={back} escapeTo={back.to}>
      {member && self?.role === 'superadmin' ? (
        <div ref={listRef}>
          <RadioList
            label={tr('入学年份', 'Enrollment year')}
            value={String(member.graduationYear)}
            busy={busy}
            onSelect={(value) => void pick(value)}
            footer={tr('入学满五年的成员会记为毕业生。', 'Members five or more years past enrollment are recorded as graduates.')}
            items={years.map((value) => ({ value: String(value), label: year(value) }))}
          />
        </div>
      ) : member ? (
        <p className="px-4 py-10 text-center text-[15px] text-wx-meta">{tr('入学年份只有系统管理员能改。', 'Only a system administrator can change enrollment years.')}</p>
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}

/**
 * 在读状态, for the system admin: 在校生 or 毕业生. Locked to 毕业生 five years after enrollment and for honorary
 * advisors; the status decides which channels the member sees, so a change is confirmed first.
 * 「在读状态」，供系统管理员使用：在校生或毕业生。入学满五年后以及荣誉顾问固定为毕业生；在读状态决定成员能看到哪些频道，因此修改前先确认。
 */
export function StatusPicker({ id }: { id: string }) {
  const { tr, enrollment } = useLabels();
  const self = useSessionStore((s) => s.member);
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const back = useMemberBack(id);
  const { member, fallback } = useMemberScreen(id);
  const [busy, setBusy] = useState<EnrollmentStatus | null>(null);

  async function pick(status: EnrollmentStatus) {
    if (!member || busy) return;
    const ok = await confirm({
      title: tr(`改为${enrollment(status)}？`, `Change to ${enrollment(status)}?`),
      body: tr('在读状态决定这位成员能看到哪些频道，修改后立即生效。', 'The enrollment status decides which channels this member can see. The change applies at once.'),
      confirmLabel: tr('更正', 'Correct'),
    });
    if (!ok) return;
    setBusy(status);
    try {
      const res = await adminApi.setEnrollment(member.id, member.graduationYear, correctedStatus(member, member.graduationYear, status));
      storeMember(withEnrollment(member, res.graduationYear, res.enrollmentStatus));
      toast(tr('已保存', 'Saved'));
      goBack(back.to);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
    }
  }

  const locked = member ? enrollmentLocked(member) : false;
  return (
    <AdminScreen title={tr('在读状态', 'Enrollment status')} back={back} escapeTo={back.to}>
      {member && self?.role === 'superadmin' ? (
        <RadioList
          label={tr('在读状态', 'Enrollment status')}
          value={locked ? 'alumni' : member.enrollmentStatus}
          busy={busy}
          onSelect={(status) => void pick(status)}
          footer={locked ? tr('入学已满五年，或荣誉顾问，只能是毕业生。', 'Five years after enrollment, and for honorary advisors, only graduate is possible.') : undefined}
          items={ENROLLMENT_STATUSES.map((status) => ({
            value: status,
            label: enrollment(status),
            disabledReason: locked && status === 'student' ? tr('入学已满五年或为荣誉顾问', 'Five years since enrollment, or an honorary advisor') : null,
          }))}
        />
      ) : member ? (
        <p className="px-4 py-10 text-center text-[15px] text-wx-meta">{tr('在读状态只有系统管理员能改。', 'Only a system administrator can change the enrollment status.')}</p>
      ) : (
        fallback
      )}
    </AdminScreen>
  );
}
