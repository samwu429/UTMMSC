const ROOT_ID = 'wx-toast-root';
/** Newly created live regions are often skipped by screen readers, so the first message waits a moment. */
/** 新建的播报区域常被读屏软件忽略，所以第一条消息稍等片刻再写入。 */
const FIRST_SHOW_DELAY_MS = 50;

let root: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;

function ensureRoot(): { element: HTMLDivElement; created: boolean } {
  if (root && root.isConnected) return { element: root, created: false };
  const element = document.createElement('div');
  element.id = ROOT_ID;
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-atomic', 'true');
  element.className = 'pointer-events-none fixed inset-0 z-[80] flex items-center justify-center px-8 pb-[var(--safe-bottom)] pt-[var(--safe-top)]';
  document.body.appendChild(element);
  root = element;
  return { element, created: true };
}

function render(element: HTMLDivElement, text: string): void {
  const hud = document.createElement('div');
  hud.className = 'wx-fade max-w-[70vw] whitespace-pre-line break-words rounded-lg bg-wx-popover/95 px-4 py-3 text-center text-[15px] leading-snug text-white shadow-lg';
  hud.textContent = text;
  element.replaceChildren(hud);
}

/**
 * Brief centred message, like WeChat's 已复制. Imperative and provider-free: the first call creates its
 * own portal root under body, and a new toast replaces the one on screen.
 * 屏幕中央的短暂提示，类似微信的「已复制」。直接调用、无需 Provider：首次调用会在 body 下创建自己的根节点，
 * 新提示会替换屏幕上已有的提示。
 */
export function toast(text: string, { ms = 1500 }: { ms?: number } = {}): void {
  if (typeof document === 'undefined' || !text) return;
  const { element, created } = ensureRoot();
  if (hideTimer) clearTimeout(hideTimer);
  if (showTimer) clearTimeout(showTimer);
  hideTimer = null;
  showTimer = null;
  const show = () => {
    showTimer = null;
    render(element, text);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      element.replaceChildren();
    }, ms);
  };
  if (created) showTimer = setTimeout(show, FIRST_SHOW_DELAY_MS);
  else show();
}
