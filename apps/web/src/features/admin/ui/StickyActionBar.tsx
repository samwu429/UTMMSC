import { useEffect, useState, type ReactNode } from 'react';
import { SNACKBAR_LIFT_VAR } from '../../../shared/ui/snackbar';
import { useAdminPane, useIsDesktop } from '../layout/media';

/**
 * Heights of the bars on screen. A list kept mounted under its item screen keeps its bar too, hidden at height 0, so
 * the snackbar takes the tallest one rather than the last one written.
 * 屏幕上各操作栏的高度。挂载在项目界面之下的列表也保留着它的操作栏，隐藏时高度为 0，所以提示条取最高的一个，而不是最后写入的一个。
 */
const lifts = new Map<symbol, number>();

function applyLift(): void {
  if (typeof document === 'undefined') return;
  const tallest = Math.max(0, ...lifts.values());
  const style = document.documentElement.style;
  if (tallest > 0) style.setProperty(SNACKBAR_LIFT_VAR, `${tallest}px`);
  else style.removeProperty(SNACKBAR_LIFT_VAR);
}

function useSnackbarLift(element: HTMLElement | null): void {
  useEffect(() => {
    if (!element) return;
    const id = Symbol('bar');
    const measure = () => {
      lifts.set(id, element.offsetHeight);
      applyLift();
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      lifts.delete(id);
      applyLift();
    };
  }, [element]);
}

/**
 * The main actions of a form or detail. On phones a white bar stuck to the bottom of the screen above the home
 * indicator, its buttons sharing the width; the snackbar rises above it. On desktop the buttons sit at the end of
 * the content, aligned right, except in the list pane of a split view. `note` is a line above the buttons, such as 正在处理 2/5.
 * 表单或详情的主要操作。手机上是一条吸附在屏幕底部、位于主屏幕指示条之上的白色操作栏，按钮平分宽度，提示条显示在它上方。桌面上按钮位于
 * 内容末尾，靠右排列（分栏视图的列表栏除外）。`note` 是按钮上方的一行文字，例如「正在处理 2/5」。
 */
export function StickyActionBar({ children, note }: { children: ReactNode; note?: ReactNode }) {
  const desktop = useIsDesktop();
  const pane = useAdminPane();
  // The narrow list pane of a split view keeps the bottom bar, as a phone does.
  // 分栏视图中较窄的列表栏与手机一样保留底部操作栏。
  const inline = desktop && pane !== 'list';
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useSnackbarLift(inline ? null : element);

  if (inline) {
    return (
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        {note ? <div className="mr-auto text-[13px] text-wx-meta">{note}</div> : null}
        {children}
      </div>
    );
  }
  return (
    <div ref={setElement} className="sticky bottom-0 z-10 border-t-[0.5px] border-wx-line bg-white px-4 pt-2.5" style={{ paddingBottom: 'max(0.625rem, var(--safe-bottom))' }}>
      {note ? (
        <div role="status" className="pb-2 text-center text-[13px] text-wx-meta">
          {note}
        </div>
      ) : null}
      <div className="flex items-center gap-3 [&>*]:min-w-0 [&>*]:flex-1">{children}</div>
    </div>
  );
}
