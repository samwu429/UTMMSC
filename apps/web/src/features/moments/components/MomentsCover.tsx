import type { MomentAlbumOwner } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { CoverBanner } from '../../profile/CoverBanner';
import { MemberAvatar } from '../../profile/InitialAvatar';

export interface MomentsCoverProps {
  /** Whose cover: the signed-in member on the home feed, the owner on an album. */
  /** 谁的封面：动态首页为当前成员，相册为相册主人。 */
  person: MomentAlbumOwner;
  /** The signed-in member's own cover: tapping it offers 更换相册封面. Others' covers are not editable. */
  /** 当前成员自己的封面：轻触可「更换相册封面」。别人的封面不能修改。 */
  editable: boolean;
  /** Avatar tap; the home feed opens the own album, the album leaves it unset. */
  /** 轻触头像；动态首页用来打开自己的相册，相册页不设置。 */
  onAvatarClick?: () => void;
}

/**
 * The 192px cover that grows upward with --pull, the name left of a 64px square avatar overlapping its bottom
 * edge by 20px, and the headline under it, right-aligned.
 * 192px 高的封面，随 --pull 向上伸展；名字在 64px 方形头像左侧，头像压住封面底边 20px；签名在其下方右对齐。
 */
export function MomentsCover({ person, editable, onAvatarClick }: MomentsCoverProps) {
  const tr = useTr();
  const avatar = <MemberAvatar name={person.displayName} avatarKey={person.avatarKey} shape="square" className="h-16 w-16 text-2xl" />;

  return (
    <div className="bg-white">
      <CoverBanner coverKey={person.coverKey} tall editable={editable} editTrigger="cover">
        <p className="pointer-events-none absolute bottom-2.5 left-4 right-[92px] truncate text-right text-[18px] font-semibold leading-6 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          {person.displayName}
        </p>
        <div className="absolute -bottom-5 right-4 z-10">
          {onAvatarClick ? (
            <button
              type="button"
              onClick={onAvatarClick}
              aria-label={tr(`${person.displayName}的相册`, `${person.displayName}'s album`)}
              className="block rounded-[4px] active:opacity-80"
            >
              {avatar}
            </button>
          ) : (
            avatar
          )}
        </div>
      </CoverBanner>
      <div className="min-h-[44px] pb-2 pl-20 pr-4 pt-7 text-right">
        {person.headline ? <p className="line-clamp-2 break-words text-[13px] leading-[18px] text-wx-meta [overflow-wrap:anywhere]">{person.headline}</p> : null}
      </div>
    </div>
  );
}
