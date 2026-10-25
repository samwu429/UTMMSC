import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: true, plugins: new Set<string>(['PushNotifications']) }));
// Like Capacitor's plugin proxy, which answers every property: calling then() throws, so the code must
// never resolve a promise with the plugin itself.
// 与 Capacitor 的插件代理一样会响应所有属性：调用 then() 会抛错，因此代码绝不能用插件本身去完成 Promise。
const push = vi.hoisted(() => ({
  register: vi.fn<() => Promise<void>>(),
  createChannel: vi.fn<(channel: { id: string; name: string; description?: string; importance?: number; vibration?: boolean }) => Promise<void>>(),
  listChannels: vi.fn<() => Promise<{ channels: { id: string; importance: number }[] }>>(),
  getDeliveredNotifications: vi.fn<() => Promise<{ notifications: { id: string; tag?: string }[] }>>(),
  then: () => {
    throw new Error('"PushNotifications.then()" is not implemented on android');
  },
}));

/** The App plugin: one foreground flag, the state listeners, and minimizeApp moving to the background. */
/** App 插件：一个是否在前台的标记、状态监听者，以及把 App 移到后台的 minimizeApp。 */
const app = vi.hoisted(() => {
  const state = { active: true, canLeave: true, listeners: new Set<(change: { isActive: boolean }) => void>() };
  const setActive = (isActive: boolean) => {
    state.active = isActive;
    for (const listener of [...state.listeners]) listener({ isActive });
  };
  const App = {
    addListener: async (_event: string, listener: (change: { isActive: boolean }) => void) => {
      state.listeners.add(listener);
      return { remove: async () => void state.listeners.delete(listener) };
    },
    getState: async () => ({ isActive: state.active }),
    minimizeApp: async () => {
      if (state.canLeave) setActive(false);
    },
  };
  return { state, setActive, App };
});
vi.mock('@capacitor/app', () => ({ App: app.App }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.platform,
    isPluginAvailable: (name: string) => native.plugins.has(name),
  },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('./api', () => ({ notificationsApi: {} }));
vi.mock('../../shared/i18n/locale', () => ({ tr: (zh: string) => zh }));

const { channelIssue, ensureNativeChannels, hasNativeNotification, isPushUnavailableError, leaveApp, nativeChannelIssues, nativePushReady, untilAppActive } = await import('./nativePush');

/** How Capacitor rejects call.unavailable() from the app's push plugin. */
/** Capacitor 对 App 推送插件 call.unavailable() 的拒绝形式。 */
function unavailable(): Error {
  return Object.assign(new Error('Push notifications are not available in this build: Firebase is not configured.'), { code: 'UNAVAILABLE' });
}

beforeEach(() => {
  native.platform = true;
  native.plugins = new Set(['PushNotifications', 'App']);
  push.register.mockReset();
  push.createChannel.mockReset();
  push.createChannel.mockResolvedValue(undefined);
  push.listChannels.mockReset();
  push.getDeliveredNotifications.mockReset();
  app.state.active = true;
  app.state.canLeave = true;
  app.state.listeners.clear();
});

describe('nativePushReady', () => {
  it('is ready when the app has Firebase: register() answers at once', async () => {
    push.register.mockResolvedValue(undefined);
    expect(await nativePushReady()).toBe(true);
    expect(push.register).toHaveBeenCalledTimes(1);
  });

  it('is not ready in a build without google-services.json', async () => {
    push.register.mockRejectedValue(unavailable());
    expect(await nativePushReady()).toBe(false);
  });

  it('leaves other refusals to registration, which reports them as failed', async () => {
    push.register.mockRejectedValue(new Error('SERVICE_NOT_AVAILABLE'));
    expect(await nativePushReady()).toBe(true);
  });

  it('is not ready without the push plugin or outside the app, and then never registers', async () => {
    native.plugins = new Set();
    expect(await nativePushReady()).toBe(false);
    native.platform = false;
    native.plugins = new Set(['PushNotifications']);
    expect(await nativePushReady()).toBe(false);
    expect(push.register).not.toHaveBeenCalled();
  });
});

describe('isPushUnavailableError', () => {
  it('recognises only the UNAVAILABLE code', () => {
    expect(isPushUnavailableError(unavailable())).toBe(true);
    expect(isPushUnavailableError(new Error('UNAVAILABLE'))).toBe(false);
    expect(isPushUnavailableError(null)).toBe(false);
  });
});

describe('channel settings', () => {
  it('reads Android importance: 0 is off, 1 and 2 are silent, 3 and up alert', () => {
    expect(channelIssue(0)).toBe('off');
    expect(channelIssue(2)).toBe('quiet');
    expect(channelIssue(3)).toBeNull();
    expect(channelIssue(5)).toBeNull();
    expect(channelIssue(undefined)).toBeNull();
  });

  it('reports the messages, events, moments and timetable channels, and nothing where Android has no channels', async () => {
    push.listChannels.mockResolvedValue({
      channels: [
        { id: 'messages', importance: 0 },
        { id: 'events', importance: 4 },
        { id: 'moments', importance: 2 },
        { id: 'timetable', importance: 0 },
        { id: 'other', importance: 1 },
      ],
    });
    expect(await nativeChannelIssues()).toEqual({ messages: 'off', events: null, moments: 'quiet', timetable: 'off' });
    push.listChannels.mockResolvedValue({ channels: [{ id: 'timetable', importance: 1 }] });
    expect((await nativeChannelIssues())?.timetable).toBe('quiet');
    push.listChannels.mockRejectedValue(new Error('not available on Android 7'));
    expect(await nativeChannelIssues()).toBeNull();
  });

  it('says nothing about the moments and timetable channels before the web has created them', async () => {
    push.listChannels.mockResolvedValue({ channels: [{ id: 'messages', importance: 5 }, { id: 'events', importance: 4 }] });
    expect(await nativeChannelIssues()).toEqual({ messages: null, events: null, moments: null, timetable: null });
  });

  it('creates moments, at a level that sounds without a pop-up, and timetable, which pops up like events, once', async () => {
    await ensureNativeChannels();
    expect(push.createChannel.mock.calls.map(([channel]) => [channel.id, channel.importance])).toEqual([
      ['messages', 5],
      ['events', 4],
      ['moments', 3],
      ['timetable', 4],
    ]);
    expect(push.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'moments', name: '好友动态', vibration: true }));
    expect(push.createChannel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'timetable', name: '课表提醒', description: '上课前和作业截止前提醒，时间在课表里设置', vibration: true }),
    );
    expect(channelIssue(3)).toBeNull();
    expect(channelIssue(4)).toBeNull();
    await ensureNativeChannels();
    expect(push.createChannel).toHaveBeenCalledTimes(4);
  });
});

describe('hasNativeNotification', () => {
  it('looks for the tag in the shade', async () => {
    push.getDeliveredNotifications.mockResolvedValue({ notifications: [{ id: '1', tag: 'channel:ch_all' }, { id: '2', tag: 'test' }] });
    expect(await hasNativeNotification('test')).toBe(true);
    expect(await hasNativeNotification('event:e')).toBe(false);
  });
});

describe('leaving and coming back', () => {
  it('reports leaving once the app is in the background', async () => {
    expect(await leaveApp()).toBe(true);
    expect(app.state.active).toBe(false);
  });

  it('gives up when the app stays in the foreground, and outside the app', async () => {
    app.state.canLeave = false;
    expect(await leaveApp(20)).toBe(false);
    native.platform = false;
    expect(await leaveApp(20)).toBe(false);
  });

  it('waits for the app to be active again, and not at all when it already is', async () => {
    await untilAppActive();
    app.state.active = false;
    let back = false;
    const waiting = untilAppActive().then(() => {
      back = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(back).toBe(false);
    app.setActive(true);
    await waiting;
    expect(back).toBe(true);
    expect(app.state.listeners.size).toBe(0);
  });
});
