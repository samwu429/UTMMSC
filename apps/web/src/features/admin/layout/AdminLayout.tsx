import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';
import { useSessionStore } from '../../../shared/session/store';
import { useAdminSummary } from '../state/summaryStore';
import { adminHistory, type NavigationKind } from './adminHistory';
import { AdminSidebar } from './AdminSidebar';
import { useIsDesktop } from './media';

const ROOT_STYLE: CSSProperties = { paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' };

/** Scroll positions of the admin entries visited, by router key, so going back lands where the screen was left. */
/** 按路由 key 记录访问过的管理后台记录的滚动位置，返回时回到离开该界面时的位置。 */
const scrollPositions = new Map<string, number>();
const SCROLL_MEMORY = 60;

function rememberScroll(key: string, y: number): void {
  scrollPositions.delete(key);
  scrollPositions.set(key, y);
  if (scrollPositions.size > SCROLL_MEMORY) {
    const oldest = scrollPositions.keys().next().value;
    if (oldest !== undefined) scrollPositions.delete(oldest);
  }
}

/**
 * Admin scrolls the document, like the rest of the app. A new screen starts at the top; back and forward return to
 * the position the entry had. A list kept mounted under its item screen gets its place back the same way.
 * 管理后台与应用其他部分一样由文档滚动。新的界面从顶部开始；返回和前进回到该记录原来的位置。挂载在项目界面之下的列表也以同样的方式恢复位置。
 */
function useScrollMemory(key: string, kind: NavigationKind): void {
  const current = useRef(key);
  useLayoutEffect(() => {
    current.current = key;
    const saved = kind === 'POP' ? scrollPositions.get(key) : undefined;
    window.scrollTo(0, saved ?? 0);
  }, [key, kind]);
  useEffect(() => {
    // Saved on every scroll event, so the position of the entry being left is always current when a navigation starts.
    // 每次滚动都保存，因此开始导航时，正要离开的记录的位置总是最新的。
    const onScroll = () => rememberScroll(current.current, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}

/** Every location admin shows goes into adminHistory, so back buttons can tell a real step back from a deep link. */
/** 管理后台显示的每个位置都写入 adminHistory，返回按钮因此能分辨真正的后退和直接打开的链接。 */
function useHistoryRecord(key: string, location: string, kind: NavigationKind): void {
  useLayoutEffect(() => {
    adminHistory.record(key, location, kind);
  }, [key, location, kind]);
  useEffect(() => () => adminHistory.leave(), []);
}

/**
 * The summary behind the badges: asked on entering admin, again when the member or the viewed role changes while admin
 * stays open (回到系统管理员 empties it), and whenever the app comes back to the foreground.
 * 角标背后的摘要：进入管理后台时查询；管理后台仍打开而成员或当前视角的身份改变时再查询（「回到系统管理员」会清空摘要）；
 * 此后每当应用回到前台时也查询。
 */
export function useSummarySync(): void {
  const memberId = useSessionStore((s) => s.member?.id);
  const role = useSessionStore((s) => s.member?.role);
  useEffect(() => {
    // After a change of member or role the session subscriber has already emptied the summary, so this asks at once
    // and its answer is kept.
    // 成员或身份改变之后，会话订阅已经清空了摘要，所以这里会立即查询，结果也会被保留。
    void useAdminSummary.getState().refresh();
  }, [memberId, role]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void useAdminSummary.getState().refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}

/**
 * The frame of every admin screen, outside AppShell: no tab bar, the gray canvas, and from 1024px the sidebar beside
 * the content column. Phones show one screen at a time.
 * 每个管理界面的外框，位于 AppShell 之外：没有标签栏，灰色底，从 1024px 起内容栏旁边显示侧边栏。手机上一次只显示一个界面。
 */
export function AdminLayout() {
  const location = useLocation();
  const kind = String(useNavigationType()) as NavigationKind;
  const desktop = useIsDesktop();
  useHistoryRecord(location.key, `${location.pathname}${location.search}`, kind);
  useScrollMemory(location.key, kind);
  useSummarySync();

  return (
    <div className="min-h-[100dvh] bg-wx-canvas" style={ROOT_STYLE}>
      <div className={desktop ? 'grid min-h-[100dvh] grid-cols-[240px_minmax(0,1fr)]' : undefined}>
        {desktop ? <AdminSidebar /> : null}
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
