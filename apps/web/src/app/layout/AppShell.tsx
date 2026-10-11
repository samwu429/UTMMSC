import { NavLink, Outlet } from 'react-router-dom';
import { hasPermission } from '@utmmsc/shared';
import { useSessionStore } from '../../shared/session/store';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const BASE_NAV: NavItem[] = [
  { to: '/', label: '首页', icon: '⌂' },
  { to: '/chat', label: '聊天', icon: '✉' },
  { to: '/directory', label: '成员', icon: '☰' },
  { to: '/files', label: '文件', icon: '▤' },
];

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
    ? [...BASE_NAV, { to: '/admin', label: '管理', icon: '⚙' }, { to: '/settings', label: '我的', icon: '●' }]
    : [...BASE_NAV, { to: '/settings', label: '我的', icon: '●' }];

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <main className="flex-1 px-4 pb-24 pt-6">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 border-t border-brand-100 bg-white/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="mx-auto flex max-w-2xl justify-around">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-medium ${isActive ? 'text-brand-800' : 'text-slate-500'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={`h-1 w-5 rounded-full ${isActive ? 'bg-accent-400' : 'bg-transparent'}`} />
                  <span className="text-lg leading-none">{item.icon}</span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
