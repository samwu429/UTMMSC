import { describe, expect, it } from 'vitest';
import { canTurnOnHere, testResultText } from './statusText';

const zh = (text: string) => text;
const none = { sent: 0, failed: 0, devices: 0 };

describe('testResultText', () => {
  it('sends a member who can turn notifications on here to the button above', () => {
    expect(testResultText(none, 'webpush', true, zh).text).toBe('还没有开启通知的设备。先在上面开启通知。');
    expect(testResultText(none, 'native', null, zh).text).toBe('还没有开启通知的设备。先在上面开启通知。');
  });

  it('never points at a button the screen does not show', () => {
    for (const [capability, serverReady] of [
      ['native-unavailable', null],
      ['unsupported', null],
      ['ios-update', true],
      ['webpush', false],
    ] as const) {
      expect(canTurnOnHere(capability, serverReady)).toBe(false);
      expect(testResultText(none, capability, serverReady, zh).text).toBe('还没有开启通知的设备，这台设备暂时也不能接收通知。');
    }
    expect(testResultText(none, 'ios-install', true, zh).text).toBe('还没有开启通知的设备。请先按上面的步骤添加到主屏幕。');
  });

  it('reports what happened once a device exists', () => {
    expect(testResultText({ sent: 0, failed: 1, devices: 1 }, 'native-unavailable', null, zh).tone).toBe('error');
    expect(testResultText({ sent: 2, failed: 0, devices: 2 }, 'native-unavailable', null, zh).text).toBe('已发送到 2 台设备，几秒内会收到。');
  });
});
