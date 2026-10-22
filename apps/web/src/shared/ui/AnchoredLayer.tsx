import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { armReleaseGuard, type ReleaseGuard } from './useLongPress';

export type AnchorRect = Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left'>;

interface Props {
  /** Viewport rect to point at; a zero-size rect points at a press position. */
  /** 要指向的视口矩形；零尺寸矩形表示指向按压位置。 */
  anchor: AnchorRect;
  prefer?: 'above' | 'below';
  tone?: 'dark' | 'light';
  onClose: () => void;
  /**
   * The member scrolling this element closes the layer, as WeChat does when the list moves. Scrolls the
   * element makes on its own, with no touch, wheel, key or press behind them, leave the layer open.
   * 成员滚动此元素时关闭浮层，与微信列表滚动时一致。元素自身发起、背后没有触摸、滚轮、按键或按压的滚动不会关闭浮层。
   */
  scrollContainer?: HTMLElement | null;
  /** Set when a press that is still down opened the layer, so its release does not dismiss it. */
  /** 由仍未松开的按压打开时设置，这样松开手指不会把它关掉。 */
  guardRelease?: boolean;
  /** Space at the top that the layer must not cover, such as a sticky header. */
  /** 顶部不可遮挡的高度，例如吸顶标题栏。 */
  insetTop?: number;
  className?: string;
  children: ReactNode;
}

/** Room the preferred side needs before the layer flips to the other side. */
/** 首选一侧至少需要这么多空间，否则浮层翻到另一侧。 */
const MIN_ROOM_PX = 56;
const EDGE_PX = 8;
const ARROW_HEIGHT = 8;
const ARROW_HALF_WIDTH = 8;
const PANEL_RADIUS = 8;
/** A scroll this soon after the member's input counts as the member's own. */
/** 成员输入后这么短时间内发生的滚动算作成员自己的滚动。 */
const USER_SCROLL_MS = 500;

interface Placement {
  top: number;
  left: number;
  side: 'above' | 'below';
  arrowX: number;
  showArrow: boolean;
}

interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function safeAreaInsets(): Box {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
  probe.remove();
  return insets;
}

/** The visible part of the layout viewport, which shrinks and shifts while the iOS keyboard is open. */
/** 布局视口中可见的部分；iOS 键盘弹出时它会缩小并偏移。 */
function visibleViewport(): Box {
  const vv = window.visualViewport;
  if (vv) return { top: vv.offsetTop, left: vv.offsetLeft, right: vv.offsetLeft + vv.width, bottom: vv.offsetTop + vv.height };
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
}

function place(anchor: AnchorRect, width: number, height: number, prefer: 'above' | 'below', insetTop: number): Placement {
  const view = visibleViewport();
  const safe = safeAreaInsets();
  const bounds: Box = {
    top: view.top + Math.max(safe.top, insetTop) + EDGE_PX,
    right: view.right - safe.right - EDGE_PX,
    bottom: view.bottom - safe.bottom - EDGE_PX,
    left: view.left + safe.left + EDGE_PX,
  };
  const need = Math.max(MIN_ROOM_PX, height + ARROW_HEIGHT);
  const roomAbove = anchor.top - bounds.top;
  const roomBelow = bounds.bottom - anchor.bottom;
  const preferredRoom = prefer === 'above' ? roomAbove : roomBelow;
  const otherRoom = prefer === 'above' ? roomBelow : roomAbove;
  let side = prefer;
  if (preferredRoom < need && (otherRoom >= need || otherRoom > preferredRoom)) side = prefer === 'above' ? 'below' : 'above';

  const idealTop = side === 'above' ? anchor.top - ARROW_HEIGHT - height : anchor.bottom + ARROW_HEIGHT;
  const top = clamp(idealTop, bounds.top, bounds.bottom - height);
  const anchorX = (anchor.left + anchor.right) / 2;
  const left = clamp(anchorX - width / 2, bounds.left, bounds.right - width);
  const arrowX = clamp(anchorX - left, PANEL_RADIUS + ARROW_HALF_WIDTH, width - PANEL_RADIUS - ARROW_HALF_WIDTH);
  // When clamping pushed the layer onto the anchor, an arrow would point at nothing.
  // 夹紧后浮层压到了锚点上时，箭头没有可指的对象。
  const showArrow = Math.abs(top - idealTop) < 1 && anchorX >= left && anchorX <= left + width;
  return { top, left, side, arrowX, showArrow };
}

/**
 * Floating layer that points at an anchor: WeChat's dark message menu or a light row menu. It flips when
 * the preferred side is too tight, stays inside the safe areas, closes on an outside press, Escape, the
 * member scrolling the list or a viewport resize, and returns focus to the trigger when focus was inside it.
 * 指向锚点的浮层：微信的深色消息菜单或浅色行菜单。首选一侧空间不足时翻转，始终留在安全区内；点击外部、
 * 按 Escape、成员滚动列表或视口尺寸变化时关闭；若焦点在浮层内，关闭后把焦点还给触发它的元素。
 */
export function AnchoredLayer({ anchor, prefer = 'above', tone = 'dark', onClose, scrollContainer, guardRelease = false, insetTop = 0, className = '', children }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const guardRef = useRef<ReleaseGuard | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [trigger] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));
  const { top: anchorTop, right: anchorRight, bottom: anchorBottom, left: anchorLeft } = anchor;

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const rect = { top: anchorTop, right: anchorRight, bottom: anchorBottom, left: anchorLeft };
    // offsetWidth and offsetHeight ignore the opening scale animation.
    // offsetWidth 与 offsetHeight 不受打开时缩放动画的影响。
    const measure = () => {
      const next = place(rect, layer.offsetWidth, layer.offsetHeight, prefer, insetTop);
      setPlacement((prev) =>
        prev && prev.top === next.top && prev.left === next.left && prev.side === next.side && prev.arrowX === next.arrowX && prev.showArrow === next.showArrow ? prev : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [anchorTop, anchorRight, anchorBottom, anchorLeft, prefer, insetTop]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    return () => {
      const focused = document.activeElement;
      if (!layer || !focused || !layer.contains(focused)) return;
      if (trigger instanceof HTMLElement && trigger !== document.body && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  useLayoutEffect(() => {
    if (!guardRelease) return;
    const guard = armReleaseGuard();
    guardRef.current = guard;
    return () => {
      guard.dispose();
      guardRef.current = null;
    };
  }, [guardRelease]);

  useEffect(() => {
    const close = () => closeRef.current();
    const onPointerDown = (event: PointerEvent) => {
      const layer = layerRef.current;
      if (layer && event.target instanceof Node && layer.contains(event.target)) return;
      if (guardRef.current?.active) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    // A list that keeps its reading position as rows arrive scrolls itself; only the member's scrolling closes.
    // 列表在新行到达时为保持阅读位置会自行滚动；只有成员自己的滚动才会关闭浮层。
    let inputAt = Number.NEGATIVE_INFINITY;
    const onInput = () => {
      inputAt = performance.now();
    };
    const onScroll = () => {
      if (performance.now() - inputAt < USER_SCROLL_MS) close();
    };
    const inputEvents = ['wheel', 'touchmove', 'keydown', 'pointerdown'] as const;
    const viewport = window.visualViewport;
    const resizeTarget: EventTarget = viewport ?? window;
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    resizeTarget.addEventListener('resize', close);
    for (const type of inputEvents) scrollContainer?.addEventListener(type, onInput, { passive: true });
    scrollContainer?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      resizeTarget.removeEventListener('resize', close);
      for (const type of inputEvents) scrollContainer?.removeEventListener(type, onInput);
      scrollContainer?.removeEventListener('scroll', onScroll);
    };
  }, [scrollContainer]);

  const dark = tone === 'dark';
  const panelTone = dark ? 'bg-wx-popover text-white' : 'bg-white text-wx-ink';
  const arrowTone = dark ? 'fill-wx-popover' : 'fill-white';
  const shadow = dark ? 'drop-shadow-[0_2px_6px_rgba(0,0,0,0.18)]' : 'drop-shadow-[0_2px_10px_rgba(0,0,0,0.16)]';
  const side = placement?.side ?? prefer;

  return createPortal(
    <div
      ref={layerRef}
      className={`wx-pop fixed z-[60] max-w-[calc(100vw-16px)] ${shadow}`}
      style={{
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? 'visible' : 'hidden',
        transformOrigin: placement ? `${placement.arrowX}px ${side === 'above' ? '100%' : '0%'}` : undefined,
      }}
    >
      <div className={`rounded-lg ${panelTone} ${className}`}>{children}</div>
      {placement?.showArrow ? (
        <svg
          width={ARROW_HALF_WIDTH * 2}
          height={ARROW_HEIGHT}
          viewBox="0 0 16 8"
          className={`absolute ${arrowTone}`}
          style={{ left: placement.arrowX - ARROW_HALF_WIDTH, ...(side === 'above' ? { top: '100%' } : { bottom: '100%', transform: 'rotate(180deg)' }) }}
          aria-hidden
        >
          <path d="M0 0h16L9.2 7.1a1.7 1.7 0 0 1-2.4 0Z" />
        </svg>
      ) : null}
    </div>,
    document.body,
  );
}
