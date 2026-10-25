import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ADMIN_ENROLLMENT_YEAR_MIN, ENROLLMENT_STATUSES, enrollmentYearMax, type EnrollmentStatus, type FriendSummary, type MemberProfile } from '@utmmsc/shared';
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
import { afterAccept, afterRequest, friendshipOf, indexFriendships, keepUnchanged } from '../friendships';

const YEARS: number[] = [];
for (let y = enrollmentYearMax(); y >= ADMIN_ENROLLMENT_YEAR_MIN; y--) YEARS.push(y);

export function DirectoryPage({ embedded = false }: { embedded?: boolean }) {
  const [q, setQ] = useState('');
  // The box shows every keystroke at once; the search and the dimmed list follow the deferred value.
  // 搜索框立即显示每次按键；搜索请求和变暗的列表跟随延后的值。
  const query = useDeferredValue(q);
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

  const friendships = useMemo(() => indexFriendships(friends, selfId), [friends, selfId]);

  // Stable, and given the member id by the row, so the memoised rows are not re-rendered by every page render.
  // 保持不变，并由行传入成员 id，经过 memo 的行因此不会随页面的每次渲染而重新渲染。
  const request = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await friendsApi.request(id);
      setFriends((prev) => afterRequest(prev, id, res.friendship));
    } catch (err) {
      // A toast, because the list's notice sits above the row that was tapped and may be off screen.
      // 用浮动提示，因为列表的提示条在被点的那一行上方，可能不在屏幕内。
      toast(errorMessage(err), { ms: 2500 });
    } finally {
      setBusyId(null);
    }
  }, []);

  const accept = useCallback(async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await friendsApi.accept(id);
      setFriends((prev) => afterAccept(prev, id));
    } catch (err) {
      toast(errorMessage(err), { ms: 2500 });
    } finally {
      setBusyId(null);
    }
  }, []);

  // Debounce the search box so each keystroke does not hit the directory endpoint.
  // 搜索框防抖，避免每次击键都请求目录接口。
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      directoryApi
        .list({ q: query || undefined, enrollmentStatus: enrollment || undefined, graduationYear: year ? Number(year) : undefined })
        .then((res) => {
          if (cancelled) return;
          setMembers((prev) => keepUnchanged(prev, res.members));
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
  }, [query, enrollment, year]);

  const filterKey = `${query}|${enrollment}|${year}`;
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const loadingMoreRef = useRef(false);

  async function loadMore() {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const requestedFor = filterKey;
    try {
      const res = await directoryApi.list({ q: query || undefined, enrollmentStatus: enrollment || undefined, graduationYear: year ? Number(year) : undefined, cursor });
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
              <MemberRow key={card.member.id} member={card.member} friendship="incoming" busy={busyId === card.member.id} onAccept={accept} />
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
            {members.map((m) => {
              const friendship = friendshipOf(friendships, m.id);
              return (
                <MemberRow
                  key={m.id}
                  member={m}
                  friendship={friendship}
                  busy={busyId === m.id}
                  onRequest={friendship === 'none' ? request : undefined}
                  onAccept={friendship === 'incoming' ? accept : undefined}
                />
              );
            })}
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
