import { describe, expect, it } from 'vitest';
import { canTurnOnHere, nativeTestVerdict, shadeTips, testResultText } from './statusText';

const zh = (text: string) => text;
const none = { sent: 0, failed: 0, devices: 0 };
const sentHere = { sent: 1, failed: 0, devices: 1, thisDevice: 'sent' as const, serviceProblem: false };

describe('testResultText', () => {
  it('sends a member who can turn notifications on here to the button above', () => {
    expect(testResultText(none, 'webpush', true, 'off', zh).text).toBe('还没有开启通知的设备。先在上面开启通知。');
    expect(testResultText(none, 'native', null, 'off', zh).text).toBe('还没有开启通知的设备。先在上面开启通知。');
  });

  it('never points at a button the screen does not show', () => {
    for (const [capability, serverReady] of [
      ['native-unavailable', null],
      ['unsupported', null],
      ['ios-update', true],
      ['webpush', false],
    ] as const) {
      expect(canTurnOnHere(capability, serverReady)).toBe(false);
      expect(testResultText(none, capability, serverReady, 'off', zh).text).toBe('还没有开启通知的设备，这台设备暂时也不能接收通知。');
    }
    expect(testResultText(none, 'ios-install', true, 'off', zh).text).toBe('还没有开启通知的设备。请先按上面的步骤添加到主屏幕。');
  });

  it('reports what happened once a device exists', () => {
    expect(testResultText({ sent: 0, failed: 1, devices: 1 }, 'native-unavailable', null, 'off', zh).tone).toBe('error');
    expect(testResultText({ sent: 2, failed: 0, devices: 2 }, 'native-unavailable', null, 'off', zh).text).toBe('已发送到 2 台设备，几秒内会收到。');
    expect(testResultText({ sent: 1, failed: 1, devices: 2 }, 'native-unavailable', null, 'off', zh).text).toBe('已发送到 1 台设备，另有 1 台被推送服务拒绝。');
  });

  it('does not tell a member whose screen says on to turn notifications on', () => {
    const lost = { ...none, thisDevice: 'none' as const, serviceProblem: false };
    expect(testResultText(lost, 'webpush', true, 'on', zh).text).toBe('服务器上没有这台设备的登记，已为它重新登记。请再发一次测试。');
    const gone = { sent: 0, failed: 1, devices: 1, thisDevice: 'gone' as const, serviceProblem: false };
    expect(testResultText(gone, 'webpush', true, 'on', zh).text).toBe('这台设备的推送地址已经失效，已为它重新登记。请再发一次测试。');
  });

  it('does not blame the push service for devices the server could not try, nor this device for others', () => {
    const partly = { sent: 1, failed: 1, devices: 2, thisDevice: 'sent' as const, serviceProblem: true };
    expect(testResultText(partly, 'webpush', true, 'on', zh).text).toBe('已发送到 1 台设备，另有 1 台因通知服务的问题没有发出。');
    expect(testResultText({ sent: 0, failed: 1, devices: 1 }, 'native-unavailable', null, 'off', zh).text).toBe('没有设备收到。请在你其他开启了通知的设备上关闭通知后重新开启。');
  });

  it('puts a server-side failure on the server, not the device', () => {
    const down = { sent: 0, failed: 2, devices: 2, thisDevice: 'unavailable' as const, serviceProblem: true };
    expect(testResultText(down, 'webpush', true, 'on', zh)).toEqual({ tone: 'error', text: '通知服务暂时出了问题，不是你设备的问题。请稍后再试。' });
    expect(testResultText({ ...down, thisDevice: 'none' }, 'native-unavailable', null, 'off', zh).text).toBe('通知服务暂时出了问题，不是你设备的问题。请稍后再试。');
  });
});

describe('nativeTestVerdict', () => {
  it('confirms the shade when the member tapped the notice or it is still there', () => {
    expect(nativeTestVerdict(sentHere, 'tap', null, zh)).toEqual({ tone: 'success', text: '通知正常：测试通知出现在了通知栏，点开后回到了这里。' });
    expect(nativeTestVerdict({ ...sentHere, sent: 3, devices: 3 }, 'shade', null, zh).text).toBe('通知正常：测试通知已经出现在通知栏里。另外 2 台设备也已发送。');
  });

  it('explains a push that landed while the app was open', () => {
    expect(nativeTestVerdict(sentHere, 'foreground', null, zh).tone).toBe('info');
  });

  it('lists what to check when the push went out but the shade showed nothing, starting with a channel turned off', () => {
    const verdict = nativeTestVerdict(sentHere, null, { messages: 'off', events: null }, zh);
    expect(verdict.tone).toBe('error');
    expect(verdict.tips?.[0]).toContain('「消息」类通知被关闭了');
    expect(verdict.tips?.length).toBe(4);
  });

  it('answers registration and server problems before anything the app saw', () => {
    expect(nativeTestVerdict({ ...sentHere, sent: 0, thisDevice: 'gone' }, null, null, zh).text).toBe('这台设备的推送地址已经失效，已为它重新登记。请再发一次测试。');
    expect(nativeTestVerdict({ ...sentHere, sent: 0, thisDevice: 'unavailable', serviceProblem: true }, null, null, zh).tone).toBe('error');
    expect(nativeTestVerdict({ sent: 0, failed: 1, devices: 1 }, null, null, zh).text).toBe('没有设备收到。可以在上面关闭通知后重新开启。');
  });
});

describe('shadeTips', () => {
  it('names a silent channel and always covers the system switches, Do Not Disturb and phone makers’ limits', () => {
    const tips = shadeTips({ messages: 'quiet', events: null }, zh);
    expect(tips[0]).toContain('静默');
    expect(shadeTips(null, zh)).toHaveLength(3);
  });
});
