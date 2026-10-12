import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { authApi } from '../../features/auth/api';
import { useSessionStore } from '../../shared/session/store';

type IconName = 'home' | 'chat' | 'people' | 'files' | 'admin' | 'me' | 'discover' | 'apps';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const LEFT_NAV: NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/miniapps', label: '小程序', icon: 'apps' },
];

const RIGHT_NAV: NavItem[] = [{ to: '/settings', label: '我的', icon: 'me' }];

function TabIcon({ name }: { name: IconName }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'h-6 w-6',
    'aria-hidden': true,
  };
  const paths: Record<IconName, ReactNode> = {
    home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />,
    chat: <path d="M5 6.5h14a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7.5a1 1 0 0 1 1-1Z" />,
    people: (
      <>
        <circle cx="9" cy="9" r="2.5" />
        <path d="M4.5 18.5c.6-2.2 2.4-3.5 4.5-3.5s3.9 1.3 4.5 3.5" />
        <circle cx="16" cy="9.5" r="2" />
        <path d="M16 15c1.6.2 3 1.2 3.6 3" />
      </>
    ),
    files: <path d="M7 3.5h7l5 5V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Zm7 0v5h5" />,
    admin: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.2M12 18.3v2.2M4.8 6.5l1.6 1.6M17.6 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.5l1.6-1.6M17.6 8.1l1.6-1.6" />
      </>
    ),
    me: (
      <>
        <circle cx="12" cy="9" r="3" />
        <path d="M6 19.5c.9-2.6 3-4 6-4s5.1 1.4 6 4" />
      </>
    ),
    discover: (
      <>
        <circle cx="12" cy="12" r="7.5" />
        <path d="m14.8 9.2-1.1 4.5-4.5 1.1 1.1-4.5 4.5-1.1Z" />
      </>
    ),
    apps: (
      <>
        <rect x="4" y="4" width="7" height="7" rx="1.6" />
        <rect x="13" y="4" width="7" height="7" rx="1.6" />
        <rect x="4" y="13" width="7" height="7" rx="1.6" />
        <rect x="13" y="13" width="7" height="7" rx="1.6" />
      </>
    ),
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function tabClass(active: boolean) {
  return `flex flex-col items-center justify-end px-0.5 pb-1.5 pt-2 text-[11px] ${active ? 'text-brand-800' : 'text-stone-400'}`;
}

function TabFace({ icon, label, active, raised = false }: { icon: IconName; label: string; active: boolean; raised?: boolean }) {
  return (
    <>
      <span className="relative flex h-6 w-full items-center justify-center">
        {raised ? (
          <span
            className={`absolute bottom-0 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-brand-800 text-white ring-4 ring-paper outline outline-[3px] ${active ? 'outline-gold' : 'outline-gold/70'}`}
          >
            <TabIcon name={icon} />
          </span>
        ) : (
          <TabIcon name={icon} />
        )}
      </span>
      <span className={`mt-1 h-4 w-full truncate text-center leading-4 ${active ? 'font-medium' : ''} ${raised && !active ? 'text-brand-700' : ''}`}>
        {label}
      </span>
      <span className={`mt-1 h-[3px] w-4 rounded-full ${active ? 'bg-gold' : 'bg-transparent'}`} />
    </>
  );
}

function SideTab({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => tabClass(isActive)}>
      {({ isActive }) => <TabFace icon={item.icon} label={item.label} active={isActive} />}
    </NavLink>
  );
}

function DiscoverTab() {
  const { pathname } = useLocation();
  const isActive = pathname.startsWith('/discover') || pathname.startsWith('/files') || pathname.startsWith('/admin');
  return (
    <NavLink to="/discover" className={tabClass(isActive)}>
      <TabFace icon="discover" label="发现" active={isActive} />
    </NavLink>
  );
}

function ChatTab() {
  const { pathname } = useLocation();
  const isActive = pathname === '/chat' || pathname.startsWith('/directory');
  return (
    <NavLink to="/chat" className={tabClass(isActive)}>
      <TabFace icon="chat" label="聊天" active={isActive} raised />
    </NavLink>
  );
}

/** Mobile-first shell: scrolling content above a fixed bottom tab bar. */
/** 手机优先的外壳：内容区在上，固定的底部标签栏在下。 */
export function AppShell() {
  const setMember = useSessionStore((s) => s.setMember);
  const setMediaToken = useSessionStore((s) => s.setMediaToken);

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setMember(res.member);
        setMediaToken(res.mediaToken);
      })
      .catch(() => undefined);
  }, [setMember, setMediaToken]);
  const right = RIGHT_NAV;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pb-28 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 overflow-visible border-t border-stone-200 bg-paper" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto grid max-w-2xl grid-cols-5 items-end">
          {LEFT_NAV.map((item) => (
            <SideTab key={item.to} item={item} />
          ))}
          <ChatTab />
          <DiscoverTab />
          {right.map((item) => (
            <SideTab key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </div>
  );
}
