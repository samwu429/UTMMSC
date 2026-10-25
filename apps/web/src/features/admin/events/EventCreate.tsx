import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EVENT_CUSTOM_TIMES_MAX, zonedLocalToIso } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Field, TextArea, TextInput } from '../../../shared/ui/Field';
import { toast } from '../../../shared/ui/toast';
import { customTimeIssues, customTimesToIso, planMorning, suggestCustomTime } from '../../notifications/eventTimes';
import { adminApi } from '../api';
import { AdminScreen } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { useScreenGuard } from '../layout/screenGuard';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { AdminGroup } from '../ui/AdminCell';
import { StickyActionBar } from '../ui/StickyActionBar';
import { recheckPublishNotice, storeEvent, useEvents } from './eventData';
import { countsAsUpcoming, duplicateDraft, emptyEventDraft, eventPath, eventsListPath, isUpcoming, readEventView, type EventDraft } from './eventGroups';
import { ToggleLine, issueText, morningText, useNow } from './eventParts';

/**
 * 新建活动, /admin/events/new: the existing form moved into the shell as it was (Toronto times, the publish and
 * morning notices, up to five custom times), with 保存活动 in the bottom bar. ?from=<id> fills it from that event
 * (复制为新活动) once the list has it. Saving opens the new event.
 * 「新建活动」，/admin/events/new：现有的表单原样移入框架（多伦多时间、发布通知和当天早上提醒、最多五个自定义时间），「保存活动」位于底部
 * 操作栏。?from=<id> 在列表中有该活动后用它填好表单（复制为新活动）。保存后打开新活动。
 */
export function EventCreate() {
  const { tr } = useLabels();
  const navigate = useNavigate();
  const beginAction = useScreenGuard();
  const insetGroups = useInsetGroups();
  const [params] = useSearchParams();
  const view = readEventView(params.get('view'));
  const from = params.get('from');
  const events = useEvents();
  const source = from ? events.data?.find((item) => item.id === from) : undefined;
  const [draft, setDraft] = useState<EventDraft>(() => (source ? duplicateDraft(source, Date.now()) : emptyEventDraft()));
  // A copy opened before the list arrived is filled in once it does, unless something was typed meanwhile.
  // 在列表到达之前打开的复制，会在列表到达后填入，除非这期间已经输入了内容。
  const [seeded, setSeeded] = useState(Boolean(source) || !from);
  const [touched, setTouched] = useState(false);
  if (!seeded && (source || events.data)) {
    setSeeded(true);
    if (source && !touched) setDraft(duplicateDraft(source, Date.now()));
  }
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  const list = eventsListPath(view);
  const back = { to: list, label: tr('活动', 'Events') };

  function change(patch: Partial<EventDraft>) {
    setTouched(true);
    setError(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  // Times are entered as Toronto time wherever the publisher is, matching how notices are scheduled.
  // 无论发布人身在何处，时间都按多伦多时间填写，与通知的安排方式一致。
  const startIso = draft.startsAt ? zonedLocalToIso(draft.startsAt) : null;
  const morning = startIso ? planMorning(startIso, now, draft.notifyOnPublish) : null;
  const issues = customTimeIssues(draft.customTimes, startIso, now);
  const morningLine = morningText(morning, tr);
  const canSave = !!draft.title.trim() && !!startIso && issues.every((issue) => issue === null);

  function addTime() {
    setTouched(true);
    setDraft((current) =>
      current.customTimes.length >= EVENT_CUSTOM_TIMES_MAX ? current : { ...current, customTimes: [...current.customTimes, suggestCustomTime(startIso, current.customTimes, Date.now())] },
    );
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setError(null);
    const at = Date.now();
    const start = draft.startsAt ? zonedLocalToIso(draft.startsAt) : null;
    if (!start) {
      setError(tr('开始时间无效', 'That start time is not valid.'));
      return;
    }
    const times = customTimesToIso(draft.customTimes, start, at);
    if (!times) {
      setError(tr('请检查自定义通知时间', 'Check the custom notification times.'));
      return;
    }
    setBusy(true);
    const stillHere = beginAction();
    try {
      const res = await adminApi.createEvent({
        title: draft.title,
        startsAt: start,
        location: draft.location || undefined,
        description: draft.description || undefined,
        notifications: { notifyOnPublish: draft.notifyOnPublish, notifyMorningOf: draft.notifyMorningOf, customTimes: times },
      });
      storeEvent(res.event);
      if (countsAsUpcoming(res.event, Date.now())) useAdminSummary.getState().adjust('upcomingEvents', 1);
      refreshAdminSummary();
      recheckPublishNotice(res.event);
      toast(tr('活动已保存', 'Event saved'));
      // Replacing is only right for this form's own entry; an admin who already moved on keeps the screen they chose.
      // A form still mounted on a newer entry (新建 tapped again) starts empty, so the saved event is not saved twice.
      // 只有这个表单自己的记录才应被替换；管理员已经去了别处时，保留他选的界面。表单仍挂载在更新的记录上时（又点了「新建」），
      // 改为空白表单，刚保存的活动就不会被保存两次。
      if (stillHere()) {
        navigate(eventPath(res.event.id, isUpcoming(res.event, Date.now()) ? 'upcoming' : 'past'), { replace: true });
      } else {
        setDraft(emptyEventDraft());
        setTouched(false);
        setBusy(false);
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AdminScreen
      title={from ? tr('复制为新活动', 'Duplicate event') : tr('新建活动', 'New event')}
      back={back}
      escapeTo={list}
      footer={
        <StickyActionBar>
          <Button onClick={() => void submit()} loading={busy} disabled={!canSave}>
            {tr('保存活动', 'Save event')}
          </Button>
        </StickyActionBar>
      }
    >
      <form onSubmit={(event) => void submit(event)}>
        <AdminGroup>
          <div className="space-y-3 px-4 py-4">
            <Field label={tr('活动名称', 'Event name')}>
              <TextInput value={draft.title} onChange={(e) => change({ title: e.target.value })} maxLength={80} className="text-[16px]" />
            </Field>
            <Field label={tr('开始时间（多伦多时间）', 'Start time (Toronto time)')}>
              <TextInput type="datetime-local" value={draft.startsAt} onChange={(e) => change({ startsAt: e.target.value })} className="text-[16px]" />
            </Field>
            <Field label={tr('地点（选填）', 'Location (optional)')}>
              <TextInput value={draft.location} onChange={(e) => change({ location: e.target.value })} maxLength={120} className="text-[16px]" />
            </Field>
            <Field label={tr('说明（选填）', 'Description (optional)')}>
              <TextArea value={draft.description} onChange={(e) => change({ description: e.target.value })} maxLength={1000} className="text-[16px]" />
            </Field>
          </div>
        </AdminGroup>

        <AdminGroup title={tr('通知', 'Notifications')}>
          <fieldset className="px-4 pb-1">
            <legend className="sr-only">{tr('通知', 'Notifications')}</legend>
            <div className="divide-y divide-stone-200">
              <ToggleLine
                label={tr('发布时通知全体成员', 'Notify all members on publish')}
                detail={draft.notifyOnPublish ? tr('保存后立即发送', 'Sent as soon as you save') : undefined}
                checked={draft.notifyOnPublish}
                onChange={(notifyOnPublish) => change({ notifyOnPublish })}
              />
              <ToggleLine
                label={tr('活动当天早上提醒', 'Remind on the morning of')}
                detail={morningLine.main}
                note={morningLine.note}
                checked={draft.notifyMorningOf}
                onChange={(notifyMorningOf) => change({ notifyMorningOf })}
              />
              <div className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px] text-stone-800">{tr('自定义通知时间', 'Custom notification times')}</span>
                  <span className="shrink-0 text-xs tabular-nums text-stone-400">
                    {draft.customTimes.length}/{EVENT_CUSTOM_TIMES_MAX}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-stone-500">{tr('多伦多时间，最晚到活动开始后一天', 'Toronto time, up to a day after the start')}</p>
                {draft.customTimes.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {draft.customTimes.map((value, index) => {
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
                              className={`min-w-0 flex-1 text-[16px] ${showIssue ? 'border-red-300' : ''}`}
                              onChange={(e) => change({ customTimes: draft.customTimes.map((item, i) => (i === index ? e.target.value : item)) })}
                            />
                            <button
                              type="button"
                              onClick={() => change({ customTimes: draft.customTimes.filter((_, i) => i !== index) })}
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
                {draft.customTimes.length < EVENT_CUSTOM_TIMES_MAX ? (
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
        </AdminGroup>

        {error ? (
          <p role="alert" className={`mt-3 rounded-lg bg-red-50 py-2 text-[14px] text-red-800 ${insetGroups ? 'px-3' : 'mx-4 px-3'}`}>
            {error}
          </p>
        ) : null}
      </form>
    </AdminScreen>
  );
}
