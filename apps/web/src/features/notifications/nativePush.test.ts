import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: true, plugins: new Set<string>(['PushNotifications']) }));
const push = vi.hoisted(() => ({ register: vi.fn<() => Promise<void>>() }));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => native.platform,
    isPluginAvailable: (name: string) => native.plugins.has(name),
  },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: push }));
vi.mock('./api', () => ({ notificationsApi: {} }));
vi.mock('../../shared/i18n/locale', () => ({ tr: (zh: string) => zh }));

const { isPushUnavailableError, nativePushReady } = await import('./nativePush');

/** How Capacitor rejects call.unavailable() from the app's push plugin. */
/** Capacitor 对 App 推送插件 call.unavailable() 的拒绝形式。 */
function unavailable(): Error {
  return Object.assign(new Error('Push notifications are not available in this build: Firebase is not configured.'), { code: 'UNAVAILABLE' });
}

beforeEach(() => {
  native.platform = true;
  native.plugins = new Set(['PushNotifications']);
  push.register.mockReset();
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
