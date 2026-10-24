import { describe, expect, it } from 'vitest';
import { albumCountLabel, albumDayLabel, albumDaySpoken, albumThumb, albumYearLabel, groupAlbumDays } from './album';

/**
 * Dates are built from local components so the tests pass in any time zone. 2026-10-24 is the "now" of
 * every case unless a case says otherwise.
 * 日期由本地时间分量构造，因此在任何时区都能通过。除非另有说明，每个用例的「现在」都是 2026-10-24。
 */
function local(year: number, month: number, day: number, hours = 12, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

const NOW = local(2026, 10, 24, 14, 30).getTime();

function post(id: string, date: Date | string): { id: string; createdAt: string } {
  return { id, createdAt: typeof date === 'string' ? date : date.toISOString() };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

function group(items: { id: string; createdAt: string }[], options: Parameters<typeof groupAlbumDays>[2]) {
  return groupAlbumDays(items, (item) => item.createdAt, options);
}

describe('groupAlbumDays', () => {
  it('groups by local calendar day and keeps the order, newest first', () => {
    const days = group(
      [
        post('a', local(2026, 10, 24, 9)),
        post('b', local(2026, 10, 24, 0, 5)),
        post('c', local(2026, 10, 23, 23, 59)),
        post('d', local(2026, 10, 20, 8)),
        post('e', local(2026, 10, 20, 7)),
        post('f', local(2026, 9, 2)),
      ],
      { nowMs: NOW },
    );
    expect(days.map((day) => day.key)).toEqual(['2026-10-24', '2026-10-23', '2026-10-20', '2026-09-02']);
    expect(days.map((day) => ids(day.items))).toEqual([['a', 'b'], ['c'], ['d', 'e'], ['f']]);
    expect(days.map((day) => day.relative)).toEqual(['today', 'yesterday', null, null]);
    expect(days[2]).toMatchObject({ year: 2026, month: 10, day: 20 });
  });

  it('compares calendar days, not 24-hour windows', () => {
    const justAfterMidnight = local(2026, 10, 24, 0, 1).getTime();
    const days = group([post('late', local(2026, 10, 23, 23, 59)), post('older', local(2026, 10, 22, 23, 59))], { nowMs: justAfterMidnight });
    expect(days.map((day) => day.relative)).toEqual(['yesterday', null]);
    const justBeforeMidnight = local(2026, 10, 24, 23, 59).getTime();
    expect(group([post('early', local(2026, 10, 24, 0, 1))], { nowMs: justBeforeMidnight })[0]?.relative).toBe('today');
  });

  it('starts the own album with today, empty when nothing was posted today', () => {
    const days = group([post('old', local(2026, 10, 21))], { nowMs: NOW, startWithToday: true });
    expect(days.map((day) => [day.key, day.relative, day.items.length])).toEqual([
      ['2026-10-24', 'today', 0],
      ['2026-10-21', null, 1],
    ]);
    expect(group([], { nowMs: NOW, startWithToday: true })).toHaveLength(1);
    expect(group([], { nowMs: NOW })).toEqual([]);
  });

  it('does not add a second today when the own album already has one', () => {
    const days = group([post('now', local(2026, 10, 24, 8))], { nowMs: NOW, startWithToday: true });
    expect(days).toHaveLength(1);
    expect(ids(days[0]?.items ?? [])).toEqual(['now']);
  });

  it('writes each earlier year once, above its first day, and never the current year', () => {
    const days = group(
      [
        post('this-year', local(2026, 1, 3)),
        post('last-year-1', local(2025, 12, 30)),
        post('last-year-2', local(2025, 6, 1)),
        post('two-years', local(2024, 3, 9)),
      ],
      { nowMs: NOW },
    );
    expect(days.map((day) => day.yearHeading)).toEqual([null, 2025, null, 2024]);
  });

  it('writes the year on the first day when the album has nothing from this year', () => {
    const days = group([post('old', local(2025, 5, 5))], { nowMs: NOW });
    expect(days[0]?.yearHeading).toBe(2025);
    const own = group([post('old', local(2025, 5, 5))], { nowMs: NOW, startWithToday: true });
    expect(own.map((day) => day.yearHeading)).toEqual([null, 2025]);
  });

  it('counts a time on a later day as today, so a slow clock does not show tomorrow', () => {
    const days = group([post('ahead', local(2026, 10, 25, 1)), post('now', local(2026, 10, 24, 9))], { nowMs: NOW });
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ key: '2026-10-24', relative: 'today' });
    expect(ids(days[0]?.items ?? [])).toEqual(['ahead', 'now']);
  });

  it('puts a time it cannot read with the day before it, or today when it comes first', () => {
    const days = group([post('bad-first', 'not a date'), post('a', local(2026, 10, 20)), post('bad', '')], { nowMs: NOW });
    expect(days.map((day) => [day.relative, ids(day.items)])).toEqual([
      ['today', ['bad-first']],
      [null, ['a', 'bad']],
    ]);
  });
});

describe('album labels', () => {
  const today = { relative: 'today' as const, year: 2026, month: 10, day: 24 };
  const yesterday = { relative: 'yesterday' as const, year: 2026, month: 10, day: 23 };
  const earlier = { relative: null, year: 2026, month: 10, day: 8 };
  const lastYear = { relative: null, year: 2025, month: 3, day: 1 };

  it('writes 今天, 昨天, or the day large with the month small', () => {
    expect(albumDayLabel(today, 'zh')).toEqual({ primary: '今天', secondary: null });
    expect(albumDayLabel(yesterday, 'zh')).toEqual({ primary: '昨天', secondary: null });
    expect(albumDayLabel(earlier, 'zh')).toEqual({ primary: '8', secondary: '10月' });
    expect(albumDayLabel(today, 'en')).toEqual({ primary: 'Today', secondary: null });
    expect(albumDayLabel(yesterday, 'en')).toEqual({ primary: 'Yesterday', secondary: null });
    expect(albumDayLabel(earlier, 'en')).toEqual({ primary: '8', secondary: 'Oct' });
  });

  it('speaks the full date, with the year only when it is not this year', () => {
    expect(albumDaySpoken(today, 'zh', NOW)).toBe('今天');
    expect(albumDaySpoken(earlier, 'zh', NOW)).toBe('10月8日');
    expect(albumDaySpoken(lastYear, 'zh', NOW)).toBe('2025年3月1日');
    expect(albumDaySpoken(yesterday, 'en', NOW)).toBe('Yesterday');
    expect(albumDaySpoken(earlier, 'en', NOW)).toBe('Oct 8');
    expect(albumDaySpoken(lastYear, 'en', NOW)).toBe('Mar 1, 2025');
  });

  it('writes the year heading', () => {
    expect(albumYearLabel(2025, 'zh')).toBe('2025年');
    expect(albumYearLabel(2025, 'en')).toBe('2025');
  });
});

describe('albumThumb', () => {
  const photo = (key: string, previewKey: string | null = null) => ({ kind: 'image' as const, key, previewKey, durationMs: null });

  it('shows the first preview with the number of photos', () => {
    const thumb = albumThumb([photo('a.jpg', 'a-preview.jpg'), photo('b.jpg', 'b-preview.jpg'), photo('c.jpg')]);
    expect(thumb).toEqual({ kind: 'image', key: 'a-preview.jpg', count: 3 });
    expect(albumCountLabel(thumb, 'zh')).toBe('共3张');
    expect(albumCountLabel(thumb, 'en')).toBe('3 photos');
  });

  it('falls back to the photo itself for media posted before previews, and says nothing for one photo', () => {
    const thumb = albumThumb([photo('legacy.png')]);
    expect(thumb).toEqual({ kind: 'image', key: 'legacy.png', count: 1 });
    expect(albumCountLabel(thumb, 'zh')).toBeNull();
  });

  it('uses the first frame of a video and never the video file', () => {
    expect(albumThumb([{ kind: 'video', key: 'clip.mp4', previewKey: 'clip.jpg', durationMs: 15_000 }])).toEqual({ kind: 'video', key: 'clip.jpg', durationMs: 15_000 });
    const bare = albumThumb([{ kind: 'video', key: 'old.mov', previewKey: null, durationMs: null }]);
    expect(bare).toEqual({ kind: 'video', key: null, durationMs: null });
    expect(albumCountLabel(bare, 'zh')).toBeNull();
  });

  it('puts a post without media in the text box', () => {
    expect(albumThumb([])).toEqual({ kind: 'text' });
    expect(albumCountLabel({ kind: 'text' }, 'en')).toBeNull();
  });
});
