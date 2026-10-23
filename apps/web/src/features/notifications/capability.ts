/**
 * What this device can do about notifications:
 * - native: the Android app, with push working in this build;
 * - native-unavailable: the Android app, but this build cannot receive push;
 * - webpush: a browser or home-screen app with Web Push;
 * - ios-install: iPhone or iPad in a browser tab, which only gets push once added to the home screen;
 * - ios-update: a home-screen app on an iOS older than 16.4;
 * - unsupported: anything else.
 * 这台设备的通知能力：
 * - native：安卓 App，且这个版本能接收推送；
 * - native-unavailable：安卓 App，但这个版本不能接收推送；
 * - webpush：支持 Web Push 的浏览器或主屏幕应用；
 * - ios-install：浏览器标签页中的 iPhone 或 iPad，添加到主屏幕后才能接收推送；
 * - ios-update：iOS 16.4 以前版本上的主屏幕应用；
 * - unsupported：其他情况。
 */
export type PushCapability = 'native' | 'native-unavailable' | 'webpush' | 'ios-install' | 'ios-update' | 'unsupported';

/**
 * Whether this device gets notifications now: checking, on, off (can be turned on), denied (blocked in the
 * browser or system settings), or failed (the app could not register with the push service).
 * 这台设备现在是否接收通知：检查中、已开启、未开启（可以开启）、被拒绝（在浏览器或系统设置中被拦截），或失败（App 无法向推送服务登记）。
 */
export type DeviceState = 'checking' | 'on' | 'off' | 'denied' | 'failed';

export interface CapabilityInput {
  /** Running inside the Capacitor app. */
  /** 在 Capacitor App 内运行。 */
  native: boolean;
  /** The app has the push plugin and Firebase is configured. */
  /** App 带有推送插件，且已配置 Firebase。 */
  nativePush: boolean;
  userAgent: string;
  maxTouchPoints: number;
  /** Opened from the home screen (display-mode standalone, or navigator.standalone on iOS). */
  /** 从主屏幕打开（display-mode 为 standalone，或 iOS 上的 navigator.standalone）。 */
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  secureContext: boolean;
}

/** iPadOS asks for desktop sites and then reports a Mac; only the touch screen gives it away. */
/** iPadOS 默认请求桌面网站，此时报告为 Mac；只有触摸屏能把它认出来。 */
export function isAppleMobile(userAgent: string, maxTouchPoints: number): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1;
}

export function detectCapability(input: CapabilityInput): PushCapability {
  if (input.native) return input.nativePush ? 'native' : 'native-unavailable';
  const webPush = input.serviceWorker && input.pushManager && input.notification && input.secureContext;
  const apple = isAppleMobile(input.userAgent, input.maxTouchPoints);
  if (apple && !input.standalone && !webPush) return 'ios-install';
  if (webPush) return 'webpush';
  if (apple) return 'ios-update';
  return 'unsupported';
}

/**
 * Short label the server keeps beside each device, e.g. android-chrome or ios-homescreen. Only letters,
 * digits and dashes, which the server accepts.
 * 服务器为每台设备保存的简短标签，例如 android-chrome 或 ios-homescreen。只用字母、数字和连字符，服务器均可接受。
 */
export function platformLabel(userAgent: string, maxTouchPoints: number, standalone: boolean, native: boolean): string {
  if (native) return 'android-app';
  if (isAppleMobile(userAgent, maxTouchPoints)) return standalone ? 'ios-homescreen' : 'ios-safari';
  const os = /\bAndroid\b/.test(userAgent) ? 'android' : /\bWindows\b/.test(userAgent) ? 'windows' : /\bMac OS X\b/.test(userAgent) ? 'mac' : /\bCrOS\b/.test(userAgent) ? 'chromeos' : /\bLinux\b/.test(userAgent) ? 'linux' : 'web';
  const browser = /\bEdg\//.test(userAgent) ? 'edge' : /\bFirefox\//.test(userAgent) ? 'firefox' : /\bChrome\//.test(userAgent) ? 'chrome' : /\bSafari\//.test(userAgent) ? 'safari' : 'browser';
  return `${os}-${browser}${standalone ? '-app' : ''}`;
}
