import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { RoomMemberCard } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { chatApi } from '../api';
import { OVERLAY_BOTTOM_INSET, useVisualViewportOverlay } from '../room/useVisualViewport';

const PAGE_SIZE = 30;
/** The members endpoint allows 30 requests a minute, so typing waits before it searches. */
/** 成员接口每分钟只允许 30 次请求，所以输入停顿后才搜索。 */
const SEARCH_DEBOUNCE_MS = 250;

interface ListState {
  members: RoomMemberCard[];
  next: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: ListState = { members: [], next: null, loading: true, error: null };

function BackChevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 4.5-7.5 7.5 7.5 7.5" />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

/**
 * Full-screen list of every member of a channel, searched and paged on the server because 'all' channels
 * can be large. Tapping a member opens their profile.
 * 频道全部成员的全屏列表。面向全体的频道可能很大，所以在服务端搜索和分页。点按成员打开其资料。
 */
export function MemberListSheet({ roomId, total, onClose }: { roomId: string; total: number; onClose: () => void }) {
  const { tr, role } = useLabels();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const requestSeq = useRef(0);
  const [input, setInput] = useState('');
  // Pinyin and other IMEs put unfinished letters in the field; searching waits until the text is committed.
  // 拼音等输入法会把未完成的字母放进输入框；等文字上屏后才搜索。
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<ListState>(EMPTY);
  const [trigger] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useVisualViewportOverlay(rootRef);
  useBackToClose(onClose);

  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true });
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => setQuery(input.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input, composing]);

  const load = useCallback(
    (after: string | null) => {
      const seq = ++requestSeq.current;
      setList((current) => ({ ...(after ? current : EMPTY), loading: true, error: null }));
      chatApi.members(roomId, { q: query || undefined, after: after ?? undefined, limit: PAGE_SIZE }).then(
        (page) => {
          if (seq !== requestSeq.current) return;
          setList((current) => {
            const known = after ? current.members : [];
            const seen = new Set(known.map((member) => member.id));
            return { members: [...known, ...page.members.filter((member) => !seen.has(member.id))], next: page.next, loading: false, error: null };
          });
        },
        (error: unknown) => {
          if (seq !== requestSeq.current) return;
          setList((current) => ({ ...current, loading: false, error: errorMessage(error) }));
        },
      );
    },
    [roomId, query],
  );

  useEffect(() => {
    load(null);
  }, [load]);

  const { next, loading, error } = list;
  useEffect(() => {
    const root = listRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !next || loading || error || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load(next);
      },
      { root, rootMargin: '0px 0px 240px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [next, loading, error, load]);

  const empty = !list.loading && !list.error && list.members.length === 0;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="wx-slide-up fixed inset-x-0 top-0 z-[60] flex h-full flex-col bg-wx-canvas"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}
    >
      <header className="relative flex h-11 shrink-0 items-center">
        <button ref={backRef} type="button" onClick={onClose} aria-label={tr('返回聊天信息', 'Back to chat info')} className="flex h-11 w-11 items-center justify-center text-wx-ink active:opacity-60">
          <BackChevron />
        </button>
        <h2 id={titleId} className="pointer-events-none absolute inset-x-16 truncate text-center text-[17px] font-semibold text-wx-ink">
          {tr(`聊天成员（${total}）`, `Members (${total})`)}
        </h2>
      </header>
      <div className="shrink-0 px-2 pb-2">
        <label className="flex h-9 items-center gap-1.5 rounded-md bg-white px-2.5 text-wx-meta">
          <SearchGlyph />
          <input
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setInput(event.currentTarget.value);
            }}
            placeholder={tr('搜索', 'Search')}
            aria-label={tr('搜索成员', 'Search members')}
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-wx-ink outline-none placeholder:text-wx-meta focus-visible:outline-none"
          />
        </label>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: OVERLAY_BOTTOM_INSET }}>
        <ul>
          {list.members.map((member) => (
            <li key={member.id}>
              <Link to={`/directory/${encodeURIComponent(member.id)}`} className="flex items-center bg-white pl-4 active:bg-wx-pressed">
                <MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-10 w-10 text-sm" />
                <span className="ml-3 flex min-h-14 min-w-0 flex-1 items-center gap-3 border-b-[0.5px] border-wx-line pr-4">
                  <span className="min-w-0 flex-1 truncate text-[17px] text-wx-ink">{member.displayName}</span>
                  <span className="shrink-0 text-[13px] text-wx-meta">{role(member.role)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {empty ? <p className="px-6 py-10 text-center text-[14px] text-wx-meta">{tr('没有找到成员', 'No members found')}</p> : null}
        {list.error ? (
          <div className="px-6 py-8 text-center text-[14px] text-wx-meta">
            <p>{list.error}</p>
            <button type="button" onClick={() => load(list.members.length ? list.next : null)} className="mt-1 min-h-11 px-3 text-wx-link">
              {tr('重试', 'Retry')}
            </button>
          </div>
        ) : null}
        {list.loading ? (
          <div className="flex justify-center py-5">
            <WxSpinner />
          </div>
        ) : null}
        <div ref={sentinelRef} className="h-px" aria-hidden />
      </div>
    </div>,
    document.body,
  );
}
