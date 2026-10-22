import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { ApplyPage } from '../features/auth/pages/ApplyPage';
import { ForgotPage } from '../features/auth/pages/ForgotPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { ChatInfoPage } from '../features/chat/pages/ChatInfoPage';
import { ChatOverviewPage } from '../features/chat/pages/ChatOverviewPage';
import { ChatSearchPage } from '../features/chat/pages/ChatSearchPage';
import { RoomPage } from '../features/chat/pages/RoomPage';
import { MemberPage } from '../features/directory/pages/MemberPage';
import { DiscoverFeedPage } from '../features/discover/pages/DiscoverFeedPage';
import { DiscoverPage } from '../features/discover/pages/DiscoverPage';
import { FilesPage } from '../features/files/pages/FilesPage';
import { HomePage } from '../features/home/pages/HomePage';
import { MiniappsPage } from '../features/miniapps/pages/MiniappsPage';
import { SettingsPage } from '../features/settings/pages/SettingsPage';
import { authApi } from '../features/auth/api';
import { useLocaleStore } from '../shared/i18n/locale';
import { useSessionStore } from '../shared/session/store';
import { ConfirmProvider } from '../shared/ui/confirm';
import { AppShell } from './layout/AppShell';
import { SplashScreen } from './SplashScreen';

/**
 * Also refreshes the stored member and media token once per sign-in, for every signed-in route,
 * including rooms opened straight from a link outside the tab shell.
 * 每次登录后为所有需登录的页面刷新一次本地成员资料与媒体令牌，包括从链接直接打开、不在标签外壳里的房间。
 */
function RequireSession() {
  const token = useSessionStore((s) => s.token);
  const setMember = useSessionStore((s) => s.setMember);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);
  useEffect(() => {
    if (!token) return;
    authApi
      .me()
      .then((res) => {
        setMember(res.member);
        setMediaToken(res.mediaToken);
      })
      .catch(() => undefined);
  }, [token, setMember, setMediaToken]);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

function RequireGuest() {
  const token = useSessionStore((s) => s.token);
  return token ? <Navigate to="/" replace /> : <Outlet />;
}

function RequireStaff() {
  const member = useSessionStore((s) => s.member);
  const allowed =
    member &&
    (hasPermission(member.role, 'members.approve') ||
      hasPermission(member.role, 'channels.manage') ||
      hasPermission(member.role, 'events.manage'));
  return allowed ? <Outlet /> : <Navigate to="/" replace />;
}

function LocaleRoot({ children }: { children: ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN';
  }, [locale]);
  return children;
}

export function App() {
  return (
    <LocaleRoot>
    <BrowserRouter basename="/UTMMSC">
      <ConfirmProvider>
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
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/chat" element={<ChatOverviewPage />} />
            <Route path="/directory" element={<Navigate to="/chat?tab=members" replace />} />
            <Route path="/directory/:id" element={<MemberPage />} />
            <Route path="/miniapps" element={<MiniappsPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/discover/feed" element={<DiscoverFeedPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route element={<RequireStaff />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <SplashScreen />
      </ConfirmProvider>
    </BrowserRouter>
    </LocaleRoot>
  );
}
