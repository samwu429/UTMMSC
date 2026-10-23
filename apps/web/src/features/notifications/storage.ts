import type { RemovePushDeviceBody } from '@utmmsc/shared';

/**
 * Per-device notification memory. Every access is guarded: blocked storage only means the device asks
 * again or forgets the card was closed.
 * 这台设备上的通知记录。每次访问都有保护：存储被禁用时，最多是再问一次，或忘记提示卡片已关闭。
 */
const KEYS = {
  /** The endpoint or token last registered here, removed again at sign-out. */
  /** 最近在此登记的 endpoint 或令牌，退出登录时据此注销。 */
  device: 'utmmsc.push.device',
  /** The member turned notifications off on this device. */
  /** 成员在这台设备上关闭了通知。 */
  off: 'utmmsc.push.off',
  /** The chat-list prompt was closed. */
  /** 聊天列表上的提示已关闭。 */
  card: 'utmmsc.push.card',
  /** The Android app already showed the system permission dialog once. */
  /** 安卓 App 已经弹出过一次系统权限对话框。 */
  asked: 'utmmsc.push.asked',
} as const;

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage is blocked; the value lasts for this visit only.
    // 存储被禁用；该值只在这次访问中有效。
  }
}

export function storedDevice(): RemovePushDeviceBody | null {
  const raw = read(KEYS.device);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.endpoint === 'string' && value.endpoint) return { endpoint: value.endpoint };
    if (typeof value.token === 'string' && value.token) return { token: value.token };
  } catch {
    // Unreadable; treated as nothing registered.
    // 无法读取，视为没有登记。
  }
  return null;
}

export function rememberDevice(device: RemovePushDeviceBody | null): void {
  write(KEYS.device, device ? JSON.stringify(device) : null);
}

export function isTurnedOffHere(): boolean {
  return read(KEYS.off) === '1';
}

export function setTurnedOffHere(off: boolean): void {
  write(KEYS.off, off ? '1' : null);
}

export function isCardDismissed(): boolean {
  return read(KEYS.card) === '1';
}

export function dismissCard(): void {
  write(KEYS.card, '1');
}

export function wasAskedNatively(): boolean {
  return read(KEYS.asked) === '1';
}

export function markAskedNatively(): void {
  write(KEYS.asked, '1');
}
