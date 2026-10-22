import { useEffect, useState } from 'react';
import { ENROLLMENT_STATUSES, ROLE_GROUPS, canAssignRole, canHoldEnrollment, enrollmentYearMax, enrollmentYearMin, isHonoraryRole, isOfficeRole, roleTier, shouldGraduate, showsEnrollment, type AdminMemberRow, type EnrollmentStatus, type Role } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Badge, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

const YEAR_OPTIONS: number[] = [];
for (let y = enrollmentYearMax(); y >= enrollmentYearMin(); y--) YEAR_OPTIONS.push(y);

/** Role picker per member. Options follow the constitution and what this person may appoint. */
/** 成员身份选择。选项按章程，并且限于当前这个人可以任命的范围。 */
export function RolesPanel() {
  const self = useSessionStore((s) => s.member);
  const [members, setMembers] = useState<AdminMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const ask = useConfirm();
  const { tr, role: roleLabel, duty, group, enrollment, year: yearLabel } = useLabels();

  useEffect(() => {
    adminApi.members().then((res) => setMembers(res.members)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function setRole(member: AdminMemberRow, role: Role) {
    if (role === member.role) return;
    const ok = await ask({
      title: tr(`任命为${roleLabel(role)}？`, `Appoint as ${roleLabel(role)}?`),
      body: duty(role),
      confirmLabel: tr('任命', 'Appoint'),
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await adminApi.setRole(member.id, role);
      setMembers((prev) => (prev ?? []).map((m) => (m.id === member.id ? { ...m, role, enrollmentStatus: res.enrollmentStatus ?? m.enrollmentStatus } : m)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleStatus(member: AdminMemberRow) {
    const disabling = member.status === 'active';
    const ok = await ask({
      title: disabling ? tr('停用这个账号？', 'Disable this account?') : tr('恢复这个账号？', 'Restore this account?'),
      body: member.displayName,
      confirmLabel: disabling ? tr('停用', 'Disable') : tr('恢复', 'Restore'),
      danger: disabling,
    });
    if (!ok) return;
    const next = disabling ? 'disabled' : 'active';
    try {
      await adminApi.setStatus(member.id, next);
      setMembers((prev) => (prev ?? []).map((m) => (m.id === member.id ? { ...m, status: next } : m)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function setEnrollment(member: AdminMemberRow, year: number, status: EnrollmentStatus) {
    if (year === member.graduationYear && status === member.enrollmentStatus) return;
    const due = shouldGraduate(year, 'student');
    const nextStatus: EnrollmentStatus = due || !canHoldEnrollment(member.role, status) ? 'alumni' : status;
    const ok = await ask({
      title: tr(`把入学年份改为 ${year}？`, `Change the enrollment year to ${year}?`),
      body: due
        ? tr('入学已满五年，会记为毕业生。成员自己不能改这个数字。', 'Five years have passed since enrollment, so this member will be recorded as a graduate. Members cannot change this number themselves.')
        : tr('成员自己不能改这个数字。', 'Members cannot change this number themselves.'),
      confirmLabel: tr('更正', 'Correct'),
    });
    if (!ok) return;
    setError(null);
    try {
      const res = await adminApi.setEnrollment(member.id, year, nextStatus);
      setMembers((prev) =>
        (prev ?? []).map((m) =>
          m.id === member.id
            ? {
                ...m,
                graduationYear: res.graduationYear,
                enrollmentStatus: res.enrollmentStatus,
                role: m.role === 'student' && res.enrollmentStatus === 'alumni' ? 'alumni' : m.role === 'alumni' && res.enrollmentStatus === 'student' ? 'student' : m.role,
              }
            : m,
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!self) return null;
  if (!members) return error ? <Notice tone="error">{error}</Notice> : <Spinner />;

  const needle = filter.trim().toLocaleLowerCase();
  const visible = members.filter((m) => !needle || m.displayName.toLocaleLowerCase().includes(needle) || m.email.toLocaleLowerCase().includes(needle));

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm leading-relaxed text-stone-500">
        {tr(
          '每个章程职位同时只能有一个人。荣誉顾问可以有多人，只有系统管理员能指定。主席可以任命部长和成员，不能任命其他主席团。入学年份只有系统管理员能改。',
          'Each office in the constitution is held by one person at a time. There can be several honorary advisors, and only a system administrator can assign them. The president can appoint department heads and members, but not other presidium members. Only a system administrator can change enrollment years.',
        )}
      </p>
      <TextInput placeholder={tr('搜索姓名或邮箱', 'Search name or email')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {visible.map((m) => {
        // As on the server, only active holders occupy an office.
        // 与服务端一致，只有在用的任职者占用职位。
        const heldByOthers = new Set(members.filter((other) => other.id !== m.id && other.status === 'active' && isOfficeRole(other.role)).map((other) => other.role));
        const graduated = shouldGraduate(m.graduationYear, 'student');
        // Five years after enrollment, and for honorary advisors, the status can only be alumni.
        // 入学满五年后，以及荣誉顾问，状态只能是毕业生。
        const statusLocked = graduated || !canHoldEnrollment(m.role, 'student');
        const editable = m.id !== self.id && (self.role === 'superadmin' || (roleTier(m.role) < roleTier(self.role) && !isHonoraryRole(m.role)));
        return (
          <div key={m.id} className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {m.displayName} {m.status !== 'active' ? <Badge tone="amber">{tr('已停用', 'Disabled')}</Badge> : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {m.email}
                  {showsEnrollment(m.role) ? ` · ${yearLabel(m.graduationYear)} · ${enrollment(m.enrollmentStatus)}` : ''}
                </p>
              </div>
              {editable ? (
                <button type="button" onClick={() => toggleStatus(m)} className="shrink-0 px-1 text-sm font-medium text-red-700">
                  {m.status === 'active' ? tr('停用', 'Disable') : tr('恢复', 'Restore')}
                </button>
              ) : null}
            </div>
            <div className="mt-2">
              {editable ? (
                <Select value={m.role} onChange={(e) => setRole(m, e.target.value as Role)} className="py-2">
                  {ROLE_GROUPS.map((roleGroup) => {
                    const options = roleGroup.roles.filter((r) => r === m.role || (canAssignRole(self.role, r) && !heldByOthers.has(r)));
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={roleGroup.label} label={group(roleGroup.label)}>
                        {options.map((r) => (
                          <option key={r} value={r} disabled={r !== m.role && r === 'student' && graduated}>
                            {roleLabel(r)}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
              ) : (
                <Badge tone="brand">{roleLabel(m.role)}</Badge>
              )}
              <p className="mt-1 text-xs leading-relaxed text-stone-500">{duty(m.role)}</p>
            </div>
            {self.realRole === 'superadmin' && showsEnrollment(m.role) ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Select
                  value={String(m.graduationYear)}
                  onChange={(e) => void setEnrollment(m, Number(e.target.value), m.enrollmentStatus)}
                  className="py-2"
                >
                  {(YEAR_OPTIONS.includes(m.graduationYear) ? YEAR_OPTIONS : [m.graduationYear, ...YEAR_OPTIONS]).map((y) => (
                    <option key={y} value={y}>
                      {yearLabel(y)}
                    </option>
                  ))}
                </Select>
                <Select
                  value={statusLocked ? 'alumni' : m.enrollmentStatus}
                  disabled={statusLocked}
                  onChange={(e) => void setEnrollment(m, m.graduationYear, e.target.value as EnrollmentStatus)}
                  className="py-2"
                >
                  {ENROLLMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {enrollment(status)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
