import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useLabels } from '../../shared/i18n/locale';
import { adminApi } from '../../features/admin/api';
import { UnreadDot } from '../../features/chat/components/UnreadDot';
import { showDot, totalUnread, useOverviewStore } from '../../features/chat/state/overviewStore';
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

const NAV_EN: Record<string, string> = {
  首页: 'Home',
  小程序: 'Mini apps',
  我的: 'Me',
  发现: 'Discover',
  聊天: 'Chat',
};

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

function TabFace({ icon, label, active }: { icon: IconName; label: string; active: boolean }) {
  return (
    <>
      <span className="relative flex h-6 w-full items-center justify-center">
        <TabIcon name={icon} />
      </span>
      <span className={`mt-1 h-4 w-full truncate text-center leading-4 ${active ? 'font-medium' : ''}`}>{label}</span>
      <span className={`mt-1 h-[3px] w-4 rounded-full ${active ? 'bg-gold' : 'bg-transparent'}`} />
    </>
  );
}

function SideTab({ item }: { item: NavItem }) {
  const { tr } = useLabels();
  return (
    <NavLink to={item.to} end={item.to === '/'} className={({ isActive }) => tabClass(isActive)}>
      {({ isActive }) => <TabFace icon={item.icon} label={tr(item.label, NAV_EN[item.label] ?? item.label)} active={isActive} />}
    </NavLink>
  );
}

function DiscoverTab() {
  const { tr } = useLabels();
  const { pathname } = useLocation();
  const isActive = pathname.startsWith('/discover') || pathname.startsWith('/files') || pathname.startsWith('/admin');
  return (
    <NavLink to="/discover" className={tabClass(isActive)}>
      <TabFace icon="discover" label={tr('发现', 'Discover')} active={isActive} />
    </NavLink>
  );
}

function ChatTab() {
  const { tr } = useLabels();
  const { pathname } = useLocation();
  const isActive = pathname === '/chat' || pathname.startsWith('/directory');
  const unread = useOverviewStore((s) => totalUnread(s.data));
  const dot = useOverviewStore((s) => showDot(s.data));
  const wasActive = useRef(isActive);
  const [motion, setMotion] = useState<'idle' | 'drop' | 'rise'>('idle');

  useEffect(() => {
    if (wasActive.current === isActive) return;
    wasActive.current = isActive;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Only the tap that enters or leaves chat plays; the first paint stays still.
    // 只有点进或点出聊天才播放，第一次画出来时不动。
    setMotion(reduce ? 'idle' : isActive ? 'drop' : 'rise');
  }, [isActive]);

  const place = isActive ? 'is-settled' : 'is-raised';

  return (
    <NavLink to="/chat" className={tabClass(isActive)}>
      <span className="relative flex h-6 w-full items-center justify-center">
        <span
          className={`chat-blob ${place} ${isActive ? 'is-active' : ''} ${motion === 'drop' ? 'chat-drop' : ''} ${motion === 'rise' ? 'chat-rise' : ''}`}
          onAnimationEnd={(event) => {
            if (event.animationName === 'chat-drop' || event.animationName === 'chat-rise') setMotion('idle');
          }}
        />
        <span className={`chat-glyph ${place} ${motion === 'drop' ? 'chat-drop-glyph' : ''} ${motion === 'rise' ? 'chat-rise-glyph' : ''}`}>
          <TabIcon name="chat" />
          {/* The badge rides on the glyph, so it follows the drop and rise animations. */}
          {/* 角标挂在图标上，随落下和浮起动画一起移动。 */}
          <UnreadDot
            count={unread}
            dot={unread === 0 && dot}
            className={`absolute shadow-[0_0_0_1.5px_#fff] ${unread > 0 ? '-top-[7px] left-[14px]' : '-top-[2px] left-[19px]'}`}
          />
        </span>
      </span>
      <span className={`mt-1 h-4 w-full truncate text-center leading-4 ${isActive ? 'font-medium' : 'text-brand-700'}`}>{tr('聊天', 'Chat')}</span>
      {unread > 0 ? (
        <span className="sr-only">{tr(`，${unread} 条未读`, `, ${unread} unread`)}</span>
      ) : dot ? (
        <span className="sr-only">{tr('，有未读消息', ', unread messages')}</span>
      ) : null}
      <span className={`mt-1 h-[3px] w-4 rounded-full ${isActive ? 'bg-gold' : 'bg-transparent'}`} />
    </NavLink>
  );
}

const TITLE_PREFIX = /^\(\d+\) /;

/** Home-screen icon badge where the browser supports it. Failures are ignored; the badge is a hint. */
/** 在支持的浏览器上设置主屏幕图标角标。失败时忽略；角标只是提示。 */
function setIconBadge(count: number) {
  try {
    if (typeof navigator === 'undefined') return;
    if (count > 0 && typeof navigator.setAppBadge === 'function') navigator.setAppBadge(count).catch(() => undefined);
    else if (count === 0 && typeof navigator.clearAppBadge === 'function') navigator.clearAppBadge().catch(() => undefined);
  } catch {
    // Some browsers expose the API but throw outside an installed app.
    // 部分浏览器提供了该接口，但在未安装的应用中会抛错。
  }
}

function setTitleCount(count: number) {
  const base = document.title.replace(TITLE_PREFIX, '');
  document.title = count > 0 ? `(${count}) ${base}` : base;
}

/**
 * Keeps the conversation list fresh without a global timer: once on mount, then whenever the app
 * returns to the foreground, regains focus or comes back online. The chat tab adds its own polling.
 * 不使用全局定时器保持会话列表最新：挂载时加载一次，之后在应用回到前台、重新获得焦点或网络恢复时加载。聊天页另有自己的轮询。
 */
function useOverviewSync() {
  useEffect(() => {
    const store = useOverviewStore.getState();
    void store.refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void store.refresh({ resume: true });
    };
    const onFocus = () => void store.refresh();
    const onOnline = () => void store.refresh({ force: true, resume: true });
    const onOffline = () => store.setOffline(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);
}

/** Unread count in the document title and on the home-screen icon. Muted chats are not counted. */
/** 把未读数写到页面标题和主屏幕图标上。免打扰的会话不计入。 */
function useUnreadIndicators() {
  const unread = useOverviewStore((s) => totalUnread(s.data));
  useEffect(() => {
    setTitleCount(unread);
    setIconBadge(unread);
  }, [unread]);
  useEffect(
    () => () => {
      // Signing out leaves the shell; the next member must not inherit the count.
      // 退出登录会离开外壳；下一个成员不能沿用这个数字。
      if (useSessionStore.getState().token) return;
      setTitleCount(0);
      setIconBadge(0);
    },
    [],
  );
}

/**
 * Content padding: below the status bar, above the tab bar and the home indicator under it. The sides stay
 * 1rem unless a landscape cutout reaches past the margin the centred 42rem column already has.
 * 内容区留白：顶部让出状态栏，底部让出标签栏及其下方的主屏幕指示条。左右保持 1rem，除非横屏时刘海超出了居中的 42rem 内容栏本身的边距。
 */
const MAIN_PADDING: CSSProperties = {
  paddingTop: 'calc(1.25rem + var(--safe-top))',
  paddingBottom: 'calc(7rem + var(--safe-bottom))',
  paddingLeft: 'max(1rem, calc(var(--safe-left) - max(0px, (100vw - 42rem) / 2)))',
  paddingRight: 'max(1rem, calc(var(--safe-right) - max(0px, (100vw - 42rem) / 2)))',
};

/** Mobile-first shell: scrolling content above a fixed bottom tab bar. */
/** 手机优先的外壳：内容区在上，固定的底部标签栏在下。 */
export function AppShell() {
  const { tr, role } = useLabels();
  const setMember = useSessionStore((s) => s.setMember);
  const member = useSessionStore((s) => s.member);
  const right = RIGHT_NAV;
  useOverviewSync();
  useUnreadIndicators();

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col">
      <main className="flex-1" style={MAIN_PADDING}>
        {member?.realRole === 'superadmin' && member.actingRole ? (
          <div className="-mx-4 mb-5 flex items-center justify-between gap-3 bg-brand-800 px-4 py-2 text-sm text-white">
            <span className="min-w-0 truncate">{tr(`正在以${role(member.actingRole)}测试`, `Testing as ${role(member.actingRole)}`)}</span>
            <button
              type="button"
              className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-brand-800"
              onClick={() => {
                adminApi.setActingRole(null).then((res) => setMember(res.member)).catch(() => undefined);
              }}
            >
              {tr('回到系统管理员', 'Back to system administrator')}
            </button>
          </div>
        ) : null}
        <Outlet />
      </main>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 overflow-visible border-t border-stone-200 bg-white"
        style={{ paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
      >
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
