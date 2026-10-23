import { Capacitor } from '@capacitor/core';
import { ANDROID_APP_URL } from './platform';

/** Published next to the installer on the homepage; the app compares its own build with it. */
/** 与安装包一起发布在官网上；App 用它和自己的版本号比较。 */
export const ANDROID_RELEASE_URL = `${ANDROID_APP_URL}.json`;

export interface AndroidRelease {
  versionCode: number;
  versionName: string;
}

export interface AppUpdate {
  currentName: string;
  latest: AndroidRelease;
}

export function parseRelease(raw: unknown): AndroidRelease | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { versionCode, versionName } = raw as Record<string, unknown>;
  if (typeof versionCode !== 'number' || !Number.isInteger(versionCode) || versionCode < 1) return null;
  if (typeof versionName !== 'string' || versionName.length === 0 || versionName.length > 32) return null;
  return { versionCode, versionName };
}

/** The app's build is its versionCode as a string; anything unreadable is never treated as outdated. */
/** App 的 build 是字符串形式的 versionCode；无法识别时一律不视为过旧。 */
export function isOutdated(currentBuild: string, latest: AndroidRelease): boolean {
  const current = Number(currentBuild);
  return Number.isInteger(current) && current > 0 && current < latest.versionCode;
}

let updatePromise: Promise<AppUpdate | null> | null = null;

/**
 * Checks once per launch whether a newer Android build is published. Null in browsers, when the app is
 * current, or when anything fails, so a check can never get in the way.
 * 每次启动检查一次官网是否有更新的安卓版本。在浏览器中、App 已是最新或任何一步失败时返回 null，检查不会妨碍使用。
 */
export function checkAppUpdate(): Promise<AppUpdate | null> {
  updatePromise ??= (async () => {
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return null;
    try {
      const { App } = await import('@capacitor/app');
      const [info, response] = await Promise.all([App.getInfo(), fetch(ANDROID_RELEASE_URL, { cache: 'no-store' })]);
      if (!response.ok) return null;
      const latest = parseRelease(await response.json());
      if (!latest || !isOutdated(info.build, latest)) return null;
      return { currentName: info.version, latest };
    } catch {
      return null;
    }
  })();
  return updatePromise;
}
