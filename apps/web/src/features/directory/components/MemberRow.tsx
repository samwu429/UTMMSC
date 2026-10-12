import { Link } from 'react-router-dom';
import { ENROLLMENT_LABELS, ROLE_LABELS, isStaffRole, type FriendshipState, type MemberProfile } from '@utmmsc/shared';
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
  return (
    <div className="flex items-center gap-2 pr-3 active:bg-stone-50">
      <Link to={`/directory/${member.id}`} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3">
        <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} className="h-10 w-10 text-sm" />
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
      {friendship === 'friends' ? <span className="shrink-0 text-xs text-brand-700">好友</span> : null}
      {friendship === 'outgoing' ? <span className="shrink-0 text-xs text-stone-400">等待通过</span> : null}
      {friendship === 'incoming' && onAccept ? (
        <button type="button" disabled={busy} onClick={onAccept} className="shrink-0 text-sm font-medium text-brand-800 disabled:opacity-40">
          通过
        </button>
      ) : null}
      {friendship === 'none' && onRequest ? (
        <button type="button" disabled={busy} onClick={onRequest} className="shrink-0 text-sm font-medium text-brand-800 disabled:opacity-40">
          加好友
        </button>
      ) : null}
    </div>
  );
}
