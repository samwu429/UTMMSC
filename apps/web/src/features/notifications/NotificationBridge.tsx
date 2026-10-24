import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { tr } from '../../shared/i18n/locale';
import { toast } from '../../shared/ui/toast';
import { useOverviewStore } from '../chat/state/overviewStore';
import { MOMENTS_PUSH_MESSAGE } from '../moments/model';
import { useMomentsBadge } from '../moments/state/badgeStore';
import { appPathFromUrl, isSameScreen } from './links';
import { closeNativeNotifications, listenForNativeNotifications } from './nativePush';
import { closeNotificationsOnSignOut, refreshAfterReturn, refreshNotificationStatus } from './notifications';
import { noteTestArrival } from './testRun';

const NAVIGATE = 'utmmsc:navigate';
const WHERE = 'utmmsc:where';
/** Sent by the service worker after it shows a notice. */
/** Service Worker 显示通知后发出。 */
const SHOWN = 'utmmsc:shown';
const FOREGROUND_TOAST_MS = 3000;
const MOMENTS_PATH = '/discover/feed';

/**
 * The 好友动态 home feed only, which shows new activity itself (the bubble above the posts), so a push there needs
 * no toast. A post, the notices, an album or the settings show nothing new, so a push there still gets one.
 * 仅限好友动态首页，它会自己显示新的互动（动态上方的气泡），因此在那里收到推送不需要提示。动态详情、消息、相册或设置页面
 * 不会显示新的互动，因此在那里收到推送仍会提示。
 */
function onMomentsHome(pathname: string): boolean {
  return pathname === MOMENTS_PATH || pathname === `${MOMENTS_PATH}/`;
}

/**
 * A moments push means the 发现 badge and the 好友动态 row are behind. The push only goes out after the write,
 * so a forced refresh sees it, even right after another refresh.
 * 收到好友动态推送说明「发现」角标和「好友动态」一行已经过时。推送在写入之后才发出，因此即使刚刷新过，强制刷新也能看到它。
 */
function refreshMomentsBadge(): void {
  void useMomentsBadge
    .getState()
    .refresh({ force: true })
    .catch(() => undefined);
}

/**
 * Opens the screen a tapped notification points to, in the browser (asked by the service worker) and in
 * the Android app (told by the push plugin). It also keeps the device status fresh, since permission can
 * change in the browser or system settings while the app is in the background, and clears the shade
 * when the session ends. A moments push, in either place, refreshes the 好友动态 badge.
 * 打开被点击的通知所指向的页面：浏览器中由 Service Worker 发来请求，安卓 App 中由推送插件告知。同时保持设备状态最新，
 * 因为应用在后台时，权限可能在浏览器或系统设置中被更改；会话结束时还会清空通知栏。无论在哪一端，收到好友动态推送都会刷新好友动态角标。
 */
export function NotificationBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  // The router hands out a new navigate after each move; the listeners below are added only once.
  // 路由每次跳转后都会给出新的 navigate；下面的监听只添加一次。
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    const open = (url: unknown) => {
      const path = appPathFromUrl(url);
      if (path) navigateRef.current(path, { replace: isSameScreen(path, locationRef.current) });
    };

    const onWorkerMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; url?: unknown } | null;
      // The worker cannot see moves inside the app, so it asks which screen is open before skipping a push.
      // Service Worker 看不到应用内的跳转，所以在跳过推送之前先询问当前打开的页面。
      if (data?.type === WHERE) {
        event.ports[0]?.postMessage(window.location.href);
        return;
      }
      if (data?.type === SHOWN) {
        if ((data as { kind?: unknown }).kind === 'test') noteTestArrival('web');
        return;
      }
      // Sent for every moments push, shown or not; the worker takes care of the notice itself.
      // 每次好友动态推送都会发来，无论是否显示了通知；通知本身由 Service Worker 处理。
      if (data?.type === MOMENTS_PUSH_MESSAGE) {
        refreshMomentsBadge();
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
      onTap: (data) => {
        if (data.kind === 'test') noteTestArrival('tap');
        open(data.url);
      },
      onForeground: (notification) => {
        const data = notification.data as Record<string, unknown> | undefined;
        const kind = data?.kind;
        // In the foreground Android shows nothing, so the app answers for itself. A test that is waiting for
        // this push reports it on its own screen.
        // 前台时安卓不会显示通知，所以由应用自己反馈。正在等这条推送的测试会在自己的页面上说明。
        if (kind === 'message' || kind === 'recall') void useOverviewStore.getState().refresh({ force: true });
        else if (kind === 'moment') {
          refreshMomentsBadge();
          if (!onMomentsHome(locationRef.current.pathname) && notification.title) {
            toast([notification.title, notification.body].filter(Boolean).join('\n'), { ms: FOREGROUND_TOAST_MS });
          }
        } else if (kind === 'moment_recall') {
          refreshMomentsBadge();
          // The quiet replacement cannot be shown now, so the deleted comment's notice, if it is still in the
          // shade from before, is taken out instead.
          // 安静的替换通知此刻无法显示，所以改为把之前留在通知栏里的那条已删除评论的通知移除。
          if (typeof data?.tag === 'string') void closeNativeNotifications(data.tag).catch(() => undefined);
        } else if (kind === 'test') {
          if (!noteTestArrival('foreground')) toast(tr('测试通知已到达。App 开着时，安卓不会把通知放进通知栏。', 'The test notification arrived. While the app is open, Android keeps notifications out of the shade.'), { ms: FOREGROUND_TOAST_MS });
        } else if (notification.title) toast([notification.title, notification.body].filter(Boolean).join('\n'), { ms: FOREGROUND_TOAST_MS });
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
      if (document.visibilityState === 'visible') void refreshAfterReturn();
    };
    // The Android app keeps its page visible in the background and fires resume on the way back instead.
    // 安卓 App 在后台时页面仍保持可见，回到前台时改为触发 resume。
    const onResume = () => void refreshAfterReturn();
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('resume', onResume);

    return () => {
      cancelled = true;
      worker?.removeEventListener('message', onWorkerMessage);
      stopNative?.();
      stopClosing();
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('resume', onResume);
    };
  }, []);

  return null;
}
