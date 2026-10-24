import { memo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MomentNotice } from '@utmmsc/shared';
import { formatDividerTime } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { mediaUrl } from '../../profile/media';
import { commentBarKeepProps } from '../comment/useCommentBar';
import { HeartIcon, PlayGlyph } from '../icons';

/**
 * One row of 消息: who did it, what they did, when, and the post on the right. The whole row opens the post
 * (and flashes the comment); comment and reply rows also carry 回复, which opens the comment bar on the
 * notices page itself.
 * 「消息」中的一行：谁、做了什么、什么时候，右侧是对应的动态。轻触整行打开这条动态（并闪烁那条评论）；评论和回复行还带有「回复」，
 * 直接在消息页上打开评论栏。
 */

/** The row can be answered: a live comment or reply on a post the reader can still see. */
/** 这一行可以回复：可见动态上仍然存在的评论或回复。 */
export function canReplyToNotice(notice: MomentNotice): boolean {
  if (notice.kind !== 'comment' && notice.kind !== 'reply') return false;
  return notice.post.available && notice.actor !== null && notice.comment !== null && notice.comment.body !== null;
}

/** The comment to flash on the detail page: only one that still exists. */
/** 详情页上要闪烁的评论：只取仍然存在的评论。 */
export function noticeCommentToFlash(notice: MomentNotice): string | null {
  return notice.comment && notice.comment.body !== null ? notice.comment.id : null;
}

export interface NoticeRowProps {
  notice: MomentNotice;
  mediaToken: string | null;
  /** The row was tapped. The page opens the post, or says it is gone when it is not available. */
  /** 轻触了这一行。页面打开这条动态；动态不可用时提示它已不存在。 */
  onOpen(notice: MomentNotice): void;
  /** 回复 was tapped; `row` is the anchor the comment bar keeps visible. Call the bar's open() synchronously. */
  /** 轻触了「回复」；`row` 是评论栏要保持可见的锚点。须同步调用评论栏的 open()。 */
  onReply(notice: MomentNotice, row: HTMLElement): void;
}

function NoticePreview({ notice, mediaToken }: { notice: MomentNotice; mediaToken: string | null }) {
  const preview = notice.post.preview;
  // A video posted before its first frame was kept has no preview key; it shows the dark tile and the play glyph.
  // 在保存首帧之前发的视频没有预览图键，只显示深色方块和播放图标。
  const src = preview?.key && mediaToken ? mediaUrl(preview.key, mediaToken) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (preview) {
    return (
      <span aria-hidden className={`relative block h-14 w-14 shrink-0 overflow-hidden ${preview.kind === 'video' ? 'bg-stone-800' : 'bg-wx-bar'}`}>
        {src && src !== failedSrc ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailedSrc(src)} className="h-full w-full object-cover" />
        ) : null}
        {preview.kind === 'video' ? (
          <span className="absolute inset-0 flex items-center justify-center">
            <PlayGlyph size={22} />
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span aria-hidden className="block h-14 w-14 shrink-0 overflow-hidden bg-wx-bar px-1 py-0.5">
      <span className="line-clamp-3 whitespace-pre-line text-[11px] leading-[17px] text-wx-meta [overflow-wrap:anywhere]">{notice.post.excerpt}</span>
    </span>
  );
}

/** What the row says, as text: shown for comments, spoken for every kind. */
/** 这一行的文字内容：评论类直接显示，所有类型都用于朗读。 */
function useNoticeText() {
  const tr = useTr();
  return (notice: MomentNotice): { visible: string | null; spoken: string } => {
    const body = notice.comment?.body ?? null;
    const deleted = tr('该评论已删除', 'Comment deleted');
    switch (notice.kind) {
      case 'like':
        return { visible: null, spoken: tr('赞了你的动态', 'Liked your update') };
      case 'comment': {
        const text = body ?? deleted;
        return { visible: text, spoken: text };
      }
      case 'reply': {
        const text = body === null ? deleted : tr(`回复了你：${body}`, `Replied to you: ${body}`);
        return { visible: text, spoken: text };
      }
      case 'thread': {
        const replyTo = notice.comment?.replyTo ?? null;
        const text = body === null ? deleted : replyTo ? tr(`回复${replyTo.displayName}：${body}`, `Replied to ${replyTo.displayName}: ${body}`) : body;
        return { visible: text, spoken: text };
      }
      case 'removed': {
        const text = notice.comment ? tr('你的评论已被管理员移除', 'An admin removed your comment') : tr('你的动态已被管理员移除', 'An admin removed your update');
        return { visible: text, spoken: text };
      }
    }
  };
}

export const NoticeRow = memo(function NoticeRow({ notice, mediaToken, onOpen, onReply }: NoticeRowProps) {
  const tr = useTr();
  const rowRef = useRef<HTMLLIElement>(null);
  const describe = useNoticeText();
  const { visible, spoken } = describe(notice);
  const name = notice.actor?.displayName ?? tr('管理员', 'Admin');
  const time = formatDividerTime(notice.createdAt);
  const available = notice.post.available;
  const replyable = canReplyToNotice(notice);
  const removedKind = notice.kind === 'removed';
  // Each part is dimmed on its own: opacity on a wrapper would start a stacking context and put the avatar link
  // under the row button.
  // 各部分分别变淡：在外层设置不透明度会形成层叠上下文，使头像链接落到整行按钮下面。
  const dim = available ? '' : 'opacity-50';
  const label = [name, spoken, time, available ? null : tr('这条动态已删除或无法查看', "This update was deleted or isn't available")].filter(Boolean).join(tr('，', ', '));

  return (
    <li ref={rowRef} className="relative flex gap-3 border-b-[0.5px] border-wx-line bg-white px-4 py-3">
      {/* The whole row is one button laid over the text, so the avatar and 回复 above it stay separate controls. */}
      {/* 整行是覆盖在文字上方的一个按钮，其上的头像和「回复」仍是各自独立的控件。 */}
      <button type="button" onClick={() => onOpen(notice)} aria-label={label} className="absolute inset-0 z-[1] active:bg-black/[0.04]" />
      {notice.actor ? (
        <Link
          to={`/directory/${encodeURIComponent(notice.actor.id)}`}
          aria-label={tr(`查看${name}的资料`, `View ${name}'s profile`)}
          className="relative z-[2] h-10 w-10 shrink-0 self-start active:opacity-70"
        >
          <MemberAvatar name={name} avatarKey={notice.actor.avatarKey} shape="square" className={`h-10 w-10 text-sm ${dim}`} />
        </Link>
      ) : (
        <span aria-hidden className="h-10 w-10 shrink-0">
          <MemberAvatar name={name} avatarKey={null} shape="square" className={`h-10 w-10 text-sm ${dim}`} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span aria-hidden className={`truncate text-[15px] font-medium leading-5 text-wx-link ${dim}`}>
          {name}
        </span>
        <span aria-hidden className={`mt-1 text-[15px] leading-[21px] ${removedKind ? 'text-wx-meta' : 'text-wx-ink'} ${dim}`}>
          {visible === null ? (
            <span className="inline-flex h-[21px] items-center text-wx-link">
              <HeartIcon filled className="h-4 w-4" />
            </span>
          ) : (
            <span className="line-clamp-3 [overflow-wrap:anywhere]">{visible}</span>
          )}
        </span>
        <span className="mt-1 flex min-h-5 items-center gap-4">
          <time aria-hidden dateTime={notice.createdAt} className={`text-[12px] leading-5 text-wx-meta ${dim}`}>
            {time}
          </time>
          {replyable ? (
            <button
              type="button"
              {...commentBarKeepProps}
              onClick={() => {
                const row = rowRef.current;
                if (row) onReply(notice, row);
              }}
              aria-label={tr(`回复 ${name}`, `Reply to ${name}`)}
              className="relative z-[2] -my-3 flex min-h-11 items-center px-1 text-[13px] text-wx-link active:opacity-60"
            >
              {tr('回复', 'Reply')}
            </button>
          ) : null}
        </span>
      </span>
      <span className={dim}>
        <NoticePreview notice={notice} mediaToken={mediaToken} />
      </span>
    </li>
  );
});
