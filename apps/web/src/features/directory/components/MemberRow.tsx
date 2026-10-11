import { Link } from 'react-router-dom';
import { ENROLLMENT_LABELS, ROLE_LABELS, isStaffRole, type MemberProfile } from '@utmmsc/shared';
import { Badge } from '../../../shared/ui/Card';

export function MemberRow({ member }: { member: MemberProfile }) {
  return (
    <Link to={`/directory/${member.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800">
        {member.displayName.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {member.displayName} {isStaffRole(member.role) ? <Badge tone="brand">{ROLE_LABELS[member.role]}</Badge> : null}
        </p>
        <p className="truncate text-sm text-slate-500">
          {member.graduationYear} 届 · {ENROLLMENT_LABELS[member.enrollmentStatus]}
          {member.major ? ` · ${member.major}` : ''}
        </p>
      </div>
    </Link>
  );
}
