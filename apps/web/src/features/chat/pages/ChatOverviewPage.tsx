import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTr } from '../../../shared/i18n/locale';
import { BackHeader } from '../../../shared/ui/BackHeader';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, Notice } from '../../../shared/ui/Card';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { DirectoryPage } from '../../directory/pages/DirectoryPage';
import { ConversationList, useConversationRows } from '../list/ConversationList';
import { totalUnread, useOverviewStore } from '../state/overviewStore';

type Filter = 'all' | 'channels' | 'direct';
type Tab = Filter | 'members';

/** ?tab=channels and ?tab=direct from old links still narrow the merged list. */
/** 旧链接里的 ?tab=channels 和 ?tab=direct 仍可筛选合并后的列表。 */
function tabFromQuery(value: string | null): Tab {
  if (value === 'channels' || value === 'direct' || value === 'members') return value;
  return 'all';
}

/** Window scroll of each list view, so returning from a room lands where the member left. */
/** 每个列表视图的窗口滚动位置，从房间返回时回到离开时的位置。 */
const scrollMemory = new Map<Tab, number>();

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="10" cy="8.5" r="3.5" />
      <path d="M3.8 19.5c.8-3.2 3.2-5 6.2-5s5.4 1.8 6.2 5" />
      <path d="M16.5 5.6a3.4 3.4 0 0 1 0 5.8M18.6 14.8c1 .8 1.6 2.1 1.9 3.7" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-wx-red" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="M12 7v6.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.8" r="1.2" fill="#fff" />
    </svg>
  );
}

/** True once `value` has stayed true for `delayMs`, so a quick refresh does not flash the title. */
/** `value` 持续为 true 达到 `delayMs` 后才为 true，快速的刷新不会让标题闪一下。 */
function useSettledFlag(value: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!value) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return value && settled;
}

function NavBar({ unread, syncing }: { unread: number; syncing: boolean }) {
  const tr = useTr();
  const showSync = useSettledFlag(syncing, 300);
  return (
    <header className="sticky top-0 z-20 -mx-4 -mt-5 bg-wx-canvas" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="relative flex h-11 items-center justify-center px-14">
        {showSync ? (
          <h1 className="flex items-center gap-1.5 text-[17px] font-semibold text-wx-ink">
            <WxSpinner size={16} label={tr('收取中…', 'Updating…')} />
            <span aria-hidden>{tr('收取中…', 'Updating…')}</span>
          </h1>
        ) : (
          <h1 className="truncate text-[17px] font-semibold text-wx-ink">
            {tr('聊天', 'Chat')}
            {unread > 0 ? `(${unread})` : null}
          </h1>
        )}
        <Link
          to="/chat?tab=members"
          aria-label={tr('通讯录', 'Contacts')}
          className="absolute right-1 top-0 flex h-11 w-11 items-center justify-center rounded-lg text-wx-ink active:bg-wx-pressed"
        >
          <ContactsIcon />
        </Link>
      </div>
    </header>
  );
}

function SearchBar() {
  const tr = useTr();
  return (
    <div className="-mx-4 bg-wx-canvas px-2 pb-2">
      <Link to="/chat/search" className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-white text-[15px] text-wx-meta active:bg-wx-pressed">
        <SearchIcon />
        {tr('搜索', 'Search')}
      </Link>
    </div>
  );
}

function OfflineBanner({ offline, error }: { offline: boolean; error: string | null }) {
  const tr = useTr();
  return (
    <div role="status" className="-mx-4 flex min-h-12 items-center gap-3 border-b-[0.5px] border-wx-line bg-white px-4 py-2.5 text-[14px] leading-snug text-wx-ink">
      <AlertIcon />
      <span className="min-w-0 flex-1">{offline || !error ? tr('当前网络不可用，请检查你的网络设置', 'No network connection. Check your network settings.') : error}</span>
    </div>
  );
}

function FilterStrip({ filter }: { filter: Exclude<Filter, 'all'> }) {
  const tr = useTr();
  return (
    <div className="-mx-4 flex h-9 items-center justify-between bg-wx-canvas px-4 text-[13px] text-wx-meta">
      <span>{filter === 'channels' ? tr('仅显示频道', 'Channels only') : tr('仅显示私聊', 'Direct messages only')}</span>
      <Link to="/chat" replace className="flex min-h-9 items-center text-wx-link">
        {tr('显示全部', 'Show all')}
      </Link>
    </div>
  );
}

function ConversationsView({ filter }: { filter: Filter }) {
  const tr = useTr();
  const navigate = useNavigate();
  const data = useOverviewStore((s) => s.data);
  const error = useOverviewStore((s) => s.error);
  const offline = useOverviewStore((s) => s.offline);
  const syncing = useOverviewStore((s) => s.syncing);
  const unread = useOverviewStore((s) => totalUnread(s.data));
  const allRows = useConversationRows(data);
  const rows = useMemo(() => (filter === 'all' ? allRows : allRows.filter((row) => (filter === 'channels' ? row.kind === 'channel' : row.kind === 'direct'))), [allRows, filter]);

  useEffect(() => {
    const store = useOverviewStore.getState();
    void store.refresh();
    return store.startPolling();
  }, []);

  // Track the scroll position while the list is mounted, and restore it before paint when cached data is shown.
  // 列表挂载期间记录滚动位置；显示缓存数据时，在绘制前恢复该位置。
  const hasData = data !== null;
  useLayoutEffect(() => {
    const saved = scrollMemory.get(filter);
    let frame = 0;
    if (hasData && saved !== undefined) {
      window.scrollTo(0, saved);
      // The room screen that was just left may release its body scroll lock after this effect, so apply it once more.
      // 刚离开的房间页可能在这个 effect 之后才解除对 body 滚动的锁定，所以再设置一次。
      frame = requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - saved) > 1) window.scrollTo(0, saved);
      });
    }
    const remember = () => scrollMemory.set(filter, window.scrollY);
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', remember);
    };
    // Restoring happens once per mount; later data changes must not jump the list.
    // 每次挂载只恢复一次；之后的数据变化不能让列表跳动。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const onOpen = useCallback(() => {
    scrollMemory.set(filter, window.scrollY);
  }, [filter]);

  // With cached data on screen, a failed refresh or an offline event shows a banner instead of replacing the list.
  // 屏幕上已有缓存数据时，刷新失败或断网只显示一条横幅，不替换列表。
  const failedWithData = hasData && (offline || error !== null);

  return (
    <div>
      <NavBar unread={unread} syncing={syncing} />
      <SearchBar />
      {failedWithData ? <OfflineBanner offline={offline} error={error} /> : null}
      {filter !== 'all' ? <FilterStrip filter={filter} /> : null}
      {!hasData && error ? (
        <div className="mt-4 space-y-3">
          <Notice tone="error">{error}</Notice>
          <Button variant="secondary" block onClick={() => void useOverviewStore.getState().refresh({ force: true })}>
            {tr('重试', 'Retry')}
          </Button>
        </div>
      ) : null}
      {!hasData && !error ? (
        <div className="flex justify-center py-10">
          <WxSpinner />
        </div>
      ) : null}
      {hasData && rows.length > 0 ? <ConversationList rows={rows} onOpen={onOpen} /> : null}
      {hasData && rows.length === 0 ? (
        filter === 'direct' ? (
          <div className="mt-2">
            <EmptyState>{tr('还没有私聊。加了好友之后，才能在这里发私信。', 'No direct messages yet. Add a friend first.')}</EmptyState>
            <Button variant="secondary" block onClick={() => navigate('/chat?tab=members')}>
              {tr('去加好友', 'Add a friend')}
            </Button>
          </div>
        ) : (
          <div className="mt-2 text-center">
            <EmptyState>{tr('暂无聊天', 'No chats yet')}</EmptyState>
            <Button variant="secondary" onClick={() => navigate('/chat?tab=members')}>
              {tr('找成员聊天', 'Find members')}
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function ContactsView() {
  const tr = useTr();
  return (
    <div>
      <BackHeader to="/chat" label={tr('聊天', 'Chat')} title={tr('通讯录', 'Contacts')} />
      <DirectoryPage embedded />
    </div>
  );
}

/**
 * The chat tab: one list of channels and direct messages sorted by activity, as in WeChat.
 * ?tab=members keeps the embedded contacts directory that /directory redirects to.
 * 聊天页：频道与私聊合并成一个按活动时间排序的列表，与微信一致。?tab=members 保留内嵌的通讯录，/directory 会跳转到这里。
 */
export function ChatOverviewPage() {
  const [params] = useSearchParams();
  const tab = tabFromQuery(params.get('tab'));
  if (tab === 'members') return <ContactsView />;
  return <ConversationsView key={tab} filter={tab} />;
}
