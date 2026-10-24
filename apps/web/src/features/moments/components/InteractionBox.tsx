import { forwardRef, Fragment, memo } from 'react';
import { Link } from 'react-router-dom';
import type { MomentPerson } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { HeartIcon } from '../icons';
import type { CommentReplyTarget, MomentView } from '../model';
import { useFeedStore } from '../state/feedStore';
import { CommentRow } from './CommentRow';

/** The small triangle on the box's top edge, 12px from its left, pointing up at the footer. */
/** 评论区上边缘的小三角，距左侧 12px，向上指向底栏。 */
function Caret() {
  return (
    <svg width="12" height="6" viewBox="0 0 12 6" className="absolute -top-[6px] left-3 fill-wx-bar" aria-hidden>
      <path d="M0 6 6 0l6 6Z" />
    </svg>
  );
}

/**
 * Heart, then every visible liker's name opening their profile, then 等 N 人 when there are more likes than
 * names. 等 N 人 counts everyone in Chinese; "and N others" counts the rest in English.
 * 心形，然后是每位可见点赞人的名字（点击打开资料），点赞数多于名字时再加「等 N 人」。中文的「等 N 人」计算全部人数，英文的
 * “and N others” 计算其余人数。
 */
function LikesRow({ likes, likeCount }: { likes: readonly MomentPerson[]; likeCount: number }) {
  const tr = useTr();
  const others = Math.max(0, likeCount - likes.length);
  return (
    <p className="flex gap-1.5 px-2 py-[5px] text-[14px] leading-5">
      <HeartIcon filled className="mt-0.5 h-4 w-4 shrink-0 text-wx-link" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className="sr-only">{tr('赞：', 'Liked by ')}</span>
        {likes.map((person, index) => (
          <Fragment key={person.id}>
            {index > 0 ? <span className="text-wx-link">{tr('，', ', ')}</span> : null}
            <Link to={`/directory/${person.id}`} className="rounded-[2px] font-medium text-wx-link active:bg-wx-pressed">
              {person.displayName.trim() || tr('成员', 'Member')}
            </Link>
          </Fragment>
        ))}
        {others > 0 ? <span className="text-wx-ink">{tr(` 等 ${likeCount} 人`, ` and ${others} ${others === 1 ? 'other' : 'others'}`)}</span> : null}
      </span>
    </p>
  );
}

export interface InteractionBoxProps {
  view: MomentView;
  /** detail: every loaded comment, and no 展开其余 N 条评论 row. */
  /** detail：显示全部已加载的评论，没有「展开其余 N 条评论」一行。 */
  variant: 'feed' | 'detail';
  me: MomentPerson | null;
  flashCommentId: string | null;
  onReply: (target: CommentReplyTarget, anchor: HTMLElement) => void;
}

/**
 * WeChat's grey likes and comments box under the footer: the likes row, a hairline when both are present,
 * the comment rows, and 展开其余 N 条评论, which loads the next page in place (spinner, then retry on failure).
 * Renders nothing while a post has neither.
 * 微信底栏下方灰色的赞和评论区：点赞行、两者都有时的细分隔线、评论行，以及就地加载下一页的「展开其余 N 条评论」（加载中显示转圈，
 * 失败后可重试）。动态既没有赞也没有评论时不渲染任何内容。
 */
export const InteractionBox = memo(
  forwardRef<HTMLDivElement, InteractionBoxProps>(function InteractionBox({ view, variant, me, flashCommentId, onReply }, ref) {
    const tr = useTr();
    const hasLikes = view.likes.length > 0 || view.likeCount > 0;
    const more = variant === 'feed' ? view.moreComments : 0;
    const hasComments = view.comments.length > 0 || more > 0;
    if (!hasLikes && !hasComments) return null;

    const loading = view.commentPaging === 'loading';
    const failed = view.commentPaging === 'failed';
    const expandLabel = failed
      ? tr('加载失败，轻触重试', 'Couldn’t load. Tap to retry')
      : tr(`展开其余 ${more} 条评论`, more === 1 ? 'Show 1 more comment' : `Show ${more} more comments`);

    return (
      <div ref={ref} className="relative mt-2.5 rounded-[4px] bg-wx-bar">
        <Caret />
        {hasLikes ? <LikesRow likes={view.likes} likeCount={view.likeCount} /> : null}
        {hasLikes && hasComments ? <div className="h-px origin-top scale-y-50 bg-wx-line" aria-hidden /> : null}
        {hasComments ? (
          <div className="py-1">
            <ul aria-label={tr('评论', 'Comments')}>
              {view.comments.map((item) => (
                <li key={item.key}>
                  <CommentRow
                    item={item}
                    post={view.post}
                    me={me}
                    flash={item.type === 'server' && item.comment.id === flashCommentId}
                    onReply={onReply}
                  />
                </li>
              ))}
            </ul>
            {more > 0 ? (
              <button
                type="button"
                disabled={loading}
                onClick={() => void useFeedStore.getState().loadMoreComments(view.post.id)}
                className="flex min-h-9 w-full items-center gap-1.5 rounded-[2px] px-2 text-left text-[14px] leading-5 text-wx-link active:bg-wx-pressed disabled:active:bg-transparent"
              >
                {loading ? <WxSpinner size={16} /> : null}
                <span>{expandLabel}</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }),
);
