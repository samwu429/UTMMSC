import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { ActionPerformed, PushNotificationSchema, PushNotificationsPlugin } from '@capacitor/push-notifications';
import { tr } from '../../shared/i18n/locale';
import { notificationsApi } from './api';

const REGISTER_WAIT_MS = 15_000;
/** register() answers at once; the token itself arrives later as an event. */
/** register() 会立即答复；令牌本身稍后以事件送达。 */
const PROBE_WAIT_MS = 5_000;

let pluginPromise: Promise<PushNotificationsPlugin> | null = null;

function pushPlugin(): Promise<PushNotificationsPlugin> {
  pluginPromise ??= import('@capacitor/push-notifications').then((module) => module.PushNotifications);
  return pluginPromise;
}

/** How the app's push plugin refuses register() in a build without google-services.json. */
/** 没有 google-services.json 的版本中，App 的推送插件拒绝 register() 的方式。 */
export function isPushUnavailableError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'UNAVAILABLE';
}

/**
 * Whether this app build can receive push. The app's PushNotifications plugin rejects register() with
 * code UNAVAILABLE when Firebase is not configured, and otherwise resolves at once and fetches a token in
 * the background, which needs no permission, so asking is safe before the system dialog is shown. An app
 * without the plugin cannot receive push at all.
 * 这个 App 版本能否接收推送。未配置 Firebase 时，App 的 PushNotifications 插件以 UNAVAILABLE 拒绝 register()；
 * 否则立即答复并在后台获取令牌，这一步不需要通知权限，因此可以在弹出系统对话框之前询问。没有该插件的 App 完全不能接收推送。
 */
export async function nativePushReady(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return false;
  try {
    const push = await pushPlugin();
    await Promise.race([push.register(), new Promise((resolve) => setTimeout(resolve, PROBE_WAIT_MS))]);
    return true;
  } catch (err) {
    // Any other refusal is a token problem, which registration reports as failed.
    // 其他拒绝属于令牌问题，登记时会报告为失败。
    return !isPushUnavailableError(err);
  }
}

export type NativePermission = 'granted' | 'denied' | 'prompt';

export async function nativePermission(): Promise<NativePermission> {
  const push = await pushPlugin();
  const { receive } = await push.checkPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
}

/** Shows the Android 13+ system dialog; older Android grants at once. */
/** 弹出 Android 13 及以上的系统对话框；更早的安卓版本直接授予。 */
export async function requestNativePermission(): Promise<NativePermission> {
  const push = await pushPlugin();
  const { receive } = await push.requestPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
}

let channelsMade = false;

/**
 * The channels the server names. Creating an existing channel again only updates its name, so the
 * names follow the app language.
 * 服务器使用的通知渠道。重复创建已有渠道只会更新名称，因此名称会随应用语言变化。
 */
export async function ensureNativeChannels(): Promise<void> {
  if (channelsMade) return;
  const push = await pushPlugin();
  await push.createChannel({ id: 'messages', name: tr('消息', 'Messages'), description: tr('聊天中的新消息', 'New chat messages'), importance: 5, vibration: true });
  await push.createChannel({ id: 'events', name: tr('活动', 'Events'), description: tr('社团活动通知与提醒', 'Club event notices and reminders'), importance: 4, vibration: true });
  channelsMade = true;
}

type TokenListener = (result: { token: string } | { error: string }) => void;

const tokenListeners = new Set<TokenListener>();
let registrationHandles: Promise<PluginListenerHandle[]> | null = null;

/**
 * Token events arrive on registration and whenever Firebase rotates the token; each is passed to every
 * waiting listener and to `onToken` for refreshes.
 * 令牌事件在登记时以及 Firebase 更换令牌时到达；每次都会交给所有等待中的监听者，并交给 `onToken` 处理刷新。
 */
function listenForTokens(onToken: (token: string) => void): Promise<PluginListenerHandle[]> {
  registrationHandles ??= pushPlugin().then((push) =>
    Promise.all([
      push.addListener('registration', ({ value }) => {
        onToken(value);
        for (const listener of tokenListeners) listener({ token: value });
      }),
      push.addListener('registrationError', ({ error }) => {
        for (const listener of tokenListeners) listener({ error });
      }),
    ]),
  );
  return registrationHandles;
}

/**
 * Registers with Firebase and resolves with the token. Rotated tokens later go to `onToken`.
 * 向 Firebase 登记并返回令牌。之后更换的令牌会交给 `onToken`。
 */
export async function registerNative(onToken: (token: string) => void): Promise<string> {
  await listenForTokens(onToken);
  const push = await pushPlugin();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      tokenListeners.delete(listener);
      reject(new Error('registration timed out'));
    }, REGISTER_WAIT_MS);
    const listener: TokenListener = (result) => {
      clearTimeout(timer);
      tokenListeners.delete(listener);
      if ('token' in result) resolve(result.token);
      else reject(new Error(result.error));
    };
    tokenListeners.add(listener);
    push.register().catch((err: unknown) => listener({ error: err instanceof Error ? err.message : String(err) }));
  });
}

/** Deletes this phone's token, so pushes still addressed to it fail and the server drops it. */
/** 删除这台手机的令牌，仍发往它的推送会失败，服务器随之删除它。 */
export async function unregisterNative(): Promise<void> {
  const push = await pushPlugin();
  await push.unregister();
}

export function registerFcmDevice(token: string) {
  return notificationsApi.registerDevice({ kind: 'fcm', token, platform: 'android-app' });
}

/**
 * Tap and foreground listeners. Taps are kept by the plugin until a listener exists, so adding it at
 * start-up also catches the tap that launched the app.
 * 点击与前台收到通知的监听。插件会保留点击事件直到有监听者，因此启动时添加也能收到启动 App 的那次点击。
 */
export async function listenForNativeNotifications(handlers: {
  onTap: (data: Record<string, unknown>) => void;
  onForeground: (notification: PushNotificationSchema) => void;
}): Promise<() => void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return () => undefined;
  const push = await pushPlugin();
  const handles = await Promise.all([
    push.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => handlers.onTap((action.notification.data ?? {}) as Record<string, unknown>)),
    push.addListener('pushNotificationReceived', handlers.onForeground),
  ]);
  return () => {
    for (const handle of handles) void handle.remove();
  };
}

/** Removes a chat's notices from the shade once the member opens it. */
/** 成员打开某个聊天后，从通知栏移除该聊天的通知。 */
export async function closeNativeNotifications(tag: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return;
  const push = await pushPlugin();
  const { notifications } = await push.getDeliveredNotifications();
  const matching = notifications.filter((notification) => notification.tag === tag);
  if (matching.length > 0) await push.removeDeliveredNotifications({ notifications: matching });
}

/** Clears every notice this app has in the shade, for example at sign-out. */
/** 清除本 App 在通知栏中的全部通知，例如在退出登录时。 */
export async function closeAllNativeNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return;
  const push = await pushPlugin();
  await push.removeAllDeliveredNotifications();
}
