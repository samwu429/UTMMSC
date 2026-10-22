import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { QuotePreview } from '@utmmsc/shared';
import { formatDividerTime } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import type { AnchorRect } from '../../../shared/ui/AnchoredLayer';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { ImageMessage, type PendingImageView } from './ImageMessage';
import { LinkifiedText } from './LinkifiedText';
import { copyText, MessagePopover } from './MessagePopover';
import { QuoteBlock } from './QuoteBlock';
import { SendStatus } from './SendStatus';
import { messageActions, quoteFrom, type BubbleItem, type MessageActionId, type MessageActionInput } from './timeline';
import { TranslationCard } from './TranslationCard';

export interface RowMe {
  id: string;
  displayName: string;
  avatarKey: string | null;
}

/** Stable callbacks from the list, so memoized rows never re-render because of them. */
/** 来自列表的稳定回调，记忆化的行不会因它们而重新渲染。 */
export interface RowActions {
  openProfile(memberId: string): void;
  mentionAuthor(author: { id: string; displayName: string }): void;
  quote(quote: QuotePreview): void;
  recall(id: number): void;
  hide(id: number): void;
  removeAsModerator(id: number): void;
  mute(memberId: string): void;
  resend(clientId: string): void;
  discard(clientId: string): void;
  jumpTo(id: number): void;
  openImage(id: number, rect: DOMRect): void;
  clockSkewMs(): number;
  listElement(): HTMLElement | null;
  /** Keeps the list from following new messages while a menu points at a row; returns the release. */
  /** 菜单指向某行期间，列表不跟随新消息滚动；返回解除函数。 */
  holdFollow(): () => void;
}

interface Props {
  item: BubbleItem;
  kind: 'channel' | 'direct';
  me: RowMe;
  mediaToken: string | null;
  capable: boolean;
  canPost: boolean | null;
  canModerate: boolean;
  actions: RowActions;
}

interface MenuState {
  anchor: AnchorRect;
  held: boolean;
  focus: boolean;
  insetTop: number;
  ids: MessageActionId[];
}

/** A bubble taller than this share of the list points its menu at the press instead of the whole bubble. */
/** 高于列表这一比例的气泡，菜单指向按压位置而不是整个气泡。 */
const TALL_FRACTION = 0.6;

function pointRect(x: number, y: number): AnchorRect {
  return { top: y, bottom: y, left: x, right: x };
}

/**
 * One message, WeChat style: a 40px square avatar on the sender's side, the sender's name above other
 * people's bubbles in channels, and a bubble with a tail. A single tap does nothing; a long press,
 * right-click or the hidden 消息操作 button opens the dark menu. Your own pending messages show their
 * send state to the left of the bubble.
 * 一条微信样式的消息：发送者一侧是 40px 方形头像，频道中别人的气泡上方显示名字，气泡带尾巴。单击无反应；
 * 长按、右键或隐藏的「消息操作」按钮打开深色菜单。自己的待发消息在气泡左侧显示发送状态。
 */
export const MessageRow = memo(function MessageRow({ item, kind, me, mediaToken, capable, canPost, canModerate, actions }: Props) {
  const tr = useTr();
  const ask = useConfirm();
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [sheet, setSheet] = useState<'hide' | 'discard' | null>(null);
  const [translation, setTranslation] = useState(0);

  const message = item.type === 'message' ? item.message : null;
  const pending = item.type === 'pending' ? item.pending : null;
  const own = item.type === 'pending' || item.own;
  const showName = item.type === 'message' && item.showName;
  const author = message ? message.author : { id: me.id, displayName: me.displayName, avatarKey: me.avatarKey };
  const name = author.displayName.trim() || tr('成员', 'Member');
  const text = message ? message.text : (pending?.text ?? '');
  const createdAt = message ? message.createdAt : (pending?.createdAt ?? '');
  const quote = message ? message.replyTo : (pending?.replyTo ?? null);
  const failed = pending?.status === 'failed';

  let image: { imageKey: string | null; width: number | null; height: number | null; pending: PendingImageView | null } | null = null;
  if (message?.imageKey) {
    image = { imageKey: message.imageKey, width: message.imageWidth, height: message.imageHeight, pending: null };
  } else if (pending?.image) {
    const uploading = pending.image.imageKey === null && pending.status !== 'failed';
    image = {
      imageKey: pending.image.imageKey,
      width: pending.image.width,
      height: pending.image.height,
      pending: { localUrl: pending.image.localUrl, progress: pending.image.progress, uploading },
    };
  }

  function actionInput(nowMs: number): MessageActionInput {
    return { own, kind: message?.kind ?? 'user', text, redacted: false, pending: pending !== null, createdAt, capable, canPost, canModerate, nowMs };
  }

  // Taken at the message's own time, so the widest set (including 撤回) decides whether a menu exists at all.
  // 以消息自身的时间计算，得到最完整的操作集合（含撤回），据此判断是否存在菜单。
  const hasMenu = failed || messageActions(actionInput(Date.parse(createdAt) || 0)).length > 0;

  function openMenu(info: LongPressInfo, focus: boolean) {
    if (failed) {
      setSheet('discard');
      return;
    }
    const ids = messageActions(actionInput(Date.now() + actions.clockSkewMs()));
    if (ids.length === 0) return;
    const listRect = actions.listElement()?.getBoundingClientRect();
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const tall = listRect ? info.rect.height > listRect.height * TALL_FRACTION : false;
    setMenu({
      anchor: tall && info.source !== 'keyboard' ? pointRect(info.clientX, info.clientY) : info.rect,
      held: info.held,
      focus,
      insetTop: listRect ? Math.max(0, listRect.top - viewportTop) : 0,
      ids,
    });
  }

  function openFromButton() {
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (!rect) return;
    openMenu({ rect, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, source: 'keyboard', held: false }, true);
  }

  const press = useLongPress({ onLongPress: (info) => openMenu(info, info.source === 'keyboard'), disabled: !hasMenu });
  const avatarPress = useLongPress({
    onLongPress: () => actions.mentionAuthor({ id: author.id, displayName: author.displayName }),
    disabled: own || kind !== 'channel' || !capable || !message,
  });
  const menuOpen = menu !== null;
  const pressed = press.pressed || menuOpen;

  // The menu points at this bubble, so a new message must not scroll the bubble away from it.
  // 菜单指向这个气泡，因此新消息不能把气泡滚离菜单。
  useLayoutEffect(() => (menuOpen ? actions.holdFollow() : undefined), [menuOpen, actions]);

  async function confirmRemove(id: number) {
    const ok = await ask({
      title: tr('为所有人删除这条消息？', 'Remove this message for everyone?'),
      body:
        kind === 'direct'
          ? tr('删除后，聊天双方都看不到这条消息。', 'Neither person in this chat will be able to see it.')
          : tr('删除后，频道里的所有人都看不到这条消息。', 'No one in the channel will be able to see it.'),
      confirmLabel: tr('删除', 'Delete'),
      danger: true,
    });
    if (ok) actions.removeAsModerator(id);
  }

  function onAction(id: MessageActionId) {
    switch (id) {
      case 'copy':
        void copyText(text).then((ok) => toast(ok ? tr('已复制', 'Copied') : tr('复制失败', 'Couldn’t copy')));
        return;
      case 'quote':
        if (message) actions.quote(quoteFrom(message));
        return;
      case 'recall':
        if (message) actions.recall(message.id);
        return;
      case 'hide':
        setSheet('hide');
        return;
      case 'translate':
        setTranslation((n) => n + 1);
        return;
      case 'remove':
        if (message) void confirmRemove(message.id);
        return;
      case 'mute':
        actions.mute(author.id);
        return;
    }
  }

  return (
    <div className={`flex items-start gap-2 py-2 ${own ? 'flex-row-reverse' : ''}`}>
      <span className="sr-only left-0">{`${name}, ${formatDividerTime(createdAt)}:`}</span>
      <button
        type="button"
        className={`shrink-0 rounded-[4px] ${own ? 'mr-3' : 'ml-3'}`}
        style={{ WebkitTouchCallout: 'none' }}
        onClick={() => actions.openProfile(author.id)}
        aria-label={tr(`${name}的资料`, `${name}'s profile`)}
        {...avatarPress.handlers}
      >
        <MemberAvatar name={name} avatarKey={author.avatarKey} shape="square" className="pointer-events-none h-10 w-10 text-base" />
      </button>
      <div className={`relative flex min-w-0 max-w-[min(480px,calc(100%_-_136px))] flex-col ${own ? 'items-end' : 'items-start'}`}>
        {showName ? (
          <p className="mb-1 max-w-full truncate text-xs leading-4 text-wx-meta" aria-hidden>
            {name}
          </p>
        ) : null}
        <div ref={bubbleRef} className={`relative flex max-w-full flex-col gap-1 ${own ? 'items-end' : 'items-start'}`}>
          {pending ? (
            <div className="absolute right-full top-1/2 mr-1 -translate-y-1/2">
              <SendStatus status={pending.status} onResend={() => actions.resend(pending.clientId)} />
            </div>
          ) : null}
          {image ? (
            <ImageMessage
              imageKey={image.imageKey}
              width={image.width}
              height={image.height}
              mediaToken={mediaToken}
              pending={image.pending}
              pressed={pressed}
              handlers={press.handlers}
              onOpen={message ? (rect) => actions.openImage(message.id, rect) : undefined}
            />
          ) : null}
          {text ? (
            <div
              className={`wx-bubble ${own ? 'wx-bubble-mine' : 'wx-bubble-other'} ${pressed ? 'is-pressed' : ''} max-w-full select-none whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
              style={{ WebkitTouchCallout: 'none', touchAction: 'manipulation' }}
              data-interactive
              {...press.handlers}
            >
              <LinkifiedText text={text} own={own} />
            </div>
          ) : null}
        </div>
        {pending?.failure ? <p className="mt-1 max-w-full text-xs leading-4 text-wx-meta">{pending.failure}</p> : null}
        {quote ? <QuoteBlock quote={quote} onJump={message ? actions.jumpTo : undefined} /> : null}
        {translation > 0 && text ? <TranslationCard key={translation} text={text} own={own} onClose={() => setTranslation(0)} /> : null}
        {hasMenu ? (
          // Shown on focus without taking space, so the rows below do not move and the list does not scroll.
          // 获得焦点时显示但不占位，下方的行不会移动，列表也不会滚动。
          <button
            type="button"
            onClick={openFromButton}
            className={`sr-only focus:not-sr-only focus:absolute focus:top-full focus:z-10 focus:mt-1 focus:whitespace-nowrap focus:rounded-[4px] focus:bg-white focus:px-2 focus:py-1 focus:text-xs focus:text-wx-ink focus:shadow ${own ? 'focus:right-0' : 'focus:left-0'}`}
          >
            {tr('消息操作', 'Message actions')}
          </button>
        ) : null}
      </div>
      {menu ? (
        <MessagePopover
          anchor={menu.anchor}
          actions={menu.ids}
          onAction={onAction}
          onClose={() => setMenu(null)}
          scrollContainer={actions.listElement()}
          guardRelease={menu.held}
          insetTop={menu.insetTop}
          autoFocus={menu.focus}
        />
      ) : null}
      {sheet === 'hide' && message ? (
        <ActionSheet
          title={tr('删除后，这条消息只会从你的聊天记录里消失，其他人仍能看到。', 'This removes the message from your chat history only. Others can still see it.')}
          options={[{ label: tr('删除', 'Delete'), danger: true, onSelect: () => actions.hide(message.id) }]}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet === 'discard' && pending ? (
        <ActionSheet options={[{ label: tr('删除', 'Delete'), danger: true, onSelect: () => actions.discard(pending.clientId) }]} onClose={() => setSheet(null)} />
      ) : null}
    </div>
  );
});
