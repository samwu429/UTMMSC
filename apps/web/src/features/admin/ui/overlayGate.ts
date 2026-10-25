import { useCallback } from 'react';
import { useConfirm } from '../../../shared/ui/confirm';

/**
 * Whether a sheet or dialog is open over admin, so the desktop keys (Esc back to the list, / to search, arrows)
 * leave it alone. The app's confirmation sheet has no dialog role to look for, so admin opens it through
 * useAdminConfirm, which counts it here; ActionSheet and the typed confirmation are found by aria-modal.
 * 管理后台上方是否打开了底部菜单或对话框，桌面快捷键（Esc 返回列表、/ 搜索、方向键）因此不去打扰它。应用的确认层没有可供查找的
 * dialog 角色，所以管理后台通过 useAdminConfirm 打开它，并在这里计数；ActionSheet 和输入名称确认层通过 aria-modal 找到。
 */

let open = 0;

/** Counts one overlay as open; the returned function, called once, counts it closed. */
/** 记一个浮层为打开；返回的函数（只生效一次）记它为关闭。 */
export function overlayOpened(): () => void {
  open += 1;
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    open = Math.max(0, open - 1);
  };
}

export function isAdminOverlayOpen(): boolean {
  if (open > 0) return true;
  return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null;
}

/** Key presses typed into a field belong to the field. */
/** 在输入框中按下的键属于输入框。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return element.closest('input, textarea, select, [contenteditable="true"]') !== null;
}

type ConfirmRequest = Parameters<ReturnType<typeof useConfirm>>[0];

/** The app's confirmation sheet, counted as an open overlay while it waits for an answer. */
/** 应用的确认层，在等待回答期间计为打开的浮层。 */
export function useAdminConfirm(): (request: ConfirmRequest) => Promise<boolean> {
  const ask = useConfirm();
  return useCallback(
    async (request: ConfirmRequest) => {
      const release = overlayOpened();
      try {
        return await ask(request);
      } finally {
        release();
      }
    },
    [ask],
  );
}
