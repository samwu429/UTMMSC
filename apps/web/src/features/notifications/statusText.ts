import type { TestNotificationResponse } from '@utmmsc/shared';
import type { DeviceState, PushCapability } from './capability';

type Tr = (zh: string, en: string) => string;

/** One-line status of this device, for the settings row and the notifications screen. */
/** 这台设备的一行状态，用于设置列表和通知页面。 */
export function deviceStatusText(capability: PushCapability | null, device: DeviceState, serverReady: boolean | null, tr: Tr): string {
  if (capability === null || device === 'checking') return tr('检查中…', 'Checking…');
  if (capability === 'native-unavailable') return tr('此版本暂不支持通知', 'Not supported in this version');
  if (capability === 'ios-install') return tr('iPhone 请先添加到主屏幕', 'Add to Home Screen first');
  if (capability === 'ios-update') return tr('需要更新 iOS', 'Update iOS first');
  if (capability === 'unsupported') return tr('浏览器不支持', 'Not supported by this browser');
  if (device === 'on') return tr('已开启', 'On');
  if (device === 'denied') return tr('已被拦截', 'Blocked');
  if (device === 'failed') return tr('无法开启', 'Unavailable');
  if (capability === 'webpush' && serverReady === false) return tr('通知服务尚未开通', 'Not available yet');
  return tr('未开启', 'Off');
}

/** Whether the notifications screen offers a way to turn notifications on for this device. */
/** 通知页面是否为这台设备提供开启通知的方式。 */
export function canTurnOnHere(capability: PushCapability | null, serverReady: boolean | null): boolean {
  return capability === 'native' || (capability === 'webpush' && serverReady !== false);
}

export interface TestResultText {
  tone: 'success' | 'error' | 'info';
  text: string;
}

/**
 * What the test button's result says. With no device on, the advice matches what this device can do,
 * so nobody is sent to a button the screen does not show.
 * 测试按钮的结果说明。没有开启通知的设备时，建议与这台设备的能力一致，不会让人去找页面上没有的按钮。
 */
export function testResultText(result: TestNotificationResponse, capability: PushCapability | null, serverReady: boolean | null, tr: Tr): TestResultText {
  if (result.devices === 0) {
    if (canTurnOnHere(capability, serverReady)) return { tone: 'info', text: tr('还没有开启通知的设备。先在上面开启通知。', 'No device has notifications on yet. Turn them on above first.') };
    if (capability === 'ios-install') {
      return { tone: 'info', text: tr('还没有开启通知的设备。请先按上面的步骤添加到主屏幕。', 'No device has notifications on yet. Add UTMMSC to the Home Screen first, as shown above.') };
    }
    return {
      tone: 'info',
      text: tr('还没有开启通知的设备，这台设备暂时也不能接收通知。', 'No device has notifications on yet, and this device cannot receive them for now.'),
    };
  }
  if (result.sent === 0) return { tone: 'error', text: tr('没有设备收到。可以在这台设备上关闭通知后重新开启。', 'No device accepted it. Try turning notifications off and on again on this device.') };
  if (result.failed > 0) {
    return { tone: 'success', text: tr(`已发送到 ${result.sent} 台设备，${result.failed} 台没有收到。`, `Sent to ${result.sent} of ${result.devices} devices.`) };
  }
  return { tone: 'success', text: tr(`已发送到 ${result.sent} 台设备，几秒内会收到。`, result.sent === 1 ? 'Sent to 1 device. It should arrive in a few seconds.' : `Sent to ${result.sent} devices. They should arrive in a few seconds.`) };
}
