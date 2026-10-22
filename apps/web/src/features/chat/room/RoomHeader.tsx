import { useTr } from '../../../shared/i18n/locale';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import type { RoomStatus } from './types';

interface RoomHeaderProps {
  title: string;
  /** Member count shown after a channel name; null for direct messages or before it is known. */
  /** 显示在频道名称后的成员数；私聊或尚未得知时为 null。 */
  count: number | null;
  /** Null hides the connection line, for example while the first connection is still expected to be quick. */
  /** 为 null 时不显示连接状态行，例如首次连接预计很快完成时。 */
  status: RoomStatus | null;
  retrying: boolean;
  othersUnread: number;
  muted: boolean;
  onBack: () => void;
  /** Omitted when the chat info page cannot be opened. */
  /** 无法打开聊天信息页时省略。 */
  onMore?: () => void;
}

function BackChevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 4.5-7.5 7.5 7.5 7.5" />
    </svg>
  );
}

function MoreDots() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function BellSlash() {
  return (
    <svg viewBox="0 0 24 24" className="ml-1 h-4 w-4 shrink-0 text-wx-meta" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 19.5a2.6 2.6 0 0 0 5 0" />
      <path d="M7 9.2V12l-1.8 3.2a.6.6 0 0 0 .5.9h10.6" />
      <path d="M8.3 6.2A5.2 5.2 0 0 1 17 9.2v2.9l1 1.8" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

/**
 * WeChat room title bar: back with the other chats' unread count, the centred name with the member count
 * (only the name truncates), a bell-slash when muted, a connection line when not connected, and the chat
 * info button. There is no online count.
 * 微信式房间标题栏：返回键旁显示其他会话的未读数；居中显示名称与成员数（只截断名称）；免打扰时显示静音铃；未连接时显示连接状态行；
 * 右侧是聊天信息按钮。不显示在线人数。
 */
export function RoomHeader({ title, count, status, retrying, othersUnread, muted, onBack, onMore }: RoomHeaderProps) {
  const tr = useTr();
  useStatusBarColor(WX_COLORS.canvas);
  const offline = status === 'closed' && !retrying;
  const statusLabel =
    status === null || status === 'open' ? null : status === 'catching_up' ? tr('收取中…', 'Updating…') : offline ? tr('未连接', 'Offline') : tr('连接中…', 'Connecting…');
  const backLabel = othersUnread > 0 ? tr(`返回聊天列表，${othersUnread} 条未读`, `Back to chats, ${othersUnread} unread`) : tr('返回聊天列表', 'Back to chats');

  return (
    <header
      className="sticky top-0 z-20 shrink-0 border-b-[0.5px] border-wx-line bg-wx-canvas"
      style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <div className="relative flex h-11 items-center">
        <button type="button" onClick={onBack} aria-label={backLabel} className="flex h-11 min-w-11 items-center pl-2 pr-2 text-wx-ink active:opacity-60">
          <BackChevron />
          {othersUnread > 0 ? (
            <span className="text-[17px] leading-none" aria-hidden>
              {othersUnread > 99 ? '99+' : othersUnread}
            </span>
          ) : null}
        </button>
        <div className="pointer-events-none absolute inset-y-0 left-[72px] right-[72px] flex flex-col items-center justify-center">
          <h1 className="flex max-w-full items-center text-[17px] font-semibold leading-[22px] text-wx-ink">
            <span className="min-w-0 truncate">{title}</span>
            {count !== null ? <span className="shrink-0">({count})</span> : null}
            {muted ? (
              <>
                <BellSlash />
                <span className="sr-only">{tr('，消息免打扰', ', muted')}</span>
              </>
            ) : null}
          </h1>
          {statusLabel ? (
            <p aria-live="polite" className="flex items-center gap-1 text-[12px] leading-4 text-wx-meta">
              {offline ? null : (
                <span aria-hidden className="inline-flex">
                  <WxSpinner size={16} />
                </span>
              )}
              {statusLabel}
            </p>
          ) : null}
        </div>
        {onMore ? (
          <button
            type="button"
            onClick={onMore}
            aria-label={tr('聊天信息', 'Chat info')}
            className="ml-auto flex h-11 w-11 items-center justify-center text-wx-ink active:opacity-60"
          >
            <MoreDots />
          </button>
        ) : null}
      </div>
    </header>
  );
}
