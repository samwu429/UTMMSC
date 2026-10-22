import { useEffect, useRef, useState } from 'react';
import { ADMIN_ENROLLMENT_YEAR_MIN, ENROLLMENT_STATUSES, enrollmentYearMax, type EnrollmentStatus, type FriendSummary, type FriendshipState, type MemberProfile } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List, Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { Select, TextInput } from '../../../shared/ui/Field';
import { toast } from '../../../shared/ui/toast';
import { friendsApi } from '../../friends/api';
import { directoryApi } from '../api';
import { MemberRow } from '../components/MemberRow';

const YEARS: number[] = [];
for (let y = enrollmentYearMax(); y >= ADMIN_ENROLLMENT_YEAR_MIN; y--) YEARS.push(y);

export function DirectoryPage({ embedded = false }: { embedded?: boolean }) {
  const [q, setQ] = useState('');
  const [enrollment, setEnrollment] = useState<EnrollmentStatus | ''>('');
  const [year, setYear] = useState('');
  const [members, setMembers] = useState<MemberProfile[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendSummary | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const selfId = useSessionStore((s) => s.member?.id);
  const { tr, enrollment: enrollmentLabel, year: yearLabel } = useLabels();

  useEffect(() => {
    friendsApi.summary().then(setFriends).catch(() => undefined);
  }, []);

  function stateFor(id: string): FriendshipState {
    if (id === selfId) return 'self';
    if (friends?.friendIds.includes(id)) return 'friends';
    if (friends?.outgoingIds.includes(id)) return 'outgoing';
    if (friends?.incoming.some((card) => card.member.id === id)) return 'incoming';
    return 'none';
  }

  async function request(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await friendsApi.request(id);
      setFriends((prev) => {
        const base = prev ?? { incoming: [], outgoingIds: [], friendIds: [] };
        if (res.friendship === 'friends') {
          return { ...base, friendIds: [...base.friendIds, id], incoming: base.incoming.filter((card) => card.member.id !== id), outgoingIds: base.outgoingIds.filter((item) => item !== id) };
        }
        return { ...base, outgoingIds: base.outgoingIds.includes(id) ? base.outgoingIds : [...base.outgoingIds, id] };
      });
    } catch (err) {
      // A toast, because the list's notice sits above the row that was tapped and may be off screen.
      // 用浮动提示，因为列表的提示条在被点的那一行上方，可能不在屏幕内。
      toast(errorMessage(err), { ms: 2500 });
    } finally {
      setBusyId(null);
    }
  }

  async function accept(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await friendsApi.accept(id);
      setFriends((prev) => {
        const base = prev ?? { incoming: [], outgoingIds: [], friendIds: [] };
        return { ...base, friendIds: [...base.friendIds, id], incoming: base.incoming.filter((card) => card.member.id !== id) };
      });
    } catch (err) {
      toast(errorMessage(err), { ms: 2500 });
    } finally {
      setBusyId(null);
    }
  }

  // Debounce the search box so each keystroke does not hit the directory endpoint.
  // 搜索框防抖，避免每次击键都请求目录接口。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      directoryApi
        .list({ q: q || undefined, enrollmentStatus: enrollment || undefined, graduationYear: year ? Number(year) : undefined })
        .then((res) => {
          if (cancelled) return;
          setMembers(res.members);
          setCursor(res.nextCursor);
          setError(null);
        })
        .catch((err) => !cancelled && setError(errorMessage(err)))
        .finally(() => !cancelled && setLoading(false));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, enrollment, year]);

  const filterKey = `${q}|${enrollment}|${year}`;
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const loadingMoreRef = useRef(false);

  async function loadMore() {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const requestedFor = filterKey;
    try {
      const res = await directoryApi.list({ q: q || undefined, enrollmentStatus: enrollment || undefined, graduationYear: year ? Number(year) : undefined, cursor });
      // Drop the page if the filters changed while it loaded.
      // 加载期间筛选条件变了，就丢弃这一页。
      if (filterKeyRef.current !== requestedFor) return;
      setMembers((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...res.members.filter((m) => !seen.has(m.id))];
      });
      setCursor(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-4">
      {embedded ? null : <PageTitle>{tr('成员', 'Members')}</PageTitle>}
      {friends && friends.incoming.length > 0 ? (
        <div>
          <h2 className="mb-2 text-[15px] font-medium text-brand-800">{tr('新的朋友', 'New friends')}</h2>
          <List>
            {friends.incoming.map((card) => (
              <MemberRow key={card.member.id} member={card.member} friendship="incoming" busy={busyId === card.member.id} onAccept={() => accept(card.member.id)} />
            ))}
          </List>
        </div>
      ) : null}
      <TextInput
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label={tr('搜索成员', 'Search members')}
        placeholder={tr('搜索姓名、专业、技能或所在地', 'Search name, program, skills, or location')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select value={enrollment} onChange={(e) => setEnrollment(e.target.value as EnrollmentStatus | '')}>
          <option value="">{tr('全部状态', 'Any status')}</option>
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {enrollmentLabel(s)}
            </option>
          ))}
        </Select>
        <Select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">{tr('全部入学年份', 'Any enrollment year')}</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {yearLabel(y)}
            </option>
          ))}
        </Select>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {/* A new search keeps the current list on screen, dimmed, instead of swapping it for a spinner on every keystroke. */}
      {/* 新的搜索会保留当前列表并调暗，而不是每次按键都换成加载圈。 */}
      {loading && members.length === 0 ? <Spinner /> : !loading && members.length === 0 ? (
        <div className="text-center">
          <EmptyState>{tr('没有匹配的成员', 'No matching members')}</EmptyState>
          {q || enrollment || year ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQ('');
                setEnrollment('');
                setYear('');
              }}
            >
              {tr('清除筛选', 'Clear filters')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {members.length > 0 ? (
        <div className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <List>
            {members.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                friendship={stateFor(m.id)}
                busy={busyId === m.id}
                onRequest={stateFor(m.id) === 'none' ? () => request(m.id) : undefined}
                onAccept={stateFor(m.id) === 'incoming' ? () => accept(m.id) : undefined}
              />
            ))}
          </List>
          {cursor && !loading ? (
            <Button variant="secondary" block onClick={loadMore} loading={loadingMore}>
              {tr('加载更多', 'Load more')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
