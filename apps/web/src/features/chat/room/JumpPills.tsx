import type { ReactNode } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { ChevronDownIcon, ChevronUpIcon } from './messageIcons';

interface Props {
  /** Unread count for the top pill, or null when it is hidden. */
  /** 顶部胶囊显示的未读数；隐藏时为 null。 */
  unread: number | null;
  mention: boolean;
  /** New messages from others that arrived while scrolled up. */
  /** 向上翻看期间别人发来的新消息数。 */
  below: number;
  onUnread: () => void;
  onMention: () => void;
  onBelow: () => void;
}

function Pill({ position, onClick, children }: { position: 'top' | 'bottom'; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`wx-fade absolute right-0 z-10 flex h-11 items-center gap-1 rounded-l-full bg-white pl-4 pr-3 text-[14px] font-medium text-brand-700 shadow-[0_1px_6px_rgba(0,0,0,0.12)] active:bg-wx-pressed ${position === 'top' ? 'top-3' : 'bottom-3'}`}
    >
      {children}
    </button>
  );
}

/**
 * WeChat's jump pills: 「有人@我」 or 「N条新消息」 at the top right when entering with unread messages above
 * the screen, and 「N条新消息」 at the bottom right for arrivals while you read older messages.
 * 微信的跳转胶囊：进入时屏幕上方有未读消息，右上角显示「有人@我」或「N条新消息」；向上翻看时有新消息到达，
 * 右下角显示「N条新消息」。
 */
export function JumpPills({ unread, mention, below, onUnread, onMention, onBelow }: Props) {
  const tr = useTr();
  const count = (n: number) => tr(`${n}条新消息`, n === 1 ? '1 new message' : `${n} new messages`);
  return (
    <>
      {mention ? (
        <Pill position="top" onClick={onMention}>
          <ChevronUpIcon />
          {tr('有人@我', 'Mentioned you')}
        </Pill>
      ) : unread !== null && unread > 0 ? (
        <Pill position="top" onClick={onUnread}>
          <ChevronUpIcon />
          {count(unread)}
        </Pill>
      ) : null}
      {below > 0 ? (
        <Pill position="bottom" onClick={onBelow}>
          <ChevronDownIcon />
          {count(below)}
        </Pill>
      ) : null}
    </>
  );
}
