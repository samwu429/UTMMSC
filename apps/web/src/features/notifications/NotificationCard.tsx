import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTr } from '../../shared/i18n/locale';
import { toast } from '../../shared/ui/toast';
import { notificationCardVariant } from './card';
import { enableNotifications, useNotificationStore } from './notifications';
import { dismissCard, isCardDismissed } from './storage';

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-brand-700" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5Z" />
      <path d="M10 20.5a2 2 0 0 0 4 0" />
    </svg>
  );
}

/**
 * One-line prompt on the chat list. 开启 asks for permission straight from the tap; closing it hides it for
 * good on this device, and Settings → Notifications stays available.
 * 聊天列表上的一行提示。「开启」直接在点击中请求权限；关闭后在这台设备上不再显示，「设置 → 通知」仍然可用。
 */
export function NotificationCard() {
  const tr = useTr();
  const navigate = useNavigate();
  const capability = useNotificationStore((s) => s.capability);
  const device = useNotificationStore((s) => s.device);
  const serverReady = useNotificationStore((s) => s.serverReady);
  const busy = useNotificationStore((s) => s.busy);
  const [dismissed, setDismissed] = useState(isCardDismissed);
  const variant = notificationCardVariant({ capability, device, serverReady, dismissed });
  if (!variant) return null;

  function close() {
    dismissCard();
    setDismissed(true);
  }

  function turnOn() {
    void enableNotifications().then((outcome) => {
      if (outcome === 'on') toast(tr('通知已开启', 'Notifications are on'));
      else if (outcome === 'denied') toast(tr('通知被拦截了，可以在「我的 → 设置 → 通知」里查看怎么打开', 'Notifications were blocked. See Me → Settings → Notifications for how to allow them.'), { ms: 3000 });
      else if (outcome === 'failed') toast(useNotificationStore.getState().error ?? tr('没能开启通知，请稍后再试', 'Notifications could not be turned on. Try again later.'), { ms: 2500 });
    });
  }

  return (
    <div className="-mx-4 flex min-h-12 items-center gap-3 border-b-[0.5px] border-wx-line bg-white py-1.5 pl-4 pr-1">
      <BellIcon />
      <p className="min-w-0 flex-1 text-[14px] leading-snug text-wx-ink">
        {variant === 'enable' ? tr('开启通知，不错过消息和活动', 'Turn on notifications for messages and events') : tr('添加到主屏幕后可收到通知', 'Add to Home Screen to get notifications')}
      </p>
      {variant === 'enable' ? (
        <button type="button" disabled={busy} onClick={turnOn} className="shrink-0 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-900 disabled:bg-stone-300">
          {tr('开启', 'Turn on')}
        </button>
      ) : (
        <button type="button" onClick={() => navigate('/settings?tab=settings&screen=notifications')} className="shrink-0 rounded-lg bg-brand-800 px-3 py-1.5 text-sm font-medium text-white active:bg-brand-900">
          {tr('怎么做', 'How')}
        </button>
      )}
      <button type="button" onClick={close} aria-label={tr('关闭', 'Close')} className="flex h-11 w-11 shrink-0 items-center justify-center text-stone-400 active:text-stone-600">
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
