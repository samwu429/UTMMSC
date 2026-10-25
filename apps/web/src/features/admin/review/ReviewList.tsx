import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ManualApplication } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast';
import type { AdminYearRequest } from '../api';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useIsWide } from '../layout/media';
import { plural } from '../sections';
import { refreshAdminSummary, useAdminCounts } from '../state/summaryStore';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { SegmentedControl } from '../ui/Choices';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';
import { StickyActionBar } from '../ui/StickyActionBar';
import { decideReview, useApplications, useYearRequests } from './reviewData';
import { reviewItemPath, reviewListPath, runInOrder, type ReviewKind } from './reviewQueue';

const HEADER_BUTTON = 'min-h-11 rounded-lg px-2.5 text-[16px] font-medium text-brand-800 active:bg-stone-100 disabled:text-stone-400';

/**
 * 待审核: 入会申请 and, for the system admin, 入学年份 requests, oldest first, each opening its own screen. Applications
 * can also be approved several at a time: 选择, tick, 通过所选, confirmed with the count and sent one after another.
 * 「待审核」：入会申请，以及系统管理员才有的入学年份申请，最早的在前，每一项打开各自的界面。入会申请也可以一次通过多个：「选择」、勾选、
 * 「通过所选」，确认人数之后逐个发送。
 */
export function ReviewList({ kinds, kind, selectedId }: { kinds: readonly ReviewKind[]; kind: ReviewKind; selectedId: string | null }) {
  const { tr, year, enrollment, major } = useLabels();
  const navigate = useNavigate();
  const back = useSectionBack();
  const confirm = useAdminConfirm();
  const counts = useAdminCounts();
  const applications = useApplications(kinds.includes('applications'));
  const years = useYearRequests(kinds.includes('years'));
  const listRef = useRef<HTMLDivElement>(null);
  useListKeyboard(listRef);
  // In the split view, picking another item replaces the one shown, so back and Esc return to the list in one step.
  // 在分栏视图中，选择另一项会替换正在显示的一项，因此返回和 Esc 一步就回到列表。
  const swap = useIsWide() && selectedId !== null;

  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const query = kind === 'applications' ? applications : years;
  const appItems = applications.data ?? [];
  const canSelect = kind === 'applications' && appItems.length > 1;
  const inSelection = selecting && kind === 'applications';
  const visibleChosen = appItems.filter((item) => chosen.has(item.id));
  const allChosen = appItems.length > 0 && visibleChosen.length === appItems.length;

  function switchKind(next: ReviewKind) {
    setSelecting(false);
    setChosen(new Set());
    navigate(reviewListPath(next), { replace: true });
  }

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function approveChosen() {
    const batch = visibleChosen;
    if (batch.length === 0 || progress) return;
    const n = batch.length;
    const ok = await confirm({
      title: tr(`通过 ${n} 个入会申请？`, `Approve ${plural(n, 'application', 'applications')}?`),
      body: tr('每个人都会立即收到一封通过的邮件。', "Each of them gets an email right away saying they're in."),
      confirmLabel: tr('通过', 'Approve'),
    });
    if (!ok) return;
    setProgress({ done: 0, total: n });
    const result = await runInOrder(
      batch,
      (item) => decideReview('applications', item.id, 'approve', { refresh: false }),
      (done, total) => setProgress({ done, total }),
    );
    refreshAdminSummary();
    setProgress(null);
    // The ones that failed stay ticked, so trying again is one tap; the ones handled elsewhere have left the queue.
    // 失败的保持勾选，再试一次只需点一下；已在别处处理的已离开队列。
    setChosen(new Set(result.failed.map((entry) => entry.item.id)));
    const done = result.done.length;
    if (result.failed.length === 0) {
      setSelecting(false);
      toast(tr(`已通过 ${done} 个，已发邮件`, `Approved ${done}. They've been emailed.`));
      return;
    }
    const reason = errorMessage(result.failed[0]?.error);
    toast(tr(`已通过 ${done} 个，${result.failed.length} 个未成功：${reason}`, `Approved ${done}. ${result.failed.length} didn't go through: ${reason}`), { ms: 4000 });
  }

  const segments =
    kinds.length > 1 ? (
      <div className="px-3 pb-2.5 pt-0.5">
        <SegmentedControl
          label={tr('审核类别', 'Review type')}
          value={kind}
          onChange={switchKind}
          options={[
            { value: 'applications', label: tr('入会申请', 'Applications'), count: applications.data?.length ?? counts?.pendingApplications ?? null },
            { value: 'years', label: tr('入学年份', 'Enrollment years'), count: years.data?.length ?? counts?.pendingYearRequests ?? null },
          ]}
        />
      </div>
    ) : null;

  const trailing = inSelection ? (
    <button
      type="button"
      className={HEADER_BUTTON}
      disabled={progress !== null}
      onClick={() => {
        setSelecting(false);
        setChosen(new Set());
      }}
    >
      {tr('取消', 'Cancel')}
    </button>
  ) : canSelect ? (
    <button type="button" className={HEADER_BUTTON} onClick={() => setSelecting(true)}>
      {tr('选择', 'Select')}
    </button>
  ) : null;

  const footer = inSelection ? (
    <StickyActionBar note={progress ? tr(`正在处理 ${progress.done}/${progress.total}`, `Working ${progress.done}/${progress.total}`) : undefined}>
      <Button variant="secondary" disabled={progress !== null} onClick={() => setChosen(allChosen ? new Set() : new Set(appItems.map((item) => item.id)))}>
        {allChosen ? tr('全不选', 'Select none') : tr('全选', 'Select all')}
      </Button>
      <Button loading={progress !== null} disabled={visibleChosen.length === 0} onClick={() => void approveChosen()}>
        {tr(`通过所选（${visibleChosen.length}）`, `Approve (${visibleChosen.length})`)}
      </Button>
    </StickyActionBar>
  ) : undefined;

  function applicationRow(item: ManualApplication) {
    const programs = major(item.major);
    const detail = [year(item.graduationYear), enrollment(item.enrollmentStatus), programs].filter(Boolean).join(' · ');
    if (inSelection) {
      return (
        <AdminCell
          key={item.id}
          rowId={item.id}
          label={item.displayName}
          detail={detail}
          value={formatRelative(item.createdAt)}
          checkbox={{ checked: chosen.has(item.id), onChange: (on) => toggle(item.id, on) }}
          disabled={progress !== null}
          lazy
        />
      );
    }
    return (
      <AdminCell
        key={item.id}
        rowId={item.id}
        to={reviewItemPath('applications', item.id)}
        replace={swap}
        selected={item.id === selectedId}
        label={item.displayName}
        detail={detail}
        value={formatRelative(item.createdAt)}
        lazy
      />
    );
  }

  function yearRow(item: AdminYearRequest) {
    return (
      <AdminCell
        key={item.id}
        rowId={item.id}
        to={reviewItemPath('years', item.id)}
        replace={swap}
        selected={item.id === selectedId}
        label={item.displayName}
        detail={tr(`${item.currentYear} 年 → ${item.requestedYear} 年`, `${item.currentYear} → ${item.requestedYear}`)}
        value={formatRelative(item.createdAt)}
        lazy
      />
    );
  }

  let body;
  if (!query.data) {
    body = query.error ? <LoadFailed error={query.error} onRetry={() => void query.refresh()} /> : <ListSkeleton rows={4} />;
  } else if (query.data.length === 0) {
    body =
      kind === 'applications' ? (
        <EmptyBlock
          title={tr('没有待审核的申请', 'No applications waiting for review')}
          hint={tr('新的申请会出现在这里，管理入口会显示红色数字。', 'New applications show up here, with a red count on Admin.')}
        />
      ) : (
        <EmptyBlock
          title={tr('没有待审核的入学年份申请', 'No enrollment year requests waiting')}
          hint={tr('成员申请修改入学年份时会出现在这里。', 'Requests to change an enrollment year show up here.')}
        />
      );
  } else {
    body = (
      <>
        {query.error ? <LoadFailed error={query.error} onRetry={() => void query.refresh()} /> : null}
        <AdminGroup
          footer={
            kind === 'applications'
              ? tr('最早提交的在最前面。通过或拒绝都会立即给对方发邮件。', 'The oldest is first. Approving or declining emails them right away.')
              : tr('最早提交的在最前面。同意或拒绝都会给对方发邮件。', 'The oldest is first. Either decision emails them.')
          }
        >
          {kind === 'applications' ? appItems.map(applicationRow) : (years.data ?? []).map(yearRow)}
        </AdminGroup>
      </>
    );
  }

  return (
    <AdminScreen title={tr('待审核', 'Review')} count={query.data?.length ?? null} back={back} top trailing={trailing} sub={segments} footer={footer}>
      <div ref={listRef}>{body}</div>
    </AdminScreen>
  );
}
