import { create } from 'zustand';
import type { TestNotificationResponse } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { notificationsApi } from './api';
import { appIsActive, closeNativeNotifications, hasNativeNotification, leaveApp, nativeChannelIssues, untilAppActive } from './nativePush';
import { renewRegistration, syncRegistration, useNotificationStore } from './notifications';
import { nativeTestVerdict, renewFailedText, renewingText, testResultText, type NativeTestSighting, type TestResultText } from './statusText';

type Tr = (zh: string, en: string) => string;

/** The tag the server gives every test push. */
/** 服务器给每条测试推送的 tag。 */
export const TEST_TAG = 'test';

/**
 * Seconds the server waits before the app's test push, long enough for the app to reach the background
 * first. Android only puts a push in the shade while the app is not in the foreground.
 * 服务器发送 App 测试推送前等待的秒数，足够 App 先进入后台。安卓只在 App 不在前台时才把推送放进通知栏。
 */
export const TEST_DELAY_SECONDS = 3;
/** The notice stays readable this long before the app leaves; a request that fails meanwhile stops the test. */
/** App 离开前，提示保持可读的时长；其间请求失败则测试停止。 */
const LEAVE_PAUSE_MS = 900;
/** A push may still be on its way when the member comes back. */
/** 成员回来时，推送可能还在路上。 */
const SIGHTING_WAIT_MS = 4000;
const SIGHTING_POLL_MS = 500;
/** How long the browser test waits for its service worker to report the notice. */
/** 浏览器测试等待 Service Worker 报告通知已显示的时长。 */
const WEB_SIGHTING_WAIT_MS = 8000;
/** A result this old is from an earlier visit to the screen, not the test that just ended. */
/** 这么久以前的结果属于之前一次打开页面，而不是刚结束的测试。 */
const STALE_RESULT_MS = 5000;

interface TestRunState {
  running: boolean;
  result: TestResultText | null;
  /** When the last run ended. */
  /** 上一次测试结束的时间。 */
  finishedAt: number;
}

/** Kept outside the screen, which may mount again when a tapped test notice opens it. */
/** 保存在页面之外：点开测试通知打开页面时，页面可能重新挂载。 */
export const useTestRun = create<TestRunState>()(() => ({ running: false, result: null, finishedAt: 0 }));

function show(result: TestResultText | null) {
  useTestRun.setState({ result });
}

let waiting = false;
let sighting: Exclude<NativeTestSighting, 'shade' | null> | 'web' | null = null;

/**
 * Called when a test push reaches this device: tapped in the shade, received with the app open, or shown
 * by the service worker. True while a test is waiting for it, so the caller need not announce it itself.
 * 测试推送到达这台设备时调用：在通知栏中被点开、App 打开时收到，或由 Service Worker 显示。测试正在等它时返回 true，调用方就不必另行提示。
 */
export function noteTestArrival(how: 'tap' | 'foreground' | 'web'): boolean {
  if (!waiting) return false;
  // A tap is the strongest sign and is never overwritten.
  // 点开是最确定的迹象，不会被覆盖。
  if (sighting !== 'tap') sighting = how;
  return true;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Looks for the test push once the member is back, giving one still on its way a few seconds. If the member
 * leaves again meanwhile, the search waits for the next return, so a notice that lands in the shade then
 * is left there for them to see.
 * 成员回来后查找测试推送，还在路上的推送可以再等几秒。期间成员若再次离开，查找会等到下一次回来，这时到达通知栏的通知会留给成员看到。
 */
async function nativeSighting(expected: boolean): Promise<NativeTestSighting> {
  let deadline = Date.now() + SIGHTING_WAIT_MS;
  for (;;) {
    if (sighting === 'tap' || sighting === 'foreground') return sighting;
    if (!(await appIsActive())) {
      await untilAppActive();
      deadline = Date.now() + SIGHTING_WAIT_MS;
      continue;
    }
    if (await hasNativeNotification(TEST_TAG).catch(() => false)) return 'shade';
    if (!expected || Date.now() >= deadline) return null;
    await pause(SIGHTING_POLL_MS);
  }
}

/**
 * After the test, a registration the server lost or the push service forgot is mended, so the next test can
 * succeed. The result says it was registered again only once that is done, and says so only if it worked.
 * 测试之后修复服务器丢失或推送服务已不认识的登记，下一次测试就能成功。只有完成之后、且确实成功时，结果才说明已重新登记。
 */
async function mendRegistration(result: TestNotificationResponse, verdict: TestResultText, tr: Tr): Promise<void> {
  if (useNotificationStore.getState().device !== 'on') return;
  if (result.thisDevice !== 'gone' && result.thisDevice !== 'none') return;
  show(renewingText(tr));
  if (result.thisDevice === 'gone') await renewRegistration();
  else await syncRegistration();
  show(useNotificationStore.getState().device === 'on' ? verdict : renewFailedText(tr));
}

/** What the fallback asks for when the app could not leave by itself, with the seconds actually left. */
/** App 无法自行离开时的提示，所说的秒数按实际剩余时间计算。 */
function leaveYourselfText(startedAt: number, tr: Tr): TestResultText {
  const left = Math.round(TEST_DELAY_SECONDS - (Date.now() - startedAt) / 1000);
  return left >= 1
    ? { tone: 'info', text: tr(`现在锁屏或回到桌面，${left} 秒后通知栏会出现一条测试通知。`, `Lock the screen or go to the home screen now. In ${left} seconds a test notice appears in the notification shade.`) }
    : { tone: 'info', text: tr('现在锁屏，测试通知马上就会出现在锁屏上。', 'Lock the screen now; the test notice is about to appear there.') };
}

/**
 * The app's test: the server is asked to push in a few seconds, the app goes to the home screen so the
 * push lands in the shade as a real one would, and on the member's return the app reports whether it got
 * there, or what to check if it did not.
 * App 内的测试：请服务器几秒后推送，App 退到桌面，推送因此像真实通知一样进入通知栏；成员回来时，App 说明推送是否到了通知栏，
 * 没到时该检查什么。
 */
export async function runNativeTest(tr: Tr): Promise<void> {
  if (useTestRun.getState().running) return;
  useTestRun.setState({ running: true });
  waiting = true;
  sighting = null;
  show({ tone: 'info', text: tr(`App 即将回到桌面，${TEST_DELAY_SECONDS} 秒后通知栏会出现一条测试通知。点开它就会回到这里。`, `The app will go to the home screen. In ${TEST_DELAY_SECONDS} seconds a test notice appears in the notification shade; tap it to come back here.`) });
  try {
    await closeNativeNotifications(TEST_TAG).catch(() => undefined);
    const startedAt = Date.now();
    const request = notificationsApi.test({ delaySeconds: TEST_DELAY_SECONDS });
    // A request refused at once (offline, too many tests, signed out) is reported here, without leaving the app.
    // 立即被拒绝的请求（离线、测试太频繁、已退出登录）在这里报告，不会离开 App。
    const early = await Promise.race([request.then(() => null, (err: unknown) => ({ err })), pause(LEAVE_PAUSE_MS).then(() => null)]);
    if (early) {
      show({ tone: 'error', text: errorMessage(early.err) });
      return;
    }
    if (!(await leaveApp())) show(leaveYourselfText(startedAt, tr));
    let result: TestNotificationResponse;
    try {
      result = await request;
    } catch (err) {
      // The server keeps sending when the connection drops in the background, so the push may still have
      // come; only when nothing was seen is the network error the answer.
      // 后台连接中断时服务器仍会继续发送，推送可能已经到了；只有什么都没看到时，才以网络错误作答。
      await untilAppActive();
      const seen = await nativeSighting(true);
      show(seen ? nativeTestVerdict({ sent: 1, failed: 0, devices: 1, thisDevice: 'sent' }, seen, null, tr) : { tone: 'error', text: errorMessage(err) });
      if (seen === 'shade') await closeNativeNotifications(TEST_TAG).catch(() => undefined);
      return;
    }
    await untilAppActive();
    const expected = result.thisDevice === 'sent' || (result.thisDevice === undefined && result.sent > 0);
    const seen = await nativeSighting(expected);
    const channels = seen === 'tap' || seen === 'shade' ? null : await nativeChannelIssues();
    const verdict = nativeTestVerdict(result, seen, channels, tr);
    show(verdict);
    if (seen === 'shade') await closeNativeNotifications(TEST_TAG).catch(() => undefined);
    await mendRegistration(result, verdict, tr);
  } finally {
    waiting = false;
    useTestRun.setState({ running: false, finishedAt: Date.now() });
  }
}

/**
 * The test everywhere else: sent at once, and on a browser with notifications on, confirmed when the
 * service worker reports that the notice was shown.
 * 其他情况下的测试：立即发送；在开启了通知的浏览器中，Service Worker 报告通知已显示时予以确认。
 */
export async function runTest(tr: Tr): Promise<void> {
  if (useTestRun.getState().running) return;
  const { capability, device, serverReady } = useNotificationStore.getState();
  useTestRun.setState({ running: true });
  show(null);
  const watch = capability === 'webpush' && device === 'on';
  waiting = watch;
  sighting = null;
  try {
    const result = await notificationsApi.test();
    const verdict = testResultText(result, capability, serverReady, device, tr);
    show(verdict);
    await mendRegistration(result, verdict, tr);
    if (!watch || result.thisDevice !== 'sent') return;
    // Read through a function: the worker's report changes it while this waits.
    // 通过函数读取：等待期间 Service Worker 的报告会改变它。
    const shown = () => sighting === 'web';
    const deadline = Date.now() + WEB_SIGHTING_WAIT_MS;
    while (!shown() && Date.now() < deadline) await pause(SIGHTING_POLL_MS);
    if (shown()) {
      show({
        tone: 'success',
        text: tr('测试通知已在这台设备上显示。如果没有看到弹出，请检查系统的通知设置或勿扰模式。', 'The test notice was shown on this device. If nothing popped up, check the system notification settings or Do Not Disturb.'),
      });
    }
  } catch (err) {
    show({ tone: 'error', text: errorMessage(err) });
  } finally {
    waiting = false;
    useTestRun.setState({ running: false, finishedAt: Date.now() });
  }
}

/**
 * Called when the screen opens: a result left from an earlier visit is dropped, while one that just landed,
 * as when a tapped test notice opens the screen, stays.
 * 页面打开时调用：之前那次打开留下的结果会被清除，刚刚得到的结果（例如点开测试通知打开页面时）则保留。
 */
export function clearStaleTestResult(): void {
  const { running, finishedAt } = useTestRun.getState();
  if (!running && Date.now() - finishedAt > STALE_RESULT_MS) show(null);
}

/** Clears the last result when the screen closes, unless a test is still going. */
/** 页面关闭时清除上一次的结果，测试仍在进行时除外。 */
export function clearTestResult(): void {
  if (!useTestRun.getState().running) show(null);
}
