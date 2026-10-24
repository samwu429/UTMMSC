import { Link } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { useMomentsBadge } from '../state/badgeStore';

/**
 * The dark pill under the cover while there are unread notices: the latest actor's avatar and 「N条新消息」.
 * It opens 消息 with unread notices only. A moderator's removal has no actor, so the avatar is left out.
 * 有未读消息时显示在封面下方的深色气泡：最近一位互动者的头像和「N条新消息」。轻触打开只显示未读的「消息」。
 * 管理员移除没有操作者，因此不显示头像。
 */
export function NoticeBubble() {
  const tr = useTr();
  const unread = useMomentsBadge((s) => s.unread);
  const actor = useMomentsBadge((s) => s.latestActor);
  if (unread <= 0) return null;
  const count = unread > 99 ? '99+' : String(unread);

  return (
    <div className="flex justify-center px-4 pb-2 pt-4">
      <Link
        to="/discover/feed/notices?unread=1"
        className="wx-fade flex min-h-11 items-center gap-2.5 rounded-[6px] bg-wx-popover py-1.5 pl-1.5 pr-4 text-[14px] text-white active:opacity-80"
        style={actor ? undefined : { paddingLeft: 16 }}
      >
        {actor ? <MemberAvatar name={actor.displayName} avatarKey={actor.avatarKey} shape="square" className="h-8 w-8 text-sm" /> : null}
        <span>{tr(`${count}条新消息`, `${count} new`)}</span>
      </Link>
    </div>
  );
}
