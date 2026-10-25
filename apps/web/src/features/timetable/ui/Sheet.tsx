/**
 * Owner: T3, timetable web core. The timetable's two sheets. FullSheet holds a form: full height on phones, a
 * white bar with 取消 and the title, the grey canvas under WeChat-style groups, and a sticky save button. HalfSheet
 * rises from the bottom for the course card. Both close on the system back gesture and on Escape.
 * 维护者：T3，课表网页核心。课表的两种面板。FullSheet 用于表单：在手机上占满全屏，白色标题栏带「取消」和标题，灰色底上是微信式分组，
 * 保存按钮固定在底部。HalfSheet 从底部升起，用于课程卡片。两者都会因系统返回手势或 Escape 键而关闭。
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';

/**
 * Escape closes the sheet when it is the top dialog; a sheet or menu opened over it handles the key itself.
 * The import sheet uses it too.
 * 当面板是最上层的对话框时，Escape 键关闭它；在它之上打开的面板或菜单自行处理这个按键。导入面板也使用它。
 */
export function useEscape(onClose: () => void, panel: RefObject<HTMLElement>) {
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [panel]);
}

/** Moves focus into a newly opened sheet, so screen readers start there and Tab stays near it. */
/** 把焦点移入新打开的面板，读屏软件从这里开始，Tab 键也在附近。 */
function useInitialFocus(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [ref]);
}

export interface FullSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The sticky action, usually 保存. Absent for a sheet that only lists things. */
  /** 固定在底部的操作，通常为「保存」。只用于列出内容的面板没有它。 */
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  /** A control at the right of the title bar. */
  /** 标题栏右侧的控件。 */
  trailing?: ReactNode;
  closeLabel?: string;
  /** Sits above other sheets, such as a term editor opened from the term list. */
  /** 位于其他面板之上，例如从学期列表打开的学期编辑。 */
  raised?: boolean;
}

export function FullSheet({ title, onClose, children, primary, trailing, closeLabel, raised = false }: FullSheetProps) {
  const tr = useTr();
  const panelRef = useRef<HTMLDivElement>(null);
  useBackToClose(onClose);
  useEscape(onClose, panelRef);
  useInitialFocus(panelRef);
  return createPortal(
    <div className={`fixed inset-0 ${raised ? 'z-[56]' : 'z-[55]'} flex justify-center bg-black/30`}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="wx-slide-up flex h-full w-full max-w-2xl flex-col bg-wx-canvas outline-none"
        style={{ paddingTop: 'var(--safe-top)' }}
      >
        <header className="relative flex h-12 shrink-0 items-center border-b-[0.5px] border-wx-line bg-white px-1">
          <button type="button" onClick={onClose} className="min-h-11 rounded-lg px-3 text-[16px] text-wx-ink active:bg-wx-pressed">
            {closeLabel ?? tr('取消', 'Cancel')}
          </button>
          <h2 className="pointer-events-none absolute inset-x-20 truncate text-center text-[17px] font-semibold text-wx-ink">{title}</h2>
          <div className="ml-auto flex min-w-11 items-center justify-end pr-1">{trailing}</div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
          {children}
        </div>
        {primary ? (
          <div className="shrink-0 border-t-[0.5px] border-wx-line bg-white px-4 pt-2" style={{ paddingBottom: 'max(0.5rem, var(--safe-bottom))' }}>
            <button
              type="button"
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="flex min-h-11 w-full items-center justify-center rounded-lg bg-brand-800 text-[16px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300"
            >
              {primary.label}
            </button>
          </div>
        ) : (
          <div className="shrink-0" style={{ height: 'var(--safe-bottom)' }} />
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface HalfSheetProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/** A sheet from the bottom, at most about two thirds of the screen, closed by a tap on the dimmed page. */
/** 从底部升起的面板，最多约占屏幕三分之二，点按变暗的页面即可关闭。 */
export function HalfSheet({ label, onClose, children }: HalfSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  useBackToClose(onClose);
  useEscape(onClose, panelRef);
  useInitialFocus(panelRef);
  return createPortal(
    <div
      className="wx-fade fixed inset-0 z-50 flex flex-col justify-end bg-black/40"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // A tap that both starts and ends on the backdrop closes; the release of the press that opened it does not.
        // 只有在遮罩上按下并松开的点按才会关闭；打开它的那次按压松开时不算。
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="wx-slide-up mx-auto flex max-h-[72vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-wx-canvas outline-none"
      >
        <div className="flex shrink-0 justify-center bg-white pb-1 pt-2" aria-hidden>
          <span className="h-1 w-9 rounded-full bg-stone-300" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: 'var(--safe-bottom)' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
