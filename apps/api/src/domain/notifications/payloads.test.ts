import { describe, expect, it } from 'vitest';
import {
  eventPushPayload,
  messagePushPayload,
  momentCommentPushPayload,
  momentNoticesUrl,
  momentPostUrl,
  momentRecallPushPayload,
  momentRemovedPushPayload,
  momentTag,
  retractionPushPayload,
  roomUrl,
  testPushPayload,
} from './payloads';

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

  const ICON = 'https://utmmsc.com/UTMMSC/channel-icons/announce-192.png';

  it('passes the channel icon through', () => {
    expect(messagePushPayload({ ...channelInput, icon: ICON }).icon).toBe(ICON);
    expect('icon' in messagePushPayload(channelInput)).toBe(false);
  });

  it('leaves the icon out of a hidden notice, which must not say which chat it is', () => {
    expect('icon' in messagePushPayload({ ...channelInput, icon: ICON, preview: false })).toBe(false);
  });

  it('never puts a channel icon on a direct message', () => {
    expect('icon' in messagePushPayload({ ...channelInput, roomId: 'direct:dm_1', roomKind: 'direct', roomTitle: '', icon: ICON })).toBe(false);
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

  it('keeps the channel icon of the notice it replaces', () => {
    const icon = 'https://utmmsc.com/api/members/media/channel-icon%2Fch_all%2Fcic_abcdefghijklmnop.webp?t=tok';
    expect(retractionPushPayload({ ...input, icon }).icon).toBe(icon);
    expect(retractionPushPayload({ ...input, icon }).icon).toBe(messagePushPayload({ ...channelInput, icon }).icon);
    expect('icon' in retractionPushPayload(input)).toBe(false);
    expect('icon' in retractionPushPayload({ ...input, roomId: 'direct:dm_1', roomKind: 'direct', roomTitle: '', icon })).toBe(false);
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

describe('moments payloads', () => {
  const comment = { postId: 'pst_1', commentId: 'cmt_9', kind: 'comment' as const, actorName: '张三', text: '好看！', preview: true, baseUrl: BASE };

  it('says who commented on your post, under 好友动态, tagged by post and opening the comment', () => {
    expect(momentCommentPushPayload(comment)).toEqual({
      title: '好友动态',
      body: '张三评论了你：好看！',
      tag: 'moment:pst_1',
      url: 'https://utmmsc.com/UTMMSC/discover/feed/post/pst_1?comment=cmt_9',
      kind: 'moment',
      postId: 'pst_1',
    });
  });

  it('says who replied to you, under the same tag as the comments on that post', () => {
    const reply = momentCommentPushPayload({ ...comment, kind: 'reply', commentId: 'cmt_10', text: '谢谢' });
    expect(reply.body).toBe('张三回复了你：谢谢');
    expect(reply.tag).toBe(momentCommentPushPayload(comment).tag);
    expect(reply.url).toBe('https://utmmsc.com/UTMMSC/discover/feed/post/pst_1?comment=cmt_10');
  });

  it('keeps the text on one line, and still names the actor when there is no text or no name', () => {
    expect(momentCommentPushPayload({ ...comment, text: '第一行\n  第二行 ' }).body).toBe('张三评论了你：第一行 第二行');
    expect(momentCommentPushPayload({ ...comment, text: '  ' }).body).toBe('张三评论了你');
    expect(momentCommentPushPayload({ ...comment, actorName: ' ' }).body).toBe('有人评论了你：好看！');
  });

  it('hides the name, the text and what happened when preview is off, keeping tag and link', () => {
    for (const kind of ['comment', 'reply'] as const) {
      const hidden = momentCommentPushPayload({ ...comment, kind, preview: false });
      expect(hidden).toEqual({ ...momentCommentPushPayload({ ...comment, kind }), title: 'UTMMSC', body: '好友动态有新互动' });
    }
    const removed = momentRemovedPushPayload({ postId: 'pst_1', target: 'comment', preview: false, baseUrl: BASE });
    expect(removed.title).toBe('UTMMSC');
    expect(removed.body).toBe('好友动态有新互动');
    expect(removed.tag).toBe('moment:pst_1:removed');
  });

  it('caps the body at 160 without splitting an emoji', () => {
    const long = momentCommentPushPayload({ ...comment, text: '字'.repeat(300) });
    expect(long.body.length).toBeLessThanOrEqual(160);
    expect(long.body.endsWith('…')).toBe(true);
    // The emoji's two halves would sit at units 158 and 159, so the cut moves before it.
    // 表情符号的两半落在第 158 和 159 个代码单元，所以截断点移到它前面。
    const emoji = momentCommentPushPayload({ ...comment, text: `${'字'.repeat(151)}\u{1F600}\u{1F600}` });
    expect(emoji.body).toBe(`张三评论了你：${'字'.repeat(151)}…`);
    expect(emoji.body.length).toBe(159);
    expect(momentCommentPushPayload({ ...comment, text: `${'字'.repeat(150)}\u{1F600}\u{1F600}` }).body).toBe(`张三评论了你：${'字'.repeat(150)}\u{1F600}…`);
  });

  it('tells the author about a removed post or comment on a tag of its own, opening the notices', () => {
    expect(momentRemovedPushPayload({ postId: 'pst_1', target: 'post', preview: true, baseUrl: BASE })).toEqual({
      title: '好友动态',
      body: '你的一条动态已被管理员移除',
      tag: 'moment:pst_1:removed',
      url: 'https://utmmsc.com/UTMMSC/discover/feed/notices',
      kind: 'moment',
      postId: 'pst_1',
    });
    expect(momentRemovedPushPayload({ postId: 'pst_1', target: 'comment', preview: true, baseUrl: BASE }).body).toBe('你的一条评论已被管理员移除');
  });

  it('replaces a deleted comment’s notice quietly under the same tag, without its text', () => {
    const original = momentCommentPushPayload(comment);
    expect(momentRecallPushPayload({ postId: 'pst_1', baseUrl: BASE })).toEqual({
      title: original.title,
      body: '一条评论已删除',
      tag: original.tag,
      url: 'https://utmmsc.com/UTMMSC/discover/feed/post/pst_1',
      kind: 'moment_recall',
      postId: 'pst_1',
    });
  });

  it('builds links under the app with or without a trailing slash, escaping the ids', () => {
    expect(momentPostUrl('https://utmmsc.com/UTMMSC', 'p/1', 'c&2')).toBe('https://utmmsc.com/UTMMSC/discover/feed/post/p%2F1?comment=c%262');
    expect(momentPostUrl(BASE, 'pst_1', null)).toBe('https://utmmsc.com/UTMMSC/discover/feed/post/pst_1');
    expect(momentNoticesUrl('https://utmmsc.com/UTMMSC')).toBe('https://utmmsc.com/UTMMSC/discover/feed/notices');
    expect(momentTag('pst_1')).toBe('moment:pst_1');
  });
});

describe('urls', () => {
  it('joins the base url with or without a trailing slash', () => {
    expect(roomUrl('https://utmmsc.com/UTMMSC', 'direct:x')).toBe('https://utmmsc.com/UTMMSC/chat/room/direct%3Ax');
    expect(testPushPayload('https://utmmsc.com/UTMMSC/').url).toBe('https://utmmsc.com/UTMMSC/settings?tab=settings&screen=notifications');
  });
});
