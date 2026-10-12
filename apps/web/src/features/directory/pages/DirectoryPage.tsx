import { useEffect, useState } from 'react';
import { ENROLLMENT_LABELS, ENROLLMENT_STATUSES, GRADUATION_YEAR_MIN, graduationYearMax, type EnrollmentStatus, type MemberProfile } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { Button } from '../../../shared/ui/Button';
import { EmptyState, List, Notice, PageTitle, Spinner } from '../../../shared/ui/Card';
import { Select, TextInput } from '../../../shared/ui/Field';
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
        <EmptyState>
          没有匹配的成员
          {q || enrollment || year ? (
            <button
              type="button"
              className="mt-2 font-medium text-brand-800"
              onClick={() => {
                setQ('');
                setEnrollment('');
                setYear('');
              }}
            >
              清除筛选
            </button>
          ) : null}
        </EmptyState>
      ) : null}
      {!loading ? (
        <div className="space-y-3">
          {members.length > 0 ? (
            <List>
              {members.map((m) => (
                <MemberRow key={m.id} member={m} />
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
