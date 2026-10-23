import { describe, expect, it } from 'vitest';
import { eventPushPayload, messagePushPayload, retractionPushPayload, roomUrl, testPushPayload } from './payloads';

const BASE = 'https://utmmsc.com/UTMMSC/';

const channelInput = {
  roomId: 'channel:ch_all',
  roomKind: 'channel' as const,
  roomTitle: '全体成员',
  authorName: '张三',
  text: '今晚  七点\n开会',
  hasImage: false,
  mentioned: false,
  preview: true,
  baseUrl: BASE,
};

describe('messagePushPayload', () => {
  it('shows the channel name over sender and text, tagged by room', () => {
    expect(messagePushPayload(channelInput)).toEqual({
      title: '全体成员',
      body: '张三: 今晚 七点 开会',
      tag: 'channel:ch_all',
      url: 'https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all',
      kind: 'message',
      roomId: 'channel:ch_all',
    });
  });

  it('marks a mention the WeChat way', () => {
    expect(messagePushPayload({ ...channelInput, mentioned: true }).body).toBe('[有人@我] 张三: 今晚 七点 开会');
  });

  it('labels image-only messages', () => {
    expect(messagePushPayload({ ...channelInput, text: '', hasImage: true }).body).toBe('张三: [图片]');
    expect(messagePushPayload({ ...channelInput, text: '看这个', hasImage: true }).body).toBe('张三: [图片] 看这个');
  });

  it('uses the sender as the title of a direct message', () => {
    const payload = messagePushPayload({ ...channelInput, roomId: 'direct:dm_1', roomKind: 'direct', roomTitle: '' });
    expect(payload.title).toBe('张三');
    expect(payload.body).toBe('今晚 七点 开会');
    expect(payload.tag).toBe('direct:dm_1');
  });

  it('hides sender and text when preview is off', () => {
    const payload = messagePushPayload({ ...channelInput, preview: false, mentioned: true });
    expect(payload.title).toBe('UTMMSC');
    expect(payload.body).toBe('你收到一条新消息');
    expect(payload.url).toBe('https://utmmsc.com/UTMMSC/chat/room/channel%3Ach_all');
  });

  it('caps long text', () => {
    const payload = messagePushPayload({ ...channelInput, text: '字'.repeat(500) });
    expect(payload.body.length).toBeLessThanOrEqual(160);
    expect(payload.body.endsWith('…')).toBe(true);
  });
});

describe('retractionPushPayload', () => {
  const input = { roomId: 'channel:ch_all', roomKind: 'channel' as const, roomTitle: '全体成员', authorName: '张三', reason: 'recalled' as const, baseUrl: BASE };

  it('replaces the notice under the same tag and title without the text', () => {
    const original = messagePushPayload(channelInput);
    const replacement = retractionPushPayload(input);
    expect(replacement).toEqual({
      title: original.title,
      body: '张三 撤回了一条消息',
      tag: original.tag,
      url: original.url,
      kind: 'recall',
      roomId: 'channel:ch_all',
    });
  });

  it('words a direct message and each kind of removal', () => {
    const direct = retractionPushPayload({ ...input, roomId: 'direct:dm_1', roomKind: 'direct', roomTitle: '' });
    expect(direct.title).toBe('张三');
    expect(direct.body).toBe('对方撤回了一条消息');
    expect(direct.tag).toBe('direct:dm_1');
    expect(retractionPushPayload({ ...input, reason: 'deleted' }).body).toBe('一条消息已被删除');
    expect(retractionPushPayload({ ...input, reason: 'removed' }).body).toBe('管理员删除了一条消息');
  });
});

describe('eventPushPayload', () => {
  const event = { id: 'evt_1', title: '迎新晚会', startsAt: '2026-10-24T18:00:00.000Z', location: 'MN 1170' };

  it('announces a published event with the Toronto time and place', () => {
    expect(eventPushPayload({ event, kind: 'publish', now: new Date('2026-10-20T15:00:00Z'), baseUrl: BASE })).toEqual({
      title: '活动：迎新晚会',
      body: '10月24日 周六 14:00 · MN 1170',
      tag: 'event:evt_1:publish',
      url: BASE,
      kind: 'event',
      eventId: 'evt_1',
    });
  });

  it('says today for the morning notice and tomorrow when it goes out the evening before', () => {
    expect(eventPushPayload({ event, kind: 'morning', now: new Date('2026-10-24T13:00:00Z'), baseUrl: BASE }).title).toBe('今天的活动：迎新晚会');
    const midnight = { ...event, startsAt: '2026-10-25T04:00:00.000Z' };
    expect(eventPushPayload({ event: midnight, kind: 'morning', now: new Date('2026-10-25T01:00:00Z'), baseUrl: BASE }).title).toBe('明天的活动：迎新晚会');
  });

  it('uses the reminder title for custom times and leaves out a missing place', () => {
    const payload = eventPushPayload({ event: { ...event, location: null }, kind: 'custom', now: new Date('2026-10-23T12:00:00Z'), baseUrl: BASE });
    expect(payload.title).toBe('活动提醒：迎新晚会');
    expect(payload.body).toBe('10月24日 周六 14:00');
    expect(payload.tag).toBe('event:evt_1:custom');
  });
});

describe('urls', () => {
  it('joins the base url with or without a trailing slash', () => {
    expect(roomUrl('https://utmmsc.com/UTMMSC', 'direct:x')).toBe('https://utmmsc.com/UTMMSC/chat/room/direct%3Ax');
    expect(testPushPayload('https://utmmsc.com/UTMMSC/').url).toBe('https://utmmsc.com/UTMMSC/settings?tab=settings&screen=notifications');
  });
});
