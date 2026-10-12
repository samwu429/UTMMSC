import { useEffect, useState } from 'react';
import { ENROLLMENT_LABELS, enrollmentYearLabel, type ManualApplication } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { Button } from '../../../shared/ui/Button';
import { Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { adminApi } from '../api';

export function ApprovalsPanel() {
  const [items, setItems] = useState<ManualApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    adminApi.applications().then((res) => setItems(res.applications)).catch((err) => setError(errorMessage(err)));
  }, []);

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

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!items) return <Spinner />;
  if (items.length === 0) return <EmptyState>没有待审核的申请</EmptyState>;

  return (
    <div className="space-y-3">
      {items.map((a) => (
        <Card key={a.id}>
          <p className="font-medium">
            {a.displayName} <span className="text-sm font-normal text-slate-500">· {enrollmentYearLabel(a.graduationYear)} · {ENROLLMENT_LABELS[a.enrollmentStatus]}</span>
          </p>
          <p className="text-sm text-slate-600">{a.email}</p>
          {a.major ? <p className="text-sm text-slate-600">{a.major}</p> : null}
          {a.note ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-sm">{a.note}</p> : null}
          <p className="mt-1 text-xs text-slate-400">{formatRelative(a.createdAt)} 提交</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button onClick={() => decide(a.id, 'approve')} loading={busyId === a.id}>
              通过
            </Button>
            <Button variant="secondary" onClick={() => decide(a.id, 'reject')} disabled={busyId === a.id}>
              拒绝
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
