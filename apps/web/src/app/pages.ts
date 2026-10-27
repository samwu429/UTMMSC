import { lazy, type ComponentType } from 'react';
import { chunkReloader } from './chunkReload';

/**
 * Pages that load on demand. Home, the chat list and sign-in stay in the main bundle because a launch opens one
 * of them; everything else is its own chunk. Workbox precaches every chunk, so they open offline too.
 * 按需加载的页面。首页、聊天列表和登录页留在主包里，因为启动时打开的总是其中之一；其余页面各自成块。Workbox 会预缓存所有分块，
 * 所以离线时也能打开。
 */

/**
 * A lazy page whose chunk may be gone after a deploy: the page then reloads instead of failing, and the screen
 * keeps waiting until it does.
 * 部署后分块可能已经不存在的按需页面：这时页面会重新加载而不是报错，界面一直等到重新加载完成。
 */
function page<M>(load: () => Promise<M>, pick: (module: M) => ComponentType) {
  return lazy(async () => {
    try {
      return { default: pick(await load()) };
    } catch (error) {
      if (chunkReloader().reload()) return new Promise<never>(() => undefined);
      throw error;
    }
  });
}

const loadRoom = () => import('../features/chat/pages/RoomPage');
const loadMoments = () => import('../features/moments/pages/MomentsPage');
const loadDiscover = () => import('../features/discover/pages/DiscoverPage');
const loadSettings = () => import('../features/settings/pages/SettingsPage');
const loadMiniapps = () => import('../features/miniapps/pages/MiniappsPage');
const loadTimetable = () => import('../features/timetable/pages/TimetablePage');

export const RegisterPage = page(() => import('../features/auth/pages/RegisterPage'), (m) => m.RegisterPage);
export const ApplyPage = page(() => import('../features/auth/pages/ApplyPage'), (m) => m.ApplyPage);
export const ForgotPage = page(() => import('../features/auth/pages/ForgotPage'), (m) => m.ForgotPage);

export const RoomPage = page(loadRoom, (m) => m.RoomPage);
export const ChatInfoPage = page(() => import('../features/chat/pages/ChatInfoPage'), (m) => m.ChatInfoPage);
export const ChatSearchPage = page(() => import('../features/chat/pages/ChatSearchPage'), (m) => m.ChatSearchPage);
/** 我的表情, the sticker manage screen, opened from the chat panel's gear and from 设置. */
/** 「我的表情」表情管理界面，从聊天面板的齿轮和「设置」中打开。 */
export const StickersPage = page(() => import('../features/chat/pages/StickersPage'), (m) => m.StickersPage);

export const MomentsPage = page(loadMoments, (m) => m.MomentsPage);
export const MomentDetailPage = page(() => import('../features/moments/pages/MomentDetailPage'), (m) => m.MomentDetailPage);
export const MomentNoticesPage = page(() => import('../features/moments/pages/MomentNoticesPage'), (m) => m.MomentNoticesPage);
export const MemberMomentsPage = page(() => import('../features/moments/pages/MemberMomentsPage'), (m) => m.MemberMomentsPage);
export const MomentSettingsPage = page(() => import('../features/moments/pages/MomentSettingsPage'), (m) => m.MomentSettingsPage);

export const MemberPage = page(() => import('../features/directory/pages/MemberPage'), (m) => m.MemberPage);
export const MiniappsPage = page(loadMiniapps, (m) => m.MiniappsPage);
export const DiscoverPage = page(loadDiscover, (m) => m.DiscoverPage);
export const FilesPage = page(() => import('../features/files/pages/FilesPage'), (m) => m.FilesPage);
export const SettingsPage = page(loadSettings, (m) => m.SettingsPage);

/** /timetable/*: the week grid and its 作业 tab (timetable-final.md section 9). */
/** /timetable/*：周课表及其「作业」标签（timetable-final.md 第 9 节）。 */
export const TimetablePage = page(loadTimetable, (m) => m.default);
/** /admin/*: the admin shell and every section (admin-design.md 1.3). Ordinary members never load it. */
/** /admin/*：管理后台框架和所有板块（admin-design.md 1.3）。普通成员从不加载它。 */
export const AdminRoutes = page(() => import('../features/admin/AdminRoutes'), (m) => m.default);

/**
 * Loaded while the browser is idle after launch, most likely first: a chat room, 好友动态, the timetable (its card is
 * on 首页), then the other tabs. A tap on any of them then opens at once, without waiting for its chunk.
 * 启动后在浏览器空闲时加载，最可能先打开的排在前面：聊天室、好友动态、课表（它的卡片就在首页上），然后是其他标签页。
 * 点开它们时就能立即显示，不必等待分块。
 */
export const IDLE_PRELOADS: ReadonlyArray<() => Promise<unknown>> = [loadRoom, loadMoments, loadTimetable, loadDiscover, loadSettings, loadMiniapps];

/** How long after the page has loaded preloading starts, so it stays clear of the opening film and the first requests. */
/** 页面加载完成后多久开始预加载，以避开开屏影片和首批请求。 */
export const IDLE_PRELOAD_DELAY_MS = 1500;

interface IdleHost {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
}

/**
 * Runs the loaders one per idle period, in order. A failure is ignored (the page loads on demand later), and never
 * reloads the page. Returns a function that stops what has not started yet.
 * 每个空闲时段按顺序运行一个加载函数。失败会被忽略（之后按需加载即可），也绝不会因此重新加载页面。返回一个函数，用来停止尚未开始的加载。
 */
export function preloadOneByOne(loaders: ReadonlyArray<() => Promise<unknown>>, host: IdleHost, inBackground: (load: () => Promise<unknown>) => Promise<unknown>): () => void {
  let index = 0;
  let stopped = false;
  const schedule = () => {
    if (stopped || index >= loaders.length) return;
    const run = () => {
      if (stopped) return;
      const load = loaders[index++]!;
      void inBackground(load).then(schedule);
    };
    if (host.requestIdleCallback) host.requestIdleCallback(run, { timeout: 5000 });
    else host.setTimeout(run, 200);
  };
  schedule();
  return () => {
    stopped = true;
  };
}

/** Starts the idle preloading once the page has loaded, unless the device asks to save data. */
/** 页面加载完成后开始空闲预加载，除非设备要求节省流量。 */
export function preloadLikelyPages(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  let stop: (() => void) | null = null;
  let timer: number | undefined;
  const begin = () => {
    timer = window.setTimeout(() => {
      const reloader = chunkReloader();
      stop = preloadOneByOne(IDLE_PRELOADS, window, (load) => reloader.inBackground(load));
    }, IDLE_PRELOAD_DELAY_MS);
  };
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
  return () => {
    window.removeEventListener('load', begin);
    if (timer !== undefined) window.clearTimeout(timer);
    stop?.();
  };
}
