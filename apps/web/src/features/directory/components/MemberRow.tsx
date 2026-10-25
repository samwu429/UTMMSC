import { memo } from 'react';
import { Link } from 'react-router-dom';
import { isHonoraryRole, isStaffRole, showsEnrollment, type FriendshipState, type MemberProfile } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';

/**
 * One directory row. It is memoised and its callbacks take the member id, so a keystroke in the search box, which
 * re-renders the page, re-renders no row whose member and friendship are unchanged. Rows off screen skip layout
 * and paint (content-visibility), sized as the 64px they take once drawn.
 * 目录中的一行。它经过 memo，回调以成员 id 为参数；搜索框的每次按键虽然会重新渲染页面，但成员和好友关系未变的行都不会重新渲染。
 * 屏幕外的行跳过布局和绘制（content-visibility），按绘制后的 64px 预留高度。
 */
export const MemberRow = memo(function MemberRow({
  member,
  friendship = 'none',
  busy = false,
  onRequest,
  onAccept,
}: {
  member: MemberProfile;
  friendship?: FriendshipState;
  busy?: boolean;
  onRequest?: (memberId: string) => void;
  onAccept?: (memberId: string) => void;
}) {
  const { tr, role, enrollment, year, major } = useLabels();
  const title = isStaffRole(member.role) || isHonoraryRole(member.role) ? role(member.role) : null;
  return (
    <div className="flex items-center gap-2 pr-3 [contain-intrinsic-size:auto_64px] [content-visibility:auto] active:bg-stone-50">
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
        <button type="button" disabled={busy} onClick={() => onAccept(member.id)} className="mr-1 shrink-0 rounded-full bg-brand-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {tr('通过', 'Accept')}
        </button>
      ) : null}
      {friendship === 'none' && onRequest ? (
        <button type="button" disabled={busy} onClick={() => onRequest(member.id)} className="mr-1 shrink-0 rounded-full bg-brand-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-40">
          {tr('加好友', 'Add')}
        </button>
      ) : null}
    </div>
  );
});

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
