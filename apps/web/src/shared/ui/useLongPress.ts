import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

export interface LongPressInfo {
  rect: DOMRect;
  clientX: number;
  clientY: number;
  /** What opened it: a held pointer, the context menu (right-click or the system long press) or the keyboard. */
  /** 打开方式：按住指针、上下文菜单（右键或系统长按）或键盘。 */
  source: 'pointer' | 'contextmenu' | 'keyboard';
  /** The finger or button that opened it is still down; pass it to AnchoredLayer as guardRelease. */
  /** 打开它的手指或按键仍未松开；可作为 guardRelease 传给 AnchoredLayer。 */
  held: boolean;
}

export interface LongPressOptions {
  onLongPress: (info: LongPressInfo) => void;
  delayMs?: number;
  moveTolerancePx?: number;
  disabled?: boolean;
}

export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

/** How long a press is held before it counts as a long press. */
/** 按住多久才算长按。 */
export const LONG_PRESS_DELAY_MS = 450;
/** Moving further than this before the delay ends cancels the long press, so the finger can scroll. */
/** 在延时结束前移动超过这个距离会取消长按，手指因此可以滚动。 */
export const LONG_PRESS_TOLERANCE_PX = 10;

/**
 * The short vibration that confirms a long press, where the device allows it. Vibration is optional feedback:
 * browsers refuse it, and Chrome logs an error, before the first tap on the page.
 * 确认长按的短促震动（设备允许时）。震动只是附加反馈：在页面上第一次点按之前，浏览器会拒绝震动，Chrome 还会记录一条错误。
 */
export function vibrateForLongPress(): void {
  try {
    if (typeof navigator === 'undefined') return;
    if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.(10);
  } catch {
    // Some browsers throw instead of returning false.
    // 部分浏览器会直接抛错，而不是返回 false。
  }
}

/** Pressed colour appears only after this, so a flick that starts on a row does not flash it. */
/** 按下颜色在此之后才出现，从某一行开始的快速滑动不会让它闪一下。 */
const PRESSED_FEEDBACK_MS = 100;
/** A second open request this soon after the first is the same gesture reported twice. */
/** 在上一次打开后这么短的时间内再次请求打开，是同一手势被报告了两次。 */
const DUPLICATE_OPEN_MS = 500;
/** The click that follows a long press arrives within this window and must be swallowed. */
/** 长按之后的 click 会在这段时间内到达，必须吞掉。 */
const CLICK_SWALLOW_MS = 350;

let heldPresses = 0;

export interface ReleaseGuard {
  readonly active: boolean;
  dispose: () => void;
}

/**
 * A layer opened by a press that is still down must ignore that press's release, or lifting the finger
 * would dismiss it. The guard stays active until the next pointerup or pointercancel (seen in the capture
 * phase) and clears one tick later. It starts inactive when no long press is being held.
 * 在按住期间打开的浮层必须忽略这次按压的松开，否则抬起手指就会把它关掉。保护在下一次 pointerup 或
 * pointercancel（捕获阶段）之前一直有效，并在之后一个时钟周期解除。当前没有按住的长按时，它一开始就是失效的。
 */
export function armReleaseGuard(): ReleaseGuard {
  let active = heldPresses > 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const detach = () => {
    window.removeEventListener('pointerup', release, true);
    window.removeEventListener('pointercancel', release, true);
  };
  function release() {
    detach();
    timer = setTimeout(() => {
      timer = null;
      active = false;
    }, 0);
  }
  if (active) {
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  }
  return {
    get active() {
      return active;
    },
    dispose() {
      detach();
      if (timer) clearTimeout(timer);
      timer = null;
      active = false;
    },
  };
}

interface PressState {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  element: HTMLElement | null;
  active: boolean;
  long: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  feedbackTimer: ReturnType<typeof setTimeout> | null;
  swallowTimer: ReturnType<typeof setTimeout> | null;
  release: ((event: globalThis.PointerEvent) => void) | null;
}

function center(rect: DOMRect): { clientX: number; clientY: number } {
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

/**
 * WeChat long press: a 450ms hold opens it, moving more than 10px first cancels it, right-click and the
 * system long press open it at once, and the ContextMenu key or Shift+F10 open it from the keyboard.
 * The click that follows a long press is swallowed. `pressed` drives the pressed colour.
 * 微信式长按：按住 450ms 打开，期间移动超过 10px 则取消；右键和系统长按会立即打开；ContextMenu 键或
 * Shift+F10 从键盘打开。长按之后的那次 click 会被吞掉。`pressed` 用于显示按下颜色。
 */
export function useLongPress(options: LongPressOptions): { handlers: LongPressHandlers; pressed: boolean } {
  const [pressed, setPressed] = useState(false);
  const optionsRef = useRef(options);
  const lastOpenAt = useRef(0);
  const press = useRef<PressState>({
    pointerId: -1,
    pointerType: '',
    x: 0,
    y: 0,
    element: null,
    active: false,
    long: false,
    timer: null,
    feedbackTimer: null,
    swallowTimer: null,
    release: null,
  });

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const api = useMemo(() => {
    const state = press.current;

    function clearTimers() {
      if (state.timer) clearTimeout(state.timer);
      if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
      state.timer = null;
      state.feedbackTimer = null;
    }

    function endPress() {
      clearTimers();
      if (state.release) {
        window.removeEventListener('pointerup', state.release, true);
        window.removeEventListener('pointercancel', state.release, true);
        state.release = null;
      }
      if (state.active) heldPresses = Math.max(0, heldPresses - 1);
      state.active = false;
      setPressed(false);
    }

    function open(info: LongPressInfo) {
      lastOpenAt.current = Date.now();
      vibrateForLongPress();
      optionsRef.current.onLongPress(info);
    }

    function recentlyOpened() {
      return Date.now() - lastOpenAt.current < DUPLICATE_OPEN_MS;
    }

    const handlers: LongPressHandlers = {
      onPointerDown(event) {
        if (optionsRef.current.disabled) return;
        if (!event.isPrimary) {
          // A second finger means a pinch or a scroll, not a long press.
          // 第二根手指意味着缩放或滚动，而不是长按。
          endPress();
          return;
        }
        endPress();
        if (state.swallowTimer) clearTimeout(state.swallowTimer);
        state.swallowTimer = null;
        state.long = false;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        const element = event.currentTarget;
        state.active = true;
        heldPresses += 1;
        state.pointerId = event.pointerId;
        state.pointerType = event.pointerType;
        state.x = event.clientX;
        state.y = event.clientY;
        state.element = element;
        const release = (up: globalThis.PointerEvent) => {
          if (up.pointerId !== state.pointerId) return;
          const wasLong = state.long;
          endPress();
          if (!wasLong) return;
          if (state.swallowTimer) clearTimeout(state.swallowTimer);
          state.swallowTimer = setTimeout(() => {
            state.swallowTimer = null;
            state.long = false;
          }, CLICK_SWALLOW_MS);
        };
        state.release = release;
        window.addEventListener('pointerup', release, true);
        window.addEventListener('pointercancel', release, true);
        state.feedbackTimer = setTimeout(() => {
          state.feedbackTimer = null;
          setPressed(true);
        }, PRESSED_FEEDBACK_MS);
        state.timer = setTimeout(() => {
          state.timer = null;
          state.long = true;
          setPressed(true);
          open({ rect: element.getBoundingClientRect(), clientX: state.x, clientY: state.y, source: 'pointer', held: true });
        }, optionsRef.current.delayMs ?? LONG_PRESS_DELAY_MS);
      },
      onPointerMove(event) {
        if (!state.active || event.pointerId !== state.pointerId || state.timer === null) return;
        const tolerance = optionsRef.current.moveTolerancePx ?? LONG_PRESS_TOLERANCE_PX;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        if (dx * dx + dy * dy > tolerance * tolerance) endPress();
      },
      onPointerLeave(event) {
        if (event.pointerType === 'mouse' && event.pointerId === state.pointerId && state.timer !== null) endPress();
      },
      onContextMenu(event) {
        if (optionsRef.current.disabled) return;
        event.preventDefault();
        if (state.long || recentlyOpened()) return;
        const element = event.currentTarget;
        const rect = element.getBoundingClientRect();
        const held = state.active || event.buttons !== 0;
        if (state.active) {
          // The system long press arrived before the timer; this press counts as the long press.
          // 系统长按先于计时器触发；这次按压就算作长按。
          clearTimers();
          state.long = true;
          setPressed(true);
        }
        const point = event.clientX === 0 && event.clientY === 0 ? center(rect) : { clientX: event.clientX, clientY: event.clientY };
        open({ rect, ...point, source: 'contextmenu', held });
      },
      onKeyDown(event) {
        if (optionsRef.current.disabled) return;
        if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
        event.preventDefault();
        if (recentlyOpened()) return;
        const rect = event.currentTarget.getBoundingClientRect();
        open({ rect, ...center(rect), source: 'keyboard', held: false });
      },
      onClickCapture(event) {
        if (!state.long) return;
        event.preventDefault();
        event.stopPropagation();
        state.long = false;
        if (state.swallowTimer) clearTimeout(state.swallowTimer);
        state.swallowTimer = null;
      },
    };

    function dispose() {
      endPress();
      if (state.swallowTimer) clearTimeout(state.swallowTimer);
      state.swallowTimer = null;
    }

    return { handlers, dispose };
  }, []);

  useEffect(() => api.dispose, [api]);

  return { handlers: api.handlers, pressed };
}
