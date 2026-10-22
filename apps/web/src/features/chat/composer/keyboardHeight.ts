/**
 * Remembers the on-screen keyboard height, so the emoji and more panels open at the same height and the
 * composer does not jump when one replaces the other. Nothing touches window or storage at import time.
 * 记住屏幕键盘的高度，使表情面板和更多面板以相同高度打开，互相替换时输入栏不会跳动。导入时不访问 window 或存储。
 */

const STORAGE_KEY = 'utmmsc.chat.keyboardHeight';
/** A smaller gap between the layout and visual viewports is browser chrome, not a keyboard. */
/** 布局视口与可视视口之间的差距小于此值时，是浏览器界面而不是键盘。 */
export const KEYBOARD_MIN_PX = 120;
export const DEFAULT_KEYBOARD_PX = 260;
/** No keyboard covers more than this share of the window. */
/** 键盘不会占据窗口超过这个比例。 */
const KEYBOARD_MAX_SHARE = 0.75;

/**
 * Custom property the room root sets to the keyboard height it currently leaves out. It changes in the same
 * frame as the root's height, so space sized against it stays put while the keyboard comes or goes.
 * 房间根元素设置的自定义属性，值为根元素当前让出的键盘高度。它与根元素的高度在同一帧内变化，按它计算的空间在键盘弹出或收起时保持不动。
 */
export const KEYBOARD_VAR = '--wx-keyboard';

/**
 * CSS height for the space under the input bar that takes over from the keyboard: the part of `height` the
 * keyboard does not cover yet, so the input bar stays where it is while the keyboard opens or closes.
 * 输入栏下方接替键盘的空间的 CSS 高度：`height` 中键盘尚未覆盖的部分，键盘弹出或收起时输入栏因此保持不动。
 */
export function besideKeyboard(height: number): string {
  return `max(0px, calc(${Math.max(0, Math.round(height))}px - var(${KEYBOARD_VAR}, 0px)))`;
}

let remembered: number | null = null;

function validHeight(value: number, windowHeight: number): boolean {
  return Number.isFinite(value) && value > KEYBOARD_MIN_PX && value < windowHeight * KEYBOARD_MAX_SHARE;
}

/** The keyboard height now, or null when no keyboard is showing or the page is pinch-zoomed. */
/** 当前的键盘高度；没有显示键盘或页面被双指缩放时为 null。 */
export function measureKeyboardHeight(): number | null {
  if (typeof window === 'undefined') return null;
  const viewport = window.visualViewport;
  if (!viewport || Math.abs(viewport.scale - 1) > 0.01) return null;
  const gap = Math.round(window.innerHeight - viewport.height);
  return validHeight(gap, window.innerHeight) ? gap : null;
}

/** Measures and stores the keyboard height when one is showing. */
/** 键盘显示时测量并保存其高度。 */
export function rememberKeyboardHeight(): number | null {
  const height = measureKeyboardHeight();
  if (height === null) return null;
  remembered = height;
  try {
    sessionStorage.setItem(STORAGE_KEY, String(height));
  } catch {
    // Kept in memory only.
    // 只保存在内存中。
  }
  return height;
}

/** The last measured keyboard height on this device, or a typical phone keyboard height. */
/** 本设备上次测得的键盘高度；没有时取常见手机键盘高度。 */
export function lastKeyboardHeight(): number {
  if (remembered !== null) return remembered;
  try {
    const stored = Number(sessionStorage.getItem(STORAGE_KEY));
    if (typeof window !== 'undefined' && validHeight(stored, window.innerHeight)) {
      remembered = stored;
      return stored;
    }
  } catch {
    // Storage is blocked; fall back to the default.
    // 存储被禁用；使用默认值。
  }
  return DEFAULT_KEYBOARD_PX;
}

/** True when focusing a text field here is likely to raise an on-screen keyboard. */
/** 在本设备上聚焦文本框很可能弹出屏幕键盘时为 true。 */
export function expectsSoftKeyboard(): boolean {
  if (typeof window === 'undefined') return false;
  if (remembered !== null) return true;
  return window.matchMedia?.('(pointer: coarse)').matches === true;
}

function textFieldFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
}

/**
 * Reports the keyboard height, or null when none is showing, whenever the visual viewport resizes. Heights
 * are stored only while a text field has focus, so the shrinking frames of a closing keyboard are never
 * remembered. Returns the unsubscribe function.
 * 每当可视视口尺寸变化时报告键盘高度，没有键盘时为 null。只有文本框聚焦时才保存高度，键盘收起过程中的高度不会被记住。
 * 返回取消订阅的函数。
 */
export function watchKeyboard(onChange: (height: number | null) => void): () => void {
  if (typeof window === 'undefined' || !window.visualViewport) return () => undefined;
  const viewport = window.visualViewport;
  const update = () => {
    onChange(textFieldFocused() ? rememberKeyboardHeight() : measureKeyboardHeight());
  };
  viewport.addEventListener('resize', update);
  update();
  return () => viewport.removeEventListener('resize', update);
}
