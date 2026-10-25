import { memo, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AdminEventRecord } from '@utmmsc/shared';
import { useLabels } from '../../../shared/i18n/locale';
import { formatNoticeTime } from '../../notifications/eventTimes';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useInsetGroups, useIsWide } from '../layout/media';
import { AdminGroup } from '../ui/AdminCell';
import { SegmentedControl } from '../ui/Choices';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { AdminIcon } from '../ui/icons';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useEvents } from './eventData';
import { clockText, dateBlock, eventPath, eventsListPath, newEventPath, noticeSummary, splitEvents, type EventView } from './eventGroups';
import { NoticeChip, useNow } from './eventParts';

const HEADER_ACTION = 'inline-flex min-h-11 items-center rounded-lg px-2.5 text-[16px] font-medium text-brand-800 active:bg-stone-100';

/**
 * One event: a Toronto date block, the title, 18:30 · the place, and the notice chip (scheduled, notified, or failed
 * in red).
 * 单个活动：多伦多时间的日期块、标题、「18:30 · 地点」，以及通知标签（待发送、已通知，或红色的通知失败）。
 */
const EventRow = memo(function EventRow({ event, to, replace, selected }: { event: AdminEventRecord; to: string; replace: boolean; selected: boolean }) {
  const { locale } = useLabels();
  const block = dateBlock(event.startsAt, locale);
  const where = [clockText(event.startsAt), event.location?.trim()].filter(Boolean).join(' · ');
  return (
    <Link
      to={to}
      replace={replace}
      aria-current={selected ? 'true' : undefined}
      data-admin-row={event.id}
      className={`relative block w-full text-left outline-offset-[-2px] [contain-intrinsic-size:auto_64px] [content-visibility:auto] active:bg-wx-pressed ${selected ? 'bg-brand-50' : ''}`}
    >
      <span className="flex min-h-16 items-center gap-3 px-4 py-2.5">
        <span aria-hidden className="flex w-10 shrink-0 flex-col items-center rounded-lg bg-brand-50 py-1 text-brand-800">
          <span className="text-[11px] leading-4">{block?.month}</span>
          <span className="text-[18px] font-semibold leading-6 tabular-nums">{block?.day}</span>
          <span className="text-[11px] leading-4">{block?.weekday}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[17px] leading-6 ${selected ? 'font-medium text-brand-800' : 'text-wx-ink'}`}>
            {event.title}
            <span className="sr-only">{`, ${formatNoticeTime(event.startsAt, locale)}`}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[14px] leading-5 tabular-nums text-wx-meta">{where}</span>
            <NoticeChip summary={noticeSummary(event.notifications)} />
          </span>
        </span>
        <AdminIcon name="chevron" className="h-4 w-4 shrink-0 text-stone-400" strokeWidth={2} />
      </span>
      {selected ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-gold" /> : null}
    </Link>
  );
});

/**
 * 活动: 即将开始 (today or later in Toronto, soonest first) and 已结束 (most recent first) as segments (?view=). Rows
 * open the event; 新建 opens the form. Skeleton rows until the list arrives, never a false 没有活动.
 * 「活动」：以分段控件（?view=）显示「即将开始」（多伦多时间今天或之后，最近的在前）和「已结束」（最晚结束的在前）。每一行打开该活动；
 * 「新建」打开表单。列表到达之前显示骨架行，不会误显示「没有活动」。
 */
export function EventList({ view, selectedId }: { view: EventView; selectedId: string | null }) {
  const { tr } = useLabels();
  const navigate = useNavigate();
  const back = useSectionBack();
  const events = useEvents();
  const now = useNow();
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef);
  const swap = useIsWide() && selectedId !== null;
  const insetGroups = useInsetGroups();
  const groups = useMemo(() => splitEvents(events.data ?? [], now), [events.data, now]);
  const shown = groups[view];

  const segments = (
    <div className="px-3 pb-2.5 pt-0.5">
      <SegmentedControl<EventView>
        label={tr('活动时间', 'Event time')}
        value={view}
        onChange={(next) => navigate(eventsListPath(next), { replace: true })}
        options={[
          { value: 'upcoming', label: tr('即将开始', 'Upcoming'), count: events.data ? groups.upcoming.length : null },
          { value: 'past', label: tr('已结束', 'Past') },
        ]}
      />
    </div>
  );
  const trailing = (
    <Link to={newEventPath(null, view)} replace={swap} className={HEADER_ACTION}>
      {tr('新建', 'New')}
    </Link>
  );

  let body;
  if (!events.data) {
    body = events.error ? <LoadFailed error={events.error} onRetry={() => void events.refresh()} /> : <ListSkeleton rows={5} avatar />;
  } else if (shown.length === 0) {
    body =
      view === 'upcoming' ? (
        <EmptyBlock
          title={tr('没有即将开始的活动', 'No upcoming events')}
          hint={tr('新建的活动会出现在首页，并按你的设置通知成员。', 'New events show on Home and notify members the way you set.')}
          action={
            <Link to={newEventPath(null, view)} className="inline-flex min-h-11 items-center rounded-lg border-t-[3px] border-gold bg-brand-800 px-4 text-[15px] font-medium text-white">
              {tr('新建活动', 'New event')}
            </Link>
          }
        />
      ) : (
        <EmptyBlock title={tr('还没有已结束的活动', 'No past events yet')} />
      );
  } else {
    body = (
      <>
        {events.error ? <LoadFailed error={events.error} onRetry={() => void events.refresh()} /> : null}
        <AdminGroup inset="avatar">
          {shown.map((event) => (
            <EventRow key={event.id} event={event} to={eventPath(event.id, view)} replace={swap} selected={event.id === selectedId} />
          ))}
        </AdminGroup>
        <p className={`pt-3 text-[13px] text-wx-meta ${insetGroups ? 'px-1' : 'px-4'}`}>{tr('时间均为多伦多时间。', 'All times are Toronto time.')}</p>
      </>
    );
  }

  return (
    <AdminScreen title={tr('活动', 'Events')} back={back} top trailing={trailing} sub={segments}>
      <div ref={listRef}>{body}</div>
    </AdminScreen>
  );
}
