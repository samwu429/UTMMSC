import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestNotificationResponse } from '@utmmsc/shared';

const api = vi.hoisted(() => ({ test: vi.fn<(body?: { delaySeconds?: number }) => Promise<TestNotificationResponse>>() }));
const native = vi.hoisted(() => ({
  appIsActive: vi.fn(async () => true),
  closeNativeNotifications: vi.fn(async (_tag: string) => undefined),
  hasNativeNotification: vi.fn(async (_tag: string) => false),
  leaveApp: vi.fn(async () => true),
  nativeChannelIssues: vi.fn(async () => null as { messages: 'off' | 'quiet' | null; events: 'off' | 'quiet' | null } | null),
  untilAppActive: vi.fn(async () => undefined),
}));
const registration = vi.hoisted(() => ({
  renewRegistration: vi.fn(async () => undefined),
  syncRegistration: vi.fn(async () => undefined),
  state: { capability: 'native', device: 'on', serverReady: null } as { capability: string; device: string; serverReady: boolean | null },
}));

vi.mock('./api', () => ({ notificationsApi: api }));
vi.mock('./nativePush', () => native);
vi.mock('./notifications', () => ({
  renewRegistration: registration.renewRegistration,
  syncRegistration: registration.syncRegistration,
  useNotificationStore: { getState: () => registration.state },
}));
vi.mock('../../shared/api/errors', () => ({ errorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)) }));

const { clearStaleTestResult, noteTestArrival, runNativeTest, runTest, useTestRun } = await import('./testRun');

const zh = (text: string) => text;
const sentHere: TestNotificationResponse = { sent: 1, failed: 0, devices: 1, thisDevice: 'sent', serviceProblem: false };

/** Runs a test to the end, advancing the clock through its pauses. */
/** 运行一次测试直到结束，并推进时钟跳过其中的等待。 */
async function finish(run: Promise<void>) {
  await vi.runAllTimersAsync();
  await run;
}

/** A request the server answers after `ms`, as the delayed test does. */
/** 服务器在 `ms` 毫秒后才应答的请求，与延迟发送的测试相同。 */
function answerAfter(ms: number, outcome: TestNotificationResponse | Error): Promise<TestNotificationResponse> {
  return new Promise((resolve, reject) => setTimeout(() => (outcome instanceof Error ? reject(outcome) : resolve(outcome)), ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  // Vitest 2 leaves a reset mock returning undefined, so every default is set again here.
  // Vitest 2 中被重置的 mock 会返回 undefined，所以这里重新设置每个默认行为。
  vi.resetAllMocks();
  native.appIsActive.mockResolvedValue(true);
  native.closeNativeNotifications.mockResolvedValue(undefined);
  native.hasNativeNotification.mockResolvedValue(false);
  native.leaveApp.mockResolvedValue(true);
  native.nativeChannelIssues.mockResolvedValue(null);
  native.untilAppActive.mockResolvedValue(undefined);
  registration.renewRegistration.mockResolvedValue(undefined);
  registration.syncRegistration.mockResolvedValue(undefined);
  registration.state = { capability: 'native', device: 'on', serverReady: null };
  api.test.mockImplementation(() => answerAfter(3200, sentHere));
  useTestRun.setState({ running: false, result: null, finishedAt: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('runNativeTest', () => {
  it('asks for a delayed push, leaves the app, and confirms a tapped notice', async () => {
    native.untilAppActive.mockImplementation(async () => {
      noteTestArrival('tap');
    });
    await finish(runNativeTest(zh));
    expect(api.test).toHaveBeenCalledWith({ delaySeconds: 3 });
    expect(native.closeNativeNotifications).toHaveBeenCalledWith('test');
    expect(native.leaveApp).toHaveBeenCalledTimes(1);
    expect(useTestRun.getState()).toMatchObject({ running: false, result: { tone: 'success', text: '通知正常：测试通知出现在了通知栏，点开后回到了这里。' } });
  });

  it('confirms a notice still in the shade, then tidies it away', async () => {
    native.hasNativeNotification.mockResolvedValue(true);
    await finish(runNativeTest(zh));
    expect(useTestRun.getState().result?.text).toBe('通知正常：测试通知已经出现在通知栏里。');
    expect(native.closeNativeNotifications).toHaveBeenCalledTimes(2);
  });

  it('waits a little for a push still on its way when the member comes back early', async () => {
    let checks = 0;
    native.hasNativeNotification.mockImplementation(async () => {
      checks += 1;
      return checks >= 3;
    });
    await finish(runNativeTest(zh));
    expect(useTestRun.getState().result?.tone).toBe('success');
  });

  it('waits for the next return when the member leaves again while it looks, instead of clearing the notice unseen', async () => {
    native.appIsActive.mockResolvedValueOnce(false);
    native.hasNativeNotification.mockResolvedValue(true);
    await finish(runNativeTest(zh));
    expect(native.untilAppActive).toHaveBeenCalledTimes(2);
    expect(useTestRun.getState().result?.tone).toBe('success');
  });

  it('explains a push that arrived while the app was open', async () => {
    native.untilAppActive.mockImplementation(async () => {
      noteTestArrival('foreground');
    });
    await finish(runNativeTest(zh));
    expect(useTestRun.getState().result?.tone).toBe('info');
  });

  it('lists what to check, with the channel settings, when nothing was seen', async () => {
    native.nativeChannelIssues.mockResolvedValue({ messages: 'off', events: null });
    await finish(runNativeTest(zh));
    const result = useTestRun.getState().result;
    expect(result?.tone).toBe('error');
    expect(result?.tips?.[0]).toContain('「消息」类通知被关闭了');
  });

  it('says a forgotten registration was renewed only once it was, and says so when it was not', async () => {
    api.test.mockImplementationOnce(() => answerAfter(3200, { sent: 0, failed: 1, devices: 1, thisDevice: 'gone', serviceProblem: false }));
    await finish(runNativeTest(zh));
    expect(registration.renewRegistration).toHaveBeenCalledTimes(1);
    expect(useTestRun.getState().result?.text).toBe('这台设备的推送地址已经失效，已为它重新登记。请再发一次测试。');

    api.test.mockImplementationOnce(() => answerAfter(3200, { sent: 0, failed: 0, devices: 0, thisDevice: 'none', serviceProblem: false }));
    registration.syncRegistration.mockImplementationOnce(async () => {
      registration.state = { ...registration.state, device: 'failed' };
    });
    await finish(runNativeTest(zh));
    expect(registration.syncRegistration).toHaveBeenCalledTimes(1);
    expect(useTestRun.getState().result?.text).toBe('没能为这台设备重新登记。请在上面关闭通知后重新开启。');
  });

  it('reports a request refused at once without leaving the app', async () => {
    api.test.mockRejectedValue(new Error('测试太频繁'));
    await finish(runNativeTest(zh));
    expect(native.leaveApp).not.toHaveBeenCalled();
    expect(useTestRun.getState()).toMatchObject({ running: false, result: { tone: 'error', text: '测试太频繁' } });
  });

  it('still confirms a push the member tapped when the connection dropped while away', async () => {
    api.test.mockImplementation(() => answerAfter(5000, new Error('网络连接失败')));
    native.untilAppActive.mockImplementation(async () => {
      noteTestArrival('tap');
    });
    await finish(runNativeTest(zh));
    expect(useTestRun.getState().result?.tone).toBe('success');
  });

  it('reports the network error when the connection dropped and nothing arrived', async () => {
    api.test.mockImplementation(() => answerAfter(5000, new Error('网络连接失败')));
    await finish(runNativeTest(zh));
    expect(useTestRun.getState().result).toEqual({ tone: 'error', text: '网络连接失败' });
  });

  it('asks the member to leave when the app could not, with the seconds actually left', async () => {
    native.leaveApp.mockResolvedValueOnce(false);
    let shownWhileAway = '';
    native.untilAppActive.mockImplementationOnce(async () => {
      shownWhileAway = useTestRun.getState().result?.text ?? '';
    });
    await finish(runNativeTest(zh));
    expect(shownWhileAway).toBe('现在锁屏或回到桌面，2 秒后通知栏会出现一条测试通知。');
  });

  it('runs one test at a time and stops listening for arrivals afterwards', async () => {
    const first = runNativeTest(zh);
    const second = runNativeTest(zh);
    await finish(Promise.all([first, second]).then(() => undefined));
    expect(api.test).toHaveBeenCalledTimes(1);
    expect(noteTestArrival('foreground')).toBe(false);
  });
});

describe('runTest', () => {
  it('confirms a browser test once the service worker reports the notice', async () => {
    registration.state = { capability: 'webpush', device: 'on', serverReady: true };
    api.test.mockResolvedValue(sentHere);
    const run = runTest(zh);
    await vi.advanceTimersByTimeAsync(0);
    expect(api.test).toHaveBeenCalledWith();
    expect(useTestRun.getState().result?.text).toBe('已发送到 1 台设备，几秒内会收到。');
    expect(noteTestArrival('web')).toBe(true);
    await finish(run);
    expect(useTestRun.getState().result?.text).toBe('测试通知已在这台设备上显示。如果没有看到弹出，请检查系统的通知设置或勿扰模式。');
  });

  it('keeps the sent text when the worker does not report, and does not watch where nothing is on', async () => {
    registration.state = { capability: 'webpush', device: 'on', serverReady: true };
    api.test.mockResolvedValue(sentHere);
    await finish(runTest(zh));
    expect(useTestRun.getState().result?.text).toBe('已发送到 1 台设备，几秒内会收到。');
    registration.state = { capability: 'unsupported', device: 'off', serverReady: null };
    const run = runTest(zh);
    expect(noteTestArrival('web')).toBe(false);
    await finish(run);
  });
});

describe('clearStaleTestResult', () => {
  it('drops a result from an earlier visit but keeps one that just landed', () => {
    const result = { tone: 'success' as const, text: 'ok' };
    useTestRun.setState({ running: false, result, finishedAt: Date.now() - 1000 });
    clearStaleTestResult();
    expect(useTestRun.getState().result).toBe(result);
    useTestRun.setState({ finishedAt: Date.now() - 60_000 });
    clearStaleTestResult();
    expect(useTestRun.getState().result).toBeNull();
  });
});
