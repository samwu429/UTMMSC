import { describe, expect, it } from 'vitest';
import {
  isReviewKind,
  neighbourAfter,
  oldestFirst,
  readReviewKind,
  reviewItemPath,
  reviewKindsFor,
  reviewListPath,
  runInOrder,
  withoutId,
} from './reviewQueue';

const item = (id: string, createdAt: string) => ({ id, createdAt });

describe('who reviews what', () => {
  it('follows the viewed role', () => {
    expect(reviewKindsFor('superadmin')).toEqual(['applications', 'years']);
    expect(reviewKindsFor('president')).toEqual(['applications']);
    expect(reviewKindsFor('secretary_general')).toEqual(['applications']);
    expect(reviewKindsFor('head_events')).toEqual([]);
    expect(reviewKindsFor('student')).toEqual([]);
  });

  it('reads ?type= and falls back to the first kind the role has', () => {
    expect(readReviewKind('years', ['applications', 'years'])).toBe('years');
    expect(readReviewKind('years', ['applications'])).toBe('applications');
    expect(readReviewKind(null, ['applications', 'years'])).toBe('applications');
    expect(readReviewKind('nope', ['years'])).toBe('years');
    expect(readReviewKind('applications', [])).toBeNull();
    expect(isReviewKind('years')).toBe(true);
    expect(isReviewKind('roles')).toBe(false);
    expect(isReviewKind(undefined)).toBe(false);
  });

  it('builds addresses that keep the segment', () => {
    expect(reviewListPath('years')).toBe('/admin/review?type=years');
    expect(reviewItemPath('applications', 'app_1')).toBe('/admin/review/applications/app_1?type=applications');
    expect(reviewItemPath('years', 'a/b')).toBe('/admin/review/years/a%2Fb?type=years');
  });
});

describe('queue order', () => {
  it('puts whoever waited longest first, with a stable order for equal times', () => {
    const sorted = oldestFirst([
      item('c', '2026-10-03T10:00:00.000Z'),
      item('b', '2026-10-01T10:00:00.000Z'),
      item('a', '2026-10-03T10:00:00.000Z'),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not change the list it was given', () => {
    const list = [item('b', '2026-10-02T00:00:00.000Z'), item('a', '2026-10-01T00:00:00.000Z')];
    oldestFirst(list);
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a']);
  });

  it('opens the next item after a decision, the previous one at the end, and none when it was alone', () => {
    const queue = [item('a', ''), item('b', ''), item('c', '')];
    expect(neighbourAfter(queue, 'a')?.id).toBe('b');
    expect(neighbourAfter(queue, 'b')?.id).toBe('c');
    expect(neighbourAfter(queue, 'c')?.id).toBe('b');
    expect(neighbourAfter([item('a', '')], 'a')).toBeNull();
    expect(neighbourAfter(queue, 'gone')).toBeNull();
  });

  it('takes a decided item out', () => {
    expect(withoutId([item('a', ''), item('b', '')], 'a')?.map((entry) => entry.id)).toEqual(['b']);
    expect(withoutId(undefined, 'a')).toBeUndefined();
  });
});

describe('batches', () => {
  it('runs one at a time, keeps going after a failure and reports progress', async () => {
    let running = 0;
    let most = 0;
    const progress: string[] = [];
    const result = await runInOrder(
      ['a', 'b', 'c'],
      async (id) => {
        running += 1;
        most = Math.max(most, running);
        await Promise.resolve();
        running -= 1;
        if (id === 'b') throw new Error('mail failed');
      },
      (finished, total) => progress.push(`${finished}/${total}`),
    );
    expect(most).toBe(1);
    expect(result.done).toEqual(['a', 'c']);
    expect(result.failed.map((entry) => entry.item)).toEqual(['b']);
    expect((result.failed[0]?.error as Error).message).toBe('mail failed');
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
  });

  it('does nothing for an empty batch', async () => {
    const result = await runInOrder([], async () => undefined);
    expect(result).toEqual({ done: [], failed: [] });
  });
});
