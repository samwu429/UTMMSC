import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { AdminPage } from '../features/admin/pages/AdminPage';
import { ApplyPage } from '../features/auth/pages/ApplyPage';
import { ForgotPage } from '../features/auth/pages/ForgotPage';
import { LoginPage } from '../features/auth/pages/LoginPage';
import { RegisterPage } from '../features/auth/pages/RegisterPage';
import { ChatOverviewPage } from '../features/chat/pages/ChatOverviewPage';
import { RoomPage } from '../features/chat/pages/RoomPage';
import { MemberPage } from '../features/directory/pages/MemberPage';
import { DiscoverFeedPage } from '../features/discover/pages/DiscoverFeedPage';
import { DiscoverPage } from '../features/discover/pages/DiscoverPage';
import { FilesPage } from '../features/files/pages/FilesPage';
import { HomePage } from '../features/home/pages/HomePage';
import { MiniappsPage } from '../features/miniapps/pages/MiniappsPage';
import { SettingsPage } from '../features/settings/pages/SettingsPage';
import { useSessionStore } from '../shared/session/store';
import { AppShell } from './layout/AppShell';

function RequireSession() {
  const token = useSessionStore((s) => s.token);
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

export function App() {
  return (
    <BrowserRouter basename="/UTMMSC">
      <Routes>
        <Route element={<RequireGuest />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/apply" element={<ApplyPage />} />
          <Route path="/forgot" element={<ForgotPage />} />
        </Route>
        <Route element={<RequireSession />}>
          <Route path="/chat/room/:roomId" element={<RoomPage />} />
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
    </BrowserRouter>
  );
}
