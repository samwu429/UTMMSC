import { describe, expect, it } from 'vitest';
import { normalizeChatMessage, type ChatMessage, type NormalizedChatMessage } from '@utmmsc/shared';
import { buildTimeline, messageActions, quoteFrom, spokenPreview, translatorFor, type MessageActionInput, type TimelineInput, type TimelineItem } from './timeline';
import type { PendingMessage } from './types';

/**
 * Times are built from local components so divider labels do not depend on the time zone.
 * 时间由本地时间分量构造，时间条的文字因此与时区无关。
 */
function local(day: number, hours: number, minutes: number, seconds = 0): string {
  return new Date(2026, 9, day, hours, minutes, seconds).toISOString();
}

const NOW = new Date(2026, 9, 22, 18, 0).getTime();
const ME = 'mem_me';

function row(id: number, extra: Partial<ChatMessage> = {}): NormalizedChatMessage {
  return normalizeChatMessage({
    id,
    roomId: 'channel:ch_test',
    author: { id: 'mem_a', displayName: 'Alice' },
    text: `message ${id}`,
    imageKey: null,
    createdAt: local(22, 10, id),
    deleted: false,
    recalled: false,
    ...extra,
  });
}

function pending(clientId: string, extra: Partial<PendingMessage> = {}): PendingMessage {
  return {
    clientId,
    text: 'pending',
    replyTo: null,
    mentions: [],
    mentionAll: false,
    image: null,
    status: 'sending',
    failure: null,
    createdAt: local(22, 11, 0),
    ...extra,
  };
}

function input(extra: Partial<TimelineInput> = {}): TimelineInput {
  return {
    messages: [],
    pending: [],
    meId: ME,
    kind: 'channel',
    hasMore: false,
    reachedFloor: false,
    floorReason: null,
    roomTitle: 'Board',
    unreadMarkerBeforeId: null,
    canReEdit: () => false,
    locale: 'zh',
    nowMs: NOW,
    ...extra,
  };
}

function types(items: TimelineItem[]): string[] {
  return items.map((item) => item.type);
}

describe('buildTimeline dividers', () => {
  it('puts a divider on the first item', () => {
    const items = buildTimeline(input({ messages: [row(1)] }));
    expect(types(items)).toEqual(['divider', 'message']);
    expect(items[0]).toMatchObject({ type: 'divider', text: '10:01' });
  });

  it('adds a divider at a 5:00 gap but not at 4:59', () => {
    const atFive = buildTimeline(input({ messages: [row(1, { createdAt: local(22, 10, 0) }), row(2, { createdAt: local(22, 10, 5) })] }));
    expect(types(atFive)).toEqual(['divider', 'message', 'divider', 'message']);
    const justUnder = buildTimeline(input({ messages: [row(1, { createdAt: local(22, 10, 0) }), row(2, { createdAt: local(22, 10, 4, 59) })] }));
    expect(types(justUnder)).toEqual(['divider', 'message', 'message']);
  });

  it('adds a divider on a new day even when the gap is short', () => {
    const items = buildTimeline(input({ messages: [row(1, { createdAt: local(21, 23, 59) }), row(2, { createdAt: local(22, 0, 1) })] }));
    expect(types(items)).toEqual(['divider', 'message', 'divider', 'message']);
    expect(items[0]).toMatchObject({ text: '昨天 23:59' });
    expect(items[2]).toMatchObject({ text: '00:01' });
  });

  it('labels dividers in English', () => {
    const items = buildTimeline(input({ locale: 'en', messages: [row(1, { createdAt: local(21, 9, 30) })] }));
    expect(items[0]).toMatchObject({ text: 'Yesterday 09:30' });
  });
});

describe('buildTimeline join tip', () => {
  const floored = { hasMore: false, reachedFloor: true, floorReason: 'join' as const };

  it('appears only at the floor with nothing more to load', () => {
    const items = buildTimeline(input({ ...floored, messages: [row(5)] }));
    expect(items[0]).toEqual({ type: 'join_tip', key: 'join-tip', text: '你已加入“Board”' });
    expect(types(buildTimeline(input({ ...floored, hasMore: true, messages: [row(5)] })))).not.toContain('join_tip');
    expect(types(buildTimeline(input({ ...floored, reachedFloor: false, messages: [row(5)] })))).not.toContain('join_tip');
    expect(types(buildTimeline(input({ ...floored, floorReason: 'clear', messages: [row(5)] })))).not.toContain('join_tip');
  });

  it('is skipped when the first row is a join notice naming the viewer', () => {
    const notice = row(5, {
      kind: 'system',
      author: { id: 'system', displayName: '' },
      system: { type: 'join', actor: { id: 'mem_admin', displayName: '管理员' }, members: [{ id: ME, displayName: 'Me' }], more: 0 },
    });
    const items = buildTimeline(input({ ...floored, messages: [notice] }));
    expect(types(items)).toEqual(['divider', 'system']);
    expect(items[1]).toMatchObject({ text: '“管理员”邀请你加入了频道' });
  });

  it('falls back to a generic title', () => {
    const items = buildTimeline(input({ ...floored, roomTitle: null, locale: 'en' }));
    expect(items).toEqual([{ type: 'join_tip', key: 'join-tip', text: 'You joined this channel' }]);
  });
});

describe('buildTimeline tips', () => {
  it('turns recalled rows into tips with no body', () => {
    const own = row(1, { author: { id: ME, displayName: 'Me' }, recalled: true, text: '' });
    const other = row(2, { recalled: true, text: '' });
    const items = buildTimeline(input({ messages: [own, other], canReEdit: (id) => id === 1 }));
    const tips = items.filter((item) => item.type === 'recall');
    expect(tips).toEqual([
      { type: 'recall', key: 'm:1', id: 1, text: '你撤回了一条消息', reEdit: true },
      { type: 'recall', key: 'm:2', id: 2, text: '“Alice” 撤回了一条消息', reEdit: false },
    ]);
    expect(JSON.stringify(items)).not.toContain('message 1');
  });

  it('offers re-edit only on own rows', () => {
    const other = row(2, { recalled: true, text: '' });
    const items = buildTimeline(input({ messages: [other], canReEdit: () => true }));
    expect(items[1]).toMatchObject({ type: 'recall', reEdit: false });
  });

  it('words moderator and legacy deletes and omits author deletes', () => {
    const items = buildTimeline(
      input({
        messages: [
          row(1, { deleted: true, deletedBy: 'moderator', text: '' }),
          row(2, { deleted: true, deletedBy: null, text: '' }),
          row(3, { deleted: true, deletedBy: 'author', text: '' }),
        ],
      }),
    );
    const removed = items.filter((item) => item.type === 'removed');
    expect(removed.map((item) => (item.type === 'removed' ? item.text : ''))).toEqual(['管理员删除了一条消息', '一条消息已被删除']);
    expect(items.some((item) => 'id' in item && item.id === 3)).toBe(false);
  });

  it('places the unread marker before the first row at or after its id', () => {
    const items = buildTimeline(input({ messages: [row(1), row(2), row(3)], unreadMarkerBeforeId: 2 }));
    expect(types(items)).toEqual(['divider', 'message', 'unread', 'message', 'message']);
  });
});

describe('buildTimeline messages', () => {
  it('shows names only for other people in channels', () => {
    const mine = row(1, { author: { id: ME, displayName: 'Me' } });
    const theirs = row(2);
    const channel = buildTimeline(input({ messages: [mine, theirs] })).filter((item) => item.type === 'message');
    expect(channel.map((item) => (item.type === 'message' ? [item.own, item.showName] : null))).toEqual([
      [true, false],
      [false, true],
    ]);
    const direct = buildTimeline(input({ kind: 'direct', messages: [theirs] })).filter((item) => item.type === 'message');
    expect(direct[0]).toMatchObject({ own: false, showName: false });
  });

  it('puts pending items last, in order', () => {
    const items = buildTimeline(input({ messages: [row(1), row(2)], pending: [pending('a'), pending('b')] }));
    expect(items.slice(-2).map((item) => item.key)).toEqual(['c:a', 'c:b']);
  });

  it('keeps the key stable across an ack', () => {
    const before = buildTimeline(input({ messages: [row(1)], pending: [pending('abc')] }));
    const confirmed = row(2, { author: { id: ME, displayName: 'Me' }, clientId: 'abc' });
    const after = buildTimeline(input({ messages: [row(1), confirmed], pending: [] }), before);
    expect(before[before.length - 1]).toMatchObject({ type: 'pending', key: 'c:abc' });
    expect(after[after.length - 1]).toMatchObject({ type: 'message', key: 'c:abc' });
  });

  it('drops a pending item whose confirmed row is already listed', () => {
    const confirmed = row(2, { author: { id: ME, displayName: 'Me' }, clientId: 'abc' });
    const items = buildTimeline(input({ messages: [confirmed], pending: [pending('abc')] }));
    expect(items.filter((item) => item.key === 'c:abc')).toHaveLength(1);
  });

  it('keys rows without a clientId by id', () => {
    const items = buildTimeline(input({ messages: [row(7, { clientId: 'other-device' })] }));
    expect(items[1]?.key).toBe('m:7');
  });

  it('reuses unchanged items and the array itself', () => {
    const messages = [row(1), row(2)];
    const first = buildTimeline(input({ messages }));
    const same = buildTimeline(input({ messages }), first);
    expect(same).toBe(first);
    const recalled = row(2, { recalled: true, text: '' });
    const next = buildTimeline(input({ messages: [messages[0] as NormalizedChatMessage, recalled] }), first);
    expect(next).not.toBe(first);
    expect(next[1]).toBe(first[1]);
    expect(next[2]).not.toBe(first[2]);
  });
});

describe('messageActions', () => {
  const base: MessageActionInput = {
    own: false,
    kind: 'user',
    text: 'hello',
    redacted: false,
    pending: false,
    createdAt: new Date(NOW - 60_000).toISOString(),
    capable: true,
    canPost: true,
    canModerate: false,
    nowMs: NOW,
  };

  it('lists the WeChat order for someone else’s text', () => {
    expect(messageActions(base)).toEqual(['copy', 'quote', 'hide', 'translate']);
  });

  it('offers recall only inside the window', () => {
    expect(messageActions({ ...base, own: true })).toEqual(['copy', 'quote', 'recall', 'hide', 'translate']);
    expect(messageActions({ ...base, own: true, nowMs: NOW + 3 * 60_000 })).not.toContain('recall');
  });

  it('adds moderator items and never mutes yourself', () => {
    expect(messageActions({ ...base, canModerate: true })).toEqual(['copy', 'quote', 'hide', 'translate', 'remove', 'mute']);
    expect(messageActions({ ...base, own: true, canModerate: true })).not.toContain('mute');
  });

  it('drops quote and hide on an old server, and quote when posting is not allowed', () => {
    expect(messageActions({ ...base, capable: false })).toEqual(['copy', 'translate']);
    expect(messageActions({ ...base, canPost: false })).not.toContain('quote');
  });

  it('offers only copy on a pending row and nothing text-based on an image', () => {
    expect(messageActions({ ...base, pending: true, own: true })).toEqual(['copy']);
    expect(messageActions({ ...base, text: '' })).toEqual(['quote', 'hide']);
  });
});

describe('quote and preview helpers', () => {
  it('builds a quote with a capped excerpt', () => {
    const quote = quoteFrom(row(3, { text: `  ${'字'.repeat(70)}\n  ` }));
    expect(quote).toMatchObject({ id: 3, authorName: 'Alice', state: 'ok', hasImage: false });
    expect(Array.from(quote.excerpt)).toHaveLength(60);
  });

  it('marks image quotes', () => {
    expect(quoteFrom(row(4, { text: '', imageKey: 'chat/channel/ch_test/a.png' }))).toMatchObject({ excerpt: '', hasImage: true });
  });

  it('never speaks a recalled body', () => {
    const tr = translatorFor('zh');
    expect(spokenPreview(row(1, { text: 'secret', recalled: true }), tr)).toBe('');
    expect(spokenPreview(row(2, { text: '', imageKey: 'k' }), tr)).toBe('[图片]');
    expect(spokenPreview(row(3, { text: 'a\n b' }), tr)).toBe('a b');
  });
});
