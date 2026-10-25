import { Navigate, useLocation, useMatch } from 'react-router-dom';
import { SplitView } from '../layout/SplitView';
import { sectionPath } from '../sections';
import { AnnouncementCompose } from './AnnouncementCompose';
import { AnnouncementDetail } from './AnnouncementDetail';
import { AnnouncementList } from './AnnouncementList';
import { NEW_ANNOUNCEMENT, announcementsPath } from './announcementRules';

/**
 * /admin/announcements/*: the history, 发布公告 at /admin/announcements/new and one sent announcement at
 * /admin/announcements/:id, side by side with the history from 1280px. Any other address under it goes back to the
 * history.
 * /admin/announcements/*：公告记录、位于 /admin/announcements/new 的「发布公告」，以及位于 /admin/announcements/:id 的单条已发公告，
 * 从 1280px 起与记录并排显示。其下的其他地址回到记录。
 */
export function AnnouncementsSection() {
  const { pathname } = useLocation();
  const base = sectionPath('announcements');
  const match = useMatch(`${base}/:id`);
  const atList = pathname === base || pathname === `${base}/`;
  const composing = match?.params.id === NEW_ANNOUNCEMENT;
  const id = composing ? null : (match?.params.id ?? null);
  if (!atList && !composing && !id) return <Navigate to={announcementsPath()} replace />;

  const detail = composing ? <AnnouncementCompose /> : id ? <AnnouncementDetail key={id} id={id} /> : null;
  return <SplitView detailOpen={composing || id !== null} list={<AnnouncementList selectedId={id} />} detail={detail} />;
}
