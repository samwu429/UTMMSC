import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import type { RemovePushDeviceBody } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { tr } from '../../shared/i18n/locale';
import { useSessionStore } from '../../shared/session/store';
import { notificationsApi } from './api';
import { detectCapability, type DeviceState, type PushCapability } from './capability';
import {
  canOpenNativeSettings,
  closeAllNativeNotifications,
  closeNativeNotifications,
  ensureNativeChannels,
  nativeChannelIssues,
  nativePermission,
  nativePushReady,
  type ChannelIssues,
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
  /** In the Android app, channels the member turned off or down in system settings. */
  /** 安卓 App 中，成员在系统设置里关闭或调低的通知渠道。 */
  channels: ChannelIssues | null;
  /** The Android app can open its notification settings (from 1.2.0). */
  /** 安卓 App 能打开自己的通知设置（1.2.0 起）。 */
  canOpenSettings: boolean;
  busy: boolean;
  error: string | null;
}

export const useNotificationStore = create<NotificationState>()(() => ({
  capability: null,
  device: 'checking',
  serverReady: null,
  channels: null,
  canOpenSettings: false,
  busy: false,
  error: null,
}));

function set(patch: Partial<NotificationState>) {
  useNotificationStore.setState(patch);
}

let capabilityPromise: Promise<PushCapability> | null = null;

/**
 * Detected once per page; the answer does not change while the page is open. The app's probe registers with
 * Firebase, which creates a push token, so it is skipped before sign-in and after the member turned
 * notifications off here; a build with the plugin then counts as able.
 * 每个页面只检测一次；页面打开期间结果不会变化。App 的探测会向 Firebase 登记，从而生成推送令牌，所以登录之前、
 * 以及成员在这台设备上关闭通知之后都跳过探测，此时带有插件的版本视为可以接收。
 */
function capability(): Promise<PushCapability> {
  capabilityPromise ??= (async () => {
    const native = Capacitor.isNativePlatform();
    const probe = Boolean(useSessionStore.getState().token) && !isTurnedOffHere();
    return detectCapability({
      native,
      nativePush: native ? (probe ? await nativePushReady() : Capacitor.isPluginAvailable('PushNotifications')) : false,
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
    const native = cap === 'native';
    const [device, serverReady, channels, canOpenSettings] = await Promise.all([
      readDeviceState(cap),
      readServerReady(cap),
      native ? nativeChannelIssues() : null,
      native ? canOpenNativeSettings() : false,
    ]);
    // A failed registration in the app stays visible until the member tries again.
    // App 内登记失败的状态会一直显示，直到成员重试。
    const keepFailed = useNotificationStore.getState().device === 'failed' && device === 'off';
    set({ capability: cap, device: keepFailed ? 'failed' : device, serverReady, channels, canOpenSettings });
  } catch {
    set({ capability: 'unsupported', device: 'off' });
  }
}

/**
 * Records a newly registered token here and drops the one it replaced from the server, so a rotated token
 * does not leave a dead row that the test would count as a second device.
 * 在本机记下新登记的令牌，并从服务器删除被它替换的旧令牌，免得更换令牌后留下一条无效记录，被测试当成第二台设备。
 */
function rememberToken(token: string, previous: RemovePushDeviceBody | null) {
  rememberDevice({ token });
  if (previous && 'token' in previous && previous.token !== token) void notificationsApi.removeDevice(previous).catch(() => undefined);
}

/**
 * On the way back to the page, for example from system settings: a device that was blocked and is now
 * allowed is registered at once, so the member does not have to tap 开启通知 again. Never throws.
 * 回到页面时（例如从系统设置回来）：原本被拦截、现在已允许的设备会立即登记，成员不必再点一次「开启通知」。不会抛错。
 */
export async function refreshAfterReturn(): Promise<void> {
  const before = useNotificationStore.getState().device;
  await refreshNotificationStatus();
  if (before === 'denied' && useNotificationStore.getState().device === 'off') await syncRegistration();
}

/** A registration under way records its own token, so the token event it causes is not sent twice. */
/** 进行中的登记会自己记下令牌，因此它引发的令牌事件不会再发送一次。 */
let registering = false;

/**
 * The plugin answers unregister() at once while Firebase deletes the token in the background, and until
 * then Firebase hands the same doomed token out again. The token being deleted, and since when, is kept
 * here so a quick re-registration waits for a new one. The wait is bounded: a token still handed out after
 * that was kept, for example because the delete failed offline, so it is still valid and is used.
 * 插件对 unregister() 立即答复，而 Firebase 在后台删除令牌；删除完成之前，Firebase 仍会再给出这个即将失效的令牌。
 * 这里记下正在删除的令牌及开始时间，紧接着重新登记时就会等到新令牌。等待有上限：超过上限后仍被给出的令牌说明它被保留了
 * （例如离线时删除失败），它仍然有效，因此照常使用。
 */
let deleting: { token: string; since: number } | null = null;
const DELETE_GRACE_MS = 8000;
const NEW_TOKEN_WAIT_MS = 1500;

function isBeingDeleted(token: string): boolean {
  if (!deleting || deleting.token !== token) return false;
  if (Date.now() - deleting.since < DELETE_GRACE_MS) return true;
  deleting = null;
  return false;
}

/** The member still wants notifications here: signed in, and not turned off on this device. */
/** 成员仍希望在这里接收通知：已登录，且没有在这台设备上关闭。 */
function stillWanted(): boolean {
  return Boolean(useSessionStore.getState().token) && !isTurnedOffHere();
}

function onRotatedToken(token: string) {
  const current = storedDevice();
  if (current && 'token' in current && current.token === token) return;
  if (registering || !stillWanted() || isBeingDeleted(token)) return;
  registerFcmDevice(token)
    .then(() => rememberToken(token, current))
    .catch(() => undefined);
}

async function unregisterNativeToken(token: string | null): Promise<void> {
  if (token) deleting = { token, since: Date.now() };
  await unregisterNative();
}

async function freshNativeToken(): Promise<string> {
  for (;;) {
    const token = await registerNative(onRotatedToken);
    if (!isBeingDeleted(token)) {
      deleting = null;
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, NEW_TOKEN_WAIT_MS));
  }
}

/**
 * Firebase gave no token, usually because the phone lacks Google Play services. Kept apart from server
 * errors, which the settings screen reports as they are.
 * Firebase 没有给出令牌，通常是因为手机缺少 Google Play 服务。与服务器错误分开处理，服务器错误由设置页原样显示。
 */
class NativeTokenError extends Error {}

async function registerNativeDevice(): Promise<void> {
  await ensureNativeChannels().catch(() => undefined);
  const previous = storedDevice();
  registering = true;
  try {
    let token: string;
    try {
      token = await freshNativeToken();
    } catch (err) {
      set({ device: 'failed' });
      throw new NativeTokenError(err instanceof Error ? err.message : String(err));
    }
    // Firebase can take seconds, and meanwhile the member may have signed out or turned notifications off.
    // Firebase 可能要好几秒，其间成员可能已退出登录或关闭了通知。
    if (!stillWanted()) return;
    await registerFcmDevice(token);
    if (!stillWanted()) {
      await notificationsApi.removeDevice({ token }).catch(() => undefined);
      return;
    }
    rememberToken(token, previous);
  } finally {
    registering = false;
  }
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
    if (cap === 'native') await unregisterNativeToken(device && 'token' in device ? device.token : null).catch(() => undefined);
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

/**
 * The push service no longer knows this device's address, so registering it again would not help: the
 * browser subscribes afresh and the app gets a new token, then the server is told. Never throws; the
 * outcome shows in the device state.
 * 推送服务已经不认识这台设备的地址，重新登记同一个地址没有用：浏览器重新订阅，App 换一个新令牌，再告知服务器。不会抛错；结果反映在设备状态中。
 */
export async function renewRegistration(): Promise<void> {
  const cap = useNotificationStore.getState().capability;
  if (!useSessionStore.getState().token || isTurnedOffHere()) return;
  try {
    if (cap === 'webpush' && webPushPermission() === 'granted') {
      await unsubscribeWebPush();
      rememberDevice({ endpoint: await subscribeWebPush() });
    } else if (cap === 'native' && (await nativePermission()) === 'granted') {
      const device = storedDevice();
      await unregisterNativeToken(device && 'token' in device ? device.token : null);
      // The deleted token is forgotten at once, so a renewal that fails reads as off rather than on.
      // 立即忘掉已删除的令牌，续订失败时显示为未开启，而不是已开启。
      rememberDevice(null);
      await registerNativeDevice();
    }
  } catch {
    // The screen shows the state; the member can turn notifications off and on again.
    // 页面会显示状态；成员可以关闭后重新开启通知。
  } finally {
    await refreshNotificationStatus();
  }
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
  if (cap === 'native') await waitAtMost(unregisterNativeToken(device && 'token' in device ? device.token : null), LOGOUT_WAIT_MS);
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
