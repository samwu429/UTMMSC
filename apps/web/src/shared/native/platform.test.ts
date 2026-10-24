import { describe, expect, it } from 'vitest';
import { ANDROID_APP_URL, isAndroidUserAgent, isAppleTouchDevice, offersAndroidApp } from './platform';

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
const ANDROID_WEBVIEW = 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36';
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

describe('isAndroidUserAgent', () => {
  it('recognizes Android browsers and WebViews', () => {
    expect(isAndroidUserAgent(ANDROID_CHROME)).toBe(true);
    expect(isAndroidUserAgent(ANDROID_WEBVIEW)).toBe(true);
  });

  it('rejects iPhone, iPad and desktop browsers', () => {
    expect(isAndroidUserAgent(IPHONE_SAFARI)).toBe(false);
    expect(isAndroidUserAgent(IPAD_DESKTOP_MODE)).toBe(false);
    expect(isAndroidUserAgent(WINDOWS_CHROME)).toBe(false);
    expect(isAndroidUserAgent('')).toBe(false);
  });

  it('needs the whole word', () => {
    expect(isAndroidUserAgent('Mozilla/5.0 (X11; Linux x86_64) NotAndroidish/1.0')).toBe(false);
  });
});

describe('isAppleTouchDevice', () => {
  const IPAD_SAFARI = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPHONE_HOME_SCREEN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

  it('recognizes iPhone Safari and the home-screen app', () => {
    expect(isAppleTouchDevice(IPHONE_SAFARI, 5)).toBe(true);
    expect(isAppleTouchDevice(IPHONE_HOME_SCREEN, 5)).toBe(true);
    expect(isAppleTouchDevice(IPAD_SAFARI, 5)).toBe(true);
  });

  it('recognizes iPadOS asking for the desktop site by its touch screen', () => {
    expect(isAppleTouchDevice(IPAD_DESKTOP_MODE, 5)).toBe(true);
  });

  it('rejects a Mac without touch, Android and Windows', () => {
    expect(isAppleTouchDevice(IPAD_DESKTOP_MODE, 0)).toBe(false);
    expect(isAppleTouchDevice(IPAD_DESKTOP_MODE, 1)).toBe(false);
    expect(isAppleTouchDevice(ANDROID_CHROME, 5)).toBe(false);
    expect(isAppleTouchDevice(ANDROID_WEBVIEW, 5)).toBe(false);
    expect(isAppleTouchDevice(WINDOWS_CHROME, 10)).toBe(false);
    expect(isAppleTouchDevice('', 0)).toBe(false);
  });
});

describe('offersAndroidApp', () => {
  it('offers the app in an Android browser only', () => {
    expect(offersAndroidApp(ANDROID_CHROME, false)).toBe(true);
    expect(offersAndroidApp(IPHONE_SAFARI, false)).toBe(false);
    expect(offersAndroidApp(WINDOWS_CHROME, false)).toBe(false);
  });

  it('never offers it inside the app', () => {
    expect(offersAndroidApp(ANDROID_WEBVIEW, true)).toBe(false);
    expect(offersAndroidApp(ANDROID_CHROME, true)).toBe(false);
  });

  it('points at the homepage download route', () => {
    expect(ANDROID_APP_URL).toBe('https://utmmsc.com/download/android');
  });
});
