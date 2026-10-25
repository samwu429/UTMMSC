import { Navigate, useLocation, useMatch, useSearchParams } from 'react-router-dom';
import { SplitView } from '../layout/SplitView';
import { sectionPath } from '../sections';
import { ReportDetail } from './ReportDetail';
import { ReportsList } from './ReportsList';
import { readReportStatus, reportsListPath } from './reportsQueue';

/**
 * /admin/reports/*: the reports (?status=open|removed|dismissed) and one report at /admin/reports/:id, side by side
 * from 1280px. Any other address under it goes back to the list.
 * /admin/reports/*：投诉列表（?status=open|removed|dismissed）以及位于 /admin/reports/:id 的单条投诉，从 1280px 起并排显示。其下的
 * 其他地址回到列表。
 */
export function ReportsSection() {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const base = sectionPath('reports');
  const match = useMatch(`${base}/:id`);
  const status = readReportStatus(params.get('status'));
  const id = match?.params.id ?? null;
  const atList = pathname === base || pathname === `${base}/`;
  if (!atList && !id) return <Navigate to={reportsListPath(status)} replace />;
  return (
    <SplitView
      detailOpen={id !== null}
      list={<ReportsList key={status} status={status} selectedId={id} />}
      detail={id ? <ReportDetail key={`${status}:${id}`} status={status} id={id} /> : null}
    />
  );
}
