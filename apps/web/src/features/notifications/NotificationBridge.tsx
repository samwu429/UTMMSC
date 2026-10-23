import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { tr } from '../../shared/i18n/locale';
import { toast } from '../../shared/ui/toast';
import { useOverviewStore } from '../chat/state/overviewStore';
import { appPathFromUrl } from './links';
import { listenForNativeNotifications } from './nativePush';
import { closeNotificationsOnSignOut, refreshNotificationStatus } from './notifications';

const NAVIGATE = 'utmmsc:navigate';
const WHERE = 'utmmsc:where';
const FOREGROUND_TOAST_MS = 3000;

/**
 * Opens the screen a tapped notification points to, in the browser (asked by the service worker) and in
 * the Android app (told by the push plugin). It also keeps the device status fresh, since permission can
 * change in the browser or system settings while the app is in the background, and clears the shade
 * when the session ends.
 * 打开被点击的通知所指向的页面：浏览器中由 Service Worker 发来请求，安卓 App 中由推送插件告知。同时保持设备状态最新，
 * 因为应用在后台时，权限可能在浏览器或系统设置中被更改；会话结束时还会清空通知栏。
 */
export function NotificationBridge() {
  const navigate = useNavigate();
  // The router hands out a new navigate after each move; the listeners below are added only once.
  // 路由每次跳转后都会给出新的 navigate；下面的监听只添加一次。
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    const open = (url: unknown) => {
      const path = appPathFromUrl(url);
      if (path) navigateRef.current(path);
    };

    const onWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      // The worker cannot see moves inside the app, so it asks which screen is open before skipping a push.
      // Service Worker 看不到应用内的跳转，所以在跳过推送之前先询问当前打开的页面。
      if (data?.type === WHERE) {
        event.ports[0]?.postMessage(window.location.href);
        return;
      }
      if (!data || data.type !== NAVIGATE) return;
      event.ports[0]?.postMessage('ok');
      open(data.url);
    };
    const worker = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    worker?.addEventListener('message', onWorkerMessage);

    let stopNative: (() => void) | null = null;
    let cancelled = false;
    listenForNativeNotifications({
      onTap: (data) => open(data.url),
      onForeground: (notification) => {
        const kind = (notification.data as Record<string, unknown> | undefined)?.kind;
        // In the foreground Android shows nothing, so the app answers for itself.
        // 前台时安卓不会显示通知，所以由应用自己反馈。
        if (kind === 'message' || kind === 'recall') void useOverviewStore.getState().refresh({ force: true });
        else if (kind === 'test') toast(tr('收到测试通知。App 在后台时，通知会出现在通知栏。', 'Test notification received. When the app is in the background, it shows in the notification shade.'), { ms: FOREGROUND_TOAST_MS });
        else if (notification.title) toast([notification.title, notification.body].filter(Boolean).join('\n'), { ms: FOREGROUND_TOAST_MS });
      },
    })
      .then((stop) => {
        if (cancelled) stop();
        else stopNative = stop;
      })
      .catch(() => undefined);

    const stopClosing = closeNotificationsOnSignOut();
    void refreshNotificationStatus();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNotificationStatus();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      worker?.removeEventListener('message', onWorkerMessage);
      stopNative?.();
      stopClosing();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
