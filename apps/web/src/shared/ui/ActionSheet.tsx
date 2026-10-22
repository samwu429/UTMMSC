import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../i18n/locale';
import { useBackToClose } from './overlayHistory';

export interface ActionSheetOption {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface Props {
  title?: string;
  options: ActionSheetOption[];
  cancelLabel?: string;
  onClose: () => void;
}

const ROW = 'flex min-h-14 w-full items-center justify-center bg-white px-4 py-2 text-center text-[17px] leading-snug active:bg-wx-pressed';

/**
 * WeChat bottom action sheet: an optional gray title, the options, an 8px gap, then a separate cancel row.
 * Choosing an option closes the sheet first and then runs it.
 * 微信式底部操作菜单：可选的灰色标题、选项、8px 间隔，再加一行独立的取消。选择某项时先关闭菜单再执行。
 */
export function ActionSheet({ title, options, cancelLabel, onClose }: Props) {
  const tr = useTr();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);
  const [trigger] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useBackToClose(onClose);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    return () => {
      const focused = document.activeElement;
      if (!panel || !focused || !panel.contains(focused)) return;
      if (!(trigger instanceof HTMLElement) || trigger === document.body || !trigger.isConnected) return;
      // On touch screens, refocusing a text field would bring the keyboard back up after the sheet closes.
      // 在触屏上，重新聚焦输入框会在菜单关闭后再次弹出键盘。
      const textField = trigger instanceof HTMLTextAreaElement || trigger instanceof HTMLInputElement;
      if (textField && window.matchMedia?.('(pointer: coarse)').matches) return;
      trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      // Keep Tab inside the sheet while it is open.
      // 菜单打开时让 Tab 停留在菜单内部。
      const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function choose(option: ActionSheetOption) {
    onClose();
    option.onSelect();
  }

  return createPortal(
    <div
      className="wx-fade fixed inset-0 z-[60] flex touch-none flex-col justify-end bg-black/40"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a tap that both starts and ends on the backdrop dismisses, never the release of the press that opened the sheet.
        // 只有在遮罩上按下并松开的点按才会关闭，打开菜单的那次按压松开时不算。
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? tr('操作', 'Actions')}
        tabIndex={-1}
        className="wx-slide-up mx-auto w-full max-w-2xl overflow-hidden rounded-t-xl bg-wx-canvas outline-none"
      >
        {title ? <p className="border-b-[0.5px] border-wx-line bg-white px-6 py-4 text-center text-[13px] leading-snug text-wx-meta">{title}</p> : null}
        <div className="max-h-[60vh] touch-pan-y overflow-y-auto overscroll-contain">
          {options.map((option, index) => (
            <button
              key={`${index}:${option.label}`}
              type="button"
              onClick={() => choose(option)}
              className={`${ROW} ${option.danger ? 'text-wx-red' : 'text-wx-ink'} ${index > 0 ? 'border-t-[0.5px] border-wx-line' : ''}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="h-2" aria-hidden />
        <div className="bg-white" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          <button type="button" onClick={onClose} className={`${ROW} text-wx-ink`}>
            {cancelLabel ?? tr('取消', 'Cancel')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
