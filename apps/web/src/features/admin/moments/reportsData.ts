import { useState } from 'react';
import type { MomentReport, MomentReportStatus } from '@utmmsc/shared';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { snackbar } from '../../../shared/ui/snackbar';
import { toast } from '../../../shared/ui/toast';
import { momentsApi } from '../../moments/api';
import { adminCache, useAdminQuery, type AdminQuery } from '../state/adminCache';
import { refreshAdminSummary, useAdminSummary } from '../state/summaryStore';
import { appendPage, applyToTarget, reportsOnTarget, targetKey, type ReportsPage } from './reportsQueue';

/** One cache entry per list, holding every page loaded so far. */
/** 每个列表一个缓存项，保存目前已加载的所有分页。 */
export function reportsKey(status: MomentReportStatus): string {
  return `reports:${status}`;
}

async function firstPage(status: MomentReportStatus): Promise<ReportsPage> {
  const res = await momentsApi.reports({ status });
  return { reports: res.reports, nextCursor: res.nextCursor, mediaToken: res.mediaToken };
}

export function useReports(status: MomentReportStatus): AdminQuery<ReportsPage> {
  return useAdminQuery(reportsKey(status), () => firstPage(status));
}

/** Loads the page after `cursor` and adds it to the cached list. */
/** 加载 `cursor` 之后的一页，并接到缓存的列表后面。 */
export async function loadMoreReports(status: MomentReportStatus, cursor: string): Promise<void> {
  const res = await momentsApi.reports({ status, cursor });
  adminCache.mutate<ReportsPage>(reportsKey(status), (page) =>
    page ? appendPage(page, { reports: res.reports, nextCursor: res.nextCursor, mediaToken: res.mediaToken }) : page,
  );
}

function changeTarget(status: MomentReportStatus, report: MomentReport, change: (item: MomentReport) => MomentReport | null): void {
  adminCache.mutate<ReportsPage>(reportsKey(status), (page) => (page ? applyToTarget(page, report, change) : page));
}

/** The other lists now hold a different picture of this content, so they load again when next opened. */
/** 其他列表中关于这条内容的信息已经过时，因此下次打开时重新加载。 */
function invalidateOthers(status: MomentReportStatus): void {
  adminCache.invalidate((key) => key.startsWith('reports:') && key !== reportsKey(status));
}

/** Gone since the queue loaded: the author deleted it. */
/** 队列加载之后内容已不存在：作者已删除。 */
function isGone(error: unknown): boolean {
  return error instanceof ApiClientError && (error.code === 'moment_unavailable' || error.code === 'comment_unavailable');
}

export type ReportAction = 'remove' | 'dismiss' | 'restore';

/**
 * Remove, dismiss and restore for the reports of one list, with the action on its way per piece of content (every
 * button on that content waits for it). A removal is undone from the snackbar by restoring the content; a dismissal
 * has no inverse, so it only confirms with a toast.
 * 某个列表中投诉的移除、驳回和恢复，并按内容记录正在进行的操作（该内容上的所有按钮都等它完成）。移除可以在提示条中通过恢复内容来撤销；
 * 驳回没有相反的操作，因此只用 toast 确认。
 */
export function useReportActions(status: MomentReportStatus) {
  const tr = useTr();
  const [busy, setBusy] = useState<Readonly<Record<string, ReportAction>>>({});

  async function run(report: MomentReport, action: ReportAction, send: () => Promise<unknown>, done: () => void): Promise<boolean> {
    const key = targetKey(report);
    if (busy[key]) return false;
    setBusy((current) => ({ ...current, [key]: action }));
    try {
      await send();
      done();
      return true;
    } catch (err) {
      if (isGone(err)) changeTarget(status, report, (item) => ({ ...item, current: 'deleted' }));
      toast(errorMessage(err));
      return false;
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  /** Resolving closes every open report on the content, so the open count drops by all of them. */
  /** 处理会关闭该内容上的所有待处理投诉，因此待处理计数按它们的总数减少。 */
  function leaveOpenList(report: MomentReport): void {
    const count = reportsOnTarget(adminCache.read<ReportsPage>(reportsKey(status)).data, report);
    changeTarget(status, report, () => null);
    if (count > 0) useAdminSummary.getState().adjust('openReports', -count);
  }

  async function restoreContent(report: MomentReport): Promise<void> {
    await (report.commentId ? momentsApi.restoreComment(report.commentId) : momentsApi.restorePost(report.postId));
  }

  async function undoRemoval(report: MomentReport): Promise<void> {
    try {
      await restoreContent(report);
      changeTarget(status, report, (item) => ({ ...item, current: 'live' }));
      adminCache.invalidate((key) => key.startsWith('reports:'));
      toast(tr('已恢复', 'Restored'));
    } catch (err) {
      toast(errorMessage(err));
    }
  }

  function remove(report: MomentReport, reason: string): Promise<boolean> {
    return run(
      report,
      'remove',
      // Always through the report, handled or not: the moderator works from its snapshot, and the direct routes would
      // also need sight of the post, which a moderator outside the author's circle does not have.
      // 无论投诉是否已处理，都通过投诉移除：管理员依据投诉的快照处理；直接移除的接口还要求能看到这条动态，而不在作者圈子里的管理员看不到。
      () => momentsApi.resolveReport(report.id, { action: 'remove', reason }),
      () => {
        if (status === 'open') leaveOpenList(report);
        else changeTarget(status, report, (item) => ({ ...item, current: 'removed' }));
        invalidateOthers(status);
        refreshAdminSummary();
        snackbar({ text: tr('已移除', 'Removed'), action: { label: tr('撤销', 'Undo'), onAction: () => void undoRemoval(report) } });
      },
    );
  }

  function dismiss(report: MomentReport): Promise<boolean> {
    return run(
      report,
      'dismiss',
      () => momentsApi.resolveReport(report.id, { action: 'dismiss' }),
      () => {
        leaveOpenList(report);
        invalidateOthers(status);
        refreshAdminSummary();
        toast(tr('已驳回', 'Dismissed'));
      },
    );
  }

  function restore(report: MomentReport): Promise<boolean> {
    return run(
      report,
      'restore',
      () => restoreContent(report),
      () => {
        changeTarget(status, report, (item) => ({ ...item, current: 'live' }));
        invalidateOthers(status);
        toast(tr('已恢复', 'Restored'));
      },
    );
  }

  return { busy, remove, dismiss, restore };
}
