import { memo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { useLongPress, type LongPressInfo } from '../../../shared/ui/useLongPress';
import { UnreadDot } from '../components/UnreadDot';
import { ChatAvatar } from './ChatAvatar';
import { roomLink, type Conversation } from './conversations';
import { KindTag } from './KindTag';
import { RowMenu } from './RowMenu';

function BellSlash() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-wx-meta" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 19.5a2.6 2.6 0 0 0 5 0" />
      <path d="M7 9.2V12l-1.8 3.2a.6.6 0 0 0 .5.9h10.6" />
      <path d="M8.3 6.2A5.2 5.2 0 0 1 17 9.2v2.9l1 1.8" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

/**
 * One 72px WeChat conversation row: square avatar with the badge on its corner, name, group or direct
 * tag and time on the first line, the preview on the second, and a hairline that starts after the avatar.
 * Long press or right-click opens the row menu.
 * 一行 72px 的微信式会话：方形头像右上角带角标，第一行是名称、群聊或私信标签和时间，第二行是预览，分隔线从头像之后开始。长按或右键打开行菜单。
 */
export const ConversationRow = memo(function ConversationRow({ row, last, onOpen }: { row: Conversation; last: boolean; onOpen: (roomId: string) => void }) {
  const tr = useTr();
  const [menu, setMenu] = useState<LongPressInfo | null>(null);
  const { handlers, pressed } = useLongPress({ onLongPress: setMenu });

  const background = pressed || menu ? 'bg-wx-pressed' : row.pinned ? 'bg-wx-pinned' : 'bg-white';
  const unreadLabel =
    row.badge?.type === 'count'
      ? tr(`${row.badge.n} 条未读`, `${row.badge.n} unread`)
      : row.badge?.type === 'dot'
        ? row.muted && row.unreadCount > 0
          ? tr(`${row.unreadCount} 条未读`, `${row.unreadCount} unread`)
          : tr('标为未读', 'Marked unread')
        : null;

  return (
    <>
      <Link
        to={roomLink(row.roomId)}
        draggable={false}
        onClick={() => onOpen(row.roomId)}
        {...handlers}
        className={`flex h-[72px] select-none items-stretch pl-4 outline-offset-[-2px] [-webkit-touch-callout:none] [touch-action:manipulation] active:bg-wx-pressed ${background}`}
      >
        <span className="relative my-3 mr-3 shrink-0 self-center">
          <ChatAvatar avatar={row.avatar} />
          {row.badge ? (
            <UnreadDot
              count={row.badge.type === 'count' ? row.badge.n : 0}
              dot={row.badge.type === 'dot'}
              className={`absolute ${row.badge.type === 'dot' ? '-right-[5px] -top-[5px]' : '-right-[6px] -top-[6px]'}`}
            />
          ) : null}
        </span>
        <span className={`flex min-w-0 flex-1 flex-col justify-center gap-1 pr-4 ${last ? '' : 'border-b-[0.5px] border-wx-line'}`}>
          <span className="flex items-baseline gap-2">
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="min-w-0 truncate text-[17px] leading-6 text-wx-ink">{row.title}</span>
              <KindTag kind={row.kind} />
            </span>
            {row.timeLabel ? <span className="shrink-0 text-[12px] text-wx-meta">{row.timeLabel}</span> : null}
          </span>
          <span className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-wx-meta">
              {row.preview.tag ? <span className={row.preview.tag.tone === 'alert' ? 'text-wx-red' : ''}>{row.preview.tag.text}</span> : null}
              {row.preview.tag && row.preview.text ? ' ' : null}
              {row.preview.text}
            </span>
            {row.muted ? (
              <>
                <BellSlash />
                <span className="sr-only">{tr('消息免打扰', 'Muted')}</span>
              </>
            ) : null}
          </span>
          {row.pinned ? <span className="sr-only">{tr('已置顶', 'Pinned')}</span> : null}
          {unreadLabel ? <span className="sr-only">{unreadLabel}</span> : null}
        </span>
      </Link>
      {menu ? <RowMenu row={row} press={menu} onClose={() => setMenu(null)} /> : null}
    </>
  );
});
