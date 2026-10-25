import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { MomentReport, MomentReportStatus } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useInsetGroups, useIsWide } from '../layout/media';
import { useHeldValue } from '../state/useHeldValue';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { ReportCard } from './ReportCard';
import { useReportActions, useReports } from './reportsData';
import { nextReportAfter, reportPath, reportsListPath, targetKey } from './reportsQueue';

/**
 * One report at /admin/reports/:id: the detail pane of the wide split view, or its own screen from a link. Once an
 * open report is resolved it leaves the list, so the split view moves on to the next one and a single screen goes
 * back to the list.
 * 位于 /admin/reports/:id 的单条投诉：宽屏分栏视图的详情栏，或从链接打开的独立界面。待处理的投诉处理后会离开列表，因此分栏视图转到下一条，
 * 独立界面则返回列表。
 */
export function ReportDetail({ status, id }: { status: MomentReportStatus; id: string }) {
  const tr = useTr();
  const navigate = useNavigate();
  const goBack = useAdminBack();
  const wide = useIsWide();
  const insetGroups = useInsetGroups();
  const query = useReports(status);
  const actions = useReportActions(status);
  const [leaving, setLeaving] = useState(false);
  const live = query.data?.reports.find((report) => report.id === id);
  const report = useHeldValue(live, leaving || (live ? actions.busy[targetKey(live)] !== undefined : false));
  const list = reportsListPath(status);

  async function resolve(item: MomentReport, send: () => Promise<boolean>) {
    const next = query.data ? nextReportAfter(query.data.reports, item) : null;
    setLeaving(true);
    const ok = await send();
    if (!ok || status !== 'open') {
      setLeaving(false);
      return;
    }
    if (wide && next) navigate(reportPath(status, next.id), { replace: true });
    else goBack(list);
  }

  let body;
  if (report) {
    body = (
      <div className={insetGroups ? '' : 'px-3 pt-3'}>
        <ReportCard
          report={report}
          status={status}
          mediaToken={query.data?.mediaToken ?? null}
          busy={actions.busy[targetKey(report)] ?? null}
          onRemove={(reason) => void resolve(report, () => actions.remove(report, reason))}
          onDismiss={() => void resolve(report, () => actions.dismiss(report))}
          onRestore={() => void actions.restore(report)}
        />
      </div>
    );
  } else if (!query.data) {
    body = query.error ? <LoadFailed error={query.error} onRetry={() => void query.refresh()} /> : <ListSkeleton rows={3} avatar />;
  } else {
    body = (
      <EmptyBlock
        title={tr('这条投诉不在列表中', "This report isn't in the list")}
        hint={tr('可能已被处理，或在更早的分页里。', 'It may have been handled already, or be further down the list.')}
        action={
          <Link to={list} replace className="inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-brand-800 active:bg-stone-100">
            {tr('返回动态投诉', 'Back to update reports')}
          </Link>
        }
      />
    );
  }

  return (
    <AdminScreen title={tr('投诉详情', 'Report')} back={{ to: list, label: tr('动态投诉', 'Update reports') }} escapeTo={list}>
      {body}
    </AdminScreen>
  );
}
