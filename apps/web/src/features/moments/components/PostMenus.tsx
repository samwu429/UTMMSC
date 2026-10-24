import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MOMENT_MODERATION_REASON_MAX, momentTextLength, type MomentReportReason } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { tr as translate, useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { AnchoredLayer, type AnchorRect } from '../../../shared/ui/AnchoredLayer';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { OVERLAY_BOTTOM_INSET, useVisualViewportOverlay } from '../../chat/room/useVisualViewport';
import { useFeedStore } from '../state/feedStore';

/**
 * Menus and sheets of a post card: the dark long-press menu, the 删除这条动态？ sheet, the bottom sheet shell
 * used by 投诉 and 删除（管理员）, and the moderator's removal sheet. The detail page reuses them for its ··· menu.
 * 动态卡片的菜单与底部面板：深色长按菜单、「删除这条动态？」菜单、投诉和「删除（管理员）」共用的底部面板外壳，以及管理员的移除面板。
 * 详情页的「···」菜单也复用它们。
 */

/** Height of the moments header under the safe area, when no header can be measured. */
/** 无法测量顶栏时，安全区下方好友动态顶栏的高度。 */
const HEADER_FALLBACK_PX = 44;
/** A finger that moves this far is the member scrolling, not a tap. */
/** 手指移动超过这个距离表示成员在滚动，而不是点按。 */
const DRAG_PX = 10;
/** A scroll this soon after a key press is the member's own (Space, Page Down, arrows). */
/** 按键后这么短时间内发生的滚动算作成员自己的滚动（空格、Page Down、方向键）。 */
const KEY_SCROLL_MS = 500;

function safeTopPx(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;height:var(--safe-top)';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
}

/**
 * The bottom edge of the page's fixed or sticky header in viewport px, so menus never open under it and 收起
 * can bring a post's top back just below it. Falls back to the safe area plus the 44px moments header.
 * 页面固定或吸顶标题栏底边在视口中的位置（像素），菜单因此不会在它下面打开，「收起」也能把动态顶部放回它的正下方。
 * 测量不到时使用安全区加 44px 的好友动态顶栏。
 */
export function momentsHeaderBottom(): number {
  if (typeof document === 'undefined') return 0;
  for (const header of Array.from(document.querySelectorAll('header'))) {
    const position = getComputedStyle(header).position;
    if (position !== 'fixed' && position !== 'sticky') continue;
    const rect = header.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > 0 && rect.top < 120) return rect.bottom;
  }
  return safeTopPx() + HEADER_FALLBACK_PX;
}

/**
 * Calls onClose when the member scrolls the page while `active`: a finger dragged more than 10px, a wheel or
 * trackpad scroll, or a scroll right after a key press. Scrolls the page makes on its own do not count.
 * `active` 期间成员滚动页面时调用 onClose：手指拖动超过 10px、滚轮或触控板滚动，或按键后紧接着的滚动。页面自身发起的滚动不算。
 */
export function useCloseOnUserScroll(active: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    let start: { x: number; y: number } | null = null;
    let keyAt = Number.NEGATIVE_INFINITY;
    const close = () => closeRef.current();
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      start = touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || !start) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx * dx + dy * dy <= DRAG_PX * DRAG_PX) return;
      start = null;
      close();
    };
    const onWheel = () => close();
    const onKeyDown = () => {
      keyAt = performance.now();
    };
    const onScroll = () => {
      if (performance.now() - keyAt < KEY_SCROLL_MS) close();
    };
    const capture = { capture: true, passive: true } as const;
    window.addEventListener('touchstart', onTouchStart, capture);
    window.addEventListener('touchmove', onTouchMove, capture);
    window.addEventListener('wheel', onWheel, capture);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onScroll);
    };
  }, [active]);
}

export interface MomentMenuItem {
  key: string;
  label: string;
  onSelect: () => void;
}

interface MomentPopoverProps {
  anchor: AnchorRect;
  items: MomentMenuItem[];
  /** Spoken name of the menu. */
  /** 菜单的读屏名称。 */
  label: string;
  onClose: () => void;
  /** A press that is still down opened it, so its release must not dismiss it. */
  /** 由仍未松开的按压打开，松开时不能把它关掉。 */
  guardRelease: boolean;
  /** Moves focus to the first item, for keyboard and screen-reader opens. */
  /** 把焦点移到第一项，用于键盘和读屏方式打开。 */
  autoFocus: boolean;
}

/**
 * WeChat's dark long-press menu over moments text and comments: short labels in one row, pointing at what was
 * pressed. It closes on an outside press, Escape, back or the member's own scroll; choosing closes it first.
 * 微信好友动态正文和评论上的深色长按菜单：一排简短文字，箭头指向被按住的内容。点击外部、Escape、返回或成员自己滚动时关闭；
 * 选择某项时先关闭菜单。
 */
export function MomentPopover({ anchor, items, label, onClose, guardRelease, autoFocus }: MomentPopoverProps) {
  const [insetTop] = useState(momentsHeaderBottom);
  const [focusIndex, setFocusIndex] = useState(0);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);

  useBackToClose(onClose);
  useCloseOnUserScroll(true, onClose);

  useEffect(() => {
    if (!autoFocus) return;
    // The layer stays invisible until it has measured itself, and invisible items cannot take focus.
    // 浮层在完成测量之前不可见，而不可见的项无法获得焦点。
    const frame = requestAnimationFrame(() => itemsRef.current[0]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  function move(index: number) {
    const last = items.length - 1;
    const next = index < 0 ? last : index > last ? 0 : index;
    setFocusIndex(next);
    itemsRef.current[next]?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      move(focusIndex + 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(focusIndex - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(items.length - 1);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <AnchoredLayer anchor={anchor} prefer="above" tone="dark" onClose={onClose} guardRelease={guardRelease} insetTop={insetTop}>
      <div role="menu" aria-label={label} onKeyDown={onKeyDown} className="flex items-stretch px-1">
        {items.map((item, index) => (
          <div key={item.key} className="flex items-stretch">
            {index > 0 ? <span className="my-3 w-px bg-white/20" aria-hidden /> : null}
            <button
              ref={(element) => {
                itemsRef.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={index === focusIndex ? 0 : -1}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
              className="flex min-h-11 min-w-11 items-center justify-center whitespace-nowrap rounded-[4px] px-3.5 text-[14px] text-white outline-none active:bg-white/10 focus-visible:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/80"
            >
              {item.label}
            </button>
          </div>
        ))}
      </div>
    </AnchoredLayer>
  );
}

/** 删除这条动态？ with a red 删除. */
/** 「删除这条动态？」，带红色的「删除」。 */
export function DeleteMomentSheet({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const tr = useTr();
  return <ActionSheet title={tr('删除这条动态？', 'Delete this update?')} options={[{ label: tr('删除', 'Delete'), danger: true, onSelect: onConfirm }]} onClose={onClose} />;
}

/**
 * The words for a report reason. It reads the language when called, so the calling component must use useTr().
 * 投诉原因的文字。调用时才读取语言，所以调用它的组件也要使用 useTr()。
 */
export function momentReportReasonLabel(reason: MomentReportReason): string {
  switch (reason) {
    case 'spam':
      return translate('垃圾广告', 'Spam');
    case 'harassment':
      return translate('骚扰或攻击', 'Harassment');
    case 'inappropriate':
      return translate('不当内容', 'Inappropriate');
    case 'privacy':
      return translate('泄露隐私', 'Privacy');
    case 'other':
      return translate('其他', 'Other');
  }
}

/** Cuts text to `max` code points, the way the API counts. */
/** 按接口的计数方式，把文字截到 `max` 个码点。 */
export function limitCodePoints(text: string, max: number): string {
  return momentTextLength(text) <= max ? text : Array.from(text).slice(0, max).join('');
}

interface MomentSheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The action row, pinned under the content above the home indicator or the keyboard. */
  /** 操作行，固定在内容下方、主屏幕指示条或键盘之上。 */
  footer: ReactNode;
}

/**
 * Bottom sheet with a title bar, scrolling content and an action row, fitted to the visible part of the
 * screen so a note field stays above the keyboard. Back, Escape and a tap on the dimmed backdrop close it; Tab
 * stays inside while it is open, and focus returns to what opened it.
 * 带标题栏、可滚动内容和操作行的底部面板，贴合屏幕的可见区域，说明输入框因此始终在键盘上方。返回、Escape 和轻触变暗的背景会关闭它；
 * 打开期间 Tab 停留在面板内，关闭后焦点回到打开它的元素。
 */
export function MomentSheet({ title, onClose, children, footer }: MomentSheetProps) {
  const tr = useTr();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const pressStartedOnBackdrop = useRef(false);

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useBackToClose(onClose);
  useVisualViewportOverlay(rootRef);

  useLayoutEffect(() => {
    // Read here rather than during render: a menu that opened the sheet has handed focus back to its row by now.
    // 在这里读取而不是在渲染时读取：打开面板的菜单此时已把焦点还给了它所指的那一行。
    const trigger = document.activeElement;
    const panel = panelRef.current;
    panel?.focus({ preventScroll: true });
    return () => {
      const focused = document.activeElement;
      if (!panel || (focused && focused !== document.body && !panel.contains(focused))) return;
      if (trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      // Keep Tab inside the sheet while it is open.
      // 面板打开时让 Tab 停留在面板内部。
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input:not([disabled])')).filter((element) => element.tabIndex >= 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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

  return createPortal(
    <div
      ref={rootRef}
      className="wx-fade fixed inset-x-0 top-0 z-[60] flex h-full touch-none flex-col justify-end bg-black/40"
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        // Only a tap that both starts and ends on the backdrop dismisses.
        // 只有在遮罩上按下并松开的点按才会关闭。
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
        pressStartedOnBackdrop.current = false;
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="wx-slide-up mx-auto flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-t-xl bg-wx-canvas outline-none"
      >
        <div className="relative flex min-h-12 shrink-0 items-center border-b-[0.5px] border-wx-line bg-white px-1">
          <button type="button" onClick={onClose} className="min-h-11 rounded-[4px] px-3 text-[16px] text-wx-ink active:bg-wx-pressed">
            {tr('取消', 'Cancel')}
          </button>
          <h2 id={titleId} className="pointer-events-none absolute inset-x-20 truncate text-center text-[17px] font-medium text-wx-ink">
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain">{children}</div>
        <div className="shrink-0 bg-white px-4 pt-3" style={{ paddingBottom: `calc(12px + ${OVERLAY_BOTTOM_INSET})` }}>
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Reasons a moderator can pick in one tap; the text stays editable. */
/** 管理员一键可选的原因；文字仍可编辑。 */
const MODERATION_PRESETS: MomentReportReason[] = ['spam', 'harassment', 'inappropriate', 'privacy'];

export interface ModerationSheetProps {
  postId: string;
  /** Set to remove one comment instead of the post. */
  /** 移除某条评论而不是动态本身时设置。 */
  commentId?: string | null;
  onClose: () => void;
}

/**
 * 删除（管理员）: the reason, which the author is told, then the removal through the feed store. Presets fill the
 * reason in one tap; the sheet stays open when the server refuses, so the moderator can try again.
 * 「删除（管理员）」：填写会告知作者的原因，然后经由动态 store 移除。预设原因一键填入；服务器拒绝时面板保持打开，管理员可以再试一次。
 */
export function ModerationSheet({ postId, commentId = null, onClose }: ModerationSheetProps) {
  const tr = useTr();
  const noteId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = reason.trim();
  const length = momentTextLength(trimmed);

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await useFeedStore.getState().removeAsModerator({ postId, commentId }, trimmed);
    } catch (err) {
      toast(errorMessage(err));
    }
    setBusy(false);
    // The store toasts a refusal and announces 已删除 on success.
    // store 会提示被拒绝的原因，成功时播报「已删除」。
    if (ok) onClose();
  }

  return (
    <MomentSheet
      title={tr('删除（管理员）', 'Remove as admin')}
      onClose={onClose}
      footer={
        <button
          type="button"
          disabled={!trimmed || busy}
          onClick={() => void submit()}
          className="flex min-h-11 w-full items-center justify-center rounded-lg bg-wx-red text-[16px] font-medium text-white active:opacity-90 disabled:bg-stone-300"
        >
          {busy ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
          {tr('删除', 'Remove')}
        </button>
      }
    >
      <p className="px-4 pb-2 pt-3 text-[13px] leading-5 text-wx-meta">
        {commentId
          ? tr('该评论会对所有人隐藏，作者会收到通知和下面的原因。', 'The comment will be hidden from everyone. Its author is told, with the reason below.')
          : tr('这条动态会对所有人隐藏，作者会收到通知和下面的原因。', 'The update will be hidden from everyone. Its author is told, with the reason below.')}
      </p>
      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {MODERATION_PRESETS.map((preset) => {
          const label = momentReportReasonLabel(preset);
          const chosen = trimmed === label;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={chosen}
              onClick={() => setReason(label)}
              className={`min-h-9 rounded-full px-3.5 text-[14px] ${chosen ? 'bg-wx-ink text-white' : 'bg-white text-wx-ink active:bg-wx-pressed'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="bg-white px-4 py-3">
        <label htmlFor={noteId} className="sr-only">
          {tr('移除原因', 'Reason for removal')}
        </label>
        <textarea
          id={noteId}
          value={reason}
          rows={3}
          placeholder={tr('移除原因', 'Reason for removal')}
          onChange={(event) => setReason(limitCodePoints(event.target.value, MOMENT_MODERATION_REASON_MAX))}
          className="block w-full resize-none bg-transparent text-[16px] leading-6 text-wx-ink outline-none placeholder:text-wx-meta"
        />
        <p className="mt-1 text-right text-[12px] leading-4 text-wx-meta" aria-hidden>
          {length}/{MOMENT_MODERATION_REASON_MAX}
        </p>
      </div>
    </MomentSheet>
  );
}
