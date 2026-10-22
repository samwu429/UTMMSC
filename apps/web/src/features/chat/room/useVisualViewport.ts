import { useLayoutEffect, type RefObject } from 'react';
import { KEYBOARD_VAR, measureKeyboardHeight } from '../composer/keyboardHeight';

function isTextField(target: EventTarget | null): boolean {
  return target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || (target instanceof HTMLElement && target.isContentEditable);
}

interface ViewportPin {
  schedule: () => void;
  release: () => void;
}

/**
 * Keeps a fixed element on the visible part of the screen, following the visual viewport as the keyboard
 * comes and goes, until release() runs. Without visualViewport the element falls back to 100dvh.
 * 让固定定位的元素保持在屏幕的可见区域内，键盘弹出或收起时跟随可见视口，直到调用 release()。不支持 visualViewport 时退回 100dvh。
 */
function pinToVisualViewport(root: HTMLElement): ViewportPin {
  root.style.position = 'fixed';
  root.style.left = '0';
  root.style.right = '0';
  const viewport = window.visualViewport ?? null;
  let frame = 0;

  const apply = () => {
    frame = 0;
    // While pinch-zoomed the visible area is only part of the page, so the root keeps the full layout height.
    // 双指缩放时可见区域只是页面的一部分，因此根元素保持完整的布局高度。
    if (!viewport || Math.abs(viewport.scale - 1) > 0.01) {
      root.style.top = '0px';
      // Browsers without dvh ignore the second value and keep 100%.
      // 不支持 dvh 的浏览器会忽略第二个值，保留 100%。
      root.style.height = '100%';
      root.style.height = '100dvh';
      root.style.setProperty(KEYBOARD_VAR, '0px');
      return;
    }
    // iOS pans the visual viewport inside the layout viewport while the keyboard is up; follow it.
    // 键盘弹出时 iOS 会在布局视口内平移可见视口；根元素随之移动。
    root.style.top = `${Math.max(0, viewport.offsetTop)}px`;
    root.style.height = `${viewport.height}px`;
    root.style.setProperty(KEYBOARD_VAR, `${measureKeyboardHeight() ?? 0}px`);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  apply();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  return {
    schedule,
    release: () => {
      if (frame) cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      root.style.removeProperty(KEYBOARD_VAR);
    },
  };
}

/**
 * Pins the root to the visible part of the screen, so the header stays put and the composer sits right
 * above the keyboard on iOS Safari, the iOS home-screen app and Android Chrome. Without visualViewport the
 * root falls back to 100dvh. The page itself is locked while mounted, so it never scrolls or bounces.
 * 把根元素固定在屏幕的可见区域内：在 iOS Safari、iOS 主屏幕应用和 Android Chrome 上，标题栏保持不动，输入栏紧贴键盘上方。
 * 不支持 visualViewport 时退回 100dvh。挂载期间锁定页面本身，页面不会滚动或回弹。
 */
export function useVisualViewport(rootRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const body = document.body;
    const html = document.documentElement;
    const saved = {
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      htmlOverscroll: html.style.overscrollBehavior,
    };
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.overscrollBehavior = 'none';

    const pin = pinToVisualViewport(root);
    const onFocusIn = (event: FocusEvent) => {
      if (!isTextField(event.target)) return;
      // iOS scrolls the page to reveal a focused field even though the root is fixed; undo that.
      // 即使根元素是固定定位，iOS 仍会滚动页面来露出获得焦点的输入框；在此撤销。
      window.scrollTo(0, 0);
      pin.schedule();
    };

    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      pin.release();
      body.style.overflow = saved.bodyOverflow;
      body.style.overscrollBehavior = saved.bodyOverscroll;
      html.style.overscrollBehavior = saved.htmlOverscroll;
    };
  }, [rootRef]);
}

/**
 * Bottom padding for the scrolling list of an overlay pinned by useVisualViewportOverlay: the home indicator
 * area, which needs no room while the keyboard covers it.
 * 由 useVisualViewportOverlay 固定的浮层中滚动列表的底部留白：即主屏幕指示条区域，键盘盖住它时无需留出空间。
 */
export const OVERLAY_BOTTOM_INSET = `max(0px, calc(var(--safe-bottom) - var(${KEYBOARD_VAR}, 0px)))`;

/**
 * Fits a full-screen overlay to the visible part of the screen, so its bottom rows can be scrolled into view
 * above the keyboard. Unlike useVisualViewport it leaves page scrolling to the screen underneath, which
 * either locks the page already (the room) or keeps its own scroll position (chat info).
 * 让全屏浮层贴合屏幕的可见区域，底部的行都能滚动到键盘上方。与 useVisualViewport 不同，页面滚动交给下层界面处理：
 * 下层界面要么已经锁定页面（聊天室），要么保留自己的滚动位置（聊天信息页）。
 */
export function useVisualViewportOverlay(rootRef: RefObject<HTMLElement>): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    return pinToVisualViewport(root).release;
  }, [rootRef]);
}
