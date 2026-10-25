import { describe, expect, it } from 'vitest';
import type { MomentReport } from '@utmmsc/shared';
import {
  appendPage,
  applyToTarget,
  firstLine,
  nextReportAfter,
  readReportStatus,
  reportActions,
  reportPath,
  reportsListPath,
  reportsOnTarget,
  targetKey,
  type ReportsPage,
} from './reportsQueue';

function report(id: string, postId: string, commentId: string | null = null, extra: Partial<MomentReport> = {}): MomentReport {
  const person = { id: 'mem_x', displayName: 'X', avatarKey: null };
  return {
    id,
    reason: 'spam',
    note: null,
    createdAt: '2026-10-24T10:00:00.000Z',
    status: 'open',
    reporter: person,
    target: person,
    reportCount: 1,
    postId,
    commentId,
    snapshot: { body: 'hello', media: [] },
    current: 'live',
    canResolve: true,
    ...extra,
  } as MomentReport;
}

const page = (reports: MomentReport[], nextCursor: string | null = null): ReportsPage => ({ reports, nextCursor, mediaToken: 'tok' });

describe('addresses', () => {
  it('reads ?status= and leaves it out for the open list', () => {
    expect(readReportStatus('removed')).toBe('removed');
    expect(readReportStatus('nope')).toBe('open');
    expect(readReportStatus(null)).toBe('open');
    expect(reportsListPath('open')).toBe('/admin/reports');
    expect(reportsListPath('dismissed')).toBe('/admin/reports?status=dismissed');
    expect(reportPath('open', 'mrp_1')).toBe('/admin/reports/mrp_1');
    expect(reportPath('removed', 'mrp_1')).toBe('/admin/reports/mrp_1?status=removed');
  });
});

describe('one decision, every report on the content', () => {
  const list = page([report('r1', 'p1'), report('r2', 'p1', 'c1'), report('r3', 'p1'), report('r4', 'p2')]);

  it('groups a post and its comments apart', () => {
    expect(targetKey(report('a', 'p1'))).not.toBe(targetKey(report('b', 'p1', 'c1')));
    expect(targetKey(report('a', 'p1'))).toBe(targetKey(report('b', 'p1')));
  });

  it('takes every report on the content out, or changes them all', () => {
    const removed = applyToTarget(list, report('r1', 'p1'), () => null);
    expect(removed.reports.map((item) => item.id)).toEqual(['r2', 'r4']);
    const marked = applyToTarget(list, report('r1', 'p1'), (item) => ({ ...item, current: 'removed' }));
    expect(marked.reports.filter((item) => item.current === 'removed').map((item) => item.id)).toEqual(['r1', 'r3']);
    expect(applyToTarget(list, report('zz', 'p9'), () => null)).toBe(list);
  });

  it('counts the reports that leave the open list together', () => {
    expect(reportsOnTarget(list, report('r1', 'p1'))).toBe(2);
    expect(reportsOnTarget(list, report('r2', 'p1', 'c1'))).toBe(1);
    expect(reportsOnTarget(undefined, report('r1', 'p1'))).toBe(0);
  });

  it('moves on to a report on other content', () => {
    expect(nextReportAfter(list.reports, list.reports[0]!)?.id).toBe('r2');
    expect(nextReportAfter(list.reports, list.reports[2]!)?.id).toBe('r4');
    expect(nextReportAfter(list.reports, list.reports[3]!)?.id).toBe('r3');
    expect(nextReportAfter([report('a', 'p1'), report('b', 'p1')], report('a', 'p1'))).toBeNull();
    expect(nextReportAfter(list.reports, report('gone', 'p5'))).toBeNull();
  });
});

describe('pages', () => {
  it('adds the next page without repeating reports already shown', () => {
    const merged = appendPage(page([report('r1', 'p1'), report('r2', 'p2')], 'c1'), page([report('r2', 'p2'), report('r3', 'p3')], null));
    expect(merged.reports.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
    expect(merged.nextCursor).toBeNull();
  });
});

describe('what a report still allows', () => {
  it('follows the content and the list', () => {
    expect(reportActions(report('a', 'p'), 'open')).toEqual({ remove: true, dismiss: true, restore: false });
    expect(reportActions(report('a', 'p', null, { current: 'removed' }), 'removed')).toEqual({ remove: false, dismiss: false, restore: true });
    expect(reportActions(report('a', 'p', null, { current: 'deleted' }), 'dismissed')).toEqual({ remove: false, dismiss: false, restore: false });
    expect(reportActions(report('a', 'p'), 'dismissed')).toEqual({ remove: true, dismiss: false, restore: false });
  });

  it('shows the first line of the content, cut by character', () => {
    expect(firstLine('\n\n  first  \nsecond')).toBe('first');
    expect(firstLine('')).toBe('');
    const smile = String.fromCodePoint(0x1f600);
    expect(firstLine(`${'a'.repeat(4)}${smile}${smile}`, 5)).toBe(`aaaa…`);
    expect(firstLine(`ab${smile}`, 5)).toBe(`ab${smile}`);
  });
});
