import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { sectionBackTarget } from '../sections';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { AdminIcon } from '../ui/icons';
import { isAdminOverlayOpen, isEditableTarget } from '../ui/overlayGate';
import { adminHistory } from './adminHistory';
import { useAdminPane, useIsDesktop } from './media';
import { TestingBanner } from './TestingBanner';

/** Where a back button goes and what it says: a screen above this one, or a page outside admin such as 发现. */
/** 返回按钮去往哪里、写什么：上一层界面，或管理后台之外的页面，例如「发现」。 */
export interface BackTarget {
  to: string;
  label: string;
}

export function isAdminPath(path: string): boolean {
  return path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?');
}

/**
 * Whether a back target is a detail screen rather than a section's list, as for a channel's 谁能看到 (back to its
 * settings) or a member's role picker (back to the member). In a split view the list beside the detail pane does not
 * lead there, so such a screen keeps its back button.
 * 返回目标是否是详情界面而不是板块列表，例如频道的「谁能看到」（返回频道设置）或成员的身份选择（返回该成员）。分栏视图中详情栏旁边的列表
 * 回不到那里，因此这样的界面保留返回按钮。
 */
export function isDetailTarget(to: string): boolean {
  const path = (to.split(/[?#]/)[0] ?? '').replace(/\/+$/, '');
  return isAdminPath(path) && path.split('/').filter(Boolean).length > 2;
}

/**
 * Going back from the current admin entry to `to`. When the entry before this one is that screen, it is a real
 * history step, so the system back gesture and this button agree and the history does not fill up with repeats.
 * Otherwise (a deep link, a reload, a redirect) this entry is replaced by `to`. A target outside admin pops only when
 * this entry was pushed from outside, and is replaced in otherwise.
 * 从当前的管理后台记录返回到 `to`。若前一条记录正是那个界面，就是真正的历史后退，系统返回手势与这个按钮一致，历史中也不会堆满重复的记录。
 * 否则（直接打开的链接、刷新、跳转）用 `to` 替换当前记录。目标在管理后台之外时，只有当前记录是从外部压入的才弹出，否则替换。
 */
export function useAdminBack(): (to: string) => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return useCallback(
    (to: string) => {
      const pop = isAdminPath(to) ? adminHistory.canPopTo(key, to) : adminHistory.enteredFromOutside(key);
      if (pop) navigate(-1);
      else navigate(to, { replace: true });
    },
    [key, navigate],
  );
}

/** The back target of a section's own list, in the site language. */
/** 板块列表的返回目标，使用网站语言。 */
export function useSectionBack(): BackTarget {
  const tr = useTr();
  const role = useSessionStore((s) => s.member?.role ?? 'student');
  const target = sectionBackTarget(role);
  return { to: target.to, label: tr(target.zh, target.en) };
}

export interface AdminScreenProps {
  title: string;
  /** Shown after the title on desktop, such as how many members there are. */
  /** 桌面上显示在标题之后，例如成员人数。 */
  count?: number | null;
  /**
   * Phones always show it. On desktop the sidebar replaces it on top screens, and the detail pane shows it only when
   * it leads to another detail screen (the list beside the pane is the way back otherwise).
   * 手机上总是显示。桌面上顶层界面由侧边栏代替它；详情栏中只有当它通往另一个详情界面时才显示（否则旁边的列表就是返回的路）。
   */
  back?: BackTarget | null;
  /** The overview or a section's own list: on desktop the sidebar is the way back. */
  /** 管理首页或板块的列表：桌面上由侧边栏负责返回。 */
  top?: boolean;
  /** Where Esc goes on desktop when no back button shows, as in the detail pane of a split view. */
  /** 桌面上没有返回按钮时 Esc 去往的地方，例如分栏视图的详情栏。 */
  escapeTo?: string;
  /** Actions at the end of the title bar, such as 新建. */
  /** 标题栏末尾的操作，例如「新建」。 */
  trailing?: ReactNode;
  /** Sticky under the title bar: search, filter chips, segments. */
  /** 吸附在标题栏下方：搜索、筛选标签、分段控件。 */
  sub?: ReactNode;
  /** A StickyActionBar, kept at the bottom of the screen. */
  /** 一个 StickyActionBar，固定在界面底部。 */
  footer?: ReactNode;
  children: ReactNode;
}

function BackButton({ target, onBack }: { target: BackTarget; onBack: () => void }) {
  const tr = useTr();
  return (
    <button
      type="button"
      onClick={onBack}
      aria-label={tr(`返回${target.label}`, `Back to ${target.label}`)}
      className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg pl-1 pr-2 text-[16px] font-medium text-brand-800 active:bg-stone-100"
    >
      <AdminIcon name="back" className="h-5 w-5 shrink-0" strokeWidth={2} />
      <span className="max-w-[5.5rem] truncate lg:max-w-[12rem]">{target.label}</span>
    </button>
  );
}

/**
 * One admin screen: a sticky white title bar (back, title, actions) with optional search or filters under it, the
 * content, and an optional bottom action bar. On phones it fills the screen and slides in on forward navigation;
 * on desktop it sits in the content column (760px at most) or in one pane of a split view. After a forward
 * navigation focus moves to its heading; on desktop Esc goes back.
 * 一个管理界面：吸顶的白色标题栏（返回、标题、操作），其下可带搜索或筛选，然后是内容，以及可选的底部操作栏。手机上占满整个屏幕，
 * 前进导航时滑入；桌面上位于内容栏（最宽 760px）或分栏视图的一栏中。前进导航之后焦点移到标题；桌面上按 Esc 返回。
 */
export function AdminScreen({ title, count, back, top = false, escapeTo, trailing, sub, footer, children }: AdminScreenProps) {
  const pane = useAdminPane();
  const desktop = useIsDesktop();
  const navigationType = useNavigationType();
  const goBack = useAdminBack();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [slideIn] = useState(() => !desktop && navigationType === NavigationType.Push);
  const [focusOnMount] = useState(() => navigationType !== NavigationType.Pop);
  useStatusBarColor('#FFFFFF');

  const showBack = back ? (desktop ? !top && (pane !== 'detail' || isDetailTarget(back.to)) : true) : false;
  const escapeTarget = desktop ? (pane === 'detail' ? (escapeTo ?? null) : showBack && back ? back.to : null) : null;

  useLayoutEffect(() => {
    if (focusOnMount) headingRef.current?.focus({ preventScroll: true });
  }, [focusOnMount]);

  const goBackRef = useRef(goBack);
  useLayoutEffect(() => {
    goBackRef.current = goBack;
  });
  useEffect(() => {
    if (!escapeTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isAdminOverlayOpen() || isEditableTarget(event.target)) return;
      event.preventDefault();
      goBackRef.current(escapeTarget);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [escapeTarget]);

  const backButton = showBack && back ? <BackButton target={back} onBack={() => goBack(back.to)} /> : null;
  const countText = count !== undefined && count !== null ? <span className="ml-2 text-[15px] font-normal tabular-nums text-wx-meta">{count}</span> : null;
  const column = pane === 'list' ? '' : 'mx-auto w-full max-w-[760px] px-6';

  const header = desktop ? (
    <div className="sticky top-0 z-20 border-b-[0.5px] border-wx-line bg-white" style={{ paddingTop: 'var(--safe-top)' }}>
      <header className={`flex min-h-14 items-center gap-2 py-2 ${pane === 'list' ? 'px-4' : column}`}>
        {backButton ? <div className="-ml-2">{backButton}</div> : null}
        <h1 ref={headingRef} tabIndex={-1} className="min-w-0 truncate text-[20px] font-semibold text-wx-ink outline-none">
          {title}
          {countText}
        </h1>
        <div className="ml-auto flex shrink-0 items-center gap-1">{trailing}</div>
      </header>
      {sub ? <div className={pane === 'list' ? '' : column}>{sub}</div> : null}
    </div>
  ) : (
    <div className="sticky top-0 z-20 border-b-[0.5px] border-wx-line bg-white" style={{ paddingTop: 'var(--safe-top)' }}>
      <header className="relative flex min-h-12 items-center px-1">
        {backButton}
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="pointer-events-none absolute inset-x-[6.5rem] truncate text-center text-[17px] font-semibold text-brand-800 outline-none"
        >
          {title}
        </h1>
        <div className="ml-auto flex min-w-11 shrink-0 items-center justify-end gap-1 pr-1">{trailing}</div>
      </header>
      <TestingBanner variant="bar" />
      {sub}
    </div>
  );

  // On desktop the action bar is inline at the end of the content column; on phones it sticks to the bottom.
  // 桌面上操作栏位于内容栏末尾；手机上吸附在底部。
  const inlineFooter = desktop && pane !== 'list';
  return (
    <div className={`flex min-h-[100dvh] flex-col ${slideIn ? 'wx-push-in' : ''}`}>
      {header}
      <div className={`flex-1 ${inlineFooter ? `${column} pb-10 pt-5` : footer ? 'pb-4' : 'pb-[calc(1.5rem+var(--safe-bottom))]'}`}>
        {children}
        {inlineFooter ? footer : null}
      </div>
      {inlineFooter ? null : footer}
    </div>
  );
}
