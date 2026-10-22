import { useEffect, useState } from 'react';
import type { ManualApplication } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { adminApi } from '../api';

interface YearRequest {
  id: string;
  displayName: string;
  email: string;
  currentYear: number;
  requestedYear: number;
  createdAt: string;
}

export function ApprovalsPanel() {
  const isSystemAdmin = useSessionStore((s) => s.member?.realRole === 'superadmin');
  const [items, setItems] = useState<ManualApplication[] | null>(null);
  const [yearRequests, setYearRequests] = useState<YearRequest[] | null>(isSystemAdmin ? null : []);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { tr, enrollment, year, major } = useLabels();

  useEffect(() => {
    adminApi.applications().then((res) => setItems(res.applications)).catch((err) => setError(errorMessage(err)));
  }, []);

  useEffect(() => {
    if (!isSystemAdmin) return;
    adminApi.enrollmentYearRequests().then((res) => setYearRequests(res.requests)).catch((err) => setError(errorMessage(err)));
  }, [isSystemAdmin]);

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      await adminApi.decide(id, decision);
      setItems((prev) => (prev ?? []).filter((a) => a.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function decideYear(id: string, decision: 'approve' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      await adminApi.decideEnrollmentYear(id, decision);
      setYearRequests((prev) => (prev ?? []).filter((request) => request.id !== id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (!items || !yearRequests) return error ? <Notice tone="error">{error}</Notice> : <Spinner />;
  if (items.length === 0 && yearRequests.length === 0) return <EmptyState>{tr('没有待审核的申请', 'No applications waiting for review')}</EmptyState>;

  return (
    <div className="space-y-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      {yearRequests.map((request) => (
        <Card key={request.id}>
          <p className="font-medium">{request.displayName}</p>
          <p className="text-sm text-slate-600">{request.email}</p>
          <p className="mt-1 text-sm text-slate-700">
            {tr(
              `入学年份 ${request.currentYear} 年，申请改为 ${request.requestedYear} 年`,
              `Enrollment year ${request.currentYear}, requested change to ${request.requestedYear}`,
            )}
          </p>
          <p className="mt-1 text-xs text-slate-400">{tr(`${formatRelative(request.createdAt)} 提交`, `Submitted ${formatRelative(request.createdAt)}`)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => decideYear(request.id, 'approve')} loading={busyId === request.id}>
              {tr('同意', 'Approve')}
            </Button>
            <Button variant="secondary" onClick={() => decideYear(request.id, 'reject')} disabled={busyId === request.id}>
              {tr('拒绝', 'Decline')}
            </Button>
          </div>
        </Card>
      ))}
      {items.map((a) => {
        const programs = major(a.major);
        return (
          <Card key={a.id}>
            <p className="font-medium">
              {a.displayName} <span className="text-sm font-normal text-slate-500">· {year(a.graduationYear)} · {enrollment(a.enrollmentStatus)}</span>
            </p>
            <p className="text-sm text-slate-600">{a.email}</p>
            {programs ? <p className="text-sm text-slate-600">{programs}</p> : null}
            {a.note ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-sm">{a.note}</p> : null}
            <p className="mt-1 text-xs text-slate-400">{tr(`${formatRelative(a.createdAt)} 提交`, `Submitted ${formatRelative(a.createdAt)}`)}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button onClick={() => decide(a.id, 'approve')} loading={busyId === a.id}>
                {tr('通过', 'Approve')}
              </Button>
              <Button variant="secondary" onClick={() => decide(a.id, 'reject')} disabled={busyId === a.id}>
                {tr('拒绝', 'Decline')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

