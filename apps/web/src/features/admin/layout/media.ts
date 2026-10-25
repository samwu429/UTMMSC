import { createContext, useContext, useSyncExternalStore } from 'react';

/** Sidebar from here up (Tailwind lg). */
/** 从此宽度起显示侧边栏（Tailwind 的 lg）。 */
export const DESKTOP_QUERY = '(min-width: 1024px)';
/** List and detail side by side from here up (Tailwind xl). */
/** 从此宽度起列表与详情并排显示（Tailwind 的 xl）。 */
export const WIDE_QUERY = '(min-width: 1280px)';

function subscribeTo(query: string) {
  return (listener: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const list = window.matchMedia(query);
    list.addEventListener('change', listener);
    return () => list.removeEventListener('change', listener);
  };
}

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

const subscribeDesktop = subscribeTo(DESKTOP_QUERY);
const subscribeWide = subscribeTo(WIDE_QUERY);
const readDesktop = () => matches(DESKTOP_QUERY);
const readWide = () => matches(WIDE_QUERY);
const never = () => false;

/** True at 1024px and wider: the sidebar is the navigation, and top-level screens drop their back button. */
/** 宽度不小于 1024px 时为 true：侧边栏即导航，顶层界面不再显示返回按钮。 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, readDesktop, never);
}

/** True at 1280px and wider: list sections show the list and the selected item side by side. */
/** 宽度不小于 1280px 时为 true：列表类板块并排显示列表和所选项目。 */
export function useIsWide(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, never);
}

/**
 * Which part of the window a screen is drawn in: `main` fills the content column (and the whole screen on phones),
 * `list` and `detail` are the two panes of a split view.
 * 界面绘制在窗口的哪一部分：`main` 占满内容栏（手机上占满整个屏幕），`list` 和 `detail` 是分栏视图的两栏。
 */
export type AdminPane = 'main' | 'list' | 'detail';

export const AdminPaneContext = createContext<AdminPane>('main');

export function useAdminPane(): AdminPane {
  return useContext(AdminPaneContext);
}

/**
 * Groups are full-bleed rows on phones and in the narrow list pane, and rounded cards elsewhere on desktop.
 * 分组在手机上和较窄的列表栏中是通栏行，在桌面的其他位置是圆角卡片。
 */
export function useInsetGroups(): boolean {
  const desktop = useIsDesktop();
  const pane = useAdminPane();
  return desktop && pane !== 'list';
}
