import { useEffect, useState } from 'react';
import { ENROLLMENT_LABELS, ROLE_DUTIES, ROLE_GROUPS, ROLE_LABELS, canAssignRole, isOfficeRole, roleTier, type AdminMemberRow, type Role } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Badge, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

/** Role picker per member. Options follow the constitution and what this person may appoint. */
/** 成员身份选择。选项按章程，并且限于当前这个人可以任命的范围。 */
export function RolesPanel() {
  const self = useSessionStore((s) => s.member);
  const [members, setMembers] = useState<AdminMemberRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const ask = useConfirm();

  useEffect(() => {
    adminApi.members().then((res) => setMembers(res.members)).catch((err) => setError(errorMessage(err)));
  }, []);

  async function setRole(member: AdminMemberRow, role: Role) {
    if (role === member.role) return;
    const ok = await ask({
      title: `任命为${ROLE_LABELS[role]}？`,
      body: ROLE_DUTIES[role],
      confirmLabel: '任命',
    });
    if (!ok) return;
    setError(null);
    try {
      await adminApi.setRole(member.id, role);
      setMembers((prev) => (prev ?? []).map((m) => (m.id === member.id ? { ...m, role } : m)));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleStatus(member: AdminMemberRow) {
    const disabling = member.status === 'active';
    const ok = await ask({
      title: disabling ? '停用这个账号？' : '恢复这个账号？',
      body: member.displayName,
      confirmLabel: disabling ? '停用' : '恢复',
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

  if (!self) return null;
  if (!members) return error ? <Notice tone="error">{error}</Notice> : <Spinner />;

  const visible = members.filter((m) => !filter || m.displayName.includes(filter) || m.email.includes(filter));

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="text-sm leading-relaxed text-stone-500">每个章程职位同时只能有一个人。主席可以任命部长和成员，不能任命其他主席团。</p>
      <TextInput placeholder="搜索姓名或邮箱" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {visible.map((m) => {
        const heldByOthers = new Set(members.filter((other) => other.id !== m.id && isOfficeRole(other.role)).map((other) => other.role));
        const editable = m.id !== self.id && (self.role === 'superadmin' || roleTier(m.role) < roleTier(self.role));
        return (
          <div key={m.id} className="rounded-xl bg-white p-3 ring-1 ring-stone-200">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {m.displayName} {m.status !== 'active' ? <Badge tone="amber">已停用</Badge> : null}
                </p>
                <p className="truncate text-xs text-slate-500">
                  {m.email} · {m.graduationYear} 届 · {ENROLLMENT_LABELS[m.enrollmentStatus]}
                </p>
              </div>
              {editable ? (
                <button type="button" onClick={() => toggleStatus(m)} className="shrink-0 px-1 text-sm font-medium text-red-700">
                  {m.status === 'active' ? '停用' : '恢复'}
                </button>
              ) : null}
            </div>
            <div className="mt-2">
              {editable ? (
                <Select value={m.role} onChange={(e) => setRole(m, e.target.value as Role)} className="py-2">
                  {ROLE_GROUPS.map((group) => {
                    const options = group.roles.filter((r) => r === m.role || (canAssignRole(self.role, r) && !heldByOthers.has(r)));
                    if (options.length === 0) return null;
                    return (
                      <optgroup key={group.label} label={group.label}>
                        {options.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </Select>
              ) : (
                <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
              )}
              <p className="mt-1 text-xs leading-relaxed text-stone-500">{ROLE_DUTIES[m.role]}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
