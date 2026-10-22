/** The homepage route that serves the Android installer. */
/** 官网上提供安卓安装包的地址。 */
export const ANDROID_APP_URL = 'https://utmmsc.com/download/android';

export function isAndroidUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

/**
 * Only an Android browser is offered the app. Inside the app the WebView also says Android, so the
 * native check comes first; iPhone and desktop browsers never see the offer.
 * 只有安卓浏览器才提示下载 App。App 内的 WebView 也带 Android 字样，所以先判断是否在 App 内；iPhone 和电脑浏览器永远不提示。
 */
export function offersAndroidApp(userAgent: string, nativeApp: boolean): boolean {
  return !nativeApp && isAndroidUserAgent(userAgent);
}
