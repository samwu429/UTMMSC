import { registerSW } from 'virtual:pwa-register';

/** Service worker updates apply on the next load; no prompt interrupts a chat session. */
/** Service worker 更新在下次加载时生效；不弹窗打断聊天。 */
export function registerPwa(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({ immediate: true });
}
