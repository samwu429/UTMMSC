import type { DeviceState, PushCapability } from './capability';

/** The one-line prompt on the chat list: offer to turn notifications on, or explain home-screen install on iPhone. */
/** 聊天列表上的一行提示：提议开启通知，或在 iPhone 上说明要先添加到主屏幕。 */
export type CardVariant = 'enable' | 'install';

export interface CardInput {
  capability: PushCapability | null;
  device: DeviceState;
  /** Whether the server can send Web Push; null until known. */
  /** 服务器能否发送 Web Push；未知时为 null。 */
  serverReady: boolean | null;
  dismissed: boolean;
}

/**
 * The card stays away until everything is known, after it was closed, when notifications are on or
 * blocked, and in browsers that cannot get them. Browsers only see it once the server can send Web Push,
 * so nobody grants a permission that leads nowhere.
 * 在状态未知、已关闭过、通知已开启或被拦截，以及浏览器无法接收通知时都不显示。浏览器只在服务器能发送 Web Push 后才显示，免得用户授权后却收不到。
 */
export function notificationCardVariant(input: CardInput): CardVariant | null {
  if (input.dismissed || input.capability === null) return null;
  if (input.capability === 'native') return input.device === 'off' ? 'enable' : null;
  if (input.serverReady !== true) return null;
  if (input.capability === 'webpush') return input.device === 'off' ? 'enable' : null;
  if (input.capability === 'ios-install') return 'install';
  return null;
}
