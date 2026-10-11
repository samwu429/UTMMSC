import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';

type IconName = 'home' | 'chat' | 'people' | 'files' | 'admin' | 'me';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

const BASE_NAV: NavItem[] = [
  { to: '/', label: '首页', icon: 'home' },
  { to: '/chat', label: '聊天', icon: 'chat' },
  { to: '/directory', label: '成员', icon: 'people' },
  { to: '/files', label: '文件', icon: 'files' },
];

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

/** Mobile-first shell: scrolling content above a fixed bottom tab bar. */
/** 手机优先的外壳：内容区在上，固定的底部标签栏在下。 */
export function AppShell() {
  const member = useSessionStore((s) => s.member);
  const staff =
    member &&
    (hasPermission(member.role, 'members.approve') ||
      hasPermission(member.role, 'channels.manage') ||
      hasPermission(member.role, 'events.manage'));
  const items = staff
    ? [...BASE_NAV, { to: '/admin', label: '管理', icon: 'admin' as const }, { to: '/settings', label: '我的', icon: 'me' as const }]
    : [...BASE_NAV, { to: '/settings', label: '我的', icon: 'me' as const }];

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pb-24 pt-5">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-[#f7f6f3]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-2xl">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-brand-800' : 'text-stone-500'}`
              }
            >
              {({ isActive }) => (
                <>
                  <TabIcon name={item.icon} />
                  <span className={isActive ? 'font-medium' : ''}>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
