import { Navigate, useLocation, useMatch, useSearchParams } from 'react-router-dom';
import { SplitView } from '../layout/SplitView';
import { sectionPath } from '../sections';
import { EventCreate } from './EventCreate';
import { EventDetail } from './EventDetail';
import { NEW_EVENT, eventsListPath, readEventView } from './eventGroups';
import { EventList } from './EventList';

/**
 * /admin/events/*: 即将开始 and 已结束 (?view=upcoming|past), 新建 at /admin/events/new (?from=<id> to copy one) and
 * an event at /admin/events/:id, side by side with the list from 1280px. Any other address under it goes back to the
 * list.
 * /admin/events/*：「即将开始」和「已结束」（?view=upcoming|past）、位于 /admin/events/new 的「新建」（?from=<id> 表示复制某个活动），
 * 以及位于 /admin/events/:id 的活动，从 1280px 起与列表并排显示。其下的其他地址回到列表。
 */
export function EventsSection() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const base = sectionPath('events');
  const match = useMatch(`${base}/:id`);
  const view = readEventView(params.get('view'));
  const atList = pathname === base || pathname === `${base}/`;
  const creating = match?.params.id === NEW_EVENT;
  const id = creating ? null : (match?.params.id ?? null);
  if (!atList && !creating && !id) return <Navigate to={eventsListPath(view)} replace />;

  let detail = null;
  if (creating) detail = <EventCreate key={`new:${params.get('from') ?? ''}`} />;
  else if (id) detail = <EventDetail key={id} id={id} view={view} />;
  return <SplitView detailOpen={creating || id !== null} list={<EventList view={view} selectedId={id} />} detail={detail} />;
}
