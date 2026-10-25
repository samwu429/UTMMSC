import { Component, useEffect, useState, type ReactNode } from 'react';
import { useTr } from '../shared/i18n/locale';
import { WxSpinner } from '../shared/ui/WxSpinner';
import { markUpdateReload, pageSessionStorage } from './pwa';

/** A chunk from the device's cache arrives well within this, so the spinner only shows on a slow network. */
/** 设备缓存里的分块在这段时间内就能到，所以只有网络慢时才会出现加载图标。 */
const SPINNER_DELAY_MS = 400;

/**
 * Shown while a page's chunk loads: empty at first, then a spinner. Navigations keep the old screen up meanwhile
 * (React Router's startTransition), so this appears only when a launch or deep link opens a lazy page.
 * 页面分块加载期间显示：起初是空白，之后出现加载图标。页面切换期间旧界面会保留（React Router 的 startTransition），
 * 所以只有启动或深层链接直接打开按需页面时才会看到它。
 */
export function PageFallback({ fullScreen = false }: { fullScreen?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShow(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    // No background of its own: the page's colour is not known yet, so the app's canvas shows through.
    // 不画自己的背景：页面的颜色此时还不知道，所以透出应用的底色。
    <div className={`flex justify-center ${fullScreen ? 'min-h-full items-center' : 'py-16'}`}>
      {show ? <WxSpinner /> : null}
    </div>
  );
}

function PageFailed({ fullScreen }: { fullScreen: boolean }) {
  const tr = useTr();
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-4 px-6 text-center ${fullScreen ? 'min-h-full bg-wx-canvas' : 'py-16'}`}
      style={fullScreen ? { paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)' } : undefined}
    >
      <p className="text-[15px] text-stone-600">{tr('页面没能打开，请检查网络后重试', "This page couldn't open. Check your connection and try again.")}</p>
      <button
        type="button"
        className="min-h-[44px] rounded-full bg-brand-800 px-6 text-[15px] font-medium text-white"
        onClick={() => {
          markUpdateReload(pageSessionStorage());
          window.location.reload();
        }}
      >
        {tr('重新加载', 'Reload')}
      </button>
    </div>
  );
}

interface BoundaryProps {
  /** Changing it (a new path) clears a failure, so the tab bar and back still lead somewhere else. */
  /** 改变它（换了路径）会清除失败状态，因此标签栏和返回仍能去往别处。 */
  resetKey: string;
  fullScreen?: boolean;
  children: ReactNode;
}

/**
 * Catches a page that failed to load or render, so one broken screen leaves the rest of the app usable instead of
 * blanking the whole window.
 * 捕获加载或渲染失败的页面，一个界面出错时应用的其余部分仍可使用，而不是整个窗口变成空白。
 */
export class PageBoundary extends Component<BoundaryProps, { failed: boolean; failedKey: string | null }> {
  state: { failed: boolean; failedKey: string | null } = { failed: false, failedKey: null };

  static getDerivedStateFromError(): { failed: true; failedKey: null } {
    return { failed: true, failedKey: null };
  }

  componentDidCatch(): void {
    // Remember where it failed; the failure then holds only while the path stays the same.
    // 记下出错的位置；只要路径不变，失败状态就一直保持。
    this.setState({ failedKey: this.props.resetKey });
  }

  componentDidUpdate(): void {
    if (this.state.failed && this.state.failedKey !== null && this.state.failedKey !== this.props.resetKey) {
      this.setState({ failed: false, failedKey: null });
    }
  }

  render() {
    const { failed, failedKey } = this.state;
    const stillFailed = failed && (failedKey === null || failedKey === this.props.resetKey);
    return stillFailed ? <PageFailed fullScreen={!!this.props.fullScreen} /> : this.props.children;
  }
}
