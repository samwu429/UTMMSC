/** The homepage route that serves the Android installer. */
/** 官网上提供安卓安装包的地址。 */
export const ANDROID_APP_URL = 'https://utmmsc.com/download/android';

export function isAndroidUserAgent(userAgent: string): boolean {
  return /\bAndroid\b/i.test(userAgent);
}

/**
 * iPhone, iPad and iPod, where the page scroll bounces natively at the top. iPadOS asks for desktop sites and
 * then reports a Mac, so a Mac user agent with a touch screen counts too; a Mac without touch does not.
 * iPhone、iPad 和 iPod，页面滚动到顶部时会有系统自带的回弹。iPadOS 默认请求桌面网站并报告为 Mac，因此带触摸屏的 Mac 用户代理也算在内；
 * 没有触摸屏的 Mac 不算。
 */
export function isAppleTouchDevice(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Only an Android browser is offered the app. Inside the app the WebView also says Android, so the
 * native check comes first; iPhone and desktop browsers never see the offer.
 * 只有安卓浏览器才提示下载 App。App 内的 WebView 也带 Android 字样，所以先判断是否在 App 内；iPhone 和电脑浏览器永远不提示。
 */
export function offersAndroidApp(userAgent: string, nativeApp: boolean): boolean {
  return !nativeApp && isAndroidUserAgent(userAgent);
}
