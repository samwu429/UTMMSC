import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTr } from '../../../shared/i18n/locale';
import { AnchoredLayer } from '../../../shared/ui/AnchoredLayer';
import type { LongPressInfo } from '../../../shared/ui/useLongPress';
import { useOverviewStore } from '../state/overviewStore';
import type { Conversation } from './conversations';

interface MenuItem {
  key: string;
  label: string;
  run: () => void;
}

/**
 * Long-press menu of a conversation row, as in WeChat: mark read or unread, pin, mute and hide.
 * Every action is optimistic through the overview store and syncs to the member's other devices.
 * 会话行的长按菜单，与微信一致：标为已读或未读、置顶、免打扰、不显示。所有操作都通过概览 store 乐观更新，并同步到成员的其他设备。
 */
export function RowMenu({ row, press, onClose }: { row: Conversation; press: LongPressInfo; onClose: () => void }) {
  const tr = useTr();
  const menuRef = useRef<HTMLDivElement>(null);
  const store = useOverviewStore.getState;
  const unread = row.unreadCount > 0 || row.markedUnread;

  const items: MenuItem[] = [
    unread
      ? { key: 'read', label: tr('标为已读', 'Mark as read'), run: () => void store().markAllRead(row.roomId) }
      : { key: 'unread', label: tr('标为未读', 'Mark as unread'), run: () => void store().patchPrefs(row.roomId, { markedUnread: true }) },
    {
      key: 'pin',
      label: row.pinned ? tr('取消置顶', 'Unpin') : tr('置顶该聊天', 'Pin chat'),
      run: () => void store().patchPrefs(row.roomId, { pinned: !row.pinned }),
    },
    {
      key: 'mute',
      label: row.muted ? tr('取消免打扰', 'Unmute') : tr('消息免打扰', 'Mute'),
      run: () => void store().patchPrefs(row.roomId, { muted: !row.muted }),
    },
    { key: 'hide', label: tr('不显示该聊天', 'Hide chat'), run: () => void store().patchPrefs(row.roomId, { hidden: true }) },
  ];

  // Keyboard opens move focus into the menu; a touch or mouse open leaves it on the row.
  // 用键盘打开时把焦点移入菜单；用触摸或鼠标打开时焦点留在该行。
  useEffect(() => {
    if (press.source !== 'keyboard') return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [press.source]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  const point = { top: press.clientY, bottom: press.clientY, left: press.clientX, right: press.clientX };

  return (
    <AnchoredLayer anchor={point} prefer="below" tone="light" onClose={onClose} guardRelease={press.held} className="min-w-[164px] overflow-hidden py-1">
      <div ref={menuRef} role="menu" aria-label={tr('聊天操作', 'Chat actions')} onKeyDown={onKeyDown}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              onClose();
              item.run();
            }}
            className="flex min-h-11 w-full items-center px-4 text-left text-[16px] text-wx-ink outline-none focus-visible:bg-wx-pressed active:bg-wx-pressed"
          >
            {item.label}
          </button>
        ))}
      </div>
    </AnchoredLayer>
  );
}
