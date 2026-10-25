import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MOMENT_REPORT_STATUSES, type MomentReportStatus } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useInsetGroups, useIsWide } from '../layout/media';
import { useAdminCounts } from '../state/summaryStore';
import { AdminGroup } from '../ui/AdminCell';
import { SegmentedControl } from '../ui/Choices';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { ReportCard, ReportRow } from './ReportCard';
import { loadMoreReports, useReportActions, useReports } from './reportsData';
import { reportPath, reportsListPath, targetKey } from './reportsQueue';

const STATUS_LABELS: Record<MomentReportStatus, [string, string]> = {
  open: ['待处理', 'Open'],
  removed: ['已移除', 'Removed'],
  dismissed: ['已驳回', 'Dismissed'],
};

const EMPTY_LABELS: Record<MomentReportStatus, [string, string]> = {
  open: ['没有待处理的投诉', 'No reports waiting for review'],
  removed: ['还没有移除过内容', 'Nothing has been removed yet'],
  dismissed: ['还没有驳回过投诉', 'No reports have been dismissed yet'],
};

type More = 'idle' | 'loading' | 'failed';

/**
 * 动态投诉: the open, removed and dismissed reports. Phones (and desktop below 1280px) show the full cards with their
 * actions; the wide split view shows compact rows with the card beside them. More pages load when the end of the
 * list comes into view, with a button as the fallback.
 * 「动态投诉」：待处理、已移除和已驳回的投诉。手机（以及 1280px 以下的桌面）显示带操作的完整卡片；宽屏分栏视图显示紧凑的行，卡片在旁边。
 * 列表末尾进入视野时加载更多，并保留一个按钮作为后备。
 */
export function ReportsList({ status, selectedId }: { status: MomentReportStatus; selectedId: string | null }) {
  const tr = useTr();
  const navigate = useNavigate();
  const back = useSectionBack();
  const wide = useIsWide();
  const insetGroups = useInsetGroups();
  const counts = useAdminCounts();
  const query = useReports(status);
  const actions = useReportActions(status);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<More>('idle');
  useListKeyboard(listRef);

  const page = query.data;
  const cursor = page?.nextCursor ?? null;

  async function loadMore() {
    if (!cursor || more === 'loading') return;
    setMore('loading');
    try {
      await loadMoreReports(status, cursor);
      setMore('idle');
    } catch {
      setMore('failed');
    }
  }
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });

  // The next page loads as the end of the list comes near; a failure waits for the button.
  // 列表末尾接近时加载下一页；失败后等成员点按钮。
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !cursor || more !== 'idle' || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [cursor, more]);

  const openCount = counts?.openReports ?? (page && status === 'open' && !page.nextCursor ? page.reports.length : null);
  const segments = (
    <div className="px-3 pb-2.5 pt-0.5">
      <SegmentedControl<MomentReportStatus>
        label={tr('投诉状态', 'Report status')}
        value={status}
        onChange={(next) => {
          setMore('idle');
          navigate(reportsListPath(next), { replace: true });
        }}
        options={MOMENT_REPORT_STATUSES.map((value) => ({ value, label: tr(...STATUS_LABELS[value]), count: value === 'open' ? openCount : null }))}
      />
    </div>
  );

  let body;
  if (!page) {
    body = query.error ? <LoadFailed error={query.error} onRetry={() => void query.refresh()} /> : <ListSkeleton rows={4} avatar />;
  } else if (page.reports.length === 0) {
    body = <EmptyBlock title={tr(...EMPTY_LABELS[status])} hint={status === 'open' ? tr('有人投诉动态或评论时会出现在这里。', 'Reported updates and comments show up here.') : undefined} />;
  } else if (wide) {
    body = (
      <AdminGroup inset="avatar">
        {page.reports.map((report) => (
          <ReportRow key={report.id} report={report} status={status} to={reportPath(status, report.id)} replace={selectedId !== null} selected={report.id === selectedId} />
        ))}
      </AdminGroup>
    );
  } else {
    body = (
      <div className={`space-y-3 ${insetGroups ? '' : 'px-3 pt-3'}`}>
        {page.reports.map((report) => (
          <ReportCard
            key={report.id}
            report={report}
            status={status}
            mediaToken={page.mediaToken}
            busy={actions.busy[targetKey(report)] ?? null}
            onRemove={(reason) => void actions.remove(report, reason)}
            onDismiss={() => void actions.dismiss(report)}
            onRestore={() => void actions.restore(report)}
          />
        ))}
      </div>
    );
  }

  return (
    <AdminScreen title={tr('动态投诉', 'Update reports')} back={back} top sub={segments}>
      <div ref={listRef}>
        {page && query.error ? <LoadFailed error={query.error} onRetry={() => void query.refresh()} /> : null}
        {body}
      </div>
      {cursor ? (
        <div ref={sentinel} className="flex flex-col items-center gap-2 px-4 pt-4">
          {more === 'failed' ? <p className="text-[13px] text-red-700">{tr('加载失败，请重试', "Couldn't load. Try again.")}</p> : null}
          <Button variant="secondary" loading={more === 'loading'} onClick={() => void loadMore()}>
            {tr('加载更多', 'Load more')}
          </Button>
        </div>
      ) : null}
    </AdminScreen>
  );
}
