import { Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { canOpenAdmin } from '@utmmsc/shared';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { ChatOverviewPage } from '../features/chat/pages/ChatOverviewPage';
import { HomePage } from '../features/home/pages/HomePage';
import { NotificationBridge } from '../features/notifications/NotificationBridge';
import { syncRegistration } from '../features/notifications/notifications';
import { refreshMember } from '../features/auth/refreshMember';
import { useLocaleStore } from '../shared/i18n/locale';
import { useSessionStore } from '../shared/session/store';
import { ConfirmProvider } from '../shared/ui/confirm';
import { AppShell } from './layout/AppShell';
import { StatusBarScrim } from './layout/StatusBarScrim';
import {
  AdminRoutes,
  ApplyPage,
  ChatInfoPage,
  ChatSearchPage,
  DiscoverPage,
  FilesPage,
  ForgotPage,
  MemberMomentsPage,
  MemberPage,
  MiniappsPage,
  MomentDetailPage,
  MomentNoticesPage,
  MomentSettingsPage,
  MomentsPage,
  RegisterPage,
  RoomPage,
  SettingsPage,
  TimetablePage,
  preloadLikelyPages,
} from './pages';
import { PageBoundary, PageFallback } from './RouteFallback';
import { SplashScreen } from './SplashScreen';

/**
 * Also refreshes the stored member and media token once per sign-in, for every signed-in route,
 * including rooms opened straight from a link outside the tab shell, and again when the app comes back
 * to the foreground, so role changes made by others reach the screens that depend on them.
 * 每次登录后为所有需登录的页面刷新一次本地成员资料与媒体令牌，包括从链接直接打开、不在标签外壳里的房间；应用回到前台时也会再刷新，
 * 别人做的身份修改因此能反映到依赖它的页面上。
 */
function RequireSession() {
  const token = useSessionStore((s) => s.token);
  useEffect(() => {
    if (!token) return;
    void refreshMember({ force: true });
    // The server ties each device to a session, so every sign-in registers it again.
    // 服务器把每台设备绑定到会话，因此每次登录都要重新登记。
    void syncRegistration();
    const onForeground = () => {
      if (document.visibilityState === 'visible') void refreshMember();
    };
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
    };
  }, [token]);
  // Once signed in, the likely next pages load while the browser is idle.
  // 登录之后，接下来可能打开的页面会在浏览器空闲时加载。
  useEffect(() => (token ? preloadLikelyPages() : undefined), [token]);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

function RequireGuest() {
  const token = useSessionStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <Outlet />;
}

/**
 * The same registry the admin shell and 发现 use. Checked here too, so a member who can't open admin never
 * downloads its chunk.
 * 与管理后台框架和「发现」使用同一个权限表。这里也检查一次，不能进入管理后台的成员就永远不会下载它的分块。
 */
function RequireAdmin() {
  const member = useSessionStore((s) => s.member);
  return canOpenAdmin(member) ? <Outlet /> : <Navigate to="/" replace />;
}

function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  }, [locale]);
  return children;
}

/**
 * Pages outside the tab shell load inside this boundary; the shell has its own around its content, so the tab bar
 * stays while a tab's page loads.
 * 标签外壳之外的页面在这个边界内加载；外壳在自己的内容外面另有一个，所以标签页加载时标签栏一直都在。
 */
function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <PageBoundary resetKey={pathname} fullScreen>
      <Suspense fallback={<PageFallback fullScreen />}>
        <Routes>
          <Route element={<RequireGuest />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/apply" element={<ApplyPage />} />
            <Route path="/forgot" element={<ForgotPage />} />
          </Route>
          <Route element={<RequireSession />}>
            <Route path="/chat/room/:roomId" element={<RoomPage />} />
            <Route path="/chat/room/:roomId/info" element={<ChatInfoPage />} />
            <Route path="/chat/search" element={<ChatSearchPage />} />
            {/* 好友动态 scrolls the document and has no tab bar, so its pages sit outside the shell. */}
            {/* 好友动态由文档滚动，也没有标签栏，因此这些页面位于外壳之外。 */}
            <Route path="/discover/feed" element={<MomentsPage />} />
            <Route path="/discover/feed/post/:postId" element={<MomentDetailPage />} />
            <Route path="/discover/feed/notices" element={<MomentNoticesPage />} />
            <Route path="/discover/feed/member/:memberId" element={<MemberMomentsPage />} />
            <Route path="/discover/feed/settings" element={<MomentSettingsPage />} />
            {/* The timetable has its own header and no tab bar; /timetable/due is its 作业 tab. */}
            {/* 课表有自己的标题栏，没有标签栏；/timetable/due 是它的「作业」标签。 */}
            <Route path="/timetable/*" element={<TimetablePage />} />
            {/* Admin is its own app: a phone stack of screens, a sidebar on desktop, and the old ?tab= links. */}
            {/* 管理后台自成一体：手机上是一层层的界面，桌面上有侧边栏，并处理旧的 ?tab= 链接。 */}
            <Route element={<RequireAdmin />}>
              <Route path="/admin/*" element={<AdminRoutes />} />
            </Route>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/chat" element={<ChatOverviewPage />} />
              <Route path="/directory" element={<Navigate to="/chat?tab=members" replace />} />
              <Route path="/directory/:id" element={<MemberPage />} />
              <Route path="/miniapps" element={<MiniappsPage />} />
              <Route path="/discover" element={<DiscoverPage />} />
              <Route path="/files" element={<FilesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </PageBoundary>
  );
}

export function App() {
  return (
    <LocaleRoot>
    {/* startTransition keeps the current screen up while the next page's chunk loads, instead of a blank fallback. */}
    {/* startTransition 让当前界面一直显示到下一个页面的分块加载完成，而不是先显示空白占位。 */}
    <BrowserRouter basename="/UTMMSC" future={{ v7_startTransition: true }}>
      <ConfirmProvider>
      <AppRoutes />
      <NotificationBridge />
      <StatusBarScrim />
      <SplashScreen />
      </ConfirmProvider>
    </BrowserRouter>
    </LocaleRoot>
  );
}
