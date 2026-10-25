/**
 * Owner: A-shell, admin shell. App.tsx loads this default export lazily for every path under /admin/*, outside
 * AppShell, so ordinary members never download admin. It draws the shell (admin-design.md 1.3 and 1.4), sends the
 * old ?tab= links to their sections, lands a role with one section straight in it, and turns away a section the
 * viewed role can't use. Each section mounts at <key>/* and routes its own item screens.
 * 维护者：A-shell，管理后台框架。App.tsx 为 /admin/* 下的所有路径按需加载这个默认导出，位于 AppShell 之外，普通成员因此永远不会下载管理后台。
 * 它绘制框架（admin-design.md 1.3 和 1.4），把旧的 ?tab= 链接送到对应板块，让只有一个板块的身份直接进入该板块，并拒绝当前视角的身份不能
 * 使用的板块。每个板块挂载在 <key>/* 上，自己分派其中各项目的界面。
 */
import { useEffect, type ComponentType } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { canOpenAdmin, canUseAdminSection, type AdminSectionKey } from '@utmmsc/shared';
import { tr as translate } from '../../shared/i18n/locale';
import { useSessionStore } from '../../shared/session/store';
import { toast } from '../../shared/ui/toast';
import { AdvisorsSection } from './advisors/Section';
import { AnnouncementsSection } from './announcements/Section';
import { ChannelsSection } from './channels/Section';
import { EventsSection } from './events/Section';
import { AdminLayout } from './layout/AdminLayout';
import { MembersSection } from './members/Section';
import { ReportsSection } from './moments/Section';
import { AdminHomePage } from './pages/AdminHomePage';
import { ReviewSection } from './review/Section';
import { ADMIN_HOME, adminLanding, legacyAdminPath } from './sections';

const SECTION_SCREENS: Record<AdminSectionKey, ComponentType> = {
  review: ReviewSection,
  members: MembersSection,
  advisors: AdvisorsSection,
  channels: ChannelsSection,
  events: EventsSection,
  announcements: AnnouncementsSection,
  reports: ReportsSection,
};

/** /admin itself: an old ?tab= link, the only section of a one-section role, or the overview. */
/** /admin 本身：旧的 ?tab= 链接、单板块身份的唯一板块，或管理首页。 */
function AdminIndex() {
  const { search } = useLocation();
  const role = useSessionStore((s) => s.member?.role ?? 'student');
  const legacy = legacyAdminPath(search);
  if (legacy !== null && legacy !== ADMIN_HOME) return <Navigate to={legacy} replace />;
  const landing = adminLanding(role);
  if (landing) return <Navigate to={landing} replace />;
  if (legacy === ADMIN_HOME) return <Navigate to={ADMIN_HOME} replace />;
  return <AdminHomePage />;
}

/**
 * A section the viewed role can't use goes back to the overview with a toast; the server would refuse its data
 * anyway. This also covers a system admin who starts testing a role while on a section.
 * 当前视角的身份不能使用的板块会回到管理首页并显示提示；服务器无论如何也会拒绝提供它的数据。系统管理员在某个板块中开始测试身份时也由此处理。
 */
function SectionGate({ section }: { section: AdminSectionKey }) {
  const role = useSessionStore((s) => s.member?.role ?? 'student');
  const allowed = canUseAdminSection(role, section);
  useEffect(() => {
    if (!allowed) toast(translate('你没有这个板块的权限', "You don't have access to that section"));
  }, [allowed]);
  if (!allowed) return <Navigate to={ADMIN_HOME} replace />;
  const Screen = SECTION_SCREENS[section];
  return <Screen />;
}

export default function AdminRoutes() {
  const member = useSessionStore((s) => s.member);
  if (!canOpenAdmin(member)) return <Navigate to="/" replace />;
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminIndex />} />
        {(Object.keys(SECTION_SCREENS) as AdminSectionKey[]).map((section) => (
          <Route key={section} path={`${section}/*`} element={<SectionGate section={section} />} />
        ))}
        <Route path="*" element={<Navigate to={ADMIN_HOME} replace />} />
      </Route>
    </Routes>
  );
}
