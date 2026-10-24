import { memo, useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Link } from 'react-router-dom';
import type { MomentPerson } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { useCommentBar, type CommentBarController, type CommentTarget } from '../comment/useCommentBar';
import type { CommentReplyTarget, FeedKey, MediaOpenRequest, MomentView } from '../model';
import { useFeedStore } from '../state/feedStore';
import { ActionPill } from './ActionPill';
import { InteractionBox } from './InteractionBox';
import { MediaGrid } from './MediaGrid';
import { MomentText } from './MomentText';
import { PendingStrip, RemovedStrip } from './PendingStrip';
import { LocationLine, PostFooter } from './PostFooter';
import { DeleteMomentSheet } from './PostMenus';
import { ReportSheet } from './ReportSheet';

export interface MomentItemProps {
  view: MomentView;
  /** The list the card sits in, which keeps its 全文 state. */
  /** 卡片所在的列表，保存其「全文」状态。 */
  feed: FeedKey;
  /** detail: text open, every loaded comment, no 展开其余 N 条评论 row. */
  /** detail：正文展开，显示全部已加载的评论，没有「展开其余 N 条评论」一行。 */
  variant?: 'feed' | 'detail';
  /** Comment to flash with wx-flash and scroll into view (detail opened from a notice). */
  /** 要以 wx-flash 闪烁并滚动到可见处的评论（从消息打开详情时）。 */
  flashCommentId?: string | null;
  /** A media cell was tapped: open the viewer, or for a video the player (call primeMomentVideo first). */
  /** 点击了媒体格子：打开图片查看器；视频则打开播放器（先调用 primeMomentVideo）。 */
  onOpenMedia(request: MediaOpenRequest): void;
}

/**
 * Hands the card the comment bar's open() without subscribing the card itself: the bar's state changes on every
 * keyboard frame, and only this empty child renders again for it.
 * 把评论栏的 open() 交给卡片，而卡片本身不订阅评论栏：评论栏的状态在键盘动画的每一帧都会变化，只有这个空的子组件会因此重新渲染。
 */
function CommentBarLink({ openRef }: { openRef: MutableRefObject<CommentBarController['open'] | null> }) {
  const { open } = useCommentBar();
  useLayoutEffect(() => {
    openRef.current = open;
  }, [openRef, open]);
  return null;
}

/**
 * One post: avatar and name, text with 全文 / 收起, media, location, footer with "··", the pill, pending or
 * removed strips, and the likes and comments box. Likes, deletes and comments go through the feed store and the
 * comment bar.
 * 一条动态：头像和名字、带「全文 / 收起」的正文、媒体、位置、带「··」的底栏、赞和评论浮条、发送中或已移除的提示，以及赞和评论区。
 * 点赞、删除和评论经由动态 store 和评论栏完成。
 */
export const MomentItem = memo(function MomentItem({ view, feed, variant = 'feed', flashCommentId = null, onOpenMedia }: MomentItemProps) {
  const tr = useTr();
  const nameId = useId();
  const openBarRef = useRef<CommentBarController['open'] | null>(null);
  const member = useSessionStore((s) => s.member);
  const sessionToken = useSessionStore((s) => s.mediaToken);
  const feedMe = useFeedStore((s) => s.me);
  const feedToken = useFeedStore((s) => s.mediaToken);
  const boxRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<'delete' | 'report' | null>(null);

  const { post, local } = view;
  const postId = post.id;
  const me = useMemo<MomentPerson | null>(
    () => feedMe ?? (member ? { id: member.id, displayName: member.displayName, avatarKey: member.avatarKey ?? null } : null),
    [feedMe, member],
  );
  const own = local !== null || (me !== null && post.author.id === me.id);
  const removal = own ? (post.removed ?? null) : null;
  const interactive = local === null && removal === null && post.canInteract;
  const name = post.author.displayName.trim() || tr('成员', 'Member');
  const mediaToken = feedToken ?? sessionToken;
  const profile = `/directory/${post.author.id}`;
  const detail = variant === 'detail';

  const anchor = useCallback(() => boxRef.current ?? footerRef.current, []);
  const openBar = useCallback((target: CommentTarget) => openBarRef.current?.(target), []);

  const onReply = useCallback(
    (target: CommentReplyTarget, row: HTMLElement) => {
      openBar({ postId, clubWide: post.clubWide, replyTo: target, anchor: () => (row.isConnected ? row : anchor()) });
    },
    [openBar, postId, post.clubWide, anchor],
  );

  // The store announces 已赞 / 已取消赞 and 已删除 itself.
  // store 自己会播报「已赞 / 已取消赞」和「已删除」。
  const like = useCallback(() => useFeedStore.getState().toggleLike(postId), [postId]);

  function comment() {
    // Synchronous, so the keyboard rises on this very tap.
    // 同步调用，键盘因此在这一次点击中就会弹出。
    openBar({ postId, clubWide: post.clubWide, replyTo: null, anchor });
  }

  // A local post's id is localPostKey(clientId), which deletePost discards with its uploads.
  // 本地动态的 id 为 localPostKey(clientId)，deletePost 会连同其上传一起丢弃。
  const confirmDelete = useCallback(() => void useFeedStore.getState().deletePost(postId), [postId]);

  const onExpandedChange = useCallback((expanded: boolean) => useFeedStore.getState().setExpanded(feed, postId, expanded), [feed, postId]);
  const onReport = useCallback(() => setSheet('report'), []);
  const onOpen = useCallback((index: number, rect: DOMRect | null) => onOpenMedia({ postId, index, rect }), [onOpenMedia, postId]);
  const releaseLocal = useCallback(() => useFeedStore.getState().releaseLocalMedia(postId), [postId]);

  return (
    <article
      aria-labelledby={nameId}
      className={`flex gap-[10px] border-b-[0.5px] border-wx-line bg-white px-4 py-3 transition-opacity duration-200 motion-reduce:transition-none ${view.deleting ? 'pointer-events-none opacity-0' : ''}`}
    >
      {/* The name below is the same link, so the avatar stays out of the tab order and the reading order. */}
      {/* 下面的名字是同一个链接，因此头像不进入 Tab 顺序和读屏顺序。 */}
      <Link to={profile} tabIndex={-1} aria-hidden className="shrink-0 self-start rounded-[4px]" style={{ WebkitTouchCallout: 'none' }}>
        <MemberAvatar name={name} avatarKey={post.author.avatarKey} shape="square" className="h-[42px] w-[42px] text-base" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link id={nameId} to={profile} className="inline-block max-w-full truncate align-top text-[16px] font-medium leading-[22px] text-wx-link">
          {name}
        </Link>
        {post.body ? (
          <MomentText
            id={view.key}
            text={post.body}
            alwaysOpen={detail}
            expanded={view.expanded}
            onExpandedChange={onExpandedChange}
            onReport={!own && post.canReport ? onReport : undefined}
          />
        ) : null}
        {post.media.length > 0 ? (
          <div className={`transition-opacity motion-reduce:transition-none ${local?.status === 'uploading' ? 'opacity-60' : ''}`}>
            <MediaGrid
              postId={postId}
              media={post.media}
              localMedia={view.localMedia}
              mediaToken={mediaToken}
              onOpen={onOpen}
              onPreviewsLoaded={view.localMedia && !local ? releaseLocal : undefined}
            />
          </div>
        ) : null}
        {post.location ? <LocationLine location={post.location} /> : null}
        {removal ? <RemovedStrip removal={removal} /> : null}
        <PostFooter
          ref={footerRef}
          post={post}
          own={own}
          onDelete={local === null && post.canDelete ? () => setSheet('delete') : undefined}
          pill={interactive ? <ActionPill pillKey={view.key} liked={view.liked} onLike={like} onComment={comment} /> : null}
        />
        {local ? (
          <PendingStrip state={local} onRetry={() => useFeedStore.getState().retryPost(local.clientId)} onDelete={() => setSheet('delete')} />
        ) : (
          <InteractionBox ref={boxRef} view={view} variant={variant} me={me} flashCommentId={flashCommentId} onReply={onReply} />
        )}
      </div>
      <CommentBarLink openRef={openBarRef} />
      {sheet === 'delete' ? <DeleteMomentSheet onConfirm={confirmDelete} onClose={() => setSheet(null)} /> : null}
      {sheet === 'report' ? <ReportSheet postId={postId} onClose={() => setSheet(null)} /> : null}
    </article>
  );
});
