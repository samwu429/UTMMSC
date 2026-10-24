import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import type { ActionPerformed, PushNotificationSchema, PushNotificationsPlugin } from '@capacitor/push-notifications';
import { tr } from '../../shared/i18n/locale';
import { notificationsApi } from './api';

const REGISTER_WAIT_MS = 15_000;
/** register() answers at once; the token itself arrives later as an event. */
/** register() 会立即答复；令牌本身稍后以事件送达。 */
const PROBE_WAIT_MS = 5_000;

let pluginPromise: Promise<{ push: PushNotificationsPlugin }> | null = null;

/**
 * The plugin is wrapped in an object because Capacitor's plugin proxy answers every property, including
 * then: resolving a promise with the proxy itself makes the promise call proxy.then(), which throws, and the
 * promise never settles.
 * 插件被包在一个对象里，因为 Capacitor 的插件代理会响应所有属性，包括 then：用代理本身完成 Promise 时，Promise 会调用
 * proxy.then()，而它会抛错，Promise 便永远不会完成。
 */
function pushPlugin(): Promise<{ push: PushNotificationsPlugin }> {
  pluginPromise ??= import('@capacitor/push-notifications').then((module) => ({ push: module.PushNotifications }));
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
    const { push } = await pushPlugin();
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
  const { push } = await pushPlugin();
  const { receive } = await push.checkPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
}

/** Shows the Android 13+ system dialog; older Android grants at once. */
/** 弹出 Android 13 及以上的系统对话框；更早的安卓版本直接授予。 */
export async function requestNativePermission(): Promise<NativePermission> {
  const { push } = await pushPlugin();
  const { receive } = await push.requestPermissions();
  if (receive === 'granted') return 'granted';
  if (receive === 'denied') return 'denied';
  return 'prompt';
}

let channelsMade = false;

/**
 * The channels the server names. Creating an existing channel again only updates its name, so the
 * names follow the app language. The app itself creates only messages and events at first launch, so
 * moments, added later, exists once the web has run this; until then Firebase shows its pushes on
 * messages, the default channel in the app's manifest.
 * 服务器使用的通知渠道。重复创建已有渠道只会更新名称，因此名称会随应用语言变化。App 首次启动时只自行创建 messages 和 events，
 * 后来加入的 moments 要等网页执行这里之后才存在；在那之前，Firebase 把它的推送显示在 App 清单中的默认渠道 messages 上。
 */
export async function ensureNativeChannels(): Promise<void> {
  if (channelsMade) return;
  const { push } = await pushPlugin();
  await push.createChannel({ id: 'messages', name: tr('消息', 'Messages'), description: tr('聊天中的新消息', 'New chat messages'), importance: 5, vibration: true });
  await push.createChannel({ id: 'events', name: tr('活动', 'Events'), description: tr('社团活动通知与提醒', 'Club event notices and reminders'), importance: 4, vibration: true });
  await push.createChannel({
    id: 'moments',
    name: tr('好友动态', 'Friend updates'),
    description: tr('有人评论、回复你，或管理员处理你的内容时通知', 'When someone comments on or replies to you, or an admin acts on your content'),
    importance: 3,
    vibration: true,
  });
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
  registrationHandles ??= pushPlugin().then(({ push }) =>
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
  const { push } = await pushPlugin();
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
  const { push } = await pushPlugin();
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
  const { push } = await pushPlugin();
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
  const { push } = await pushPlugin();
  const { notifications } = await push.getDeliveredNotifications();
  const matching = notifications.filter((notification) => notification.tag === tag);
  if (matching.length > 0) await push.removeDeliveredNotifications({ notifications: matching });
}

/** Clears every notice this app has in the shade, for example at sign-out. */
/** 清除本 App 在通知栏中的全部通知，例如在退出登录时。 */
export async function closeAllNativeNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return;
  const { push } = await pushPlugin();
  await push.removeAllDeliveredNotifications();
}

/** App builds from 1.2.0 (versionCode 3) on have openSettings(). */
/** 1.2.0（versionCode 3）起的 App 版本带有 openSettings()。 */
const SETTINGS_BUILD = 3;
let buildPromise: Promise<number> | null = null;

function appBuild(): Promise<number> {
  buildPromise ??= import('@capacitor/app')
    .then(({ App }) => App.getInfo())
    .then((info) => Number(info.build) || 0)
    .catch(() => 0);
  return buildPromise;
}

/**
 * Whether this app can open its own notification settings. Asked by build, because the plugin proxy of an
 * older build answers the call too and only then refuses it.
 * 这个 App 能否打开自己的通知设置。按版本号判断，因为旧版本的插件代理同样会接受这个调用，之后才拒绝。
 */
export async function canOpenNativeSettings(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications') || !Capacitor.isPluginAvailable('App')) return false;
  return (await appBuild()) >= SETTINGS_BUILD;
}

/** Opens Android's notification settings for this app; false when it could not. */
/** 打开安卓中本应用的通知设置；无法打开时返回 false。 */
export async function openNativeSettings(): Promise<boolean> {
  try {
    const { push } = await pushPlugin();
    await (push as unknown as { openSettings(): Promise<void> }).openSettings();
    return true;
  } catch {
    return false;
  }
}

/** Whether a notice with this tag is in the shade now. */
/** 通知栏里现在是否有这个 tag 的通知。 */
export async function hasNativeNotification(tag: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return false;
  const { push } = await pushPlugin();
  const { notifications } = await push.getDeliveredNotifications();
  return notifications.some((notification) => notification.tag === tag);
}

/**
 * How the member set a channel in system settings: off, or so low that notices arrive with no sound and no
 * banner. Android's importance runs from 0 (off) to 5; 3 still makes a sound.
 * 成员在系统设置里对某个渠道的设定：已关闭，或级别低到通知到达时既无声音也无横幅。安卓的重要性从 0（关闭）到 5；3 仍会发出声音。
 */
export type ChannelIssue = 'off' | 'quiet';

export interface ChannelIssues {
  messages: ChannelIssue | null;
  events: ChannelIssue | null;
  /** Optional, so callers that only look at chat and events, such as the test push tips, can leave it out. */
  /** 可选，只关心聊天和活动的调用方（例如测试通知的提示）可以不写。 */
  moments?: ChannelIssue | null;
}

export function channelIssue(importance: number | undefined): ChannelIssue | null {
  if (importance === undefined) return null;
  if (importance <= 0) return 'off';
  return importance <= 2 ? 'quiet' : null;
}

/** Null before Android 8, which has no channels, and when the plugin cannot say. */
/** Android 8 以前没有通知渠道，插件无法回答时也返回 null。 */
export async function nativeChannelIssues(): Promise<ChannelIssues | null> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('PushNotifications')) return null;
  try {
    const { push } = await pushPlugin();
    const { channels } = await push.listChannels();
    const importance = (id: string) => channels.find((channel) => channel.id === id)?.importance;
    return { messages: channelIssue(importance('messages')), events: channelIssue(importance('events')), moments: channelIssue(importance('moments')) };
  } catch {
    return null;
  }
}

/**
 * Sends the app to the home screen, so a push that arrives next goes to the shade, which Android only uses
 * while the app is in the background. Resolves true once the app is in the background, false when it could
 * not leave.
 * 把 App 退到桌面，接下来到达的推送就会进入通知栏：安卓只在 App 处于后台时才使用通知栏。App 进入后台后返回 true，无法离开时返回 false。
 */
export async function leaveApp(waitMs = 1200): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return false;
  try {
    const { App } = await import('@capacitor/app');
    let settle: (left: boolean) => void = () => undefined;
    const left = new Promise<boolean>((resolve) => {
      settle = resolve;
    });
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) settle(true);
    });
    const timer = setTimeout(() => settle(false), waitMs);
    await App.minimizeApp();
    const result = await left;
    clearTimeout(timer);
    void handle.remove();
    return result;
  } catch {
    return false;
  }
}

/** Whether the app is in the foreground; always true in a browser or when the App plugin cannot say. */
/** App 是否在前台；在浏览器中或 App 插件无法回答时总是 true。 */
export async function appIsActive(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return true;
  try {
    const { App } = await import('@capacitor/app');
    return (await App.getState()).isActive;
  } catch {
    return true;
  }
}

/** Resolves once the app is in the foreground again; at once in a browser or when it already is. */
/** App 回到前台后完成；在浏览器中或本来就在前台时立即完成。 */
export async function untilAppActive(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('App')) return;
  try {
    const { App } = await import('@capacitor/app');
    let settle: () => void = () => undefined;
    const back = new Promise<void>((resolve) => {
      settle = resolve;
    });
    // Listening comes first, so a return between the two calls is not missed.
    // 先开始监听，两次调用之间回到前台也不会漏掉。
    const handle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) settle();
    });
    if ((await App.getState()).isActive) settle();
    await back;
    void handle.remove();
  } catch {
    // Without the App plugin there is no way to tell; carry on as if back.
    // 没有 App 插件就无从判断，按已经回来处理。
  }
}
