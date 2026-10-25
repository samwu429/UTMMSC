import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MOMENT_MODERATION_REASON_MAX, momentTextLength, type MomentReport, type MomentReportReason, type MomentReportStatus } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { useTr } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { Badge, Notice } from '../../../shared/ui/Card';
import { TextArea } from '../../../shared/ui/Field';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { MediaGrid } from '../../moments/components/MediaGrid';
import { momentDetailPath, type MomentDetailLinkState } from '../../moments/pages/MomentDetailPage';
import { AdminCell } from '../ui/AdminCell';
import { StatusBadge } from '../ui/StatusBadge';
import type { ReportAction } from './reportsData';
import { firstLine, reportActions } from './reportsQueue';

export const REASON_LABELS: Record<MomentReportReason, [string, string]> = {
  spam: ['垃圾广告', 'Spam'],
  harassment: ['骚扰或攻击', 'Harassment'],
  inappropriate: ['不当内容', 'Inappropriate'],
  privacy: ['泄露隐私', 'Privacy'],
  other: ['其他', 'Other'],
};

/** Quick reasons for a removal; the author reads the reason in 这条动态已被管理员移除：{reason}. */
/** 移除时的快捷原因；作者会在「这条动态已被管理员移除：{原因}」中看到它。 */
const QUICK_REASONS: MomentReportReason[] = ['spam', 'harassment', 'inappropriate', 'privacy'];

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

export interface ReportCardProps {
  report: MomentReport;
  status: MomentReportStatus;
  mediaToken: string | null;
  /** The action on its way for this content, if any; every button waits for it. */
  /** 针对这条内容正在进行的操作；所有按钮都等它完成。 */
  busy: ReportAction | null;
  onRemove(reason: string): void;
  onDismiss(): void;
  onRestore(): void;
}

/**
 * One report with the content as it was reported, whether it is still shown, and what can still be done: an open
 * report is removed (with a reason the author reads) or dismissed; content that was removed can be restored; a
 * handled report on live content can still be removed through the same report. Members at or above the moderator's
 * level are out of reach, and the card says so.
 * 一条投诉，附带被投诉时的内容、内容是否仍在显示，以及还能做什么：待处理的投诉可以移除（填写作者会看到的原因）或驳回；已移除的内容可以恢复；
 * 已处理但内容仍在的投诉仍可通过同一条投诉移除。职位不低于管理员的成员不在处理范围内，卡片会说明这一点。
 */
export function ReportCard({ report, status, mediaToken, busy, onRemove, onDismiss, onRestore }: ReportCardProps) {
  const tr = useTr();
  const [removing, setRemoving] = useState(false);
  const isComment = report.commentId !== null;
  const open = status === 'open';
  const linkState: MomentDetailLinkState = { from: 'reports' };
  const can = reportActions(report, status);
  const actionable = can.remove || can.dismiss || can.restore;
  const disabled = busy !== null || !report.canResolve;
  const currentBadge =
    report.current === 'live' ? (
      <Badge tone="green">{tr('仍在显示', 'Still visible')}</Badge>
    ) : report.current === 'removed' ? (
      <Badge tone="amber">{isComment ? tr('该评论已被管理员移除', 'An admin removed this comment') : tr('这条动态已被管理员移除', 'An admin removed this update')}</Badge>
    ) : (
      <Badge>{tr('作者已删除', 'Deleted by the author')}</Badge>
    );

  return (
    <article className="rounded-xl bg-white p-4 ring-1 ring-black/[0.06]">
      <div className="flex items-start gap-3">
        <Link
          to={`/directory/${encodeURIComponent(report.target.id)}`}
          className="shrink-0"
          aria-label={tr(`查看${report.target.displayName}的资料`, `View ${report.target.displayName}'s profile`)}
        >
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

      {removing && can.remove ? (
        <RemoveForm
          report={report}
          busy={busy === 'remove'}
          onCancel={() => setRemoving(false)}
          onConfirm={(reason) => {
            onRemove(reason);
          }}
        />
      ) : null}

      {actionable && !(removing && can.remove) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {can.remove ? (
            <Button variant="danger" onClick={() => setRemoving(true)} disabled={disabled} className="flex-1">
              {tr('移除', 'Remove')}
            </Button>
          ) : null}
          {can.dismiss ? (
            <Button variant="secondary" onClick={onDismiss} disabled={disabled} loading={busy === 'dismiss'} className="flex-1">
              {tr('驳回', 'Dismiss')}
            </Button>
          ) : null}
          {can.restore ? (
            <Button variant="secondary" onClick={onRestore} disabled={disabled} loading={busy === 'restore'} className="flex-1">
              {tr('恢复', 'Restore')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/**
 * The compact row of the desktop split view: who, 动态 or 评论, the reason, how many reported it, and the first line
 * of what was reported. The full card opens beside it.
 * 桌面分栏视图中的紧凑行：是谁、动态还是评论、原因、投诉人数，以及被投诉内容的第一行。完整的卡片在旁边打开。
 */
export function ReportRow({ report, status, to, replace, selected }: { report: MomentReport; status: MomentReportStatus; to: string; replace: boolean; selected: boolean }) {
  const tr = useTr();
  const kind = report.commentId !== null ? tr('评论', 'comment') : tr('动态', 'update');
  const text = firstLine(report.snapshot.body) || (report.snapshot.media.length > 0 ? tr('［图片或视频］', '[Photo or video]') : tr('（没有文字）', '(No text)'));
  return (
    <AdminCell
      rowId={report.id}
      to={to}
      replace={replace}
      selected={selected}
      lazy
      leading={<MemberAvatar name={report.target.displayName} avatarKey={report.target.avatarKey} shape="square" className="h-10 w-10 text-sm" />}
      label={`${report.target.displayName} · ${kind}`}
      detail={text}
      badge={
        <span className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge tone={report.reason === 'other' ? 'muted' : 'pending'}>{tr(...REASON_LABELS[report.reason])}</StatusBadge>
          {status === 'open' && report.reportCount > 1 ? <span className="text-[12px] text-wx-meta">{tr(`${report.reportCount} 人投诉`, `${report.reportCount} reports`)}</span> : null}
        </span>
      }
    />
  );
}
