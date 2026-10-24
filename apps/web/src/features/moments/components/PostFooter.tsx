import { forwardRef, type ReactNode } from 'react';
import type { MomentPost } from '@utmmsc/shared';
import { formatEventTime } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { formatPostTime } from '../../profile/format';
import { GlobeIcon, LockIcon } from '../icons';

/**
 * A free-text place opens a map search in a new tab; nothing else is sent. GPS is never asked for.
 * 自由填写的地点在新标签页中打开地图搜索；不会发送其他内容，也从不请求定位。
 */
function mapSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}

/** 13px wx-link line under the media: the place the author typed. */
/** 媒体下方 13px 的 wx-link 色一行：作者填写的地点。 */
export function LocationLine({ location }: { location: string }) {
  const tr = useTr();
  return (
    <a
      href={mapSearchUrl(location)}
      target="_blank"
      rel="noopener noreferrer nofollow"
      aria-label={tr(`位置：${location}，在地图中查看`, `Location: ${location}. Show on a map`)}
      className="mt-1.5 block max-w-full truncate text-[13px] leading-5 text-wx-link"
    >
      {location}
    </a>
  );
}

export interface PostFooterProps {
  post: MomentPost;
  /** The signed-in member wrote it, so 仅自己 shows a lock. */
  /** 当前成员发表的动态，「仅自己」时显示锁。 */
  own: boolean;
  /** 删除, when this card can delete the post. */
  /** 「删除」，本卡片可以删除这条动态时提供。 */
  onDelete?: () => void;
  /** The "··" and its pill, when the post takes likes and comments. */
  /** 「··」及其浮条，动态可以点赞和评论时提供。 */
  pill?: ReactNode;
}

/**
 * Time · 全社团 (club-wide posts) · a lock (own 仅自己 posts) · 删除 (own) on the left, "··" on the right. The
 * comment bar keeps the footer in view when a post has no likes or comments yet.
 * 左侧为时间 ·「全社团」（全社团可见的动态）· 锁（自己的仅自己可见动态）·「删除」（自己的），右侧为「··」。动态还没有赞和评论时，
 * 评论栏让底栏保持可见。
 */
export const PostFooter = forwardRef<HTMLDivElement, PostFooterProps>(function PostFooter({ post, own, onDelete, pill }, ref) {
  const tr = useTr();
  const privatePost = own && post.audience === 'private';

  return (
    <div ref={ref} className="mt-2 flex min-h-5 items-center gap-2 text-[13px] leading-5 text-wx-meta">
      <time dateTime={post.createdAt} title={formatEventTime(post.createdAt)} className="shrink-0">
        {formatPostTime(post.createdAt)}
      </time>
      {post.clubWide ? (
        <span className="inline-flex shrink-0 items-center gap-0.5">
          <GlobeIcon className="h-3.5 w-3.5" />
          {tr('全社团', 'Club')}
        </span>
      ) : null}
      {privatePost ? (
        <span role="img" aria-label={tr('仅自己', 'Only me')} title={tr('仅自己', 'Only me')} className="inline-flex shrink-0 items-center">
          <LockIcon className="h-3.5 w-3.5" />
        </span>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={onDelete} className="-my-3 min-h-11 shrink-0 rounded-[4px] px-1 text-wx-link active:bg-wx-pressed">
          {tr('删除', 'Delete')}
        </button>
      ) : null}
      <span className="min-w-0 flex-1" />
      {pill}
    </div>
  );
});
