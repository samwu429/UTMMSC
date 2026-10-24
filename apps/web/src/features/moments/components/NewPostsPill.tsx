import { useTr } from '../../../shared/i18n/locale';

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A smooth scroll that has not reached the top by then is finished with a jump. */
/** 到这个时间还没到顶的平滑滚动，直接跳到顶部完成。 */
const SMOOTH_LIMIT_MS = 1200;

/**
 * Scrolls the page to the top, smoothly unless reduced motion is on. Resolves true at the top, or false when
 * the member took over with a touch, the wheel or a key on the way, so a merge waiting on it is skipped and
 * nothing moves under the reader.
 * 把页面滚动到顶部；除非开启了减少动态效果，否则平滑滚动。到达顶部时返回 true；途中成员用触摸、滚轮或按键接手时返回 false，
 * 等待它的合并会被跳过，内容不会在读者眼前移动。
 */
export function scrollPageToTop(): Promise<boolean> {
  if (window.scrollY <= 0 || prefersReducedMotion()) {
    window.scrollTo(0, 0);
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const started = performance.now();
    let frame = 0;
    const takeOver = () => finish(false);
    const finish = (reached: boolean) => {
      cancelAnimationFrame(frame);
      window.removeEventListener('touchstart', takeOver, true);
      window.removeEventListener('wheel', takeOver, true);
      window.removeEventListener('keydown', takeOver, true);
      resolve(reached);
    };
    const check = () => {
      if (window.scrollY <= 1) {
        finish(true);
        return;
      }
      if (performance.now() - started > SMOOTH_LIMIT_MS) {
        window.scrollTo(0, 0);
        finish(true);
        return;
      }
      frame = requestAnimationFrame(check);
    };
    window.addEventListener('touchstart', takeOver, { capture: true, passive: true });
    window.addEventListener('wheel', takeOver, { capture: true, passive: true });
    window.addEventListener('keydown', takeOver, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    frame = requestAnimationFrame(check);
  });
}

function UpArrow() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export interface NewPostsPillProps {
  /** Posts waiting in incoming. */
  /** incoming 中等待的动态数。 */
  count: number;
  /** Only once the cover has scrolled under the header, and never over the composer. */
  /** 只在封面已滚到顶栏下方之后显示，编辑器打开时从不显示。 */
  visible: boolean;
  /** Tapped: the page scrolls to the top, then merges. */
  /** 被轻触：页面滚动到顶部，然后合并。 */
  onActivate(): void;
}

/**
 * 「有 N 条新动态」 under the header. Newer posts found in the background wait behind it instead of being
 * inserted, so content never moves under the reader.
 * 顶栏下方的「有 N 条新动态」。后台发现的更新动态等在它后面，不会直接插入，内容因此不会在读者眼前移动。
 */
export function NewPostsPill({ count, visible, onActivate }: NewPostsPillProps) {
  const tr = useTr();
  if (!visible || count <= 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 z-20 flex justify-center" style={{ top: 'calc(var(--safe-top) + 54px)' }}>
      <button
        type="button"
        onClick={onActivate}
        className="wx-fade pointer-events-auto flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[14px] font-medium text-wx-link shadow-[0_2px_12px_rgba(0,0,0,0.2)] ring-[0.5px] ring-wx-line active:bg-wx-pressed"
      >
        <UpArrow />
        {tr(`有 ${count} 条新动态`, `${count} new ${count === 1 ? 'update' : 'updates'}`)}
      </button>
    </div>
  );
}
