/**
 * Owner: T3, timetable web core. 课表设置 (⋯ → 设置): 上课提醒 with its lead and 下次提醒, what this device can
 * receive, the master switch in 设置 → 通知, default reminders for new assignments, the weekend columns, and the
 * links to terms, holidays, import, export and 清空课表. Turning class reminders on also turns on notifications for
 * this device in the same tap when it has none, since the browser asks only from a tap.
 * 维护者：T3，课表网页核心。「课表设置」（⋯ → 设置）：上课提醒及提前时间和下次提醒、这台设备能否接收、「设置 → 通知」中的总开关、
 * 新作业的默认提醒、周末列，以及学期、假日、导入、导出和清空课表的入口。开启上课提醒时，如果这台设备还没有开启通知，会在同一次点按中一并开启，
 * 因为浏览器只在点按时才会询问。
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ASSIGNMENT_OFFSETS, CLASS_LEADS, nextClassReminder, type TimetableLocale } from '@utmmsc/shared';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { enableNotifications, refreshNotificationStatus, useNotificationStore } from '../../notifications/notifications';
import { canTurnOnHere, deviceStatusText } from '../../notifications/statusText';
import { useTorontoNow } from '../model/useTorontoNow';
import { clearAll, updateSettings, type TimetableView } from '../state/timetableStore';
import { offsetLabel, toggleOffset } from '../sheets/assignmentDraft';
import { ActionRow, Caption, Group, SwitchRow } from '../ui/Cells';
import { Chip, ChipRow } from '../ui/Chip';
import { FullSheet } from '../ui/Sheet';
import { nextReminderText } from './reminderText';

export const NOTIFICATION_SETTINGS_PATH = '/settings?tab=settings&screen=notifications';

export interface SettingsSheetProps {
  view: TimetableView;
  locale: TimetableLocale;
  onClose: () => void;
  onOpenTerms: () => void;
  onOpenHolidays: () => void;
  onImport: () => void;
  onExport: () => void;
}

export function SettingsSheet({ view, locale, onClose, onOpenTerms, onOpenHolidays, onImport, onExport }: SettingsSheetProps) {
  const en = locale === 'en';
  const tr = (zh: string, enText: string) => (en ? enText : zh);
  const confirm = useConfirm();
  const now = useTorontoNow();
  const capability = useNotificationStore((s) => s.capability);
  const device = useNotificationStore((s) => s.device);
  const serverReady = useNotificationStore((s) => s.serverReady);
  const busy = useNotificationStore((s) => s.busy);
  const { settings, remindersAllowed } = view;

  useEffect(() => {
    void refreshNotificationStatus();
  }, []);

  const next = nextClassReminder(view, settings, remindersAllowed, now);
  const deviceOn = device === 'on';
  const canEnable = canTurnOnHere(capability, serverReady);
  const checking = capability === null || device === 'checking';
  const holidayCount = view.skips.filter((skip) => skip.meetingId === null).length;

  function setClassReminders(on: boolean) {
    updateSettings({ classReminders: on });
    // The browser asks for permission only straight from a tap, so this runs before anything is awaited.
    // 浏览器只在点按中直接请求权限，因此这一步要在等待任何操作之前运行。
    if (on && !deviceOn && canEnable && !busy) {
      void enableNotifications().then((outcome) => {
        if (outcome === 'denied') toast(tr('通知已被拦截，请在系统设置中允许', 'Notifications are blocked. Allow them in system settings.'));
      });
    }
  }

  async function clear() {
    const ok = await confirm({
      title: tr('清空课表？', 'Clear the timetable?'),
      body: tr('所有学期、课程、假日和作业都会删除，设置会保留。', 'Every term, course, holiday and assignment is deleted. Settings are kept.'),
      confirmLabel: tr('清空', 'Clear'),
      danger: true,
    });
    if (!ok) return;
    void clearAll();
    onClose();
  }

  let reminderDetail: string;
  if (!remindersAllowed) reminderDetail = tr('已在「设置 → 通知」关闭课表提醒', 'Timetable reminders are off in Settings → Notifications');
  else if (!settings.classReminders) reminderDetail = tr('上课前推送提醒，可以开启', 'A push before each class; off for now');
  else if (next) reminderDetail = nextReminderText(next, now, locale);
  else reminderDetail = tr('暂时没有要提醒的课', 'No class to remind about yet');

  return (
    <FullSheet title={tr('课表设置', 'Timetable settings')} onClose={onClose} closeLabel={tr('完成', 'Done')}>
      <Group caption={tr('上课提醒', 'Class reminders')}>
        <SwitchRow label={tr('上课提醒', 'Class reminders')} detail={reminderDetail} checked={settings.classReminders} onChange={setClassReminders} />
        {settings.classReminders ? (
          <div className="px-3 py-1">
            <ChipRow>
              {CLASS_LEADS.map((lead) => (
                <Chip key={lead} selected={settings.classLeadMin === lead} onClick={() => updateSettings({ classLeadMin: lead })}>
                  {tr(`提前 ${lead} 分钟`, `${lead} min before`)}
                </Chip>
              ))}
            </ChipRow>
          </div>
        ) : null}
      </Group>

      {!remindersAllowed ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-[14px] leading-5 text-amber-900">
          <span className="min-w-0 flex-1">{tr('已在「设置 → 通知」关闭课表提醒', 'Timetable reminders are off in Settings → Notifications')}</span>
          <Link to={NOTIFICATION_SETTINGS_PATH} className="shrink-0 font-medium text-wx-link">
            {tr('去设置', 'Open')}
          </Link>
        </div>
      ) : !checking && !deviceOn ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg bg-stone-100 px-3 py-2.5 text-[14px] leading-5 text-stone-700">
          <span className="min-w-0 flex-1">
            {tr('这台设备的通知：', 'Notifications on this device: ')}
            {deviceStatusText(capability, device, serverReady, tr)}
          </span>
          {canEnable && device !== 'denied' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void enableNotifications()}
              className="shrink-0 rounded-md bg-brand-800 px-3 py-1.5 text-[13px] font-medium text-white active:bg-brand-900 disabled:bg-stone-300"
            >
              {tr('开启通知', 'Turn on')}
            </button>
          ) : (
            <Link to={NOTIFICATION_SETTINGS_PATH} className="shrink-0 font-medium text-wx-link">
              {tr('查看', 'Details')}
            </Link>
          )}
        </div>
      ) : null}

      <Caption>{tr('作业默认提醒（用于新作业）', 'Default reminders (new assignments)')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          {ASSIGNMENT_OFFSETS.map((token) => (
            <Chip
              key={token}
              selected={settings.assignmentOffsets.includes(token)}
              onClick={() => {
                const result = toggleOffset(settings.assignmentOffsets, token);
                if (result.refused) toast(tr('最多选 3 个提醒', 'Up to 3 reminders'));
                else updateSettings({ assignmentOffsets: result.offsets });
              }}
            >
              {offsetLabel(token, locale)}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <p className="px-4 pt-1.5 text-[13px] leading-5 text-wx-meta">
        {settings.assignmentOffsets.length === 0 ? tr('新作业默认不提醒', 'New assignments start with no reminders') : tr('最多选 3 个提醒', 'Up to 3 reminders')}
      </p>

      <Caption>{tr('周末', 'Weekend')}</Caption>
      <div className="bg-white px-3 py-1">
        <ChipRow>
          <Chip selected={settings.showWeekend === 'always'} onClick={() => updateSettings({ showWeekend: 'always' })}>
            {tr('总是显示', 'Always show')}
          </Chip>
          <Chip selected={settings.showWeekend === 'auto'} onClick={() => updateSettings({ showWeekend: 'auto' })}>
            {tr('没课时隐藏', 'Hide when empty')}
          </Chip>
        </ChipRow>
      </div>

      <Group>
        <ActionRow label={tr('学期', 'Terms')} value={view.terms.length > 0 ? String(view.terms.length) : undefined} onClick={onOpenTerms} />
        <ActionRow label={tr('假日', 'Holidays')} value={holidayCount > 0 ? String(holidayCount) : undefined} onClick={onOpenHolidays} />
        <ActionRow label={tr('导入日历文件', 'Import a calendar file')} onClick={onImport} />
        <ActionRow label={tr('导出课表', 'Export timetable')} onClick={onExport} />
      </Group>
      <Group>
        <ActionRow label={tr('清空课表', 'Clear timetable')} danger onClick={() => void clear()} />
      </Group>
      <p className="px-4 pt-3 text-[13px] leading-5 text-wx-meta">{tr('提醒需要网络：手机离线时可能收不到', 'Reminders need a connection; an offline phone may miss them')}</p>
    </FullSheet>
  );
}
