import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { authApi } from '../../features/auth/api';
import { useSessionStore } from '../../shared/session/store';

type IconName = 'home' | 'chat' | 'people' | 'files' | 'admin' | 'me';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const LEFT_NAV: NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/directory', label: '成员', icon: 'people' },
];

const RIGHT_NAV: NavItem[] = [{ to: '/files', label: '文件', icon: 'files' }];

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
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function SideTab({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex min-h-[52px] flex-1 flex-col items-center justify-center text-[11px] ${isActive ? 'text-brand-800' : 'text-stone-400'}`
      }
    >
      {({ isActive }) => (
        <>
          <TabIcon name={item.icon} />
          <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
          <span className={`mt-0.5 h-[3px] w-4 ${isActive ? 'bg-gold' : 'bg-transparent'}`} />
        </>
      )}
    </NavLink>
  );
}

function ChatTab() {
  return (
    <NavLink to="/chat" className="flex w-[4.75rem] flex-col items-center justify-end">
      {({ isActive }) => (
        <>
          <span className={`-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-800 text-white ring-4 ring-paper outline outline-[3px] ${isActive ? 'outline-gold' : 'outline-gold/70'}`}>
            <TabIcon name="chat" />
          </span>
          <span className={`mt-1 text-[11px] ${isActive ? 'font-medium text-brand-800' : 'text-brand-700'}`}>聊天</span>
        </>
      )}
    </NavLink>
  );
}

/** Mobile-first shell: scrolling content above a fixed bottom tab bar. */
/** 手机优先的外壳：内容区在上，固定的底部标签栏在下。 */
export function AppShell() {
  const member = useSessionStore((s) => s.member);
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
  const staff =
    member &&
    (hasPermission(member.role, 'members.approve') ||
      hasPermission(member.role, 'channels.manage') ||
      hasPermission(member.role, 'events.manage'));
  const right = staff
    ? [...RIGHT_NAV, { to: '/admin', label: '管理', icon: 'admin' as const }, { to: '/settings', label: '我的', icon: 'me' as const }]
    : [...RIGHT_NAV, { to: '/settings', label: '我的', icon: 'me' as const }];

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pb-28 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-paper" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-2xl items-end">
          <div className="flex flex-1">
            {LEFT_NAV.map((item) => (
              <SideTab key={item.to} item={item} />
            ))}
          </div>
          <ChatTab />
          <div className="flex flex-1">
            {right.map((item) => (
              <SideTab key={item.to} item={item} />
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}
