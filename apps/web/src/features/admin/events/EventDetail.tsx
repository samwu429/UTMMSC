import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { formatNoticeTime } from '../../notifications/eventTimes';
import { adminApi } from '../api';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { useScreenGuard } from '../layout/screenGuard';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { useHeldValue } from '../state/useHeldValue';
import { AdminCell, AdminField, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';
import { forgetEvent, useEvents } from './eventData';
import { countsAsUpcoming, eventsListPath, newEventPath, pendingNoticeCount, type EventView } from './eventGroups';
import { NoticeRow } from './eventParts';

/**
 * One event, /admin/events/:id: the title, its Toronto time, place and description, every notice with its status,
 * 复制为新活动 (the form filled from this one, client only) and 删除活动, which says how many scheduled notices it
 * cancels.
 * 单个活动，/admin/events/:id：标题、多伦多时间、地点和说明，每条通知及其状态，「复制为新活动」（用这个活动填好表单，仅在本地），以及
 * 「删除活动」（会说明将取消多少条已安排的通知）。
 */
export function EventDetail({ id, view }: { id: string; view: EventView }) {
  const { tr, locale } = useLabels();
  const goBack = useAdminBack();
  const beginAction = useScreenGuard();
  const confirm = useAdminConfirm();
  const insetGroups = useInsetGroups();
  const events = useEvents();
  const [deleting, setDeleting] = useState(false);
  const event = useHeldValue(
    events.data?.find((item) => item.id === id),
    deleting,
  );
  const list = eventsListPath(view);
  const back = { to: list, label: tr('活动', 'Events') };

  if (!event) {
    return (
      <AdminScreen title={tr('活动', 'Event')} back={back} escapeTo={list}>
        {!events.data ? (
          events.error ? (
            <LoadFailed error={events.error} onRetry={() => void events.refresh()} />
          ) : (
            <ListSkeleton rows={4} />
          )
        ) : (
          <EmptyBlock
            title={tr('找不到这个活动', "This event couldn't be found")}
            hint={tr('可能已被删除，或链接有误。', 'It may have been deleted, or the link is wrong.')}
            action={
              <Link to={list} replace className="inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-brand-800 active:bg-stone-100">
                {tr('返回活动列表', 'Back to events')}
              </Link>
            }
          />
        )}
      </AdminScreen>
    );
  }

  const current = event;
  const notices = current.notifications ?? [];
  const pending = pendingNoticeCount(notices);

  async function remove() {
    if (deleting) return;
    const ok = await confirm({
      title: tr('删除这个活动？', 'Delete this event?'),
      body:
        pending > 0
          ? tr(`已安排的 ${pending} 条通知会被取消。`, `${pending} scheduled ${pending === 1 ? 'notice' : 'notices'} will be cancelled.`)
          : tr('活动会从首页消失，删除后无法恢复。', "It disappears from Home and can't be restored."),
      confirmLabel: tr('删除', 'Delete'),
      danger: true,
    });
    if (!ok) return;
    const stillHere = beginAction();
    setDeleting(true);
    try {
      await adminApi.deleteEvent(current.id);
    } catch (err) {
      toast(errorMessage(err));
      setDeleting(false);
      return;
    }
    if (countsAsUpcoming(current, Date.now())) useAdminSummary.getState().adjust('upcomingEvents', -1);
    forgetEvent(current.id);
    // An admin who already went back or opened another event stays where they are; a second back would leave 活动.
    // A screen still mounted on a newer entry stops holding the event, so it says the event is gone.
    // 管理员已经返回或打开了别的活动时，留在原处；再后退一次就会离开「活动」。界面仍挂载在更新的记录上时不再保留这个活动，
    // 因此会显示活动已不存在。
    if (stillHere()) goBack(list);
    else setDeleting(false);
    refreshAdminSummary();
    toast(tr('已删除', 'Deleted'));
  }

  return (
    <AdminScreen title={tr('活动', 'Event')} back={back} escapeTo={list}>
      <AdminGroup>
        <div className="px-4 py-4">
          <p className="break-words text-[20px] font-semibold leading-7 text-wx-ink">{current.title}</p>
          <p className="mt-0.5 text-[14px] tabular-nums text-wx-meta">{tr(`${formatNoticeTime(current.startsAt, locale)}（多伦多时间）`, `${formatNoticeTime(current.startsAt, locale)} (Toronto time)`)}</p>
        </div>
      </AdminGroup>
      <AdminGroup>
        <AdminField label={tr('地点', 'Location')}>{current.location?.trim() ? current.location : tr('未填写', 'Not given')}</AdminField>
        <AdminField label={tr('说明', 'Description')} multiline>
          {current.description?.trim() ? current.description : tr('没有填写', 'None')}
        </AdminField>
      </AdminGroup>
      <AdminGroup title={tr('通知', 'Notifications')} footer={notices.length === 0 ? tr('这个活动不发送通知。', 'This event sends no notifications.') : undefined}>
        {notices.map((row) => (
          <NoticeRow key={row.id} row={row} event={current} />
        ))}
      </AdminGroup>
      <AdminGroup>
        <AdminCell label={tr('复制为新活动', 'Duplicate as new event')} to={newEventPath(current.id, view)} />
      </AdminGroup>
      <AdminGroup>
        <AdminCell label={deleting ? tr('正在删除…', 'Deleting…') : tr('删除活动', 'Delete event')} danger disabled={deleting} onClick={() => void remove()} />
      </AdminGroup>
      <p className={`pt-3 text-[13px] leading-relaxed text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>
        {tr('活动发布后不能修改。要改时间或地点，可以复制为新活动，再删除这一个。', "Events can't be edited once published. To change the time or place, duplicate it as a new event and delete this one.")}
      </p>
    </AdminScreen>
  );
}
