import { describe, expect, it } from 'vitest';
import { assignment, tid, toronto } from '../model/fixtures.testdata';
import { dueBadge, dueCounts, dueSections } from './sections';

const NOW = toronto('2026-10-21', '18:00'); // Wednesday
const at = (date: string, clock: string) => new Date(toronto(date, clock)).toISOString();

describe('dueSections', () => {
  it('groups by Toronto day and keeps each group in due order', () => {
    const items = [
      assignment({ id: tid('ta', 'later'), dueAt: at('2026-10-26', '09:00') }),
      assignment({ id: tid('ta', 'late'), dueAt: at('2026-10-21', '17:00') }),
      assignment({ id: tid('ta', 'tonight'), dueAt: at('2026-10-21', '23:59') }),
      assignment({ id: tid('ta', 'week2'), dueAt: at('2026-10-25', '23:59') }),
      assignment({ id: tid('ta', 'week1'), dueAt: at('2026-10-23', '23:59') }),
      assignment({ id: tid('ta', 'tomorrow'), dueAt: at('2026-10-22', '08:00') }),
      assignment({ id: tid('ta', 'done'), dueAt: at('2026-10-20', '23:59'), doneAt: at('2026-10-20', '20:00') }),
      assignment({ id: tid('ta', 'old'), dueAt: at('2026-09-01', '23:59'), doneAt: at('2026-09-01', '20:00') }),
    ];
    const sections = dueSections(items, NOW);
    expect(sections.map((s) => [s.key, s.items.map((a) => a.id)])).toEqual([
      ['overdue', [tid('ta', 'late')]],
      ['today', [tid('ta', 'tonight')]],
      ['tomorrow', [tid('ta', 'tomorrow')]],
      ['week', [tid('ta', 'week1'), tid('ta', 'week2')]],
      ['later', [tid('ta', 'later')]],
      ['done', [tid('ta', 'done')]],
    ]);
  });

  it('has no 本周 on a Sunday beyond 明天', () => {
    const sunday = toronto('2026-10-25', '10:00');
    const sections = dueSections([assignment({ dueAt: at('2026-10-27', '10:00') })], sunday);
    expect(sections.map((s) => s.key)).toEqual(['later']);
  });

  it('leaves out empty groups', () => {
    expect(dueSections([], NOW)).toEqual([]);
  });
});

describe('dueBadge', () => {
  it('counts overdue items and items due within 48 hours', () => {
    const items = [
      assignment({ dueAt: at('2026-10-21', '12:00') }),
      assignment({ dueAt: at('2026-10-23', '17:59') }),
      assignment({ dueAt: at('2026-10-23', '18:01') }),
      assignment({ dueAt: at('2026-10-21', '12:00'), doneAt: at('2026-10-21', '11:00') }),
    ];
    expect(dueCounts(items, NOW)).toEqual({ overdue: 1, soon: 1 });
    expect(dueBadge(items, NOW)).toBe(2);
  });
});
