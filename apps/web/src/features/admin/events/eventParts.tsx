import { useEffect, useId, useState } from 'react';
import { NOTIFICATION_TIME_ZONE, wallClockAt, type AdminEventRecord, type EventNotificationRow } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { Switch } from '../../chat/info/Switch';
import { formatNoticeTime, type CustomTimeIssue, type MorningPlan } from '../../notifications/eventTimes';
import { StatusBadge, type StatusTone } from '../ui/StatusBadge';
import { noticeSummaryText, type NoticeSummary } from './eventGroups';

/**
 * Pieces of the events screens moved from the old events panel: the clock the form re-reads, the morning-reminder
 * line, the custom time problems, the switch rows of the form, and the notice rows with their status.
 * 从旧版活动面板移来的活动界面组件：表单定时重读的时钟、当天早上提醒的说明、自定义时间的问题、表单中的开关行，以及带状态的通知行。
 */

export type Tr = (zh: string, en: string) => string;

/** The morning line depends on the clock, so the form re-reads it twice a minute. */
/** 当天早上提醒的说明取决于当前时间，所以表单每分钟重新计算两次。 */
const CLOCK_TICK_MS = 30_000;

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function sameTorontoDay(a: string, b: string): boolean {
  const x = wallClockAt(Date.parse(a), NOTIFICATION_TIME_ZONE);
  const y = wallClockAt(Date.parse(b), NOTIFICATION_TIME_ZONE);
  return x.year === y.year && x.month === y.month && x.day === y.day;
}

export function morningText(plan: MorningPlan | null, tr: Tr): { main: string; note?: string } {
  if (!plan) return { main: tr('填好开始时间后显示提醒时间', 'The time shows once the start is set') };
  if (plan.kind === 'passed') return { main: tr('时间已过，不再发送', 'Already past; it will not be sent') };
  if (plan.kind === 'merged') return { main: tr('离现在不到一小时，并入发布通知', 'Under an hour away; the publish notice covers it') };
  if (plan.day === 'before') {
    return { main: tr(`前一天 ${plan.clock}`, `Day before, ${plan.clock}`), note: tr('活动在 6 点或更早开始，改为前一天晚上提醒', 'The event starts at 6:00 or earlier, so the reminder goes out the evening before') };
  }
  const main = tr(`当天 ${plan.clock}`, `Event day, ${plan.clock}`);
  if (plan.early === 'two-hours') {
    return { main, note: tr('活动在 10 点前开始，改为提前两小时提醒', 'The event starts before 10:00, so the reminder goes out two hours before') };
  }
  if (plan.early === 'earliest') {
    return { main, note: tr('活动在 8 点前开始，改为当天 6:00 提醒（最早 6 点）', 'The event starts before 8:00, so the reminder goes out at 6:00, the earliest morning time') };
  }
  return { main };
}

export function issueText(issue: CustomTimeIssue, tr: Tr): string {
  switch (issue) {
    case 'empty':
      return tr('请选择时间', 'Choose a time');
    case 'invalid':
      return tr('时间无效', 'That time is not valid');
    case 'past':
      return tr('要晚于现在', 'Must be later than now');
    case 'too-late':
      return tr('不能晚于活动开始后一天', 'Must be within a day after the start');
    case 'duplicate':
      return tr('与上面的时间重复', 'Same as a time above');
  }
}

export function ToggleLine({ label, detail, note, checked, onChange }: { label: string; detail?: string; note?: string; checked: boolean; onChange: (next: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span id={id} className="block text-[15px] text-stone-800">
          {label}
        </span>
        {detail ? <span className={`mt-0.5 block text-[13px] ${checked ? 'text-brand-700' : 'text-stone-400'}`}>{detail}</span> : null}
        {note && checked ? <span className="mt-0.5 block text-xs leading-snug text-stone-500">{note}</span> : null}
      </span>
      <Switch checked={checked} labelledBy={id} onChange={onChange} />
    </div>
  );
}

export function kindLabel(row: EventNotificationRow, startsAt: string, tr: Tr): string {
  if (row.kind === 'publish') return tr('发布时', 'On publish');
  if (row.kind === 'custom') return tr('自定义', 'Custom');
  return sameTorontoDay(row.sendAt, startsAt) ? tr('当天早上', 'Morning of') : tr('前一天晚上', 'Evening before');
}

function statusOf(row: EventNotificationRow, tr: Tr): [string, StatusTone] {
  switch (row.status) {
    case 'sent':
      return [row.recipientCount === null ? tr('已发送', 'Sent') : tr(`已发送 · ${row.recipientCount}人`, `Sent · ${row.recipientCount}`), 'ok'];
    case 'pending':
      return [tr('待发送', 'Scheduled'), 'pending'];
    case 'sending':
      return [tr('发送中', 'Sending'), 'brand'];
    case 'cancelled':
      return [tr('已取消', 'Cancelled'), 'muted'];
    case 'failed':
      return [tr('失败', 'Failed'), 'danger'];
  }
}

/** One notice: what it is, when it goes (or went) out in Toronto time, and its status. */
/** 一条通知：类型、按多伦多时间的发送（或已发送）时刻，以及状态。 */
export function NoticeRow({ row, event }: { row: EventNotificationRow; event: AdminEventRecord }) {
  const { tr, locale } = useLabels();
  const [status, tone] = statusOf(row, tr);
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] leading-6 text-wx-ink">{kindLabel(row, event.startsAt, tr)}</span>
        <span className="block truncate text-[14px] leading-5 tabular-nums text-wx-meta">{formatNoticeTime(row.status === 'sent' && row.sentAt ? row.sentAt : row.sendAt, locale)}</span>
      </span>
      <StatusBadge tone={tone}>{status}</StatusBadge>
    </div>
  );
}

/** The chip at the end of an event row. */
/** 活动行末尾的标签。 */
export function NoticeChip({ summary }: { summary: NoticeSummary | null }) {
  const { tr } = useLabels();
  if (!summary) return null;
  const text = noticeSummaryText(summary);
  const tone: StatusTone = summary.kind === 'failed' ? 'danger' : summary.kind === 'scheduled' ? 'pending' : 'ok';
  return <StatusBadge tone={tone}>{tr(text.zh, text.en)}</StatusBadge>;
}
