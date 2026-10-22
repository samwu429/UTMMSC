import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { RoomMemberCard } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { chatApi } from '../api';
import { OVERLAY_BOTTOM_INSET, useVisualViewportOverlay } from '../room/useVisualViewport';
import { EveryoneIcon, SearchIcon } from './composerIcons';
import { mentionLabel, type MentionTarget } from './mentionTokens';

const PAGE_SIZE = 30;
/** The members endpoint allows 30 requests a minute, so typing waits before it searches. */
/** 成员接口每分钟只允许 30 次请求，所以输入停顿后才搜索。 */
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  roomId: string;
  meId: string | null;
  canMentionAll: boolean;
  onSelect: (target: MentionTarget) => void;
  onClose: () => void;
}

interface ListState {
  members: RoomMemberCard[];
  next: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: ListState = { members: [], next: null, loading: true, error: null };

function PickerRow({ avatar, label, onClick }: { avatar: ReactNode; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center bg-white pl-4 text-left active:bg-wx-pressed">
      {avatar}
      <span className="ml-3 flex min-h-14 min-w-0 flex-1 items-center border-b-[0.5px] border-wx-line pr-4">
        <span className="truncate text-[17px] text-wx-ink">{label}</span>
      </span>
    </button>
  );
}

/**
 * Full-screen 「选择提醒的人」 sheet opened by typing @ in a channel. Members are searched and paged on the
 * server, because 'all' channels can be large.
 * 在频道中输入 @ 时打开的全屏「选择提醒的人」页面。成员在服务端搜索和分页，因为面向全体的频道可能很大。
 */
export function MentionPicker({ roomId, meId, canMentionAll, onSelect, onClose }: Props) {
  const tr = useTr();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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

  useLayoutEffect(() => {
    closeRef.current = onClose;
  });

  useBackToClose(onClose);
  useVisualViewportOverlay(rootRef);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

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
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load(next);
    }, { root, rootMargin: '0px 0px 240px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [next, loading, error, load]);

  const everyoneLabel = tr('所有人', 'Everyone');
  const members = list.members.filter((member) => member.id !== meId);
  const showEveryone = canMentionAll && !query;
  const empty = !list.loading && !list.error && members.length === 0 && !showEveryone;

  function chooseMember(member: RoomMemberCard) {
    onSelect({ kind: 'member', id: member.id, label: mentionLabel(member.displayName) || tr('成员', 'Member') });
  }

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="wx-slide-up fixed inset-x-0 top-0 z-[60] flex h-full flex-col bg-wx-canvas"
      style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <header className="relative flex h-12 shrink-0 items-center">
        <button type="button" onClick={onClose} className="min-h-11 px-4 text-[16px] text-wx-ink active:opacity-60">
          {tr('取消', 'Cancel')}
        </button>
        <h2 id={titleId} className="pointer-events-none absolute inset-x-20 truncate text-center text-[17px] font-semibold text-wx-ink">
          {tr('选择提醒的人', 'Choose who to mention')}
        </h2>
      </header>
      <div className="shrink-0 px-2 pb-2">
        <label className="flex h-9 items-center gap-1.5 rounded-md bg-white px-2.5 text-wx-meta">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setInput(event.currentTarget.value);
            }}
            placeholder={tr('搜索', 'Search')}
            aria-label={tr('搜索', 'Search')}
            enterKeyHint="search"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-wx-ink outline-none placeholder:text-wx-meta focus-visible:outline-none"
          />
        </label>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ paddingBottom: OVERLAY_BOTTOM_INSET }}>
        {showEveryone ? (
          <PickerRow
            avatar={
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-brand-700 text-white">
                <EveryoneIcon />
              </span>
            }
            label={everyoneLabel}
            onClick={() => onSelect({ kind: 'all', label: everyoneLabel })}
          />
        ) : null}
        {members.map((member) => (
          <PickerRow
            key={member.id}
            avatar={<MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-10 w-10 text-sm" />}
            label={member.displayName}
            onClick={() => chooseMember(member)}
          />
        ))}
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
