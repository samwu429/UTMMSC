import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { errorMessage } from '../../shared/api/errors';
import { tr } from '../../shared/i18n/locale';
import { useSessionStore } from '../../shared/session/store';
import { notificationsApi } from './api';
import { detectCapability, type DeviceState, type PushCapability } from './capability';
import {
  closeAllNativeNotifications,
  closeNativeNotifications,
  ensureNativeChannels,
  nativePermission,
  nativePushReady,
  registerFcmDevice,
  registerNative,
  requestNativePermission,
  unregisterNative,
} from './nativePush';
import { isTurnedOffHere, markAskedNatively, rememberDevice, setTurnedOffHere, storedDevice, wasAskedNatively } from './storage';
import {
  PushSetupError,
  closeAllWebNotifications,
  closeWebNotifications,
  currentSubscription,
  requestWebPushPermission,
  serverVapidKey,
  standaloneDisplay,
  subscribeWebPush,
  unsubscribeWebPush,
  webPushPermission,
} from './webPush';

interface NotificationState {
  /** Null until detected. */
  /** 检测完成前为 null。 */
  capability: PushCapability | null;
  device: DeviceState;
  /** Whether the server can send Web Push; null until asked. Irrelevant in the Android app. */
  /** 服务器能否发送 Web Push；询问前为 null。安卓 App 中不适用。 */
  serverReady: boolean | null;
  busy: boolean;
  error: string | null;
}

export const useNotificationStore = create<NotificationState>()(() => ({
  capability: null,
  device: 'checking',
  serverReady: null,
  busy: false,
  error: null,
}));

function set(patch: Partial<NotificationState>) {
  useNotificationStore.setState(patch);
}

let capabilityPromise: Promise<PushCapability> | null = null;

/** Detected once per page; the answer does not change while the page is open. */
/** 每个页面只检测一次；页面打开期间结果不会变化。 */
function capability(): Promise<PushCapability> {
  capabilityPromise ??= (async () => {
    const native = Capacitor.isNativePlatform();
    return detectCapability({
      native,
      nativePush: native ? await nativePushReady() : false,
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
      standalone: standaloneDisplay(),
      serviceWorker: 'serviceWorker' in navigator,
      pushManager: typeof window !== 'undefined' && 'PushManager' in window,
      notification: typeof Notification !== 'undefined',
      secureContext: typeof window !== 'undefined' && window.isSecureContext,
    });
  })();
  return capabilityPromise;
}

async function readDeviceState(cap: PushCapability): Promise<DeviceState> {
  if (cap === 'native') {
    const permission = await nativePermission().catch(() => 'prompt' as const);
    if (permission === 'denied') return 'denied';
    if (isTurnedOffHere() || permission !== 'granted') return 'off';
    return storedDevice() ? 'on' : 'off';
  }
  if (cap === 'webpush') {
    const permission = webPushPermission();
    if (permission === 'denied') return 'denied';
    if (isTurnedOffHere() || permission !== 'granted') return 'off';
    return (await currentSubscription()) && storedDevice() ? 'on' : 'off';
  }
  return 'off';
}

async function readServerReady(cap: PushCapability): Promise<boolean | null> {
  if (cap === 'native' || cap === 'native-unavailable' || cap === 'unsupported') return null;
  return serverVapidKey()
    .then((key) => key !== null)
    .catch(() => null);
}

/** Re-reads what this device can do and whether it is on. Never throws. */
/** 重新读取这台设备的能力及是否已开启。不会抛错。 */
export async function refreshNotificationStatus(): Promise<void> {
  try {
    const cap = await capability();
    const [device, serverReady] = await Promise.all([readDeviceState(cap), readServerReady(cap)]);
    // A failed registration in the app stays visible until the member tries again.
    // App 内登记失败的状态会一直显示，直到成员重试。
    const keepFailed = useNotificationStore.getState().device === 'failed' && device === 'off';
    set({ capability: cap, device: keepFailed ? 'failed' : device, serverReady });
  } catch {
    set({ capability: 'unsupported', device: 'off' });
  }
}

function onRotatedToken(token: string) {
  const current = storedDevice();
  if (current && 'token' in current && current.token === token) return;
  if (!useSessionStore.getState().token || isTurnedOffHere()) return;
  registerFcmDevice(token)
    .then(() => rememberDevice({ token }))
    .catch(() => undefined);
}

/**
 * Firebase gave no token, usually because the phone lacks Google Play services. Kept apart from server
 * errors, which the settings screen reports as they are.
 * Firebase 没有给出令牌，通常是因为手机缺少 Google Play 服务。与服务器错误分开处理，服务器错误由设置页原样显示。
 */
class NativeTokenError extends Error {}

async function registerNativeDevice(): Promise<void> {
  await ensureNativeChannels().catch(() => undefined);
  let token: string;
  try {
    token = await registerNative(onRotatedToken);
  } catch (err) {
    set({ device: 'failed' });
    throw new NativeTokenError(err instanceof Error ? err.message : String(err));
  }
  await registerFcmDevice(token);
  rememberDevice({ token });
}

function setupMessage(err: unknown): string {
  if (err instanceof PushSetupError) {
    if (err.reason === 'server') return tr('通知服务尚未开通', 'Notifications are not set up on the server yet.');
    if (err.reason === 'worker') return tr('页面还没准备好，请刷新后再试', 'The page is not ready yet. Reload and try again.');
    return tr('浏览器没能开启推送，请稍后再试', 'The browser could not turn on push. Try again in a moment.');
  }
  return errorMessage(err);
}

export type EnableOutcome = 'on' | 'denied' | 'dismissed' | 'failed';

/**
 * Turns notifications on for this device. On the web it must run straight from a tap: the permission
 * request is the very first step, before anything is awaited.
 * 为这台设备开启通知。网页上必须直接在点击中调用：请求权限是第一步，之前不能等待任何操作。
 */
export function enableNotifications(): Promise<EnableOutcome> {
  const cap = useNotificationStore.getState().capability;
  if (cap === 'webpush') {
    const permission = requestWebPushPermission();
    return finishEnable(async () => {
      const answer = await permission;
      if (answer === 'denied') return 'denied';
      if (answer !== 'granted') return 'dismissed';
      setTurnedOffHere(false);
      const endpoint = await subscribeWebPush();
      rememberDevice({ endpoint });
      return 'on';
    });
  }
  if (cap === 'native') {
    return finishEnable(async () => {
      let permission = await nativePermission();
      if (permission === 'prompt') {
        markAskedNatively();
        permission = await requestNativePermission();
      }
      if (permission === 'denied') return 'denied';
      if (permission !== 'granted') return 'dismissed';
      setTurnedOffHere(false);
      await registerNativeDevice();
      return 'on';
    });
  }
  return Promise.resolve('failed');
}

async function finishEnable(run: () => Promise<EnableOutcome>): Promise<EnableOutcome> {
  set({ busy: true, error: null });
  try {
    const outcome = await run();
    if (outcome === 'denied') set({ device: 'denied' });
    if (outcome === 'on') set({ device: 'on' });
    return outcome;
  } catch (err) {
    set({ error: err instanceof NativeTokenError ? null : setupMessage(err) });
    return 'failed';
  } finally {
    set({ busy: false });
    void refreshNotificationStatus();
  }
}

/** Stops notifications on this device only; the member's other devices keep theirs. */
/** 只停止这台设备上的通知；成员的其他设备不受影响。 */
export async function disableOnThisDevice(): Promise<void> {
  const cap = useNotificationStore.getState().capability;
  set({ busy: true, error: null });
  setTurnedOffHere(true);
  try {
    const device = storedDevice();
    if (device) await notificationsApi.removeDevice(device).catch(() => undefined);
    rememberDevice(null);
    if (cap === 'webpush') await unsubscribeWebPush();
    if (cap === 'native') await unregisterNative().catch(() => undefined);
    set({ device: 'off' });
  } finally {
    set({ busy: false });
    void refreshNotificationStatus();
  }
}

let syncing: Promise<void> | null = null;

/**
 * After sign-in and on every start: registers this device again for the current session, which the
 * server requires, and picks up a rotated subscription. The Android app asks for permission once here;
 * browsers never ask without a tap.
 * 登录后及每次启动时：为当前会话重新登记这台设备（服务器要求如此），并接上已更换的订阅。安卓 App 在这里请求一次权限；浏览器不经点击绝不请求。
 */
export function syncRegistration(): Promise<void> {
  syncing ??= runSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function runSync(): Promise<void> {
  try {
    const cap = await capability();
    if (!useSessionStore.getState().token || isTurnedOffHere()) return;
    if (cap === 'webpush') {
      if (webPushPermission() !== 'granted') {
        await forgetDevice();
        return;
      }
      const previous = storedDevice();
      const endpoint = await subscribeWebPush();
      if (previous && 'endpoint' in previous && previous.endpoint !== endpoint) await notificationsApi.removeDevice(previous).catch(() => undefined);
      rememberDevice({ endpoint });
    } else if (cap === 'native') {
      let permission = await nativePermission();
      if (permission === 'prompt' && !wasAskedNatively()) {
        markAskedNatively();
        permission = await requestNativePermission();
      }
      if (permission !== 'granted') {
        await forgetDevice();
        return;
      }
      await registerNativeDevice();
    }
  } catch {
    // Quiet by design; the settings screen shows the state and offers a retry.
    // 刻意保持安静；设置页会显示状态并提供重试。
  } finally {
    await refreshNotificationStatus();
  }
}

/** Permission was withdrawn in the browser or system, so the server copy of this device is dropped. */
/** 权限已在浏览器或系统中撤回，因此删除服务器上这台设备的记录。 */
async function forgetDevice(): Promise<void> {
  const device = storedDevice();
  if (!device) return;
  await notificationsApi.removeDevice(device).catch(() => undefined);
  rememberDevice(null);
}

const LOGOUT_WAIT_MS = 3000;

function waitAtMost(work: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([work.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Removes this device from the server while the session is still valid, then ends the subscription here
 * whatever the network did: the browser drops its push subscription and the app deletes its token. A
 * sign-out that could not reach the server therefore still stops pushes for this member, because the
 * push services refuse the old address and the server deletes it. Each step waits at most three seconds,
 * so signing out offline is not held up. The next sign-in subscribes again.
 * 在会话仍有效时从服务器移除这台设备，然后不论网络结果如何都在本机结束订阅：浏览器取消推送订阅，App 删除令牌。
 * 因此即使退出登录时连不上服务器，这位成员的推送也会停止，因为推送服务会拒绝旧地址，服务器随之删除它。
 * 每一步最多等三秒，离线时退出登录不会被卡住。下次登录时会重新订阅。
 */
export async function unregisterBeforeLogout(): Promise<void> {
  const device = storedDevice();
  rememberDevice(null);
  if (device) await waitAtMost(notificationsApi.removeDevice(device), LOGOUT_WAIT_MS);
  const cap = useNotificationStore.getState().capability ?? (await capability().catch(() => null));
  if (cap === 'webpush') await waitAtMost(unsubscribeWebPush(), LOGOUT_WAIT_MS);
  if (cap === 'native') await waitAtMost(unregisterNative(), LOGOUT_WAIT_MS);
  set({ device: 'off' });
}

/** Clears every notice shown on this device. Never throws. */
/** 清除这台设备上显示的全部通知。不会抛错。 */
export async function closeAllNotifications(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) await closeAllNativeNotifications();
    else await closeAllWebNotifications();
  } catch {
    // Nothing more can be done; the notices close when tapped.
    // 无法再做什么；通知被点击时会关闭。
  }
}

/**
 * Whenever the session ends on this device, by sign-out or because the server refused it, the
 * member's notices leave the shade, so the next person to use the device cannot read them.
 * 只要这台设备上的会话结束（退出登录，或被服务器拒绝），该成员的通知都会从通知栏清除，下一位使用这台设备的人因此无法看到。
 */
export function closeNotificationsOnSignOut(): () => void {
  return useSessionStore.subscribe((state, previous) => {
    if (previous.token && !state.token) void closeAllNotifications();
  });
}

/** Closes notices for a chat that is now on screen. */
/** 关闭当前正在查看的聊天的通知。 */
export function closeNotificationsFor(tag: string): void {
  if (!tag) return;
  if (Capacitor.isNativePlatform()) void closeNativeNotifications(tag).catch(() => undefined);
  else void closeWebNotifications(tag).catch(() => undefined);
}
