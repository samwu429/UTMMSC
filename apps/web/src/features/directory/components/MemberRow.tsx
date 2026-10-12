import { Link } from 'react-router-dom';
import { ENROLLMENT_LABELS, ROLE_LABELS, isStaffRole, type MemberProfile } from '@utmmsc/shared';

export function MemberRow({ member }: { member: MemberProfile }) {
  return (
    <Link to={`/directory/${member.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-stone-50">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-200 text-sm font-medium text-stone-700">
        {member.displayName.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {member.displayName}
          {isStaffRole(member.role) ? <span className="ml-1.5 text-xs font-normal text-brand-800">{ROLE_LABELS[member.role]}</span> : null}
        </p>
        <p className="truncate text-sm text-stone-500">
          {member.headline ||
            `${member.graduationYear} 届 · ${ENROLLMENT_LABELS[member.enrollmentStatus]}${member.major ? ` · ${member.major}` : ''}`}
        </p>
      </div>
    </Link>
  );
}
