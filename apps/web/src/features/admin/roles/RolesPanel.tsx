import { useEffect, useState } from 'react';
import { ENROLLMENT_LABELS, ROLES, ROLE_LABELS, canAssignRole, roleRank, type AdminMemberRow, type Role } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Badge, Notice, Spinner } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Select, TextInput } from '../../../shared/ui/Field';
import { adminApi } from '../api';

/** Role picker per member. Options are limited to what the signed-in executive may assign. */
/** 每位成员的身份选择。选项限制在当前主席团成员可分配的范围内。 */
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
      <TextInput placeholder="搜索姓名或邮箱" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {visible.map((m) => {
        const editable = m.id !== self.id && (self.role === 'superadmin' || roleRank(m.role) < roleRank(self.role));
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
                  {ROLES.filter((r) => r === m.role || canAssignRole(self.role, r)).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              ) : (
                <Badge tone="brand">{ROLE_LABELS[m.role]}</Badge>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
