import { useEffect, useState } from 'react';
import { ENROLLMENT_LABELS, ENROLLMENT_STATUSES, GRADUATION_YEAR_MIN, graduationYearMax, type EnrollmentStatus, type FriendSummary, type FriendshipState, type MemberProfile } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List, Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { Select, TextInput } from '../../../shared/ui/Field';
import { friendsApi } from '../../friends/api';
import { directoryApi } from '../api';
import { MemberRow } from '../components/MemberRow';

const YEARS: number[] = [];
for (let y = graduationYearMax(); y >= GRADUATION_YEAR_MIN; y--) YEARS.push(y);

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
  const selfId = useSessionStore((s) => s.member?.id);

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
      setError(errorMessage(err));
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
      setError(errorMessage(err));
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

  async function loadMore() {
    if (!cursor) return;
    try {
      const res = await directoryApi.list({ q: q || undefined, enrollmentStatus: enrollment || undefined, graduationYear: year ? Number(year) : undefined, cursor });
      setMembers((prev) => [...prev, ...res.members]);
      setCursor(res.nextCursor);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      {embedded ? null : <PageTitle>成员</PageTitle>}
      {friends && friends.incoming.length > 0 ? (
        <div>
          <h2 className="mb-2 text-[15px] font-medium text-brand-800">新的朋友</h2>
          <List>
            {friends.incoming.map((card) => (
              <MemberRow key={card.member.id} member={card.member} friendship="incoming" busy={busyId === card.member.id} onAccept={() => accept(card.member.id)} />
            ))}
          </List>
        </div>
      ) : null}
      <TextInput placeholder="搜索姓名、专业、技能或所在地" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="grid grid-cols-2 gap-3">
        <Select value={enrollment} onChange={(e) => setEnrollment(e.target.value as EnrollmentStatus | '')}>
          <option value="">全部状态</option>
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ENROLLMENT_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">全部届别</option>
          {YEARS.map((y) => (
            <option key={y} value={y}>
              {y} 届
            </option>
          ))}
        </Select>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {loading ? <Spinner /> : members.length === 0 ? (
        <div className="text-center">
          <EmptyState>没有匹配的成员</EmptyState>
          {q || enrollment || year ? (
            <Button
              variant="secondary"
              onClick={() => {
                setQ('');
                setEnrollment('');
                setYear('');
              }}
            >
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}
      {!loading ? (
        <div className="space-y-3">
          {members.length > 0 ? (
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
          ) : null}
          {cursor ? (
            <Button variant="secondary" block onClick={loadMore}>
              加载更多
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
