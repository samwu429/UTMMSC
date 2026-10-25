import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { ManualApplication } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast';
import type { AdminYearRequest, ReviewDecision } from '../api';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useIsDesktop } from '../layout/media';
import { useHeldValue } from '../state/useHeldValue';
import { AdminField, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { formatDayTime } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAdminConfirm } from '../ui/overlayGate';
import { StickyActionBar } from '../ui/StickyActionBar';
import { decideReview, useApplications, useYearRequests } from './reviewData';
import { neighbourAfter, reviewItemPath, reviewListPath, type ReviewKind } from './reviewQueue';

/**
 * One decision on the item on screen. Declining asks first, because both decisions email the person at once;
 * approving is the expected action and is not asked. Afterwards desktop opens the next item in the queue and
 * phones go back to the list.
 * 对屏幕上这一项做出决定。拒绝前会先询问，因为两种决定都会立即给对方发邮件；通过是预期中的操作，不再询问。之后桌面打开队列中的下一项，
 * 手机返回列表。
 */
function useDecision(kind: ReviewKind, id: string, queue: readonly { id: string }[] | undefined) {
  const { tr } = useLabels();
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const goBack = useAdminBack();
  const confirm = useAdminConfirm();
  const [busy, setBusy] = useState<ReviewDecision | null>(null);

  async function decide(decision: ReviewDecision, name: string) {
    if (busy) return;
    if (decision === 'reject') {
      const ok = await confirm({
        title:
          kind === 'applications'
            ? tr(`拒绝${name}的申请？`, `Decline ${name}'s application?`)
            : tr(`拒绝${name}的入学年份申请？`, `Decline ${name}'s enrollment year request?`),
        body: tr('对方会收到一封邮件。', "They'll get an email saying so."),
        confirmLabel: tr('拒绝', 'Decline'),
        danger: true,
      });
      if (!ok) return;
    }
    const next = queue ? neighbourAfter(queue, id) : null;
    setBusy(decision);
    try {
      await decideReview(kind, id, decision);
    } catch (err) {
      toast(errorMessage(err));
      setBusy(null);
      return;
    }
    toast(decision === 'approve' ? tr('已通过，已发邮件', "Approved. They've been emailed.") : tr('已拒绝', 'Declined'));
    if (desktop && next) navigate(reviewItemPath(kind, next.id), { replace: true });
    else goBack(reviewListPath(kind));
  }

  return { busy, decide };
}

function DecisionBar({ kind, busy, onDecide }: { kind: ReviewKind; busy: ReviewDecision | null; onDecide: (decision: ReviewDecision) => void }) {
  const { tr } = useLabels();
  return (
    <StickyActionBar>
      <Button variant="secondary" onClick={() => onDecide('reject')} loading={busy === 'reject'} disabled={busy !== null}>
        {tr('拒绝', 'Decline')}
      </Button>
      <Button onClick={() => onDecide('approve')} loading={busy === 'approve'} disabled={busy !== null}>
        {kind === 'applications' ? tr('通过', 'Approve') : tr('同意', 'Approve')}
      </Button>
    </StickyActionBar>
  );
}

/**
 * The screen around an item: loading, a failed load, or an item that is gone (decided by someone else, or an old
 * link). While a decision is on its way the item stays on screen even after it leaves the queue.
 * 包裹某一项的界面：加载中、加载失败，或该项已不存在（已被别人处理，或是旧链接）。决定发出期间，即使该项已离开队列也仍显示在屏幕上。
 */
function DetailFrame({
  kind,
  title,
  loading,
  error,
  onRetry,
  found,
  footer,
  children,
}: {
  kind: ReviewKind;
  title: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  found: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const { tr } = useLabels();
  const list = reviewListPath(kind);
  let body: ReactNode = children;
  if (!found) {
    body = loading ? (
      <ListSkeleton rows={5} />
    ) : error ? (
      <LoadFailed error={error} onRetry={onRetry} />
    ) : (
      <EmptyBlock
        title={tr('这条申请已处理或不存在', 'This request was already handled or no longer exists')}
        action={
          <Link to={list} replace className="inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-brand-800 active:bg-stone-100">
            {tr('返回待审核', 'Back to review')}
          </Link>
        }
      />
    );
  }
  return (
    <AdminScreen title={title} back={{ to: list, label: tr('待审核', 'Review') }} escapeTo={list} footer={found ? footer : undefined}>
      {body}
    </AdminScreen>
  );
}

function PersonHeader({ name, submitted }: { name: string; submitted: string }) {
  const { tr } = useLabels();
  return (
    <AdminGroup>
      <div className="px-4 py-4">
        <p className="break-words text-[20px] font-semibold leading-7 text-wx-ink">{name}</p>
        <p className="mt-0.5 text-[14px] text-wx-meta">{tr(`${formatRelative(submitted)}提交`, `Submitted ${formatRelative(submitted)}`)}</p>
      </div>
    </AdminGroup>
  );
}

function ApplicationDetail({ id }: { id: string }) {
  const { tr, year, enrollment, major, locale } = useLabels();
  const query = useApplications(true);
  const live = query.data?.find((item) => item.id === id);
  const { busy, decide } = useDecision('applications', id, query.data);
  const item: ManualApplication | undefined = useHeldValue(live, busy !== null);

  return (
    <DetailFrame
      kind="applications"
      title={tr('入会申请', 'Application')}
      loading={query.loading}
      error={query.error}
      onRetry={() => void query.refresh()}
      found={Boolean(item)}
      footer={
        <DecisionBar kind="applications" busy={busy} onDecide={(decision) => void decide(decision, item?.displayName ?? '')} />
      }
    >
      {item ? (
        <>
          <PersonHeader name={item.displayName} submitted={item.createdAt} />
          <AdminGroup>
            <AdminField label={tr('邮箱', 'Email')}>{item.email}</AdminField>
            <AdminField label={tr('入学年份', 'Enrollment year')}>{year(item.graduationYear)}</AdminField>
            <AdminField label={tr('在读状态', 'Status')}>{enrollment(item.enrollmentStatus)}</AdminField>
            <AdminField label={tr('专业', 'Program')}>{major(item.major) || tr('未填写', 'Not given')}</AdminField>
            <AdminField label={tr('申请说明', 'Note')} multiline>
              {item.note?.trim() ? item.note : tr('没有填写', 'None')}
            </AdminField>
            <AdminField label={tr('提交时间', 'Submitted')}>{formatDayTime(item.createdAt, locale)}</AdminField>
          </AdminGroup>
          <p className="px-4 pt-3 text-[13px] leading-relaxed text-wx-meta lg:px-1">
            {tr('通过后对方即可用这个邮箱登录。通过或拒绝都会立即给对方发邮件。', 'Once approved they can sign in with this email. Either decision emails them right away.')}
          </p>
        </>
      ) : null}
    </DetailFrame>
  );
}

function YearRequestDetail({ id }: { id: string }) {
  const { tr, locale } = useLabels();
  const query = useYearRequests(true);
  const live = query.data?.find((item) => item.id === id);
  const { busy, decide } = useDecision('years', id, query.data);
  const item: AdminYearRequest | undefined = useHeldValue(live, busy !== null);

  return (
    <DetailFrame
      kind="years"
      title={tr('入学年份申请', 'Enrollment year request')}
      loading={query.loading}
      error={query.error}
      onRetry={() => void query.refresh()}
      found={Boolean(item)}
      footer={
        <DecisionBar kind="years" busy={busy} onDecide={(decision) => void decide(decision, item?.displayName ?? '')} />
      }
    >
      {item ? (
        <>
          <PersonHeader name={item.displayName} submitted={item.createdAt} />
          <AdminGroup>
            <AdminField label={tr('邮箱', 'Email')}>{item.email}</AdminField>
            <AdminField label={tr('现在', 'Now')}>{tr(`${item.currentYear} 年入学`, `Entered ${item.currentYear}`)}</AdminField>
            <AdminField label={tr('申请改为', 'Requested')}>{tr(`${item.requestedYear} 年入学`, `Entered ${item.requestedYear}`)}</AdminField>
            <AdminField label={tr('提交时间', 'Submitted')}>{formatDayTime(item.createdAt, locale)}</AdminField>
          </AdminGroup>
          <p className="px-4 pt-3 text-[13px] leading-relaxed text-wx-meta lg:px-1">
            {tr(
              '同意后入学年份立即改为申请的年份；入学满五年会记为毕业生。同意或拒绝都会给对方发邮件。',
              'Approving changes the enrollment year at once; five years after enrollment the member is recorded as a graduate. Either decision emails them.',
            )}
          </p>
        </>
      ) : null}
    </DetailFrame>
  );
}

/** The screen of one waiting item, /admin/review/:kind/:id. */
/** 单个待审核事项的界面，/admin/review/:kind/:id。 */
export function ReviewDetail({ kind, id }: { kind: ReviewKind; id: string }) {
  return kind === 'applications' ? <ApplicationDetail id={id} /> : <YearRequestDetail id={id} />;
}
