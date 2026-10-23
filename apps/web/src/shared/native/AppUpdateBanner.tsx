import { useEffect, useState } from 'react';
import { useTr } from '../i18n/locale';
import { PUSH_BUILD, checkAppUpdate, type AppUpdate } from './appUpdate';
import { ANDROID_APP_URL } from './platform';

const DISMISSED_KEY = 'utmmsc.app-update-dismissed';

function dismissedCode(): number {
  try {
    return Number(globalThis.localStorage?.getItem(DISMISSED_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function rememberDismissed(code: number): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, String(code));
  } catch {
    // Storage is blocked, so the banner stays hidden for this launch only.
    // 存储被禁用，横幅只在这次启动中隐藏。
  }
}

/** The newer build on offer, or null in browsers and in a current app. */
/** 可供更新的新版本；在浏览器中或 App 已是最新时为 null。 */
export function useAppUpdate(): AppUpdate | null {
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  useEffect(() => {
    let active = true;
    void checkAppUpdate().then((found) => {
      if (active) setUpdate(found);
    });
    return () => {
      active = false;
    };
  }, []);
  return update;
}

/**
 * Shown in the app when a newer build is published. Closing it hides it until the next release. Inside the
 * app the download link is handed to the system browser, which downloads and installs the APK.
 * 有新版本发布时在 App 内显示。关闭后直到下一个版本发布前不再显示。在 App 内，下载链接会交给系统浏览器下载并安装。
 */
export function AppUpdateBanner() {
  const tr = useTr();
  const update = useAppUpdate();
  const [hiddenCode, setHiddenCode] = useState(dismissedCode);
  if (!update || hiddenCode >= update.latest.versionCode) return null;
  const { versionCode, versionName } = update.latest;
  // Only builds before 1.1.0 lack notifications; later ones are simply told there is something newer.
  // 只有 1.1.0 之前的版本没有通知功能；之后的版本只提示有更新的版本。
  const text =
    update.currentCode < PUSH_BUILD
      ? tr(`有新版本 ${versionName}，更新后可接收通知等新功能`, `Version ${versionName} is out, with notifications and more`)
      : tr(`有新版本 ${versionName}，建议更新`, `Version ${versionName} is out`);

  function dismiss() {
    rememberDismissed(versionCode);
    setHiddenCode(versionCode);
  }

  return (
    <section className="-mx-4 mb-4 flex items-center gap-2 bg-white py-1.5 pl-4 pr-1">
      <span className="h-8 w-[3px] shrink-0 bg-gold" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug text-brand-800">{text}</p>
      <a href={ANDROID_APP_URL} className="shrink-0 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-900">
        {tr('更新', 'Update')}
      </a>
      <button type="button" onClick={dismiss} aria-label={tr('暂不更新', 'Not now')} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400 active:text-stone-600">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </section>
  );
}
