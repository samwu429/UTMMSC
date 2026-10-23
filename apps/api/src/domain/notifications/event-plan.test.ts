import { describe, expect, it } from 'vitest';
import { readEventNotificationPlan, scheduleEventNotifications } from './event-plan';

// An event on Saturday 2026-10-24 at 14:00 Toronto time, planned on Tuesday at 11:00.
const START = '2026-10-24T18:00:00.000Z';
const NOW = new Date('2026-10-20T15:00:00.000Z');

function plan(patch: Partial<{ notifyOnPublish: boolean; notifyMorningOf: boolean; customTimes: string[] }> = {}) {
  return { notifyOnPublish: true, notifyMorningOf: true, customTimes: [], ...patch };
}

describe('readEventNotificationPlan', () => {
  it('defaults to a publish notice and a morning notice', () => {
    expect(readEventNotificationPlan(undefined)).toEqual({ ok: true, value: { notifyOnPublish: true, notifyMorningOf: true, customTimes: [] } });
    expect(readEventNotificationPlan({ notifyMorningOf: false })).toEqual({ ok: true, value: { notifyOnPublish: true, notifyMorningOf: false, customTimes: [] } });
  });

  it('rejects wrong shapes and more than five custom times', () => {
    expect(readEventNotificationPlan('yes').ok).toBe(false);
    expect(readEventNotificationPlan({ notifyOnPublish: 'no' }).ok).toBe(false);
    expect(readEventNotificationPlan({ customTimes: 'tomorrow' }).ok).toBe(false);
    expect(readEventNotificationPlan({ customTimes: [1] }).ok).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => `2026-10-2${i}T12:00:00Z`);
    expect(readEventNotificationPlan({ customTimes: six })).toMatchObject({ ok: false, error: { code: 'too_many_notice_times' } });
  });
});

describe('scheduleEventNotifications', () => {
  it('plans the publish notice now and the morning notice at 09:00 local', () => {
    expect(scheduleEventNotifications({ startsAt: START, plan: plan(), now: NOW })).toEqual({
      ok: true,
      value: [
        { kind: 'publish', sendAt: NOW.toISOString() },
        { kind: 'morning', sendAt: '2026-10-24T13:00:00.000Z' },
      ],
    });
  });

  it('honours each switch', () => {
    const result = scheduleEventNotifications({ startsAt: START, plan: plan({ notifyOnPublish: false, notifyMorningOf: false }), now: NOW });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('drops a morning notice that has already passed', () => {
    const lateNow = new Date('2026-10-24T14:00:00.000Z');
    const result = scheduleEventNotifications({ startsAt: START, plan: plan({ notifyOnPublish: false }), now: lateNow });
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('folds a morning notice due within the hour into the publish notice', () => {
    const shortlyBefore = new Date('2026-10-24T12:30:00.000Z');
    const merged = scheduleEventNotifications({ startsAt: START, plan: plan(), now: shortlyBefore });
    expect(merged.ok && merged.value.map((n) => n.kind)).toEqual(['publish']);
    const alone = scheduleEventNotifications({ startsAt: START, plan: plan({ notifyOnPublish: false }), now: shortlyBefore });
    expect(alone.ok && alone.value.map((n) => n.kind)).toEqual(['morning']);
  });

  it('adds custom times in order, deduplicated, and not twice with the morning notice', () => {
    const result = scheduleEventNotifications({
      startsAt: START,
      plan: plan({ customTimes: ['2026-10-23T22:00:00Z', '2026-10-22T16:00:00.000Z', '2026-10-23T22:00:00.000Z', '2026-10-24T13:00:00Z'] }),
      now: NOW,
    });
    expect(result).toEqual({
      ok: true,
      value: [
        { kind: 'publish', sendAt: NOW.toISOString() },
        { kind: 'custom', sendAt: '2026-10-22T16:00:00.000Z' },
        { kind: 'custom', sendAt: '2026-10-23T22:00:00.000Z' },
        { kind: 'morning', sendAt: '2026-10-24T13:00:00.000Z' },
      ],
    });
  });

  it('rejects custom times that are invalid, past, or more than a day after the start', () => {
    expect(scheduleEventNotifications({ startsAt: START, plan: plan({ customTimes: ['soon'] }), now: NOW })).toMatchObject({ ok: false, error: { code: 'invalid_notice_time' } });
    expect(scheduleEventNotifications({ startsAt: START, plan: plan({ customTimes: ['2026-10-20T14:59:00Z'] }), now: NOW })).toMatchObject({ ok: false, error: { code: 'notice_time_past' } });
    expect(scheduleEventNotifications({ startsAt: START, plan: plan({ customTimes: ['2026-10-25T18:00:00Z'] }), now: NOW }).ok).toBe(true);
    expect(scheduleEventNotifications({ startsAt: START, plan: plan({ customTimes: ['2026-10-25T18:00:01Z'] }), now: NOW })).toMatchObject({ ok: false, error: { code: 'notice_time_too_late' } });
  });
});
