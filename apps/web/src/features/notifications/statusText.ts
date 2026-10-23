import type { TestNotificationResponse } from '@utmmsc/shared';
import type { DeviceState, PushCapability } from './capability';
import type { ChannelIssues } from './nativePush';

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
  /** Things to check, shown as a list under the text. */
  /** 需要检查的事项，以列表形式显示在说明下方。 */
  tips?: string[];
}

/**
 * The parts of a test result that concern the device in hand, when it has notifications on: a server-side
 * failure is not blamed on it, and an address the server lost or the push service forgot is renewed by
 * the caller, so the text asks for another try. Null when the generic text applies.
 * 测试结果中与手上这台设备有关的部分（设备已开启通知时）：服务器一侧的失败不归咎于设备；服务器丢失或推送服务已不认识的地址
 * 会由调用方重新登记，因此说明里请成员再试一次。适用通用说明时返回 null。
 */
function thisDeviceText(result: TestNotificationResponse, tr: Tr): TestResultText | null {
  switch (result.thisDevice) {
    case 'unavailable':
      return { tone: 'error', text: tr('通知服务暂时出了问题，不是你设备的问题。请稍后再试。', 'The notification service has a problem right now. It is not your device. Try again later.') };
    case 'gone':
      return { tone: 'info', text: tr('这台设备的推送地址已经失效，已为它重新登记。请再发一次测试。', 'This device’s push address had expired, so it was registered again. Send another test.') };
    case 'none':
      return { tone: 'info', text: tr('服务器上没有这台设备的登记，已为它重新登记。请再发一次测试。', 'The server had no record of this device, so it was registered again. Send another test.') };
    case 'failed':
      return { tone: 'error', text: tr('推送服务拒绝了这台设备。可以在上面关闭通知后重新开启。', 'The push service refused this device. Turn notifications off above, then on again.') };
    default:
      return null;
  }
}

/**
 * What the test button's result says. With no device on, the advice matches what this device can do,
 * so nobody is sent to a button the screen does not show.
 * 测试按钮的结果说明。没有开启通知的设备时，建议与这台设备的能力一致，不会让人去找页面上没有的按钮。
 */
export function testResultText(result: TestNotificationResponse, capability: PushCapability | null, serverReady: boolean | null, device: DeviceState, tr: Tr): TestResultText {
  if (device === 'on') {
    const here = thisDeviceText(result, tr);
    if (here) return here;
  }
  if (result.serviceProblem && result.sent === 0) {
    return { tone: 'error', text: tr('通知服务暂时出了问题，不是你设备的问题。请稍后再试。', 'The notification service has a problem right now. It is not your device. Try again later.') };
  }
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
  if (result.sent === 0) {
    return device === 'on'
      ? { tone: 'error', text: tr('没有设备收到。可以在这台设备上关闭通知后重新开启。', 'No device accepted it. Try turning notifications off and on again on this device.') }
      : { tone: 'error', text: tr('没有设备收到。请在你其他开启了通知的设备上关闭通知后重新开启。', 'No device accepted it. Turn notifications off and on again on your other devices.') };
  }
  if (result.failed > 0) {
    return result.serviceProblem
      ? { tone: 'success', text: tr(`已发送到 ${result.sent} 台设备，另有 ${result.failed} 台因通知服务的问题没有发出。`, `Sent to ${result.sent} of ${result.devices} devices; the rest could not be sent because of a problem with the notification service.`) }
      : { tone: 'success', text: tr(`已发送到 ${result.sent} 台设备，另有 ${result.failed} 台被推送服务拒绝。`, `Sent to ${result.sent} of ${result.devices} devices; the push service refused the rest.`) };
  }
  return { tone: 'success', text: tr(`已发送到 ${result.sent} 台设备，几秒内会收到。`, result.sent === 1 ? 'Sent to 1 device. It should arrive in a few seconds.' : `Sent to ${result.sent} devices. They should arrive in a few seconds.`) };
}

/** Shown while a lost or expired registration is being renewed after a test. */
/** 测试之后正在更新丢失或失效的登记时显示。 */
export function renewingText(tr: Tr): TestResultText {
  return { tone: 'info', text: tr('这台设备的推送登记需要更新，正在重新登记…', 'This device’s push registration needs renewing. Registering it again…') };
}

/** The renewal after a test did not work. */
/** 测试之后的重新登记没有成功。 */
export function renewFailedText(tr: Tr): TestResultText {
  return { tone: 'error', text: tr('没能为这台设备重新登记。请在上面关闭通知后重新开启。', 'This device could not be registered again. Turn notifications off above, then on again.') };
}

/** How the app learned that its test push arrived, or null when it saw no sign of it. */
/** App 如何得知测试推送已到达；没有看到任何迹象时为 null。 */
export type NativeTestSighting = 'tap' | 'shade' | 'foreground' | null;

/** System settings to check when a push reached the phone but the shade showed nothing. */
/** 推送已到手机但通知栏没有显示时，需要检查的系统设置。 */
export function shadeTips(channels: ChannelIssues | null, tr: Tr): string[] {
  const tips: string[] = [];
  if (channels?.messages === 'off') tips.push(tr('「消息」类通知被关闭了：在手机的「设置 → 应用 → UTMMSC → 通知」里打开「消息」。', 'The Messages category is off: turn it on in Settings → Apps → UTMMSC → Notifications.'));
  else if (channels?.messages === 'quiet') tips.push(tr('「消息」类通知被设成了静默：在「设置 → 应用 → UTMMSC → 通知 → 消息」里改为有声音和横幅。', 'The Messages category is silent: allow sound and banners in Settings → Apps → UTMMSC → Notifications → Messages.'));
  tips.push(
    tr('在「设置 → 应用 → UTMMSC → 通知」里确认允许通知，并打开横幅（悬浮通知）和锁屏通知。', 'In Settings → Apps → UTMMSC → Notifications, make sure notifications are allowed, with banners (pop-up) and the lock screen on.'),
    tr('关掉勿扰模式或专注模式。', 'Turn off Do Not Disturb or Focus mode.'),
    tr('小米、华为、荣耀、OPPO、vivo 等手机：在应用设置里允许 UTMMSC「自启动」和「后台运行」，耗电设为「不限制」。', 'On Xiaomi, Huawei, Honor, OPPO, vivo and similar phones, allow UTMMSC to auto-start and run in the background, and set its battery use to Unrestricted.'),
  );
  return tips;
}

/**
 * The verdict of the app's test, which leaves the app before the push lands so it can reach the shade.
 * Server-side and registration answers come first; then what the app saw on its return.
 * App 内测试的结论：测试会在推送到达之前离开 App，推送才能进入通知栏。先看服务器和登记方面的结果，再看回到 App 时看到了什么。
 */
export function nativeTestVerdict(result: TestNotificationResponse, sighting: NativeTestSighting, channels: ChannelIssues | null, tr: Tr): TestResultText {
  const here = thisDeviceText(result, tr);
  if (here) return here;
  if (result.sent === 0) return { tone: 'error', text: tr('没有设备收到。可以在上面关闭通知后重新开启。', 'No device accepted it. Turn notifications off above, then on again.') };
  const alsoOthers =
    result.sent > 1 ? tr(`另外 ${result.sent - 1} 台设备也已发送。`, result.sent === 2 ? 'It also went to 1 other device.' : `It also went to ${result.sent - 1} other devices.`) : '';
  if (sighting === 'tap') return { tone: 'success', text: tr(`通知正常：测试通知出现在了通知栏，点开后回到了这里。${alsoOthers}`, `Notifications work: the test showed in the notification shade and brought you back here. ${alsoOthers}`.trim()) };
  if (sighting === 'shade') return { tone: 'success', text: tr(`通知正常：测试通知已经出现在通知栏里。${alsoOthers}`, `Notifications work: the test reached the notification shade. ${alsoOthers}`.trim()) };
  if (sighting === 'foreground') {
    return {
      tone: 'info',
      text: tr('测试通知已到达这台手机，但当时 App 在前台，安卓不会把它放进通知栏。再试一次，等通知出现后再回到 App。', 'The test reached this phone, but the app was open, and Android keeps pushes out of the shade then. Try again and wait for the notice before coming back.'),
    };
  }
  return {
    tone: 'error',
    text: tr('推送已发到这台手机，但通知栏里没有找到它。如果你刚才看到了通知，就说明一切正常；如果没看到，请检查：', 'The push was sent to this phone, but it is not in the notification shade. If you saw it, everything works. If not, check:'),
    tips: shadeTips(channels, tr),
  };
}
