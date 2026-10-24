import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MomentPerson, MomentPost } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import type { AnchorRect } from '../../../shared/ui/AnchoredLayer';
import { toast } from '../../../shared/ui/toast';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { copyText } from '../../chat/room/MessagePopover';
import { TranslationCard } from '../../chat/room/TranslationCard';
import { commentBarKeepProps } from '../comment/useCommentBar';
import type { CommentReplyTarget, CommentView } from '../model';
import { useFeedStore } from '../state/feedStore';
import { ModerationSheet, MomentPopover, type MomentMenuItem } from './PostMenus';
import { ReportSheet } from './ReportSheet';

/** A sending comment shows its spinner only after this, so a quick send never flashes one. */
/** 发送中的评论在此之后才显示转圈，发送很快时不会闪一下。 */
const SPINNER_DELAY_MS = 600;

export interface CommentRowProps {
  item: CommentView;
  post: Pick<MomentPost, 'id' | 'clubWide' | 'canInteract'>;
  /** The signed-in member, who wrote every local comment. */
  /** 当前成员，所有本地评论都由其发出。 */
  me: MomentPerson | null;
  /** Flash with wx-flash and scroll into view once (the detail page opened from a notice). */
  /** 以 wx-flash 闪烁并滚动到可见处一次（从消息打开详情页时）。 */
  flash: boolean;
  /** Tap on someone else's comment: open the bar to reply, inside this tap. */
  /** 轻触别人的评论：在这次点击中打开评论栏进行回复。 */
  onReply: (target: CommentReplyTarget, anchor: HTMLElement) => void;
}

interface MenuState {
  anchor: AnchorRect;
  held: boolean;
  focus: boolean;
}

type Sheet = 'delete' | 'pending' | 'report' | 'moderate' | null;

/**
 * One line of the comment box: 「名字：文字」 or 「A 回复 B：文字」, names opening the profile. The row is a button:
 * someone else's comment replies, your own offers 删除, and a failed one offers [重新发送, 删除]. A long press
 * opens 复制 / 翻译 / 投诉 (+ 删除 for the post's author, + 删除（管理员） for a moderator), or 复制 / 删除 on your own.
 * 评论区中的一行：「名字：文字」或「A 回复 B：文字」，点名字打开资料。整行是一个按钮：别人的评论用来回复，自己的评论提供「删除」，
 * 发送失败的提供 [重新发送, 删除]。长按打开「复制 / 翻译 / 投诉」（动态作者另有「删除」，管理员另有「删除（管理员）」），自己的评论为「复制 / 删除」。
 */
export const CommentRow = memo(function CommentRow({ item, post, me, flash, onReply }: CommentRowProps) {
  const tr = useTr();
  const navigate = useNavigate();
  const rowRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [translation, setTranslation] = useState(0);
  const [slow, setSlow] = useState(false);

  const server = item.type === 'server' ? item.comment : null;
  const local = item.type === 'local' ? item.comment : null;
  const author: MomentPerson | null = server ? server.author : me;
  const replyTo: MomentPerson | null = server ? server.replyTo : (local?.replyTo?.person ?? null);
  const body = server ? server.body : (local?.body ?? '');
  const own = local !== null || (me !== null && server !== null && server.author.id === me.id);
  const removed = server?.removed ?? null;
  const sending = local?.status === 'sending';
  const canReply = server !== null && !own && post.canInteract;
  const authorName = author?.displayName.trim() || tr('成员', 'Member');
  const replyName = replyTo ? replyTo.displayName.trim() || tr('成员', 'Member') : null;

  useEffect(() => {
    if (!sending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sending]);

  useEffect(() => {
    if (!flash) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    rowRef.current?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }, [flash]);

  function openProfile(event: MouseEvent, person: MomentPerson | null) {
    if (!person) return;
    event.stopPropagation();
    navigate(`/directory/${person.id}`);
  }

  function openMenu(info: LongPressInfo) {
    if (!server) return;
    setMenu({ anchor: rowRef.current?.getBoundingClientRect() ?? info.rect, held: info.held, focus: info.source === 'keyboard' });
  }

  const press = useLongPress({ onLongPress: openMenu, disabled: server === null });
  const pressed = press.pressed || menu !== null;

  function onTap() {
    if (local) {
      if (local.status !== 'sending') setSheet('pending');
      return;
    }
    if (!server) return;
    if (own) {
      setSheet('delete');
      return;
    }
    const row = rowRef.current;
    if (canReply && row) onReply({ commentId: server.id, person: server.author }, row);
  }

  // The store takes the row away at once, puts it back with a toast if the server refuses, and announces 已删除.
  // store 立即移除这一行；服务器拒绝时放回原处并提示，成功时播报「已删除」。
  function remove() {
    if (server) void useFeedStore.getState().deleteComment(server.postId, server.id);
  }

  const items: MomentMenuItem[] = [];
  if (server) {
    items.push({
      key: 'copy',
      label: tr('复制', 'Copy'),
      onSelect: () => {
        void copyText(body).then((ok) => toast(ok ? tr('已复制', 'Copied') : tr('复制失败', 'Couldn’t copy')));
      },
    });
    if (own) {
      items.push({ key: 'delete', label: tr('删除', 'Delete'), onSelect: remove });
    } else {
      items.push({ key: 'translate', label: tr('翻译', 'Translate'), onSelect: () => setTranslation((value) => value + 1) });
      items.push({ key: 'report', label: tr('投诉', 'Report'), onSelect: () => setSheet('report') });
      if (server.canDelete) items.push({ key: 'delete', label: tr('删除', 'Delete'), onSelect: remove });
      if (server.canModerate) items.push({ key: 'moderate', label: tr('删除（管理员）', 'Remove as admin'), onSelect: () => setSheet('moderate') });
    }
  }

  const said = replyName ? tr(`${authorName} 回复 ${replyName}：${body}`, `${authorName} replied to ${replyName}: ${body}`) : tr(`${authorName}：${body}`, `${authorName}: ${body}`);
  let hint = '';
  if (local?.status === 'sending') hint = tr('发送中…', 'Sending…');
  else if (local?.status === 'waiting') hint = tr('等待网络', 'Waiting for network');
  else if (local?.status === 'failed') hint = tr('发送失败，轻触重新发送或删除', 'Couldn’t send. Tap to send again or delete');
  else if (removed) hint = tr('该评论已被管理员移除', 'An admin removed this comment');
  else if (own) hint = tr('轻触删除', 'Tap to delete');
  else if (canReply) hint = tr('轻触回复', 'Tap to reply');
  const label = hint ? `${said}${tr('，', '. ')}${hint}` : said;

  return (
    <>
      {/* While the bar is open, a reply row only retargets it, so the keyboard stays up. */}
      {/* 评论栏打开时，点按可回复的行只切换回复对象，键盘保持弹出。 */}
      <button
        ref={rowRef}
        type="button"
        aria-label={label}
        onClick={onTap}
        {...press.handlers}
        {...(canReply ? commentBarKeepProps : null)}
        className={`block w-full select-none rounded-[2px] px-2 py-[3px] text-left text-[14px] leading-5 text-wx-ink [overflow-wrap:anywhere] [-webkit-touch-callout:none] ${pressed ? 'bg-wx-pressed' : 'active:bg-wx-pressed'} ${flash ? 'wx-flash' : ''} ${sending ? 'opacity-60' : ''}`}
        style={{ touchAction: 'manipulation' }}
      >
        <span aria-hidden>
          <span className="font-medium text-wx-link" onClick={(event) => openProfile(event, author)}>
            {authorName}
          </span>
          {replyName ? (
            <>
              <span>{tr(' 回复 ', ' replied to ')}</span>
              <span className="font-medium text-wx-link" onClick={(event) => openProfile(event, replyTo)}>
                {replyName}
              </span>
            </>
          ) : null}
          <span>{tr('：', ': ')}</span>
          <span className={removed ? 'text-wx-meta' : ''}>{body}</span>
          {removed ? <span className="ml-1.5 text-[12px] text-wx-meta">{tr('该评论已被管理员移除', 'An admin removed this comment')}</span> : null}
          {local?.status === 'waiting' ? <span className="ml-1.5 text-[12px] text-wx-meta">{tr('等待网络', 'Waiting for network')}</span> : null}
          {local?.status === 'failed' ? (
            <span className="ml-1.5 inline-flex h-4 w-4 translate-y-[2px] items-center justify-center rounded-full bg-wx-red align-baseline text-[11px] font-bold leading-none text-white">!</span>
          ) : null}
          {sending && slow ? (
            <span className="ml-1.5 inline-flex translate-y-[3px]">
              <WxSpinner size={16} />
            </span>
          ) : null}
        </span>
      </button>
      {translation > 0 && server ? (
        <div className="px-2 pb-1 [&>div]:bg-white">
          <TranslationCard key={translation} text={body} own={false} onClose={() => setTranslation(0)} />
        </div>
      ) : null}
      {menu ? (
        <MomentPopover anchor={menu.anchor} items={items} label={tr('评论操作', 'Comment actions')} onClose={() => setMenu(null)} guardRelease={menu.held} autoFocus={menu.focus} />
      ) : null}
      {sheet === 'delete' && server ? (
        <ActionSheet options={[{ label: tr('删除', 'Delete'), danger: true, onSelect: remove }]} onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'pending' && local ? (
        <ActionSheet
          title={local.failure ?? undefined}
          options={[
            { label: tr('重新发送', 'Send again'), onSelect: () => useFeedStore.getState().resendComment(local.postId, local.clientId) },
            { label: tr('删除', 'Delete'), danger: true, onSelect: () => useFeedStore.getState().discardComment(local.postId, local.clientId) },
          ]}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'report' && server ? <ReportSheet postId={server.postId} commentId={server.id} onClose={() => setSheet(null)} /> : null}
      {sheet === 'moderate' && server ? <ModerationSheet postId={server.postId} commentId={server.id} onClose={() => setSheet(null)} /> : null}
    </>
  );
});
