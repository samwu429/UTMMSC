import type { PushDeviceRegistration } from '@utmmsc/shared';
import { ApiClientError } from '../../shared/api/errors';
import { notificationsApi } from './api';
import { platformLabel } from './capability';
import { base64UrlToBytes, sameKey } from './vapid';

/** The worker is registered by pwa.ts during the splash; a dev server has none, so waiting stops here. */
/** Service Worker 由 pwa.ts 在开屏期间注册；开发服务器上没有，所以等到这里为止。 */
const WORKER_WAIT_MS = 10_000;

export class PushSetupError extends Error {
  constructor(public readonly reason: 'server' | 'worker' | 'subscribe') {
    super(reason);
  }
}

let keyPromise: Promise<string | null> | null = null;

/**
 * The server's VAPID public key, fetched once per page. Null when the server has no Web Push yet;
 * a network failure is retried on the next call.
 * 服务器的 VAPID 公钥，每个页面只取一次。服务器尚未开通 Web Push 时为 null；网络失败会在下次调用时重试。
 */
export function serverVapidKey(): Promise<string | null> {
  keyPromise ??= notificationsApi
    .vapidKey()
    .then((res) => res.publicKey || null)
    .catch((err: unknown) => {
      if (err instanceof ApiClientError && err.status === 503) return null;
      keyPromise = null;
      throw err;
    });
  return keyPromise;
}

export function standaloneDisplay(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

export function webPushPermission(): NotificationPermission {
  return typeof Notification === 'undefined' ? 'denied' : Notification.permission;
}

async function workerRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  if (existing) return existing;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), WORKER_WAIT_MS))]);
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  if (!registration?.pushManager) return null;
  return registration.pushManager.getSubscription().catch(() => null);
}

/** Reuses the subscription when it was made with the current key; otherwise subscribes afresh. */
/** 订阅使用的是当前公钥时沿用；否则重新订阅。 */
async function ensureSubscription(key: string): Promise<PushSubscription> {
  const registration = await workerRegistration();
  if (!registration?.pushManager) throw new PushSetupError('worker');
  const keyBytes = base64UrlToBytes(key);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, keyBytes)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });
    } catch {
      throw new PushSetupError('subscribe');
    }
  }
  return subscription;
}

function registrationBody(subscription: PushSubscription): PushDeviceRegistration {
  const json = subscription.toJSON();
  const keys = json.keys ?? {};
  if (!json.endpoint || !keys.p256dh || !keys.auth) throw new PushSetupError('subscribe');
  return {
    kind: 'webpush',
    endpoint: json.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
    platform: platformLabel(navigator.userAgent, navigator.maxTouchPoints ?? 0, standaloneDisplay(), false),
  };
}

/**
 * Subscribes this browser and registers it with the server. Returns the endpoint.
 * 为这个浏览器订阅推送并在服务器登记，返回 endpoint。
 */
export async function subscribeWebPush(): Promise<string> {
  const key = await serverVapidKey();
  if (!key) throw new PushSetupError('server');
  const subscription = await ensureSubscription(key);
  const body = registrationBody(subscription);
  await notificationsApi.registerDevice(body);
  return body.kind === 'webpush' ? body.endpoint : '';
}

/**
 * Asks for permission. Call it first thing in a tap handler, before any other await, or Safari ignores it.
 * 请求通知权限。必须在点击处理中最先调用，之前不能有其他 await，否则 Safari 会忽略。
 */
export function requestWebPushPermission(): Promise<NotificationPermission> {
  try {
    return Promise.resolve(Notification.requestPermission());
  } catch {
    return Promise.resolve('denied');
  }
}

export async function unsubscribeWebPush(): Promise<void> {
  const subscription = await currentSubscription();
  await subscription?.unsubscribe().catch(() => false);
}

/** Closes the notices already shown for a chat, once the member is looking at it. */
/** 成员打开某个聊天后，关掉该聊天已经显示的通知。 */
export async function closeWebNotifications(tag: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  if (!registration?.getNotifications) return;
  const shown = await registration.getNotifications({ tag }).catch(() => []);
  for (const notification of shown) notification.close();
}

/** Closes every notice this site has shown, for example at sign-out. */
/** 关闭本网站显示过的全部通知，例如在退出登录时。 */
export async function closeAllWebNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL).catch(() => undefined);
  if (!registration?.getNotifications) return;
  const shown = await registration.getNotifications().catch(() => []);
  for (const notification of shown) notification.close();
}
