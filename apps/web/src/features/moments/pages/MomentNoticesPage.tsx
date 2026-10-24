import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import type { MomentNotice } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { WX_COLORS } from '../../../shared/ui/wxTokens';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { MomentsLiveRegion } from '../announce';
import { momentsApi } from '../api';
import { CommentBarHost } from '../comment/CommentBarHost';
import { useCommentBar, type CommentBarController } from '../comment/useCommentBar';
import { FeedError, ListFooter } from '../components/FeedStates';
import { MomentsHeader } from '../components/MomentsHeader';
import { NoticeRow, noticeCommentToFlash } from '../components/NoticeRow';
import { HEADER_HEIGHT } from '../layout/pull';
import type { LoadState } from '../model';
import { useMomentsBadge } from '../state/badgeStore';
import { momentDetailPath, useMomentsBack, type MomentDetailLinkState } from './MomentDetailPage';

/**
 * unread: opened from the bubble, so only what is new is shown, then 查看更早的消息 switches to all. all: every
 * notice, newest first, paged as the end comes near.
 * unread：从气泡打开，只显示新的消息，然后可以「查看更早的消息」切换到全部。all：全部消息，最新的在前，接近末尾时分页加载。
 */
type Mode = 'unread' | 'all';

interface NoticesState {
  mode: Mode;
  notices: MomentNotice[];
  nextCursor: string | null;
  /** loading: page 1 is on its way with nothing to show. error: page 1 failed with nothing to show. */
  /** loading：第一页正在加载，屏幕上还没有内容。error：第一页加载失败，且没有可显示的内容。 */
  status: 'loading' | 'ready' | 'error';
  /** A page loading under rows already shown: the next one, or everything after 查看更早的消息. */
  /** 在已显示的消息行下方加载的页面：下一页，或「查看更早的消息」之后的全部消息。 */
  more: LoadState;
  error: string | null;
  mediaToken: string | null;
  /** A later page has loaded, so reaching the end says 没有更多了. */
  /** 已加载过后续页面，因此到达末尾时显示「没有更多了」。 */
  paged: boolean;
}

/**
 * The list as it was when the member left for a post, so coming back shows the same rows at the same place
 * instead of starting over. Kept in memory for one member and a short while only.
 * 成员离开去看某条动态时列表的样子，返回时显示同样的消息行并停在同样的位置，而不是从头开始。只为一位成员在内存中保留一小段时间。
 */
interface NoticesSnapshot {
  memberId: string;
  state: NoticesState;
  scrollY: number;
  savedAt: number;
}

const SNAPSHOT_MS = 10 * 60 * 1000;
let snapshot: NoticesSnapshot | null = null;

const ROOT: CSSProperties = {
  paddingTop: `calc(var(--safe-top) + ${HEADER_HEIGHT}px)`,
  paddingLeft: 'var(--safe-left)',
  paddingRight: 'var(--safe-right)',
};

const COLUMN: CSSProperties = { minHeight: `calc(100dvh - var(--safe-top) - ${HEADER_HEIGHT}px)` };

const LINK_STATE: MomentDetailLinkState = { from: 'notices' };

function newer(a: string, b: string | null): boolean {
  if (b === null) return true;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isNaN(right) || (!Number.isNaN(left) && left > right);
}

function initialState(mode: Mode): NoticesState {
  return { mode, notices: [], nextCursor: null, status: 'loading', more: 'idle', error: null, mediaToken: null, paged: false };
}

/**
 * /discover/feed/notices (消息): unread only when opened from the bubble (?unread=1), then 查看更早的消息; 清空; reply straight from a row; loading the list marks everything read up to the newest notice.
 * /discover/feed/notices（消息）：从气泡打开时只显示未读（?unread=1），然后可「查看更早的消息」；可「清空」；可直接在行内回复；加载列表时把截至最新一条的消息全部标为已读。
 */
export function MomentNoticesPage() {
  const tr = useTr();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [params] = useSearchParams();
  const memberId = useSessionStore((s) => s.member?.id ?? null);
  const goBack = useMomentsBack('/discover/feed');
  const bar = useCommentBar();
  const [confirmClear, setConfirmClear] = useState(false);
  // Coming back from a post (a back navigation) picks the list up where it was left.
  // 从某条动态返回（后退导航）时，列表从离开的地方继续。
  const [resumed] = useState<NoticesSnapshot | null>(() => {
    const kept = snapshot;
    if (navigationType !== 'POP' || !kept || kept.memberId !== memberId || Date.now() - kept.savedAt > SNAPSHOT_MS) return null;
    return kept;
  });
  const [state, setState] = useState<NoticesState>(() => resumed?.state ?? initialState(params.get('unread') === '1' ? 'unread' : 'all'));
  /** Answers from before the latest request (or a 清空) are dropped. */
  /** 早于最近一次请求（或「清空」）的返回结果会被丢弃。 */
  const requestSeq = useRef(0);
  /** The newest notice already marked read on this visit. */
  /** 本次访问中已标为已读的最新一条消息的时间。 */
  const markedUpTo = useRef<string | null>(resumed?.state.notices[0]?.createdAt ?? null);
  useStatusBarColor(WX_COLORS.canvas);

  // The place: the browser must not restore it on its own; a resumed list goes back to where it was, a new visit
  // starts at the top, and the last place seen is kept with the rows when the page is left.
  // 位置：浏览器不能自行恢复；继续的列表回到原来的位置，新的访问从顶部开始；离开页面时把最后看到的位置和消息行一起保存。
  const lastY = useRef(resumed?.scrollY ?? 0);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });
  useLayoutEffect(() => {
    const history = window.history;
    history.scrollRestoration = 'manual';
    window.scrollTo(0, lastY.current);
    const remember = () => {
      lastY.current = Math.max(0, window.scrollY);
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('scroll', remember);
      // Always 'auto' on the way out, never the value found at mount: an entry reached by Back already holds
      // the 'manual' of an earlier visit, and putting that back would leak it to the pages outside moments.
      // 离开时总是设回 'auto'，而不是挂载时读到的值：通过返回到达的记录已经带着上一次访问留下的 'manual'，把它放回去会漏到动态以外的页面。
      history.scrollRestoration = 'auto';
      const current = stateRef.current;
      // A page still on its way when the member left is dropped from the copy, so coming back shows the footer
      // ready to load it again rather than a spinner nothing will end.
      // 成员离开时仍在加载的页面不放进副本，返回时底部可以重新加载，而不是显示一个永远不会结束的加载动画。
      const kept: NoticesState = current.more === 'loading' ? { ...current, more: 'idle' } : current;
      snapshot = memberId && current.status === 'ready' ? { memberId, state: kept, scrollY: lastY.current, savedAt: Date.now() } : null;
      window.scrollTo(0, 0);
    };
  }, [memberId]);

  const markRead = useCallback((newest: MomentNotice | undefined, unread: number) => {
    if (!newest) {
      useMomentsBadge.getState().setUnread(unread);
      return;
    }
    if (!newer(newest.createdAt, markedUpTo.current)) return;
    markedUpTo.current = newest.createdAt;
    momentsApi
      .markNoticesRead({ upTo: newest.createdAt })
      .then((res) => useMomentsBadge.getState().setUnread(res.unread))
      // The rows stay as they are; the next visit marks them again.
      // 消息行保持不变；下次打开时会再次标记。
      .catch(() => {
        markedUpTo.current = null;
      });
  }, []);

  const load = useCallback(
    async (mode: Mode, cursor: string | null) => {
      const seq = ++requestSeq.current;
      // With rows on screen they stay while the next list loads, and the footer shows the spinner, so the place
      // in the list is kept when 查看更早的消息 starts over with everything.
      // 屏幕上已有消息行时保留它们，由底部显示加载中；因此「查看更早的消息」从头加载全部时，列表中的位置保持不变。
      const shown = stateRef.current.notices.length > 0;
      setState((current) => (current.notices.length > 0 ? { ...current, more: 'loading' } : { ...current, mode, status: 'loading', error: null, more: 'idle' }));
      try {
        const res = await momentsApi.notices({ cursor, unreadOnly: mode === 'unread' });
        if (seq !== requestSeq.current) return;
        // Nothing new after all (another device read them): show everything rather than an empty page.
        // 其实没有新消息（例如在另一台设备上已读）：显示全部，而不是一个空页面。
        if (!cursor && mode === 'unread' && res.notices.length === 0) {
          void load('all', null);
          return;
        }
        setState((current) => {
          const known = cursor ? current.notices : [];
          const seen = new Set(known.map((notice) => notice.id));
          return {
            mode,
            notices: [...known, ...res.notices.filter((notice) => !seen.has(notice.id))],
            nextCursor: res.nextCursor,
            status: 'ready',
            more: 'idle',
            error: null,
            mediaToken: res.mediaToken,
            paged: cursor !== null || (current.paged && current.mode === mode),
          };
        });
        if (!cursor) markRead(res.notices[0], res.unread);
      } catch (err) {
        if (seq !== requestSeq.current) return;
        const message = errorMessage(err);
        if (shown) setState((current) => ({ ...current, more: 'failed' }));
        else setState((current) => ({ ...current, status: 'error', error: message }));
      }
    },
    [markRead],
  );

  // Page 1 of the mode the page opened in, unless the list was picked up where it was left; later switches call
  // load themselves.
  // 加载打开页面时所用模式的第一页，除非列表是从离开的地方继续的；之后的切换各自调用 load。
  const openedMode = useRef<Mode | null>(resumed ? null : state.mode);
  useEffect(() => {
    if (openedMode.current) void load(openedMode.current, null);
  }, [load]);

  async function clearAll() {
    const previous = state;
    // In-flight pages must not bring the rows back.
    // 正在加载的页面不能把消息行带回来。
    requestSeq.current += 1;
    setState((current) => ({ ...current, mode: 'all', notices: [], nextCursor: null, status: 'ready', more: 'idle', error: null, paged: false }));
    try {
      await momentsApi.clearNotices();
      useMomentsBadge.getState().setUnread(0);
    } catch (err) {
      setState(previous);
      toast(errorMessage(err));
    }
  }

  // Rows are memoized, so their callbacks stay the same functions and read the latest values through a ref.
  // 消息行已做记忆化，因此传给它们的回调保持为同一个函数，并通过 ref 读取最新的值。
  const latest = useRef<{ navigate: typeof navigate; bar: CommentBarController; tr: typeof tr }>({ navigate, bar, tr });
  useLayoutEffect(() => {
    latest.current = { navigate, bar, tr };
  });

  const openNotice = useCallback((notice: MomentNotice) => {
    const { navigate: go, tr: translate } = latest.current;
    if (!notice.post.available) {
      toast(translate('这条动态已删除或无法查看', "This update was deleted or isn't available"));
      return;
    }
    latest.current.bar.close();
    go(momentDetailPath(notice.post.id, noticeCommentToFlash(notice)), { state: LINK_STATE });
  }, []);

  const replyToNotice = useCallback((notice: MomentNotice, row: HTMLElement) => {
    if (!notice.actor || !notice.comment) return;
    latest.current.bar.open({
      postId: notice.post.id,
      clubWide: notice.post.clubWide,
      replyTo: { commentId: notice.comment.id, person: notice.actor },
      anchor: () => (row.isConnected ? row : null),
    });
  }, []);

  const loadNext = useCallback(() => {
    const next = stateRef.current.nextCursor;
    if (next) void load('all', next);
  }, [load]);

  const { mode, notices, nextCursor, status, more, mediaToken } = state;

  let body;
  if (status === 'loading') {
    body = (
      <div className="flex justify-center py-16">
        <WxSpinner />
      </div>
    );
  } else if (status === 'error') {
    body = <FeedError message={state.error} onRetry={() => void load(mode, null)} />;
  } else if (notices.length === 0) {
    body = <p className="px-8 pb-16 pt-14 text-center text-[15px] leading-6 text-wx-meta">{tr('暂无消息', 'No notifications')}</p>;
  } else {
    body = (
      <>
        <ul>
          {notices.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} mediaToken={mediaToken} onOpen={openNotice} onReply={replyToNotice} />
          ))}
        </ul>
        {mode === 'unread' ? (
          // Unread rows are marked read as soon as they load, so instead of paging the unread list the button starts
          // over with everything: the rows on screen are the newest ones and stay where they are.
          // 未读消息一加载就被标为已读，因此按钮不是继续翻未读列表，而是从头加载全部消息：屏幕上的就是最新的那些，位置保持不变。
          <div className="flex min-h-16 items-center justify-center px-4 text-[14px]">
            {more === 'loading' ? (
              <WxSpinner />
            ) : (
              <button type="button" onClick={() => void load('all', null)} className="min-h-11 px-4 text-wx-link active:opacity-60">
                {more === 'failed' ? tr('加载失败，轻触重试', "Couldn't load. Tap to retry") : tr('查看更早的消息', 'Show earlier')}
              </button>
            )}
          </div>
        ) : (
          <ListFooter more={more} hasMore={nextCursor !== null} hasItems={state.paged} onLoadMore={loadNext} />
        )}
      </>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-wx-canvas" style={ROOT}>
      <MomentsHeader
        variant="solid"
        title={tr('消息', 'Notifications')}
        backLabel={tr('好友动态', 'Updates')}
        onBack={goBack}
        trailing={
          notices.length > 0 ? (
            <button type="button" onClick={() => setConfirmClear(true)} className="flex min-h-11 items-center px-3 text-[16px] active:opacity-60">
              {tr('清空', 'Clear')}
            </button>
          ) : null
        }
      />
      <main className="mx-auto max-w-2xl bg-white" style={COLUMN}>
        {body}
        {/* Room for the comment bar and the keyboard while open, so the row answered can rise above them. */}
        {/* 评论栏打开时为它和键盘留出空间，被回复的消息行才能升到它们上方。 */}
        <div aria-hidden style={{ height: `calc(${bar.inset}px + var(--safe-bottom))` }} />
      </main>

      <CommentBarHost headerHeight={HEADER_HEIGHT} />
      <MomentsLiveRegion />

      {confirmClear ? (
        <ActionSheet
          title={tr('清空所有消息？', 'Clear all notifications?')}
          options={[{ label: tr('清空', 'Clear'), danger: true, onSelect: () => void clearAll() }]}
          onClose={() => setConfirmClear(false)}
        />
      ) : null}
    </div>
  );
}
