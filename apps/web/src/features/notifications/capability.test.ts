import { describe, expect, it } from 'vitest';
import { detectCapability, isAppleMobile, platformLabel, type CapabilityInput } from './capability';

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const WINDOWS_EDGE = `${WINDOWS_CHROME} Edg/129.0.0.0`;
const WINDOWS_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';

const browser = (userAgent: string, overrides: Partial<CapabilityInput> = {}): CapabilityInput => ({
  native: false,
  nativePush: false,
  userAgent,
  maxTouchPoints: 0,
  standalone: false,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  secureContext: true,
  ...overrides,
});

/** What an iPhone or iPad Safari tab exposes: a service worker, but no PushManager and no Notification. */
/** iPhone 或 iPad 的 Safari 标签页提供的能力：有 Service Worker，但没有 PushManager 和 Notification。 */
const appleTab = { pushManager: false, notification: false };

describe('detectCapability', () => {
  it('uses Web Push in desktop and Android browsers', () => {
    expect(detectCapability(browser(ANDROID_CHROME, { maxTouchPoints: 5 }))).toBe('webpush');
    expect(detectCapability(browser(WINDOWS_CHROME))).toBe('webpush');
    expect(detectCapability(browser(WINDOWS_FIREFOX))).toBe('webpush');
    expect(detectCapability(browser(MAC_SAFARI))).toBe('webpush');
  });

  it('asks an iPhone in a browser tab to add the app to the home screen', () => {
    expect(detectCapability(browser(IPHONE_SAFARI, { maxTouchPoints: 5, ...appleTab }))).toBe('ios-install');
    expect(detectCapability(browser(IPHONE_WECHAT, { maxTouchPoints: 5, ...appleTab }))).toBe('ios-install');
  });

  it('recognizes an iPad that asks for desktop sites by its touch screen', () => {
    expect(detectCapability(browser(MAC_SAFARI, { maxTouchPoints: 5, ...appleTab }))).toBe('ios-install');
    expect(isAppleMobile(MAC_SAFARI, 5)).toBe(true);
    expect(isAppleMobile(MAC_SAFARI, 0)).toBe(false);
  });

  it('uses Web Push in a home-screen app on iOS 16.4 or later', () => {
    expect(detectCapability(browser(IPHONE_SAFARI, { maxTouchPoints: 5, standalone: true }))).toBe('webpush');
  });

  it('asks for an iOS update when a home-screen app has no Web Push', () => {
    expect(detectCapability(browser(IPHONE_SAFARI, { maxTouchPoints: 5, standalone: true, ...appleTab }))).toBe('ios-update');
  });

  it('reports browsers without push, or pages outside a secure context, as unsupported', () => {
    expect(detectCapability(browser(ANDROID_CHROME, { pushManager: false }))).toBe('unsupported');
    expect(detectCapability(browser(WINDOWS_CHROME, { serviceWorker: false }))).toBe('unsupported');
    expect(detectCapability(browser(WINDOWS_CHROME, { secureContext: false }))).toBe('unsupported');
  });

  it('uses the app branch inside the Android app, whatever the WebView offers', () => {
    expect(detectCapability(browser(ANDROID_WEBVIEW, { native: true, nativePush: true }))).toBe('native');
    expect(detectCapability(browser(ANDROID_WEBVIEW, { native: true, nativePush: false }))).toBe('native-unavailable');
    expect(detectCapability(browser(ANDROID_WEBVIEW, { native: true, nativePush: false, pushManager: false }))).toBe('native-unavailable');
  });
});

describe('platformLabel', () => {
  it('names the system and browser in characters the server accepts', () => {
    expect(platformLabel(ANDROID_CHROME, 5, false, false)).toBe('android-chrome');
    expect(platformLabel(ANDROID_CHROME, 5, true, false)).toBe('android-chrome-app');
    expect(platformLabel(WINDOWS_EDGE, 0, false, false)).toBe('windows-edge');
    expect(platformLabel(WINDOWS_FIREFOX, 0, false, false)).toBe('windows-firefox');
    expect(platformLabel(MAC_SAFARI, 0, false, false)).toBe('mac-safari');
    expect(platformLabel(IPHONE_SAFARI, 5, true, false)).toBe('ios-homescreen');
    expect(platformLabel(ANDROID_WEBVIEW, 5, false, true)).toBe('android-app');
    for (const ua of [ANDROID_CHROME, IPHONE_WECHAT, WINDOWS_EDGE, '']) expect(platformLabel(ua, 0, false, false)).toMatch(/^[a-z-]{1,40}$/);
  });
});
