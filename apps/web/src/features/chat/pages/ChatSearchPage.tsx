import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { MemberProfile } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { directoryApi } from '../../directory/api';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { ChatAvatar } from '../list/ChatAvatar';
import { highlightParts, matchesQuery, roomLink, searchConversations, type ConversationAvatar } from '../list/conversations';
import { useOverviewStore } from '../state/overviewStore';

const CONTACT_DEBOUNCE_MS = 250;

type ContactSearch = { q: string; members: MemberProfile[]; error: string | null };

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <span key={index} className="text-brand-700">
            {part.text}
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-wx-meta" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-2 bg-white">
      <h2 className="border-b-[0.5px] border-wx-line px-4 pb-2 pt-3 text-[13px] text-wx-meta">{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}

function ResultRow({ to, avatar, title, query, detail }: { to: string; avatar: ReactNode; title: string; query: string; detail?: string | null }) {
  return (
    <li>
      <Link to={to} className="flex min-h-[64px] items-center gap-3 pl-4 active:bg-wx-pressed">
        {avatar}
        <span className="flex min-h-[64px] min-w-0 flex-1 flex-col justify-center border-b-[0.5px] border-wx-line py-2 pr-4">
          <span className="truncate text-[16px] text-wx-ink">
            <Highlighted text={title} query={query} />
          </span>
          {detail ? <span className="truncate text-[13px] text-wx-meta">{detail}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function ConversationResult({ roomId, avatar, title, query }: { roomId: string; avatar: ConversationAvatar; title: string; query: string }) {
  return <ResultRow to={roomLink(roomId)} avatar={<ChatAvatar avatar={avatar} size={40} />} title={title} query={query} />;
}

/**
 * Full-screen search over contacts and conversation titles, outside the tab shell. Results update as
 * the member types; contacts come from the directory, channels and direct messages from the overview.
 * 不在标签外壳内的全屏搜索，范围是联系人和会话名称。结果随输入更新；联系人来自成员目录，频道和私聊来自会话概览。
 */
export function ChatSearchPage() {
  const { tr, role } = useLabels();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<ContactSearch | null>(null);
  const data = useOverviewStore((s) => s.data);
  const query = q.trim();

  useEffect(() => {
    void useOverviewStore.getState().refresh();
  }, []);

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      directoryApi
        .list({ q: query })
        .then((res) => !cancelled && setContacts({ q: query, members: res.members, error: null }))
        .catch((err) => !cancelled && setContacts({ q: query, members: [], error: errorMessage(err) }));
    }, CONTACT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const matches = useMemo(() => searchConversations(data, query), [data, query]);
  const channels = matches.filter((item) => item.kind === 'channel');
  const direct = matches.filter((item) => item.kind === 'direct');
  const contactsReady = contacts !== null && contacts.q === query;
  // While the next page of contacts loads, keep showing the earlier ones that still match, so the section does not flicker.
  // 下一批联系人加载期间，继续显示之前仍然匹配的联系人，避免该区域闪烁。
  const members = contactsReady ? contacts.members : query && contacts ? contacts.members.filter((member) => matchesQuery(member.displayName, query)) : [];
  // A failed contact lookup is not "no results"; its error line shows instead.
  // 联系人查询失败不等于「没有结果」，此时只显示错误行。
  const nothing = query !== '' && contactsReady && !contacts.error && members.length === 0 && matches.length === 0;

  function cancel() {
    if (location.key !== 'default') navigate(-1);
    else navigate('/chat', { replace: true });
  }

  return (
    <div className="mx-auto min-h-[100dvh] max-w-2xl bg-wx-canvas">
      <header className="sticky top-0 z-20 bg-wx-canvas" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <form
          role="search"
          className="flex h-14 items-center gap-1 pl-2"
          onSubmit={(event) => {
            event.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <label className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-white px-2.5">
            <SearchGlyph />
            <input
              type="search"
              value={q}
              autoFocus
              enterKeyHint="search"
              autoComplete="off"
              aria-label={tr('搜索', 'Search')}
              placeholder={tr('搜索', 'Search')}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !q) cancel();
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-[16px] text-wx-ink outline-none placeholder:text-wx-meta"
            />
          </label>
          <button type="button" onClick={cancel} className="flex min-h-11 shrink-0 items-center px-3 text-[16px] text-wx-link">
            {tr('取消', 'Cancel')}
          </button>
        </form>
      </header>

      <div className="pb-[max(24px,env(safe-area-inset-bottom))]">
        {query && !contactsReady && members.length === 0 && matches.length === 0 ? (
          <div className="flex justify-center py-8">
            <WxSpinner />
          </div>
        ) : null}
        {nothing ? (
          <p role="status" className="px-6 py-10 text-center text-[14px] leading-relaxed text-wx-meta">{tr(`没有找到“${query}”相关结果`, `No results for “${query}”`)}</p>
        ) : null}
        {members.length > 0 ? (
          <Section title={tr('联系人', 'Contacts')}>
            {members.map((member) => (
              <ResultRow
                key={member.id}
                to={`/directory/${encodeURIComponent(member.id)}`}
                avatar={<MemberAvatar name={member.displayName} avatarKey={member.avatarKey} shape="square" className="h-10 w-10 text-[17px]" />}
                title={member.displayName}
                query={query}
                detail={member.headline || role(member.role)}
              />
            ))}
          </Section>
        ) : null}
        {contactsReady && contacts.error ? <p className="px-4 py-3 text-[13px] text-wx-meta">{contacts.error}</p> : null}
        {channels.length > 0 ? (
          <Section title={tr('群聊', 'Groups')}>
            {channels.map((item) => (
              <ConversationResult key={item.roomId} roomId={item.roomId} avatar={item.avatar} title={item.title} query={query} />
            ))}
          </Section>
        ) : null}
        {direct.length > 0 ? (
          <Section title={tr('私信', 'Direct messages')}>
            {direct.map((item) => (
              <ConversationResult key={item.roomId} roomId={item.roomId} avatar={item.avatar} title={item.title} query={query} />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
