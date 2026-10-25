import { describe, expect, it } from 'vitest';
import type { TimetableData } from '@utmmsc/shared';
import { course, meeting, term, tid, toronto } from './fixtures.testdata';
import { nextUp } from './nextUp';

const FALL = term();
const MAT = course({
  termId: FALL.id,
  meetings: [
    meeting({ id: tid('tm', 'mon-10'), weekday: 1, startMin: 600, endMin: 650 }),
    meeting({ id: tid('tm', 'mon-14'), weekday: 1, startMin: 840, endMin: 900, location: 'IB 110' }),
    meeting({ id: tid('tm', 'wed-10'), weekday: 3, startMin: 600, endMin: 650 }),
  ],
});
const DATA: TimetableData = { terms: [FALL], courses: [MAT], skips: [] };

describe('nextUp', () => {
  it('is empty without courses', () => {
    expect(nextUp({ terms: [], courses: [], skips: [] }, toronto('2026-10-19', '10:00'))).toEqual({ state: 'empty' });
  });

  it('counts down to the next class today, with the ones after it', () => {
    const up = nextUp(DATA, toronto('2026-10-19', '09:25'));
    expect(up.state).toBe('next');
    if (up.state !== 'next') return;
    expect(up.next.meeting.id).toBe(tid('tm', 'mon-10'));
    expect(up.minutesUntil).toBe(35);
    expect(up.laterToday.map((o) => o.meeting.id)).toEqual([tid('tm', 'mon-14')]);
  });

  it('shows the class under way with minutes left and progress', () => {
    const up = nextUp(DATA, toronto('2026-10-19', '10:20'));
    expect(up.state).toBe('in_class');
    if (up.state !== 'in_class') return;
    expect(up.minutesLeft).toBe(30);
    expect(up.progress).toBeCloseTo(0.4);
    expect(up.laterToday).toHaveLength(1);
  });

  it('says today is done and names the next day with a class', () => {
    const up = nextUp(DATA, toronto('2026-10-19', '15:00'));
    expect(up).toMatchObject({ state: 'done_today' });
    if (up.state !== 'done_today') return;
    expect(up.next?.date).toBe('2026-10-21');
  });

  it('says there is no class today', () => {
    const up = nextUp(DATA, toronto('2026-10-20', '09:00'));
    expect(up.state).toBe('no_class_today');
    if (up.state !== 'no_class_today') return;
    expect(up.next?.meeting.id).toBe(tid('tm', 'wed-10'));
  });

  it('knows reading week and looks past it', () => {
    const up = nextUp(DATA, toronto('2026-10-27', '09:00'));
    expect(up.state).toBe('skip_week');
    if (up.state !== 'skip_week') return;
    expect(up.term.id).toBe(FALL.id);
    expect(up.next?.date).toBe('2026-11-02');
    expect(up.next?.startMs).toBe(Date.parse('2026-11-02T10:00:00-05:00'));
  });

  it('counts a skipped class as no class', () => {
    const skipped: TimetableData = { ...DATA, skips: [{ onDate: '2026-10-19', meetingId: tid('tm', 'mon-10'), label: null }] };
    const up = nextUp(skipped, toronto('2026-10-19', '09:25'));
    expect(up.state === 'next' && up.next.meeting.id).toBe(tid('tm', 'mon-14'));
    const holiday: TimetableData = { ...DATA, skips: [{ onDate: '2026-10-19', meetingId: null, label: null }] };
    expect(nextUp(holiday, toronto('2026-10-19', '09:25')).state).toBe('no_class_today');
  });

  it('has nothing ahead after the term ends', () => {
    const up = nextUp(DATA, toronto('2026-12-20', '09:00'));
    expect(up).toEqual({ state: 'no_class_today', next: null });
  });
});
