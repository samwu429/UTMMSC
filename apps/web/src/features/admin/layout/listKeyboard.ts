import { useEffect, type RefObject } from 'react';
import { isAdminOverlayOpen, isEditableTarget } from '../ui/overlayGate';
import { useIsDesktop } from './media';

/** Rows that take part in ↑/↓ carry this attribute (AdminCell's rowId). */
/** 参与 ↑/↓ 导航的行带有这个属性（AdminCell 的 rowId）。 */
export const ROW_ATTRIBUTE = 'data-admin-row';

export type RowKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

/**
 * The row to focus after a key, among `count` rows, from the row at `current` (-1 when focus is not on a row, for
 * example in the search field, where ↓ enters the list). It stops at the ends rather than wrapping. -1 when there
 * are no rows.
 * 按键之后在 `count` 行中应聚焦的行，从位于 `current` 的行出发（焦点不在任何一行上时为 -1，例如在搜索框中，此时 ↓ 进入列表）。
 * 到两端时停住，不循环。没有行时为 -1。
 */
export function nextRowIndex(count: number, current: number, key: RowKey): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(count - 1, current + 1);
    case 'ArrowUp':
      return current <= 0 ? 0 : current - 1;
  }
}

function isRowKey(key: string): key is RowKey {
  return key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End';
}

/**
 * Desktop keys of a list screen: / focuses the search field, ↑/↓ (and Home/End) move between rows, Enter opens the
 * focused row as any link does. Nothing happens while a sheet is open, while typing elsewhere, or on phones.
 * 列表界面的桌面快捷键：/ 聚焦搜索框，↑/↓（以及 Home/End）在各行之间移动，Enter 像任何链接一样打开所聚焦的行。打开底部菜单时、
 * 在别处输入时以及在手机上不起作用。
 */
export function useListKeyboard(container: RefObject<HTMLElement>, search?: RefObject<HTMLInputElement>): void {
  const desktop = useIsDesktop();
  useEffect(() => {
    if (!desktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isAdminOverlayOpen()) return;
      const root = container.current;
      // A list kept mounted under its item screen is hidden and takes no keys.
      // 挂载在项目界面之下的列表处于隐藏状态，不接收按键。
      if (!root || root.offsetParent === null) return;
      const field = search?.current ?? null;
      if (event.key === '/' && field && !isEditableTarget(event.target)) {
        event.preventDefault();
        field.focus();
        field.select();
        return;
      }
      if (!isRowKey(event.key)) return;
      const target = event.target instanceof Element ? event.target : null;
      const inSearch = field !== null && target === field;
      if (!inSearch && (!target || !root.contains(target) || isEditableTarget(target))) return;
      if (inSearch && event.key !== 'ArrowDown') return;
      const rows = Array.from(root.querySelectorAll<HTMLElement>(`[${ROW_ATTRIBUTE}]`));
      const current = target ? rows.findIndex((row) => row === target || row.contains(target)) : -1;
      const next = nextRowIndex(rows.length, current, event.key);
      if (next < 0) return;
      event.preventDefault();
      const row = rows[next];
      row?.focus();
      row?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [desktop, container, search]);
}
