import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MOMENT_MODERATION_REASON_MAX,
  MOMENT_REPORT_STATUSES,
  momentTextLength,
  type MomentReport,
  type MomentReportReason,
  type MomentReportStatus,
} from '@utmmsc/shared';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { formatRelative } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Badge, Card, EmptyState, Notice, Spinner } from '../../../shared/ui/Card';
import { TextArea } from '../../../shared/ui/Field';
import { toast } from '../../../shared/ui/toast';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { momentsApi } from '../../moments/api';
import { MediaGrid } from '../../moments/components/MediaGrid';
import type { LoadState } from '../../moments/model';
import { momentDetailPath, type MomentDetailLinkState } from '../../moments/pages/MomentDetailPage';

/**
 * 动态投诉 for members with chat.moderate: the open, removed and dismissed reports, each with the content as it
 * was reported. A moderator removes (with a reason the author reads), dismisses or restores, and only content
 * of members in a lower tier; for the rest the buttons stay disabled and say why.
 * 拥有 chat.moderate 的成员使用的「动态投诉」：待处理、已移除和已驳回的投诉，每条都附有被投诉时的内容。管理员可以移除（填写作者会看到的原因）、
 * 驳回或恢复，但只能处理档位更低的成员的内容；其余情况按钮保持不可用，并说明原因。
 */

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

const REASON_LABELS: Record<MomentReportReason, [string, string]> = {
  spam: ['垃圾广告', 'Spam'],
  harassment: ['骚扰或攻击', 'Harassment'],
  inappropriate: ['不当内容', 'Inappropriate'],
  privacy: ['泄露隐私', 'Privacy'],
  other: ['其他', 'Other'],
};

/** Quick reasons for a removal; the author reads the reason in 这条动态已被管理员移除：{reason}. */
/** 移除时的快捷原因；作者会在「这条动态已被管理员移除：{原因}」中看到它。 */
const QUICK_REASONS: MomentReportReason[] = ['spam', 'harassment', 'inappropriate', 'privacy'];

type Action = 'remove' | 'dismiss' | 'restore';

interface PanelState {
  status: MomentReportStatus;
  reports: MomentReport[];
  nextCursor: string | null;
  /** Page 1 of this filter is loading. */
  /** 当前筛选的第一页正在加载。 */
  loading: boolean;
  more: LoadState;
  error: string | null;
  mediaToken: string | null;
}

/** Every report on one post or one comment shares this, so resolving one updates them all. */
/** 针对同一动态或同一评论的投诉共用这个键，处理其中一条时一并更新。 */
function targetKey(report: Pick<MomentReport, 'postId' | 'commentId'>): string {
  return `${report.postId}:${report.commentId ?? ''}`;
}

function RemoveForm({ report, busy, onCancel, onConfirm }: { report: MomentReport; busy: boolean; onCancel(): void; onConfirm(reason: string): void }) {
  const tr = useTr();
  const [reason, setReason] = useState(() => (report.reason === 'other' ? '' : tr(...REASON_LABELS[report.reason])));
  const length = momentTextLength(reason.trim());
  const tooLong = length > MOMENT_MODERATION_REASON_MAX;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
      <p className="text-sm font-medium text-stone-800">{tr('移除原因', 'Reason for removal')}</p>
      <p className="text-xs text-stone-500">{tr('作者会收到通知，并看到你填写的原因', 'The author is told and sees the reason you give')}</p>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REASONS.map((key) => {
          const label = tr(...REASON_LABELS[key]);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={reason.trim() === label}
              onClick={() => setReason(label)}
              className={`min-h-9 rounded-full border px-3 text-sm ${reason.trim() === label ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-stone-300 bg-white text-stone-700'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <TextArea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={MOMENT_MODERATION_REASON_MAX * 2}
        aria-label={tr('移除原因', 'Reason for removal')}
        className="min-h-[72px] text-[16px]"
      />
      <p className={`text-right text-xs ${tooLong ? 'text-red-700' : 'text-stone-500'}`}>
        {tooLong ? tr(`原因不能超过 ${MOMENT_MODERATION_REASON_MAX} 字`, `Keep the reason under ${MOMENT_MODERATION_REASON_MAX + 1} characters`) : `${length}/${MOMENT_MODERATION_REASON_MAX}`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {tr('取消', 'Cancel')}
        </Button>
        <Button variant="danger" onClick={() => onConfirm(reason.trim())} loading={busy} disabled={length === 0 || tooLong}>
          {tr('确认移除', 'Remove')}
        </Button>
      </div>
    </div>
  );
}

interface ReportCardProps {
  report: MomentReport;
  filter: MomentReportStatus;
  mediaToken: string | null;
  /** The action on its way for this content, if any; every button waits for it. */
  /** 针对这条内容正在进行的操作；所有按钮都等它完成。 */
  busy: Action | null;
  removing: boolean;
  onStartRemove(): void;
  onCancelRemove(): void;
  onRemove(reason: string): void;
  onDismiss(): void;
  onRestore(): void;
}

function ReportCard({ report, filter, mediaToken, busy, removing, onStartRemove, onCancelRemove, onRemove, onDismiss, onRestore }: ReportCardProps) {
  const tr = useTr();
  const isComment = report.commentId !== null;
  const open = filter === 'open';
  const linkState: MomentDetailLinkState = { from: 'reports' };
  const currentBadge =
    report.current === 'live' ? (
      <Badge tone="green">{tr('仍在显示', 'Still visible')}</Badge>
    ) : report.current === 'removed' ? (
      <Badge tone="amber">{isComment ? tr('该评论已被管理员移除', 'An admin removed this comment') : tr('这条动态已被管理员移除', 'An admin removed this update')}</Badge>
    ) : (
      <Badge>{tr('作者已删除', 'Deleted by the author')}</Badge>
    );

  // What can still be done: an open report is removed or dismissed; any report on removed content can be
  // restored; a handled report on live content can still be removed, through the same report.
  // 还能做什么：待处理的投诉可以移除或驳回；内容已被移除的投诉可以恢复；已处理但内容仍在的投诉仍可通过同一条投诉移除。
  const canRemove = report.current === 'live';
  const canDismiss = open;
  const canRestore = report.current === 'removed';
  const actionable = canRemove || canDismiss || canRestore;
  const disabled = busy !== null || !report.canResolve;

  return (
    <Card>
      <div className="flex items-start gap-3">
        <Link to={`/directory/${encodeURIComponent(report.target.id)}`} className="shrink-0" aria-label={tr(`查看${report.target.displayName}的资料`, `View ${report.target.displayName}'s profile`)}>
          <MemberAvatar name={report.target.displayName} avatarKey={report.target.avatarKey} shape="square" className="h-10 w-10 text-sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-medium text-stone-900">{report.target.displayName}</span>
            <Badge tone="brand">{isComment ? tr('评论', 'Comment') : tr('动态', 'Update')}</Badge>
            {open && report.reportCount > 1 ? <Badge tone="amber">{tr(`${report.reportCount} 人投诉`, `${report.reportCount} reports`)}</Badge> : null}
          </p>
          <p className="mt-1 text-sm text-stone-700">
            {tr('原因：', 'Reason: ')}
            {tr(...REASON_LABELS[report.reason])}
          </p>
          {report.note ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-stone-600">{report.note}</p> : null}
          <p className="mt-1 text-xs text-stone-500">
            {tr(`${report.reporter.displayName} 投诉于 ${formatRelative(report.createdAt)}`, `Reported by ${report.reporter.displayName}, ${formatRelative(report.createdAt)}`)}
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-stone-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-stone-500">{tr('投诉时的内容', 'As reported')}</p>
          {currentBadge}
        </div>
        {report.snapshot.body ? (
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-stone-900 [overflow-wrap:anywhere]">{report.snapshot.body}</p>
        ) : (
          <p className="mt-2 text-sm text-stone-400">{tr('（没有文字）', '(No text)')}</p>
        )}
        {report.snapshot.media.length > 0 ? (
          <div className="mt-2">
            <MediaGrid postId={`report:${report.id}`} media={report.snapshot.media} mediaToken={mediaToken} />
          </div>
        ) : null}
        {report.current === 'live' ? (
          <Link to={momentDetailPath(report.postId, report.commentId)} state={linkState} className="mt-2 inline-flex min-h-11 items-center text-sm text-brand-700">
            {isComment ? tr('查看这条评论', 'Open the comment') : tr('查看这条动态', 'Open the update')}
          </Link>
        ) : null}
      </div>

      {!report.canResolve && actionable ? (
        <div className="mt-3">
          <Notice>{tr('不能处理职位不低于你的成员的内容', "You can't act on content from someone at or above your level.")}</Notice>
        </div>
      ) : null}

      {removing ? <RemoveForm report={report} busy={busy === 'remove'} onCancel={onCancelRemove} onConfirm={onRemove} /> : null}

      {actionable && !removing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {canRemove ? (
            <Button variant="danger" onClick={onStartRemove} disabled={disabled} className="flex-1">
              {tr('移除', 'Remove')}
            </Button>
          ) : null}
          {canDismiss ? (
            <Button variant="secondary" onClick={onDismiss} disabled={disabled} loading={busy === 'dismiss'} className="flex-1">
              {tr('驳回', 'Dismiss')}
            </Button>
          ) : null}
          {canRestore ? (
            <Button variant="secondary" onClick={onRestore} disabled={disabled} loading={busy === 'restore'} className="flex-1">
              {tr('恢复', 'Restore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

/** 动态投诉: the moderation queue of 好友动态. */
/** 「动态投诉」：好友动态的管理队列。 */
export function MomentReportsPanel() {
  const tr = useTr();
  const [state, setState] = useState<PanelState>({ status: 'open', reports: [], nextCursor: null, loading: true, more: 'idle', error: null, mediaToken: null });
  const [busy, setBusy] = useState<Record<string, Action>>({});
  const [removingId, setRemovingId] = useState<string | null>(null);
  const requestSeq = useRef(0);
  // The filter on screen when an answer arrives; a list loaded for another filter since then is left alone.
  // 返回结果到达时屏幕上的筛选；之后已为其他筛选加载的列表不受影响。
  const shownStatus = useRef(state.status);
  useLayoutEffect(() => {
    shownStatus.current = state.status;
  });

  const load = useCallback(async (status: MomentReportStatus, cursor: string | null) => {
    const seq = ++requestSeq.current;
    setState((current) => (cursor ? { ...current, more: 'loading' } : { status, reports: [], nextCursor: null, loading: true, more: 'idle', error: null, mediaToken: current.mediaToken }));
    try {
      const res = await momentsApi.reports({ status, cursor });
      if (seq !== requestSeq.current) return;
      setState((current) => {
        const known = cursor ? current.reports : [];
        const seen = new Set(known.map((report) => report.id));
        return {
          status,
          reports: [...known, ...res.reports.filter((report) => !seen.has(report.id))],
          nextCursor: res.nextCursor,
          loading: false,
          more: 'idle',
          error: null,
          mediaToken: res.mediaToken,
        };
      });
    } catch (err) {
      if (seq !== requestSeq.current) return;
      setState((current) => (cursor ? { ...current, more: 'failed' } : { ...current, loading: false, error: errorMessage(err) }));
    }
  }, []);

  useEffect(() => {
    void load('open', null);
  }, [load]);

  function switchTo(status: MomentReportStatus) {
    if (status === state.status && !state.error) return;
    setRemovingId(null);
    void load(status, null);
  }

  /** Applies a change to every report on the same post or comment. */
  /** 把变化应用到针对同一动态或评论的所有投诉。 */
  function updateTarget(report: MomentReport, change: (item: MomentReport) => MomentReport | null) {
    const key = targetKey(report);
    setState((current) => ({
      ...current,
      reports: current.reports.flatMap((item) => {
        if (targetKey(item) !== key) return [item];
        const next = change(item);
        return next ? [next] : [];
      }),
    }));
  }

  async function run(report: MomentReport, action: Action, send: () => Promise<unknown>, done: () => void) {
    const key = targetKey(report);
    if (busy[key]) return;
    const filter = state.status;
    setBusy((current) => ({ ...current, [key]: action }));
    try {
      await send();
      if (shownStatus.current === filter) done();
    } catch (err) {
      // Gone since the queue loaded: the author deleted it.
      // 队列加载之后内容已不存在：作者已删除。
      const gone = err instanceof ApiClientError && (err.code === 'moment_unavailable' || err.code === 'comment_unavailable');
      if (gone && shownStatus.current === filter) {
        updateTarget(report, (item) => ({ ...item, current: 'deleted' }));
        if (removingId === report.id) setRemovingId(null);
      }
      toast(errorMessage(err));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  function remove(report: MomentReport, reason: string) {
    void run(
      report,
      'remove',
      // Always through the report, handled or not: the moderator works from its snapshot, and the direct routes
      // would also need sight of the post, which a moderator outside the author's circle does not have.
      // 无论投诉是否已处理，都通过投诉移除：管理员依据投诉的快照处理；直接移除的接口还要求能看到这条动态，而不在作者圈子里的管理员看不到。
      () => momentsApi.resolveReport(report.id, { action: 'remove', reason }),
      () => {
        setRemovingId(null);
        // Resolving closes every open report on the same content, so they all leave the open queue.
        // 处理会关闭针对同一内容的所有待处理投诉，因此它们都离开待处理队列。
        updateTarget(report, (item) => (state.status === 'open' ? null : { ...item, current: 'removed' }));
        toast(tr('已移除', 'Removed'));
      },
    );
  }

  function dismiss(report: MomentReport) {
    void run(
      report,
      'dismiss',
      () => momentsApi.resolveReport(report.id, { action: 'dismiss' }),
      () => {
        updateTarget(report, () => null);
        toast(tr('已驳回', 'Dismissed'));
      },
    );
  }

  function restore(report: MomentReport) {
    void run(
      report,
      'restore',
      () => (report.commentId ? momentsApi.restoreComment(report.commentId) : momentsApi.restorePost(report.postId)),
      () => {
        updateTarget(report, (item) => ({ ...item, current: 'live' }));
        toast(tr('已恢复', 'Restored'));
      },
    );
  }

  const { status, reports, nextCursor, loading, more, error, mediaToken } = state;

  return (
    <div className="space-y-3">
      <div role="tablist" aria-label={tr('投诉状态', 'Report status')} className="grid grid-cols-3 gap-1 rounded-lg bg-stone-100 p-1">
        {MOMENT_REPORT_STATUSES.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => switchTo(key)}
            className={`min-h-10 rounded-md text-[14px] ${status === key ? 'bg-white font-medium text-brand-800 shadow-sm' : 'text-stone-600'}`}
          >
            {tr(...STATUS_LABELS[key])}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : error && reports.length === 0 ? (
        <div className="space-y-2">
          <Notice tone="error">{error}</Notice>
          <Button variant="secondary" block onClick={() => void load(status, null)}>
            {tr('重试', 'Retry')}
          </Button>
        </div>
      ) : reports.length === 0 ? (
        <EmptyState>{tr(...EMPTY_LABELS[status])}</EmptyState>
      ) : (
        <>
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              report={report}
              filter={status}
              mediaToken={mediaToken}
              busy={busy[targetKey(report)] ?? null}
              removing={removingId === report.id}
              onStartRemove={() => setRemovingId(report.id)}
              onCancelRemove={() => setRemovingId(null)}
              onRemove={(reason) => remove(report, reason)}
              onDismiss={() => dismiss(report)}
              onRestore={() => restore(report)}
            />
          ))}
          {more === 'failed' ? <Notice tone="error">{tr('加载失败，请重试', "Couldn't load. Try again.")}</Notice> : null}
          {nextCursor ? (
            <Button variant="secondary" block loading={more === 'loading'} onClick={() => void load(status, nextCursor)}>
              {tr('加载更多', 'Load more')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
