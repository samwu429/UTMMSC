import { Link } from 'react-router-dom';
import { isHonoraryRole, isStaffRole, showsEnrollment, type FriendshipState, type MemberProfile } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';

export function MemberRow({
  member,
  friendship = 'none',
  busy = false,
  onRequest,
  onAccept,
}: {
  member: MemberProfile;
  friendship?: FriendshipState;
  busy?: boolean;
  onRequest?: () => void;
  onAccept?: () => void;
}) {
  const { tr, role, enrollment, year, major } = useLabels();
  const title = isStaffRole(member.role) || isHonoraryRole(member.role) ? role(member.role) : null;
  return (
    <div className="flex items-center gap-2 pr-3 active:bg-stone-50">
      <Link to={`/directory/${member.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className="h-10 w-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {member.displayName}
            {title ? <span className="ml-1.5 text-xs font-normal text-brand-800">{title}</span> : null}
          </p>
          <p className="truncate text-sm text-stone-500">{memberLine(member, { enrollment, year, major })}</p>
        </div>
      </Link>
      {friendship === 'friends' ? <span className="shrink-0 text-xs text-brand-700">{tr('好友', 'Friends')}</span> : null}
      {friendship === 'outgoing' ? <span className="shrink-0 text-xs text-stone-400">{tr('等待通过', 'Pending')}</span> : null}
      {friendship === 'incoming' && onAccept ? (
        <button type="button" disabled={busy} onClick={onAccept} className="mr-1 shrink-0 rounded-full bg-brand-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {tr('通过', 'Accept')}
        </button>
      ) : null}
      {friendship === 'none' && onRequest ? (
        <button type="button" disabled={busy} onClick={onRequest} className="mr-1 shrink-0 rounded-full bg-brand-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {tr('加好友', 'Add')}
        </button>
      ) : null}
    </div>
  );
}

function memberLine(
  member: MemberProfile,
  labels: { enrollment: (status: MemberProfile['enrollmentStatus']) => string; year: (year: number) => string; major: (stored: string | null | undefined) => string | null },
): string {
  const programs = showsEnrollment(member.role) ? labels.major(member.major) : null;
  if (member.headline) return [member.headline, programs].filter(Boolean).join(' · ');
  if (!showsEnrollment(member.role)) return '';
  const status = isHonoraryRole(member.role) ? null : labels.enrollment(member.enrollmentStatus);
  return [labels.year(member.graduationYear), status, programs].filter(Boolean).join(' · ');
}
