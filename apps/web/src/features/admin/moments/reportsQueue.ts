import { MOMENT_REPORT_STATUSES, type MomentReport, type MomentReportStatus } from '@utmmsc/shared';
import { sectionPath } from '../sections';

/**
 * 动态投诉 without the screens: which list is shown, addresses, pages, and how one decision changes every report on
 * the same content. Pure, so it is tested without a browser.
 * 不含界面的「动态投诉」：显示哪一个列表、地址、分页，以及一个决定如何改变针对同一内容的所有投诉。纯函数，无需浏览器即可测试。
 */

export interface ReportsPage {
  reports: MomentReport[];
  nextCursor: string | null;
  mediaToken: string | null;
}

export function readReportStatus(raw: string | null): MomentReportStatus {
  return MOMENT_REPORT_STATUSES.find((status) => status === raw) ?? 'open';
}

export function reportsListPath(status: MomentReportStatus): string {
  return status === 'open' ? sectionPath('reports') : `${sectionPath('reports')}?status=${status}`;
}

export function reportPath(status: MomentReportStatus, id: string): string {
  const base = `${sectionPath('reports')}/${encodeURIComponent(id)}`;
  return status === 'open' ? base : `${base}?status=${status}`;
}

/** Every report on one post or one comment shares this, so resolving one updates them all. */
/** 针对同一动态或同一评论的投诉共用这个键，处理其中一条时一并更新。 */
export function targetKey(report: Pick<MomentReport, 'postId' | 'commentId'>): string {
  return `${report.postId}:${report.commentId ?? ''}`;
}

/**
 * Applies a change to every report on the same content: the change returns the new report, or null to take it out
 * of the list. Returns the same page when nothing matched.
 * 把改动应用到针对同一内容的所有投诉：改动返回新的投诉，或返回 null 表示将其移出列表。没有匹配时返回原来的分页。
 */
export function applyToTarget(page: ReportsPage, report: Pick<MomentReport, 'postId' | 'commentId'>, change: (item: MomentReport) => MomentReport | null): ReportsPage {
  const key = targetKey(report);
  let touched = false;
  const reports = page.reports.flatMap((item) => {
    if (targetKey(item) !== key) return [item];
    touched = true;
    const next = change(item);
    return next ? [next] : [];
  });
  return touched ? { ...page, reports } : page;
}

/** How many reports in the list are on the same content, which is how far the open count drops when it is resolved. */
/** 列表中针对同一内容的投诉数量，即处理之后待处理计数减少的数量。 */
export function reportsOnTarget(page: ReportsPage | undefined, report: Pick<MomentReport, 'postId' | 'commentId'>): number {
  if (!page) return 0;
  const key = targetKey(report);
  return page.reports.filter((item) => targetKey(item) === key).length;
}

/**
 * The report to open once `report` is resolved: the next one on other content, or the one before it, or null.
 * Reports on the same content leave the open list together, so they are skipped.
 * `report` 处理完之后要打开的投诉：针对其他内容的下一条，或前一条，或 null。针对同一内容的投诉会一起离开待处理列表，因此被跳过。
 */
export function nextReportAfter(reports: readonly MomentReport[], report: Pick<MomentReport, 'id' | 'postId' | 'commentId'>): MomentReport | null {
  const index = reports.findIndex((item) => item.id === report.id);
  if (index === -1) return null;
  const key = targetKey(report);
  const after = reports.slice(index + 1).find((item) => targetKey(item) !== key);
  if (after) return after;
  return [...reports.slice(0, index)].reverse().find((item) => targetKey(item) !== key) ?? null;
}

/** The next page added after the ones loaded, skipping reports already shown. */
/** 把下一页接在已加载的内容之后，跳过已经显示的投诉。 */
export function appendPage(page: ReportsPage, next: ReportsPage): ReportsPage {
  const seen = new Set(page.reports.map((report) => report.id));
  return {
    reports: [...page.reports, ...next.reports.filter((report) => !seen.has(report.id))],
    nextCursor: next.nextCursor,
    mediaToken: next.mediaToken ?? page.mediaToken,
  };
}

/** What can still be done with a report: see ReportCard. */
/** 一条投诉还能做什么：见 ReportCard。 */
export function reportActions(report: MomentReport, status: MomentReportStatus): { remove: boolean; dismiss: boolean; restore: boolean } {
  return { remove: report.current === 'live', dismiss: status === 'open', restore: report.current === 'removed' };
}

/** The first line of what was reported, for a compact row. */
/** 被投诉内容的第一行，用于紧凑的行。 */
export function firstLine(text: string, max = 60): string {
  const line = text.split('\n').find((part) => part.trim()) ?? '';
  // By code point, so an emoji is never cut in half.
  // 按码点截取，表情符号不会被截成两半。
  const chars = Array.from(line.trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
}
