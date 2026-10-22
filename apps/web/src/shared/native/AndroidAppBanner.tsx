import { useState } from 'react';
import { useTr } from '../i18n/locale';
import { isNativeApp } from './native';
import { ANDROID_APP_URL, offersAndroidApp } from './platform';

const DISMISSED_KEY = 'utmmsc.android-app-banner';

function readDismissed(): boolean {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, '1');
  } catch {
    // Storage is blocked, so the banner stays hidden for this visit only.
    // 存储被禁用，横幅只在这次访问中隐藏。
  }
}

/** True in an Android phone browser that is not the app. */
/** 在安卓手机浏览器（而不是 App）中为 true。 */
export function useOffersAndroidApp(): boolean {
  const [offers] = useState(() => typeof navigator !== 'undefined' && offersAndroidApp(navigator.userAgent, isNativeApp()));
  return offers;
}

/**
 * Banner on the home page for Android browsers. Closing it hides it for good on this device. Tapping download
 * hides it only until the home page opens again, since the download page may say the installer is not out yet.
 * The entry under 设置 stays either way.
 * 安卓浏览器首页上的横幅。关闭后这台设备上不再显示；点击下载只隐藏到下次打开首页为止，因为下载页可能提示安装包尚未发布。
 * 「设置」里的入口始终保留。
 */
export function AndroidAppBanner() {
  const tr = useTr();
  const offers = useOffersAndroidApp();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!offers || dismissed) return null;

  function dismiss() {
    writeDismissed();
    setDismissed(true);
  }

  return (
    <section className="-mx-4 mt-5 flex items-center gap-2 bg-white py-1.5 pl-4 pr-1">
      <span className="h-8 w-[3px] shrink-0 bg-gold" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug text-brand-800">{tr('安卓手机可以下载 UTMMSC App', 'Get the UTMMSC app for Android')}</p>
      <a href={ANDROID_APP_URL} onClick={() => setDismissed(true)} className="shrink-0 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-900">
        {tr('下载', 'Download')}
      </a>
      <button type="button" onClick={dismiss} aria-label={tr('不再提示', 'Don’t show again')} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400 active:text-stone-600">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </section>
  );
}
