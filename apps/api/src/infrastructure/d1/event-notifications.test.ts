import { describe, expect, it } from 'vitest';
import { scheduleEventNotifications } from '../../domain/notifications/event-plan';
import { isStaleNotice } from './event-notifications';

const HOUR = 60 * 60 * 1000;
// 14:00 Toronto time on 2026-10-25.
// 2026-10-25 多伦多时间 14:00。
const START = '2026-10-25T18:00:00.000Z';
const startMs = Date.parse(START);

describe('isStaleNotice', () => {
  it('sends publish and morning notices until an hour after the start', () => {
    for (const kind of ['publish', 'morning'] as const) {
      expect(isStaleNotice({ kind, sendAt: START }, START, startMs + HOUR)).toBe(false);
      expect(isStaleNotice({ kind, sendAt: START }, START, startMs + HOUR + 1)).toBe(true);
    }
  });

  it('sends a custom time set after the start when it falls due', () => {
    const at = new Date(startMs + 3 * HOUR).toISOString();
    expect(isStaleNotice({ kind: 'custom', sendAt: at }, START, startMs + 3 * HOUR)).toBe(false);
    expect(isStaleNotice({ kind: 'custom', sendAt: at }, START, startMs + 4 * HOUR)).toBe(false);
    expect(isStaleNotice({ kind: 'custom', sendAt: at }, START, startMs + 4 * HOUR + 1)).toBe(true);
  });

  it('still sends a late custom reminder while the event is ahead', () => {
    const at = new Date(startMs - 10 * HOUR).toISOString();
    expect(isStaleNotice({ kind: 'custom', sendAt: at }, START, startMs - HOUR)).toBe(false);
    expect(isStaleNotice({ kind: 'custom', sendAt: at }, START, startMs + 2 * HOUR)).toBe(true);
  });

  it('agrees with what event creation accepts: the latest custom time is sent', () => {
    const now = new Date(startMs - 2 * 24 * HOUR);
    const latest = new Date(startMs + 24 * HOUR).toISOString();
    const plan = scheduleEventNotifications({ startsAt: START, plan: { notifyOnPublish: false, notifyMorningOf: false, customTimes: [latest] }, now });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const notice of plan.value) expect(isStaleNotice(notice, START, Date.parse(notice.sendAt))).toBe(false);
  });
});
