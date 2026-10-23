import { useEffect, useId, useState, type ReactNode } from 'react';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { useTr } from '../../shared/i18n/locale';
import { BackHeader } from '../../shared/ui/BackHeader';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { Switch } from '../chat/info/Switch';
import { notificationsApi } from './api';
import { disableOnThisDevice, enableNotifications, refreshNotificationStatus, useNotificationStore } from './notifications';
import { canTurnOnHere, deviceStatusText, testResultText, type TestResultText } from './statusText';

function Section({ label, footer, children }: { label: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="-mx-4">
      <p className="px-4 pb-1.5 text-xs text-stone-500">{label}</p>
      <div className="divide-y divide-stone-200 bg-white">{children}</div>
      {footer ? <div className="px-4 pt-1.5 text-xs leading-relaxed text-stone-400">{footer}</div> : null}
    </section>
  );
}

function ToggleRow({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className={`flex min-h-12 items-center gap-3 px-4 py-2 ${disabled ? 'opacity-60' : ''}`}>
      <span className="min-w-0 flex-1">
        <span id={id} className="block text-[16px] text-brand-800">
          {label}
        </span>
        {hint ? <span className="mt-0.5 block text-xs leading-snug text-stone-500">{hint}</span> : null}
      </span>
      <Switch checked={checked} labelledBy={id} onChange={(next) => (disabled ? undefined : onChange(next))} />
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-1.5 text-[15px] leading-relaxed text-stone-700">
      {items.map((item, index) => (
        <li key={item} className="flex gap-2">
          <span className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-800" aria-hidden>
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">{item}</span>
        </li>
      ))}
    </ol>
  );
}

/** What to do on this device, by capability and state. */
/** 按能力与状态，说明这台设备上该怎么做。 */
function DeviceHelp() {
  const tr = useTr();
  const { capability, device, serverReady, busy, error } = useNotificationStore();
  const [notice, setNotice] = useState<string | null>(null);

  async function turnOn() {
    setNotice(null);
    const outcome = await enableNotifications();
    if (outcome === 'on') setNotice(tr('通知已开启', 'Notifications are on'));
  }

  if (capability === null || device === 'checking') return null;

  if (capability === 'ios-install') {
    return (
      <div className="space-y-3 px-4 py-3">
        <p className="text-[15px] leading-relaxed text-stone-700">
          {tr('iPhone 和 iPad 只有从主屏幕打开 UTMMSC 才能收到通知：', 'iPhone and iPad only get notifications when UTMMSC is opened from the Home Screen:')}
        </p>
        <Steps
          items={[
            tr('用 Safari 打开 utmmsc.com/UTMMSC', 'Open utmmsc.com/UTMMSC in Safari'),
            tr('点底部的分享按钮', 'Tap the Share button at the bottom'),
            tr('选「添加到主屏幕」', 'Choose Add to Home Screen'),
            tr('从主屏幕打开 UTMMSC，登录后回到这里开启通知', 'Open UTMMSC from the Home Screen, sign in, and turn on notifications here'),
          ]}
        />
        <p className="text-xs leading-relaxed text-stone-500">{tr('需要 iOS 16.4 或更新版本。', 'Requires iOS 16.4 or later.')}</p>
      </div>
    );
  }

  const message =
    capability === 'native-unavailable'
      ? tr('这个版本的 App 还不能接收通知。', 'This version of the app cannot receive notifications yet.')
      : capability === 'ios-update'
        ? tr('需要 iOS 16.4 或更新版本才能接收通知。可以在「设置 → 通用 → 软件更新」里更新。', 'Notifications need iOS 16.4 or later. Update in Settings → General → Software Update.')
        : capability === 'unsupported'
          ? tr('这个浏览器不能接收通知。可以换用最新版的 Chrome、Edge、Firefox 或 Safari。', 'This browser cannot receive notifications. Try the latest Chrome, Edge, Firefox, or Safari.')
          : device === 'denied'
            ? capability === 'native'
              ? tr('通知被系统关闭了。请在手机的「设置 → 应用 → UTMMSC → 通知」里打开，再回到这里。', 'Notifications are turned off in system settings. Turn them on in Settings → Apps → UTMMSC → Notifications, then come back.')
              : tr('通知被浏览器拦截了。请在浏览器的网站设置里允许 utmmsc.com 发送通知，再回到这里。', 'The browser is blocking notifications. Allow notifications for utmmsc.com in the browser’s site settings, then come back.')
            : device === 'failed'
              ? tr('这台手机暂时无法接收推送，可能缺少 Google Play 服务。', 'This phone cannot receive push right now. Google Play services may be missing.')
              : capability === 'webpush' && serverReady === false && device !== 'on'
                ? tr('通知服务尚未开通，开通后就能在这里开启。', 'Notifications are not set up on the server yet. You can turn them on here once they are.')
                : null;

  const canEnable = (capability === 'webpush' && serverReady !== false && device === 'off') || (capability === 'native' && (device === 'off' || device === 'failed'));

  return (
    <div className="space-y-3 px-4 py-3">
      {message ? <p className="text-[15px] leading-relaxed text-stone-700">{message}</p> : null}
      {device === 'on' ? <p className="text-[15px] leading-relaxed text-stone-700">{tr('这台设备会收到新消息和活动通知。', 'This device gets new messages and event notices.')}</p> : null}
      {canEnable && device === 'off' && !message ? (
        <p className="text-[15px] leading-relaxed text-stone-700">{tr('开启后，有新消息和活动时这台设备会收到通知。', 'Turn them on to get new messages and event notices on this device.')}</p>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice && !error ? <Notice tone="success">{notice}</Notice> : null}
      {canEnable ? (
        <Button block loading={busy} onClick={() => void turnOn()}>
          {device === 'failed' ? tr('重试', 'Try again') : tr('开启通知', 'Turn on notifications')}
        </Button>
      ) : null}
      {device === 'on' ? (
        <Button
          block
          variant="secondary"
          loading={busy}
          onClick={() => {
            setNotice(null);
            void disableOnThisDevice();
          }}
        >
          {tr('在这台设备上关闭', 'Turn off on this device')}
        </Button>
      ) : null}
      {device === 'denied' ? (
        <Button block variant="secondary" onClick={() => void refreshNotificationStatus()}>
          {tr('我已允许，重新检查', 'I allowed it. Check again')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Settings → Notifications: this device's status and switch, the member's three switches (shared by all
 * their devices), and a test push.
 * 设置 → 通知：这台设备的状态与开关、成员的三个开关（对所有设备生效），以及测试通知。
 */
export function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const tr = useTr();
  const { capability, device, serverReady } = useNotificationStore();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResultText | null>(null);

  useEffect(() => {
    void refreshNotificationStatus();
    let cancelled = false;
    notificationsApi
      .prefs()
      .then((res) => {
        if (!cancelled) setPrefs(res.prefs);
      })
      .catch((err) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFS });
        setPrefsError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(key: keyof NotificationPrefs, value: boolean) {
    if (!prefs) return;
    const before = prefs;
    setPrefs({ ...prefs, [key]: value });
    setPrefsError(null);
    try {
      const res = await notificationsApi.updatePrefs({ [key]: value });
      setPrefs(res.prefs);
    } catch (err) {
      setPrefs(before);
      setPrefsError(errorMessage(err));
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(testResultText(await notificationsApi.test(), capability, serverReady, tr));
    } catch (err) {
      setTestResult({ tone: 'error', text: errorMessage(err) });
    } finally {
      setTesting(false);
    }
  }

  const status = deviceStatusText(capability, device, serverReady, tr);
  const loading = prefs === null;

  return (
    <div>
      <BackHeader onBack={onBack} label={tr('设置', 'Settings')} title={tr('通知', 'Notifications')} />
      <div className="mt-2 space-y-5">
        <Section label={tr('这台设备', 'This device')}>
          <div className="flex min-h-12 items-center gap-3 px-4">
            <span className="shrink-0 text-[16px] text-brand-800">{tr('通知', 'Notifications')}</span>
            <span className={`min-w-0 flex-1 truncate text-right text-sm ${device === 'on' ? 'font-medium text-emerald-700' : 'text-stone-500'}`}>{status}</span>
          </div>
          <DeviceHelp />
        </Section>

        <Section
          label={tr('接收哪些通知', 'What you get')}
          footer={
            <>
              <p>{tr('设为「消息免打扰」的聊天，只在有人 @ 你或 @所有人 时通知。', 'Muted chats only notify you when someone @mentions you or everyone.')}</p>
              <p className="mt-1">{tr('这些开关对你登录的所有设备都有效。', 'These switches apply to every device you are signed in on.')}</p>
            </>
          }
        >
          <ToggleRow
            label={tr('新消息通知', 'New messages')}
            checked={prefs?.messages ?? true}
            disabled={loading}
            onChange={(next) => void change('messages', next)}
          />
          <ToggleRow
            label={tr('活动通知', 'Events')}
            hint={tr('活动发布时、当天早上，以及发布人设置的提醒时间', 'When an event is published, on the morning of, and at times the organizer sets')}
            checked={prefs?.events ?? true}
            disabled={loading}
            onChange={(next) => void change('events', next)}
          />
          <ToggleRow
            label={tr('通知显示消息内容', 'Show message content')}
            hint={tr('关闭后，通知只显示「你收到一条新消息」', 'When off, notifications only say you have a new message')}
            checked={prefs?.preview ?? true}
            disabled={loading}
            onChange={(next) => void change('preview', next)}
          />
          {prefsError ? (
            <div className="px-4 py-2">
              <Notice tone="error">{prefsError}</Notice>
            </div>
          ) : null}
        </Section>

        <Section
          label={tr('测试', 'Test')}
          footer={
            canTurnOnHere(capability, serverReady)
              ? tr('发到你所有开启了通知的设备。', 'Goes to every device where you turned notifications on.')
              : tr('发到你其他开启了通知的设备。', 'Goes to your other devices that have notifications on.')
          }
        >
          <div className="space-y-3 px-4 py-3">
            <Button block variant="secondary" loading={testing} onClick={() => void sendTest()}>
              {tr('发送测试通知', 'Send a test notification')}
            </Button>
            {testResult ? <Notice tone={testResult.tone}>{testResult.text}</Notice> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
