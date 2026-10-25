import { describe, expect, it } from 'vitest';
import type { AdminEventRecord, EventNotificationRow } from '@utmmsc/shared';
import {
  clockText,
  countsAsUpcoming,
  dateBlock,
  duplicateDraft,
  eventPath,
  eventsListPath,
  isUpcoming,
  newEventPath,
  nextWeeklyStart,
  noticeSummary,
  noticeSummaryText,
  pendingNoticeCount,
  readEventView,
  splitEvents,
} from './eventGroups';

function event(id: string, startsAt: string, extra: Partial<AdminEventRecord> = {}): AdminEventRecord {
  return { id, title: `活动 ${id}`, startsAt, location: null, description: null, notifications: [], ...extra };
}

function notice(id: string, status: EventNotificationRow['status'], recipientCount: number | null = null): EventNotificationRow {
  return { id, kind: 'custom', sendAt: '2026-10-24T13:00:00.000Z', status, sentAt: status === 'sent' ? '2026-10-24T13:00:05.000Z' : null, recipientCount };
}

// 2026-10-24 10:00 in Toronto (EDT, UTC-4).
// 多伦多时间 2026-10-24 10:00（夏令时，UTC-4）。
const NOW = Date.parse('2026-10-24T14:00:00.000Z');

describe('event paths', () => {
  it('keeps the view and the copy source in the address', () => {
    expect(eventsListPath()).toBe('/admin/events');
    expect(eventsListPath('past')).toBe('/admin/events?view=past');
    expect(eventPath('ev 1')).toBe('/admin/events/ev%201');
    expect(eventPath('ev_1', 'past')).toBe('/admin/events/ev_1?view=past');
    expect(newEventPath()).toBe('/admin/events/new');
    expect(newEventPath('ev_1', 'past')).toBe('/admin/events/new?view=past&from=ev_1');
    expect(readEventView('past')).toBe('past');
    expect(readEventView('soon')).toBe('upcoming');
    expect(readEventView(null)).toBe('upcoming');
  });
});

describe('upcoming and past in Toronto time', () => {
  it('keeps an event that started earlier today under upcoming', () => {
    // 08:00 Toronto today, two hours ago.
    // 多伦多今天 08:00，两小时之前。
    expect(isUpcoming(event('a', '2026-10-24T12:00:00.000Z'), NOW)).toBe(true);
    // 00:30 Toronto today is still today, though it is 04:30Z.
    // 多伦多今天 00:30 仍算今天，虽然那是 04:30Z。
    expect(isUpcoming(event('b', '2026-10-24T04:30:00.000Z'), NOW)).toBe(true);
    // 23:30 Toronto yesterday is 03:30Z today, and already past.
    // 多伦多昨天 23:30 是今天的 03:30Z，已经结束。
    expect(isUpcoming(event('c', '2026-10-24T03:30:00.000Z'), NOW)).toBe(false);
    expect(isUpcoming(event('d', 'not a date'), NOW)).toBe(false);
  });

  it('sorts upcoming soonest first and past most recent first', () => {
    const { upcoming, past } = splitEvents(
      [
        event('later', '2026-11-01T22:00:00.000Z'),
        event('old', '2026-09-01T22:00:00.000Z'),
        event('soon', '2026-10-25T22:00:00.000Z'),
        event('recent', '2026-10-20T22:00:00.000Z'),
        event('today', '2026-10-24T12:00:00.000Z'),
      ],
      NOW,
    );
    expect(upcoming.map((item) => item.id)).toEqual(['today', 'soon', 'later']);
    expect(past.map((item) => item.id)).toEqual(['recent', 'old']);
  });

  it('counts like the server for the overview badge: from now on', () => {
    expect(countsAsUpcoming(event('a', '2026-10-24T12:00:00.000Z'), NOW)).toBe(false);
    expect(countsAsUpcoming(event('b', '2026-10-24T15:00:00.000Z'), NOW)).toBe(true);
  });
});

describe('row text', () => {
  it('draws the date block and clock in Toronto time', () => {
    // 2026-10-24 22:30Z is Saturday 18:30 in Toronto.
    // 2026-10-24 22:30Z 是多伦多时间周六 18:30。
    expect(dateBlock('2026-10-24T22:30:00.000Z', 'zh')).toEqual({ month: '10月', day: '24', weekday: '周六' });
    expect(dateBlock('2026-10-24T22:30:00.000Z', 'en')).toEqual({ month: 'Oct', day: '24', weekday: 'Sat' });
    // 01:00Z on the 25th is still the 24th in Toronto.
    // 25 日 01:00Z 在多伦多仍是 24 日。
    expect(dateBlock('2026-10-25T01:00:00.000Z', 'zh')?.day).toBe('24');
    expect(clockText('2026-10-24T22:30:00.000Z')).toBe('18:30');
    expect(dateBlock('nope', 'zh')).toBeNull();
    expect(clockText('nope')).toBe('');
  });
});

describe('notice summary', () => {
  it('puts a failure first', () => {
    expect(noticeSummary([notice('1', 'sent', 40), notice('2', 'failed'), notice('3', 'pending')])).toEqual({ kind: 'failed' });
  });

  it('counts the notices still to go out', () => {
    expect(noticeSummary([notice('1', 'sent', 40), notice('2', 'pending'), notice('3', 'sending')])).toEqual({ kind: 'scheduled', count: 2 });
  });

  it('reports the widest reach of the sent notices, not the sum', () => {
    expect(noticeSummary([notice('1', 'sent', 40), notice('2', 'sent', 52), notice('3', 'cancelled')])).toEqual({ kind: 'notified', count: 52 });
    expect(noticeSummary([notice('1', 'sent', null)])).toEqual({ kind: 'notified', count: null });
  });

  it('is null with no notices or only cancelled ones', () => {
    expect(noticeSummary([])).toBeNull();
    expect(noticeSummary(undefined)).toBeNull();
    expect(noticeSummary([notice('1', 'cancelled')])).toBeNull();
  });

  it('says it in both languages', () => {
    expect(noticeSummaryText({ kind: 'scheduled', count: 1 })).toEqual({ zh: '1 条通知待发送', en: '1 notice scheduled' });
    expect(noticeSummaryText({ kind: 'scheduled', count: 3 })).toEqual({ zh: '3 条通知待发送', en: '3 notices scheduled' });
    expect(noticeSummaryText({ kind: 'notified', count: 52 })).toEqual({ zh: '已通知 52 人', en: 'Notified 52' });
    expect(noticeSummaryText({ kind: 'notified', count: null })).toEqual({ zh: '已通知', en: 'Notified' });
    expect(noticeSummaryText({ kind: 'failed' })).toEqual({ zh: '通知失败', en: 'Notice failed' });
  });

  it('counts the notices a delete cancels', () => {
    expect(pendingNoticeCount([notice('1', 'pending'), notice('2', 'sent'), notice('3', 'pending'), notice('4', 'sending')])).toBe(2);
    expect(pendingNoticeCount(undefined)).toBe(0);
  });
});

describe('duplicate', () => {
  it('lands on the same weekday and Toronto time in the first week far enough ahead', () => {
    // Friday 2026-10-16 18:30 Toronto, copied on Saturday the 24th: next Friday the 30th.
    // 多伦多 2026-10-16 周五 18:30，在 24 日周六复制：下周五 30 日。
    expect(nextWeeklyStart('2026-10-16T22:30:00.000Z', NOW)).toBe('2026-10-30T18:30');
    // An event later today, more than two hours ahead, keeps its own date.
    // 今天稍后、两小时以上之后的活动保留原来的日期。
    expect(nextWeeklyStart('2026-10-24T22:30:00.000Z', NOW)).toBe('2026-10-24T18:30');
    // One within two hours moves a week on.
    // 两小时以内的活动顺延一周。
    expect(nextWeeklyStart('2026-10-24T15:00:00.000Z', NOW)).toBe('2026-10-31T11:00');
  });

  it('keeps the wall clock across the change to standard time', () => {
    // 18:30 EDT on Friday 2026-10-30; a week later is 18:30 EST on 2026-11-06.
    // 2026-10-30 周五 18:30（夏令时）；一周后是 2026-11-06 18:30（标准时间）。
    expect(nextWeeklyStart('2026-10-30T22:30:00.000Z', Date.parse('2026-11-01T12:00:00.000Z'))).toBe('2026-11-06T18:30');
  });

  it('copies title, place and description with default notices', () => {
    const draft = duplicateDraft(
      event('a', '2026-10-16T22:30:00.000Z', { title: '读书会', location: 'Bahen 1180', description: '每周一次', notifications: [notice('1', 'sent', 10)] }),
      NOW,
    );
    expect(draft).toEqual({
      title: '读书会',
      startsAt: '2026-10-30T18:30',
      location: 'Bahen 1180',
      description: '每周一次',
      notifyOnPublish: true,
      notifyMorningOf: true,
      customTimes: [],
    });
    expect(duplicateDraft(event('b', 'bad'), NOW).startsAt).toBe('');
  });
});
