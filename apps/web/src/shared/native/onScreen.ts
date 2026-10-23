import { Capacitor } from '@capacitor/core';

type Listener = (onScreen: boolean) => void;

const listeners = new Set<Listener>();
let appActive = true;
let started = false;
let last: boolean | null = null;

/**
 * Whether this page is on screen: the document is visible and, in the Android app, the app is in the
 * foreground. The app reports going to the background itself as well, since the WebView may keep the
 * page marked visible for a moment after Home is pressed.
 * 本页面是否显示在屏幕上：文档可见，并且在安卓 App 中 App 处于前台。App 进入后台时也会自行报告，
 * 因为按下主屏幕键后 WebView 可能还会把页面标为可见一会儿。
 */
export function isOnScreen(): boolean {
  return document.visibilityState !== 'hidden' && appActive;
}

function notify(): void {
  const now = isOnScreen();
  if (now === last) return;
  last = now;
  for (const listener of listeners) listener(now);
}

function start(): void {
  if (started) return;
  started = true;
  last = isOnScreen();
  document.addEventListener('visibilitychange', notify);
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return;
  import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('appStateChange', ({ isActive }) => {
        appActive = isActive;
        notify();
      }),
    )
    .catch(() => undefined);
}

/** Calls back whenever isOnScreen() changes. */
/** isOnScreen() 变化时回调。 */
export function onScreenChange(listener: Listener): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
