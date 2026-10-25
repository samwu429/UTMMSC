const ROOT_ID = 'wx-snackbar-root';
/** Newly created live regions are often skipped by screen readers, so the first message waits a moment. */
/** 新建的播报区域常被读屏软件忽略，所以第一条消息稍等片刻再写入。 */
const FIRST_SHOW_DELAY_MS = 50;

/**
 * CSS variable a bottom bar sets to its full height (safe-area padding included) while it is on screen, so the
 * snackbar sits above it instead of covering its buttons. See features/admin/ui/StickyActionBar.tsx.
 * 底部操作栏在屏幕上时把自身的完整高度（含安全区留白）写入这个 CSS 变量，提示条因此显示在它上方，而不会盖住它的按钮。
 * 参见 features/admin/ui/StickyActionBar.tsx。
 */
export const SNACKBAR_LIFT_VAR = '--snackbar-lift';

export interface SnackbarAction {
  label: string;
  onAction: () => void;
}

export interface SnackbarOptions {
  text: string;
  /** One action, usually 撤销 / Undo. Choosing it closes the snackbar first. */
  /** 一个操作，通常是「撤销」。选择后先关闭提示条再执行。 */
  action?: SnackbarAction;
  ms?: number;
}

interface Shown {
  id: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Time left before it hides; it stops counting while a pointer or focus is on it. */
  /** 距离隐藏的剩余时间；指针或焦点停在上面时暂停计时。 */
  remaining: number;
  startedAt: number;
}

let root: HTMLDivElement | null = null;
let shown: Shown | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

function ensureRoot(): { element: HTMLDivElement; created: boolean } {
  if (root && root.isConnected) return { element: root, created: false };
  const element = document.createElement('div');
  element.id = ROOT_ID;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  element.className = 'pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-3';
  // The lift is the whole height of the bar, its safe-area padding included, so the larger of the two wins.
  // 抬升高度是整个操作栏的高度，已包含其安全区留白，因此取两者中较大的值。
  element.style.bottom = `calc(max(var(--safe-bottom), var(${SNACKBAR_LIFT_VAR}, 0px)) + 12px)`;
  document.body.appendChild(element);
  root = element;
  return { element, created: true };
}

function hide(id: number): void {
  if (showTimer && seq === id) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (!shown || shown.id !== id) return;
  if (shown.timer) clearTimeout(shown.timer);
  shown = null;
  root?.replaceChildren();
}

function startTimer(entry: Shown): void {
  entry.startedAt = Date.now();
  entry.timer = setTimeout(() => hide(entry.id), entry.remaining);
}

function pause(entry: Shown): void {
  if (!entry.timer) return;
  clearTimeout(entry.timer);
  entry.timer = null;
  entry.remaining = Math.max(1000, entry.remaining - (Date.now() - entry.startedAt));
}

function render(element: HTMLDivElement, id: number, text: string, action: SnackbarAction | undefined): void {
  const bar = document.createElement('div');
  bar.className =
    'wx-slide-up pointer-events-auto flex w-full max-w-[560px] items-center gap-3 rounded-lg bg-wx-popover px-4 py-2.5 text-[15px] leading-snug text-white shadow-lg';
  const label = document.createElement('span');
  label.className = 'min-w-0 flex-1 break-words py-1';
  label.textContent = text;
  bar.appendChild(label);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = '-my-1 min-h-11 shrink-0 rounded-md px-2 text-[15px] font-medium text-gold active:bg-white/10';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      hide(id);
      action.onAction();
    });
    bar.appendChild(button);
  }
  // Reading or reaching for the action stops the clock, so the undo never vanishes under a finger.
  // 阅读或伸手去点操作时暂停计时，「撤销」不会在手指下消失。
  const stop = () => {
    if (shown?.id === id) pause(shown);
  };
  const resume = () => {
    if (shown?.id === id && !shown.timer && !bar.matches(':hover') && !bar.contains(document.activeElement)) startTimer(shown);
  };
  bar.addEventListener('pointerenter', stop);
  bar.addEventListener('focusin', stop);
  bar.addEventListener('pointerleave', resume);
  bar.addEventListener('focusout', () => setTimeout(resume, 0));
  element.replaceChildren(bar);
}

/**
 * Bottom message with an optional action, the Material snackbar: for a change other people notice and that can be
 * undone, such as a role change. One at a time; a new one replaces the one on screen. Shown above the safe area and
 * any sticky bottom bar, in a polite live region. Returns a function that closes it. For plain feedback use `toast`.
 * 屏幕底部的提示，可带一个操作，即 Material 的 snackbar：用于别人会注意到且可以撤销的改动，例如修改身份。一次只显示一条，新的会替换屏幕上
 * 已有的一条。显示在安全区和吸底操作栏上方，位于礼貌播报区域中。返回关闭它的函数。单纯的反馈请用 `toast`。
 */
export function snackbar({ text, action, ms = 5000 }: SnackbarOptions): () => void {
  if (typeof document === 'undefined' || !text) return () => undefined;
  const { element, created } = ensureRoot();
  if (shown) hide(shown.id);
  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  const id = ++seq;
  const show = () => {
    showTimer = null;
    render(element, id, text, action);
    shown = { id, timer: null, remaining: ms, startedAt: Date.now() };
    startTimer(shown);
  };
  if (created) showTimer = setTimeout(show, FIRST_SHOW_DELAY_MS);
  else show();
  return () => hide(id);
}

/** Closes the snackbar on screen, if any, for example when the screen it belongs to goes away. */
/** 关闭屏幕上的提示条（如果有），例如它所属的界面关闭时。 */
export function dismissSnackbar(): void {
  if (shown) hide(shown.id);
  else if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
}
