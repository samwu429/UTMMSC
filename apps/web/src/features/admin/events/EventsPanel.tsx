import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EVENT_CUSTOM_TIMES_MAX, NOTIFICATION_TIME_ZONE, wallClockAt, zonedLocalToIso, type AdminEventRecord, type EventNotificationRow } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice } from '../../../shared/ui/Card';
import { useConfirm } from '../../../shared/ui/confirm';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { Switch } from '../../chat/info/Switch';
import { customTimeIssues, customTimesToIso, formatNoticeTime, planMorning, suggestCustomTime, type CustomTimeIssue, type MorningPlan } from '../../notifications/eventTimes';
import { adminApi } from '../api';

/** The morning line depends on the clock, so the form re-reads it twice a minute. */
/** 当天早上提醒的说明取决于当前时间，所以表单每分钟重新计算两次。 */
const CLOCK_TICK_MS = 30_000;
/** The publish notice goes out about a second after saving; the list is read again to show the result. */
/** 发布通知在保存后约一秒发出；之后重新读取列表以显示结果。 */
const PUBLISH_RECHECK_MS = 3000;

type Tr = (zh: string, en: string) => string;

function useNow(): number {
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

function morningText(plan: MorningPlan | null, tr: Tr): { main: string; note?: string } {
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

function issueText(issue: CustomTimeIssue, tr: Tr): string {
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

function ToggleLine({ label, detail, note, checked, onChange }: { label: string; detail?: string; note?: string; checked: boolean; onChange: (next: boolean) => void }) {
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

function kindLabel(row: EventNotificationRow, startsAt: string, tr: Tr): string {
  if (row.kind === 'publish') return tr('发布时', 'On publish');
  if (row.kind === 'custom') return tr('自定义', 'Custom');
  return sameTorontoDay(row.sendAt, startsAt) ? tr('当天早上', 'Morning of') : tr('前一天晚上', 'Evening before');
}

function StatusTag({ row, tr }: { row: EventNotificationRow; tr: Tr }) {
  const [text, style] =
    row.status === 'sent'
      ? [row.recipientCount === null ? tr('已发送', 'Sent') : tr(`已发送 · ${row.recipientCount}人`, `Sent · ${row.recipientCount}`), 'bg-emerald-50 text-emerald-800']
      : row.status === 'pending'
        ? [tr('待发送', 'Scheduled'), 'bg-amber-50 text-amber-800']
        : row.status === 'sending'
          ? [tr('发送中', 'Sending'), 'bg-brand-50 text-brand-800']
          : row.status === 'cancelled'
            ? [tr('已取消', 'Cancelled'), 'bg-stone-100 text-stone-500']
            : [tr('失败', 'Failed'), 'bg-red-50 text-red-700'];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${style}`}>{text}</span>;
}

function NoticeRows({ event, tr, locale }: { event: AdminEventRecord; tr: Tr; locale: 'zh' | 'en' }) {
  const rows = event.notifications ?? [];
  if (rows.length === 0) return <p className="mt-2 text-xs text-stone-400">{tr('不发送通知', 'No notifications')}</p>;
  return (
    <ul className="mt-2 space-y-1 border-t border-stone-100 pt-2" aria-label={tr('通知', 'Notifications')}>
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-2 text-xs text-stone-600">
          <span className="w-[4.5rem] shrink-0 text-stone-500">{kindLabel(row, event.startsAt, tr)}</span>
          <span className="min-w-0 flex-1 truncate tabular-nums">{formatNoticeTime(row.status === 'sent' && row.sentAt ? row.sentAt : row.sendAt, locale)}</span>
          <StatusTag row={row} tr={tr} />
        </li>
      ))}
    </ul>
  );
}

export function EventsPanel() {
  const [events, setEvents] = useState<AdminEventRecord[]>([]);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [notifyOnPublish, setNotifyOnPublish] = useState(true);
  const [notifyMorningOf, setNotifyMorningOf] = useState(true);
  const [customTimes, setCustomTimes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recheck = useRef<number | null>(null);
  const ask = useConfirm();
  const { tr, locale } = useLabels();
  const now = useNow();

  // Times are entered as Toronto time wherever the publisher is, matching how notices are scheduled.
  // 无论发布人身在何处，时间都按多伦多时间填写，与通知的安排方式一致。
  const startIso = startsAt ? zonedLocalToIso(startsAt) : null;
  const morning = startIso ? planMorning(startIso, now, notifyOnPublish) : null;
  const issues = customTimeIssues(customTimes, startIso, now);
  const morningLine = morningText(morning, tr);

  const load = useCallback(() => {
    adminApi
      .events()
      .then((res) => setEvents(res.events))
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    load();
    return () => {
      if (recheck.current !== null) window.clearTimeout(recheck.current);
    };
  }, [load]);

  function addTime() {
    setCustomTimes((prev) => (prev.length >= EVENT_CUSTOM_TIMES_MAX ? prev : [...prev, suggestCustomTime(startIso, prev, Date.now())]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const at = Date.now();
    const start = startsAt ? zonedLocalToIso(startsAt) : null;
    if (!start) {
      setError(tr('开始时间无效', 'That start time is not valid.'));
      return;
    }
    const times = customTimesToIso(customTimes, start, at);
    if (!times) {
      setError(tr('请检查自定义通知时间', 'Check the custom notification times.'));
      return;
    }
    setBusy(true);
    try {
      const res = await adminApi.createEvent({
        title,
        startsAt: start,
        location: location || undefined,
        description: description || undefined,
        notifications: { notifyOnPublish, notifyMorningOf, customTimes: times },
      });
      setEvents((prev) => [res.event, ...prev]);
      setTitle('');
      setStartsAt('');
      setLocation('');
      setDescription('');
      setNotifyOnPublish(true);
      setNotifyMorningOf(true);
      setCustomTimes([]);
      if ((res.event.notifications ?? []).some((row) => row.kind === 'publish' && (row.status === 'pending' || row.status === 'sending'))) {
        if (recheck.current !== null) window.clearTimeout(recheck.current);
        recheck.current = window.setTimeout(load, PUBLISH_RECHECK_MS);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(event: AdminEventRecord) {
    const ok = await ask({ title: tr('删除这个活动？', 'Delete this event?'), body: event.title, confirmLabel: tr('删除', 'Delete'), danger: true });
    if (!ok) return;
    try {
      await adminApi.deleteEvent(event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const canSave = !!title.trim() && !!startIso && issues.every((issue) => issue === null);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-semibold">{tr('新增活动', 'New event')}</h2>
        <form onSubmit={submit} className="space-y-3">
          <Field label={tr('活动名称', 'Event name')}>
            <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
          </Field>
          <Field label={tr('开始时间（多伦多时间）', 'Start time (Toronto time)')}>
            <TextInput type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label={tr('地点（选填）', 'Location (optional)')}>
            <TextInput value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
          </Field>
          <Field label={tr('说明（选填）', 'Description (optional)')}>
            <TextArea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>

          <fieldset className="rounded-lg bg-stone-50 px-3 pb-2 pt-2.5">
            <legend className="sr-only">{tr('通知', 'Notifications')}</legend>
            <p className="text-[13px] font-medium text-stone-600" aria-hidden>
              {tr('通知', 'Notifications')}
            </p>
            <div className="divide-y divide-stone-200">
              <ToggleLine
                label={tr('发布时通知全体成员', 'Notify all members on publish')}
                detail={notifyOnPublish ? tr('保存后立即发送', 'Sent as soon as you save') : undefined}
                checked={notifyOnPublish}
                onChange={setNotifyOnPublish}
              />
              <ToggleLine label={tr('活动当天早上提醒', 'Remind on the morning of')} detail={morningLine.main} note={morningLine.note} checked={notifyMorningOf} onChange={setNotifyMorningOf} />
              <div className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] text-stone-800">{tr('自定义通知时间', 'Custom notification times')}</span>
                  <span className="shrink-0 text-xs tabular-nums text-stone-400">
                    {customTimes.length}/{EVENT_CUSTOM_TIMES_MAX}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">{tr('多伦多时间，最晚到活动开始后一天', 'Toronto time, up to a day after the start')}</p>
                {customTimes.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {customTimes.map((value, index) => {
                      const issue = issues[index] ?? null;
                      const showIssue = issue !== null;
                      return (
                        <li key={index}>
                          <div className="flex items-center gap-2">
                            <TextInput
                              type="datetime-local"
                              value={value}
                              aria-label={tr(`通知时间 ${index + 1}`, `Notification time ${index + 1}`)}
                              aria-invalid={showIssue}
                              className={`min-w-0 flex-1 ${showIssue ? 'border-red-300' : ''}`}
                              onChange={(e) => setCustomTimes((prev) => prev.map((item, i) => (i === index ? e.target.value : item)))}
                            />
                            <button
                              type="button"
                              onClick={() => setCustomTimes((prev) => prev.filter((_, i) => i !== index))}
                              aria-label={tr(`删除通知时间 ${index + 1}`, `Remove notification time ${index + 1}`)}
                              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-stone-400 active:bg-stone-100 active:text-stone-600"
                            >
                              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                                <path d="m6 6 12 12M18 6 6 18" />
                              </svg>
                            </button>
                          </div>
                          {showIssue ? <p className="mt-1 text-xs text-red-700">{issueText(issue, tr)}</p> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {customTimes.length < EVENT_CUSTOM_TIMES_MAX ? (
                  <button type="button" onClick={addTime} className="mt-2 flex min-h-11 items-center gap-1 rounded-lg px-1 text-[15px] font-medium text-brand-800 active:bg-stone-100">
                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    {tr('添加通知时间', 'Add a time')}
                  </button>
                ) : null}
              </div>
            </div>
          </fieldset>

          {error ? <Notice tone="error">{error}</Notice> : null}
          <Button type="submit" block loading={busy} disabled={!canSave}>
            {tr('保存活动', 'Save event')}
          </Button>
        </form>
      </Card>
      {events.length === 0 ? (
        <EmptyState>{tr('还没有活动', 'No events yet')}</EmptyState>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="rounded-xl bg-white px-4 py-3 ring-1 ring-stone-200">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{event.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatNoticeTime(event.startsAt, locale)}
                    {event.location ? ` · ${event.location}` : ''}
                  </p>
                </div>
                <button onClick={() => remove(event)} className="shrink-0 text-sm text-red-600">
                  {tr('删除', 'Delete')}
                </button>
              </div>
              <NoticeRows event={event} tr={tr} locale={locale} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
