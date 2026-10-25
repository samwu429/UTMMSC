/**
 * Owner: T3, timetable web core. The 已完成 · 撤销 bar shown for 5 s after ticking an assignment done (toast() takes
 * text only). The 作业 tab and the home card both use it: keep the offer with useUndoOffer, show it with UndoBar, and
 * let tick taps through useTickGuard.
 * 维护者：T3，课表网页核心。勾选作业完成后显示 5 秒的「已完成 · 撤销」提示条（toast() 只能显示文字）。「作业」标签和首页卡片都使用它：
 * 用 useUndoOffer 保存撤销操作，用 UndoBar 显示，勾选的点按先经过 useTickGuard。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';

export const UNDO_SHOW_MS = 5000;
/** A tick tap this soon after the last one let through is ignored. */
/** 距上一次放行的勾选不到这么久的点按会被忽略。 */
export const TICK_GUARD_MS = 500;

export interface UndoOffer {
  /** A new offer replaces the one on screen and restarts the 5 s. */
  /** 新的撤销会替换屏幕上的那个，并重新计时 5 秒。 */
  id: number;
  text: string;
  undo: () => void;
}

let offerSeq = 0;

export function useUndoOffer(): { offer: UndoOffer | null; show: (text: string, undo: () => void) => void; dismiss: () => void } {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const show = useCallback((text: string, undo: () => void) => {
    offerSeq += 1;
    setOffer({ id: offerSeq, text, undo });
  }, []);
  const dismiss = useCallback(() => setOffer(null), []);
  return { offer, show, dismiss };
}

/**
 * Returns a check for tick taps that refuses one within TICK_GUARD_MS of the last tap it let through. A tick moves the
 * next assignment under the finger, so a double or bouncy tap would otherwise complete that one too, and the single
 * undo could only bring back the second.
 * 返回勾选点按的检查：距上一次放行的点按不到 TICK_GUARD_MS 的点按会被拒绝。勾选后下一项作业会移到手指下方，否则双击或手指回弹会把它也完成，
 * 而只有一个的「撤销」只能恢复第二项。
 */
export function createTickGuard(now: () => number = () => performance.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const at = now();
    if (at - last < TICK_GUARD_MS) return false;
    last = at;
    return true;
  };
}

/** One createTickGuard for a card or a list, kept across renders. */
/** 一张卡片或一个列表共用的 createTickGuard，在多次渲染之间保持不变。 */
export function useTickGuard(): () => boolean {
  const [guard] = useState(() => createTickGuard());
  return guard;
}

export interface UndoLayerProps {
  offer: UndoOffer | null;
  /** How much higher the pill sits, to clear a bar at the bottom of the screen such as Home's tab bar. */
  /** 胶囊再抬高多少，以避开屏幕底部的栏，例如首页的标签栏。 */
  lift?: string;
  onUndo: () => void;
}

/**
 * The pill and its layer, without the portal. The layer sits above the tab bar and the sync banner (z-30) and below
 * every sheet, menu and dialog (z-50 and up), so whatever opens over the page also covers the pill and its buttons,
 * such as a sheet's 保存, get their taps. Only the pill itself takes taps.
 * 胶囊及其所在的层，不含 portal。这一层高于标签栏和同步提示（z-30），低于所有面板、菜单和对话框（z-50 及以上），因此在页面上打开的任何内容
 * 也会盖住胶囊，其按钮（例如面板的「保存」）能收到点按。只有胶囊本身接收点按。
 */
export function UndoLayer({ offer, lift = '0px', onUndo }: UndoLayerProps) {
  const tr = useTr();
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" style={{ bottom: `calc(var(--safe-bottom) + ${lift} + 1.25rem)` }}>
      {offer ? (
        <div key={offer.id} className="wx-fade pointer-events-auto flex min-h-11 items-center gap-2 rounded-full bg-wx-popover/95 pl-4 pr-1 text-[15px] text-white shadow-lg">
          <span>{offer.text}</span>
          <span aria-hidden className="text-white/50">
            ·
          </span>
          <button type="button" onClick={onUndo} className="min-h-11 rounded-full px-3 font-medium text-gold active:bg-white/10">
            {tr('撤销', 'Undo')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A dark pill above the bottom edge: the text, then 撤销. It leaves after 5 s or once used. */
/** 底部上方的深色胶囊：文字之后是「撤销」。5 秒后或使用后消失。 */
export function UndoBar({ offer, onDismiss, lift }: { offer: UndoOffer | null; onDismiss: () => void; lift?: string }) {
  const dismissRef = useRef(onDismiss);
  useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  });
  const id = offer?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    const timer = setTimeout(() => dismissRef.current(), UNDO_SHOW_MS);
    return () => clearTimeout(timer);
  }, [id]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <UndoLayer
      offer={offer}
      lift={lift}
      onUndo={() => {
        offer?.undo();
        dismissRef.current();
      }}
    />,
    document.body,
  );
}
