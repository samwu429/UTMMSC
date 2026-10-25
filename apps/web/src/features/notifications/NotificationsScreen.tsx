import { useEffect, useId, useState, type ReactNode } from 'react';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from '@utmmsc/shared';
import { errorMessage } from '../../shared/api/errors';
import { useTr } from '../../shared/i18n/locale';
import { BackHeader } from '../../shared/ui/BackHeader';
import { Button } from '../../shared/ui/Button';
import { Notice } from '../../shared/ui/Card';
import { useAppUpdate } from '../../shared/native/AppUpdateBanner';
import { ANDROID_APP_URL } from '../../shared/native/platform';
import { Switch } from '../chat/info/Switch';
import { refresh as refreshTimetable } from '../timetable/state/timetableStore';
import { notificationsApi } from './api';
import { openNativeSettings, type ChannelIssue } from './nativePush';
import { disableOnThisDevice, enableNotifications, refreshAfterReturn, refreshNotificationStatus, useNotificationStore } from './notifications';
import { canTurnOnHere, deviceStatusText, type TestResultText } from './statusText';
import { TEST_DELAY_SECONDS, clearStaleTestResult, clearTestResult, runNativeTest, runTest, useTestRun } from './testRun';

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

function ResultNotice({ result }: { result: TestResultText }) {
  return (
    <Notice tone={result.tone}>
      <p>{result.text}</p>
      {result.tips?.length ? (
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          {result.tips.map((tip) => (
            <li key={tip}>{tip}</li>
          ))}
        </ul>
      ) : null}
    </Notice>
  );
}

/** Opens Android's notification settings for UTMMSC, in builds that can. */
/** 在支持的版本中打开安卓里 UTMMSC 的通知设置。 */
function SystemSettingsButton() {
  const tr = useTr();
  const canOpen = useNotificationStore((s) => s.canOpenSettings);
  if (!canOpen) return null;
  return (
    <Button block variant="secondary" onClick={() => void openNativeSettings()}>
      {tr('打开系统通知设置', 'Open notification settings')}
    </Button>
  );
}

/** A channel the member turned off or down in Android settings, said where it can be turned back on. */
/** 成员在安卓设置里关闭或调低的通知渠道，并说明在哪里改回来。 */
function channelWarning(name: { zh: string; en: string }, issue: ChannelIssue | null, tr: (zh: string, en: string) => string): string | null {
  if (issue === 'off') return tr(`「${name.zh}」类通知在系统设置里被关闭了，不会提醒你。请到手机的「设置 → 应用 → UTMMSC → 通知」里打开。`, `${name.en} notifications are off in system settings, so they will not alert you. Turn them on in Settings → Apps → UTMMSC → Notifications.`);
  if (issue === 'quiet') return tr(`「${name.zh}」类通知被设成了静默，到达时没有声音和横幅。可以在「设置 → 应用 → UTMMSC → 通知」里调高。`, `${name.en} notifications are set to silent, with no sound or banner. Raise them in Settings → Apps → UTMMSC → Notifications.`);
  return null;
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
  const { capability, device, serverReady, channels, busy, error } = useNotificationStore();
  const [notice, setNotice] = useState<string | null>(null);
  // An app that cannot receive push is an old build; when a newer one is published, offer it right here.
  // 不能接收推送的 App 是旧版本；有新版本时直接在这里提供更新。
  const update = useAppUpdate();

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
      ? update
        ? tr(`这个版本的 App（${update.currentName}）还不能接收通知。更新到最新版 ${update.latest.versionName} 即可开启。`, `This version of the app (${update.currentName}) cannot receive notifications. Update to ${update.latest.versionName} to turn them on.`)
        : tr('这个版本的 App 还不能接收通知。', 'This version of the app cannot receive notifications yet.')
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
  const channelWarnings =
    capability === 'native' && device === 'on'
      ? [
          channelWarning({ zh: '消息', en: 'Message' }, channels?.messages ?? null, tr),
          channelWarning({ zh: '活动', en: 'Event' }, channels?.events ?? null, tr),
          channelWarning({ zh: '好友动态', en: 'Friend update' }, channels?.moments ?? null, tr),
          channelWarning({ zh: '课表提醒', en: 'Timetable reminder' }, channels?.timetable ?? null, tr),
        ].filter((warning): warning is string => warning !== null)
      : [];

  return (
    <div className="space-y-3 px-4 py-3">
      {message ? <p className="text-[15px] leading-relaxed text-stone-700">{message}</p> : null}
      {device === 'on' ? (
        <p className="text-[15px] leading-relaxed text-stone-700">
          {tr('这台设备会收到新消息、活动、好友动态互动和课表提醒的通知。', 'This device gets new messages, event notices, friend update activity and timetable reminders.')}
        </p>
      ) : null}
      {channelWarnings.map((warning) => (
        <Notice key={warning} tone="error">
          {warning}
        </Notice>
      ))}
      {canEnable && device === 'off' && !message ? (
        <p className="text-[15px] leading-relaxed text-stone-700">
          {tr('开启后，有新消息、活动、好友动态互动和课表提醒时这台设备会收到通知。', 'Turn them on to get new messages, event notices, friend update activity and timetable reminders on this device.')}
        </p>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice && !error ? <Notice tone="success">{notice}</Notice> : null}
      {capability === 'native-unavailable' && update ? (
        <a
          href={ANDROID_APP_URL}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border-t-[3px] border-gold bg-brand-800 px-4 py-2.5 text-[15px] font-medium text-white hover:bg-brand-900"
        >
          {tr(`下载新版 ${update.latest.versionName}`, `Download ${update.latest.versionName}`)}
        </a>
      ) : null}
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
      {capability === 'native' && (device === 'denied' || channelWarnings.length > 0) ? <SystemSettingsButton /> : null}
      {device === 'denied' ? (
        <Button block variant="secondary" onClick={() => void refreshAfterReturn()}>
          {tr('我已允许，重新检查', 'I allowed it. Check again')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Settings → Notifications: this device's status and switch, the member's five switches (shared by all
 * their devices), and a test push.
 * 设置 → 通知：这台设备的状态与开关、成员的五个开关（对所有设备生效），以及测试通知。
 */
export function NotificationsScreen({ onBack }: { onBack: () => void }) {
  const tr = useTr();
  const { capability, device, serverReady } = useNotificationStore();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const testing = useTestRun((s) => s.running);
  const testResult = useTestRun((s) => s.result);
  // The app's test needs this device registered; elsewhere the push goes to the member's other devices.
  // App 内的测试需要这台设备已登记；其他情况下推送发往成员的其他设备。
  const nativeTest = capability === 'native' && device === 'on';

  useEffect(() => {
    clearStaleTestResult();
    return clearTestResult;
  }, []);

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
      // The home card and the timetable read this switch from the timetable answer, which a throttled refresh could
      // leave stale for half a minute; asking now updates them before the member is back.
      // 首页卡片和课表从课表接口的应答中读取这个开关，按频率限制的刷新可能让它过时半分钟；现在就问一次，成员回去前它们就已更新。
      if (key === 'timetable') void refreshTimetable({ force: true }).catch(() => undefined);
    } catch (err) {
      setPrefs(before);
      setPrefsError(errorMessage(err));
    }
  }

  function sendTest() {
    void (nativeTest ? runNativeTest(tr) : runTest(tr));
  }

  const status = deviceStatusText(capability, device, serverReady, tr);
  const testFooter = nativeTest
    ? tr(`点发送后 App 会回到桌面，${TEST_DELAY_SECONDS} 秒后通知栏会出现一条测试通知，和真实通知一样。点开它会回到这里看结果。`, `After you tap send, the app goes to the home screen and a test notice appears in the shade ${TEST_DELAY_SECONDS} seconds later, just like a real one. Tap it to come back here for the result.`)
    : canTurnOnHere(capability, serverReady)
      ? tr('发到你所有开启了通知的设备。', 'Goes to every device where you turned notifications on.')
      : tr('发到你其他开启了通知的设备。', 'Goes to your other devices that have notifications on.');
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
            label={tr('好友动态互动', 'Friend update activity')}
            hint={tr('有人评论、回复你，或管理员处理你的内容时通知', 'When someone comments on or replies to you, or an admin acts on your content')}
            checked={prefs?.moments ?? true}
            disabled={loading}
            onChange={(next) => void change('moments', next)}
          />
          <ToggleRow
            label={tr('课表提醒', 'Timetable reminders')}
            hint={tr('上课前和作业截止前提醒，时间在课表里设置', 'Before classes and deadlines; set the times in your timetable')}
            checked={prefs?.timetable ?? true}
            disabled={loading}
            onChange={(next) => void change('timetable', next)}
          />
          <ToggleRow
            label={tr('通知显示消息内容', 'Show message content')}
            hint={tr('关闭后，通知只显示「你收到一条新消息」「10 分钟后有课」这样的提示，不显示内容', 'When off, notifications only say there is something new')}
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

        <Section label={tr('测试', 'Test')} footer={testFooter}>
          <div className="space-y-3 px-4 py-3">
            <Button block variant="secondary" loading={testing} onClick={sendTest}>
              {tr('发送测试通知', 'Send a test notification')}
            </Button>
            {testResult ? <ResultNotice result={testResult} /> : null}
            {nativeTest && testResult?.tips?.length ? <SystemSettingsButton /> : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
