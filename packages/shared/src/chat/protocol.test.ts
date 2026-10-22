import { describe, expect, it } from 'vitest';
import {
  HISTORY_PAGE_MAX,
  IMAGE_DIMENSION_MAX,
  MENTIONS_MAX,
  REQUEST_ID_MAX,
  normalizeChatMessage,
  parseClientFrame,
  parseServerFrame,
  type ChatMessage,
} from './protocol';

describe('parseClientFrame', () => {
  it('parses a valid send frame and drops unknown fields', () => {
    const frame = parseClientFrame({ type: 'send', clientId: 'abc', text: 'hi', extra: 1 });
    expect(frame).toEqual({ type: 'send', clientId: 'abc', text: 'hi' });
  });

  it('keeps imageKey when provided as a string', () => {
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: '', imageKey: 'k' })).toEqual({
      type: 'send',
      clientId: 'a',
      text: '',
      imageKey: 'k',
    });
  });

  it('rejects oversized image keys and mute targets', () => {
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: '', imageKey: 'k'.repeat(201) })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: '', minutes: 10 })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: 'm'.repeat(65), minutes: 10 })).toBeNull();
    expect(parseClientFrame({ type: 'mute', memberId: 'mem_1', minutes: 10 })).toEqual({ type: 'mute', memberId: 'mem_1', minutes: 10 });
  });

  it('rejects send frames with missing or malformed fields', () => {
    expect(parseClientFrame({ type: 'send', text: 'hi' })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: '', text: 'hi' })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: 1 })).toBeNull();
    expect(parseClientFrame({ type: 'send', clientId: 'a', text: 'x', imageKey: 2 })).toBeNull();
  });

  it('parses history with and without a cursor', () => {
    expect(parseClientFrame({ type: 'history' })).toEqual({ type: 'history' });
    expect(parseClientFrame({ type: 'history', beforeId: 10 })).toEqual({ type: 'history', beforeId: 10 });
    expect(parseClientFrame({ type: 'history', beforeId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'history', beforeId: '10' })).toBeNull();
  });

  it('requires positive integer ids for read, delete, and recall', () => {
    expect(parseClientFrame({ type: 'read', messageId: 3 })).toEqual({ type: 'read', messageId: 3 });
    expect(parseClientFrame({ type: 'delete', messageId: -1 })).toBeNull();
    expect(parseClientFrame({ type: 'read', messageId: 1.5 })).toBeNull();
    expect(parseClientFrame({ type: 'recall', messageId: 4 })).toEqual({ type: 'recall', messageId: 4 });
    expect(parseClientFrame({ type: 'recall', messageId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'recall' })).toBeNull();
  });

  it('accepts a recall notice that carries no message body', () => {
    expect(parseServerFrame({ type: 'recalled', messageId: 4 })).toMatchObject({ type: 'recalled', messageId: 4 });
  });

  it('accepts an author update only when it names the author', () => {
    const author = { id: 'mem_1', displayName: 'Sam', avatarKey: 'preset:man-cute-purple' };
    expect(parseServerFrame({ type: 'author', author })).toEqual({ type: 'author', author });
    expect(parseServerFrame({ type: 'author' })).toBeNull();
    expect(parseServerFrame({ type: 'author', author: { displayName: 'Sam' } })).toBeNull();
  });

  it('bounds mute duration to thirty days', () => {
    expect(parseClientFrame({ type: 'mute', memberId: 'm', minutes: 60 })).toEqual({
      type: 'mute',
      memberId: 'm',
      minutes: 60,
    });
    expect(parseClientFrame({ type: 'mute', memberId: 'm', minutes: 60 * 24 * 31 })).toBeNull();
  });

  it('rejects non-objects and unknown types', () => {
    expect(parseClientFrame(null)).toBeNull();
    expect(parseClientFrame('send')).toBeNull();
    expect(parseClientFrame([])).toBeNull();
    expect(parseClientFrame({ type: 'shout' })).toBeNull();
  });
});

describe('parseClientFrame send extensions', () => {
  const base = { type: 'send', clientId: 'c1', text: 'hi' };

  it('accepts the full valid shape', () => {
    expect(
      parseClientFrame({
        ...base,
        imageKey: 'chat/channel/ch_1/a.png',
        imageWidth: 800,
        imageHeight: 600,
        replyToId: 7,
        mentions: ['mem_a', 'mem_b', 'mem_a'],
        mentionAll: true,
      }),
    ).toEqual({
      type: 'send',
      clientId: 'c1',
      text: 'hi',
      imageKey: 'chat/channel/ch_1/a.png',
      imageWidth: 800,
      imageHeight: 600,
      replyToId: 7,
      mentions: ['mem_a', 'mem_b'],
      mentionAll: true,
    });
  });

  it('drops an empty mention list and a false mentionAll', () => {
    expect(parseClientFrame({ ...base, mentions: [], mentionAll: false })).toEqual({ type: 'send', clientId: 'c1', text: 'hi' });
  });

  it('rejects malformed replies', () => {
    expect(parseClientFrame({ ...base, replyToId: 0 })).toBeNull();
    expect(parseClientFrame({ ...base, replyToId: 1.5 })).toBeNull();
    expect(parseClientFrame({ ...base, replyToId: '3' })).toBeNull();
  });

  it('bounds and validates mentions', () => {
    const many = Array.from({ length: MENTIONS_MAX + 1 }, (_, i) => 'mem_' + String(i));
    expect(parseClientFrame({ ...base, mentions: many })).toBeNull();
    expect(parseClientFrame({ ...base, mentions: many.slice(0, MENTIONS_MAX) })).toMatchObject({ mentions: many.slice(0, MENTIONS_MAX) });
    expect(parseClientFrame({ ...base, mentions: 'mem_a' })).toBeNull();
    expect(parseClientFrame({ ...base, mentions: [''] })).toBeNull();
    expect(parseClientFrame({ ...base, mentions: ['m'.repeat(65)] })).toBeNull();
    expect(parseClientFrame({ ...base, mentions: [3] })).toBeNull();
    expect(parseClientFrame({ ...base, mentionAll: 'yes' })).toBeNull();
  });

  it('requires image dimensions together, in range, and only with an image', () => {
    const image = { ...base, imageKey: 'k' };
    expect(parseClientFrame({ ...base, imageWidth: 10, imageHeight: 10 })).toBeNull();
    expect(parseClientFrame({ ...image, imageWidth: 10 })).toBeNull();
    expect(parseClientFrame({ ...image, imageHeight: 10 })).toBeNull();
    expect(parseClientFrame({ ...image, imageWidth: 0, imageHeight: 10 })).toBeNull();
    expect(parseClientFrame({ ...image, imageWidth: 10, imageHeight: IMAGE_DIMENSION_MAX + 1 })).toBeNull();
    expect(parseClientFrame({ ...image, imageWidth: 10.5, imageHeight: 10 })).toBeNull();
    expect(parseClientFrame({ ...image, imageWidth: IMAGE_DIMENSION_MAX, imageHeight: 1 })).toMatchObject({
      imageWidth: IMAGE_DIMENSION_MAX,
      imageHeight: 1,
    });
  });

  it('rejects an oversized client id', () => {
    expect(parseClientFrame({ ...base, clientId: 'c'.repeat(65) })).toBeNull();
  });
});

describe('parseClientFrame history extensions', () => {
  it('accepts paging and catch-up shapes', () => {
    expect(parseClientFrame({ type: 'history', beforeId: 9, limit: 100, requestId: 'r_1-A' })).toEqual({
      type: 'history',
      beforeId: 9,
      limit: 100,
      requestId: 'r_1-A',
    });
    expect(parseClientFrame({ type: 'history', afterId: 0, oldestId: 3, sinceRev: 0, limit: 50, extra: true })).toEqual({
      type: 'history',
      afterId: 0,
      oldestId: 3,
      sinceRev: 0,
      limit: 50,
    });
  });

  it('rejects combining beforeId and afterId', () => {
    expect(parseClientFrame({ type: 'history', beforeId: 5, afterId: 6 })).toBeNull();
  });

  it('bounds limit', () => {
    expect(parseClientFrame({ type: 'history', limit: HISTORY_PAGE_MAX + 1 })).toBeNull();
    expect(parseClientFrame({ type: 'history', limit: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'history', limit: 2.5 })).toBeNull();
  });

  it('allows oldestId and sinceRev only with afterId', () => {
    expect(parseClientFrame({ type: 'history', sinceRev: 3 })).toBeNull();
    expect(parseClientFrame({ type: 'history', oldestId: 3 })).toBeNull();
    expect(parseClientFrame({ type: 'history', afterId: 2, oldestId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'history', afterId: 2, sinceRev: -1 })).toBeNull();
    expect(parseClientFrame({ type: 'history', afterId: -1 })).toBeNull();
  });

  it('checks the request id charset and length', () => {
    expect(parseClientFrame({ type: 'history', requestId: 'has space' })).toBeNull();
    expect(parseClientFrame({ type: 'history', requestId: '' })).toBeNull();
    expect(parseClientFrame({ type: 'history', requestId: 'x'.repeat(REQUEST_ID_MAX + 1) })).toBeNull();
    expect(parseClientFrame({ type: 'history', requestId: 7 })).toBeNull();
    expect(parseClientFrame({ type: 'history', requestId: 'x'.repeat(REQUEST_ID_MAX) })).toMatchObject({ requestId: 'x'.repeat(REQUEST_ID_MAX) });
  });
});

describe('parseClientFrame hide', () => {
  it('requires a positive integer id', () => {
    expect(parseClientFrame({ type: 'hide', messageId: 4, extra: 1 })).toEqual({ type: 'hide', messageId: 4 });
    expect(parseClientFrame({ type: 'hide', messageId: 0 })).toBeNull();
    expect(parseClientFrame({ type: 'hide' })).toBeNull();
  });
});

const legacyMessage: ChatMessage = {
  id: 12,
  roomId: 'channel:ch_1',
  author: { id: 'mem_a', displayName: 'A', avatarKey: null },
  text: 'hello',
  imageKey: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  deleted: false,
  recalled: false,
};

describe('normalizeChatMessage', () => {
  it('fills defaults for a message shaped like the first protocol', () => {
    expect(normalizeChatMessage(legacyMessage)).toEqual({
      ...legacyMessage,
      kind: 'user',
      system: null,
      replyTo: null,
      imageWidth: null,
      imageHeight: null,
      clientId: null,
      deletedBy: null,
      rev: 0,
    });
  });

  it('keeps valid new fields and drops malformed ones', () => {
    const normalized = normalizeChatMessage({
      ...legacyMessage,
      kind: 'system',
      system: { type: 'join', actor: { id: 'mem_x', displayName: 'X' }, members: [{ id: 'mem_y', displayName: 'Y' }, { bad: true }], more: 2 } as never,
      replyTo: { id: 3, authorId: 'mem_b', authorName: 'B', excerpt: 'secret', hasImage: true, state: 'recalled' },
      imageWidth: -4,
      clientId: 'c9',
      deletedBy: 'someone' as never,
      rev: 7,
    });
    expect(normalized.kind).toBe('system');
    expect(normalized.system).toEqual({ type: 'join', actor: { id: 'mem_x', displayName: 'X' }, members: [{ id: 'mem_y', displayName: 'Y' }], more: 2 });
    expect(normalized.replyTo).toEqual({ id: 3, authorId: 'mem_b', authorName: 'B', excerpt: '', hasImage: false, state: 'recalled' });
    expect(normalized.imageWidth).toBeNull();
    expect(normalized.clientId).toBe('c9');
    expect(normalized.deletedBy).toBeNull();
    expect(normalized.rev).toBe(7);
  });

  it('never attaches a system event to a user row', () => {
    const normalized = normalizeChatMessage({ ...legacyMessage, system: { type: 'join', actor: null, members: [], more: 0 } });
    expect(normalized.system).toBeNull();
  });
});

describe('parseServerFrame', () => {
  it('normalizes messages in message and history frames', () => {
    const message = parseServerFrame({ type: 'message', message: legacyMessage, clientId: 'c1' });
    expect(message).toMatchObject({ type: 'message', clientId: 'c1', message: { kind: 'user', rev: 0 } });

    const history = parseServerFrame({
      type: 'history_result',
      messages: [legacyMessage, 'junk'],
      hasMore: false,
      changed: [{ ...legacyMessage, id: 3, rev: 9 }],
      hiddenIds: [4, 'x', 0],
    });
    expect(history).toMatchObject({ type: 'history_result', hasMore: false, hiddenIds: [4] });
    if (history?.type !== 'history_result') throw new Error('expected history');
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]?.replyTo).toBeNull();
    expect(history.changed?.[0]).toMatchObject({ id: 3, rev: 9, kind: 'user' });
  });

  it('rejects message frames without a message and history frames without a list', () => {
    expect(parseServerFrame({ type: 'message' })).toBeNull();
    expect(parseServerFrame({ type: 'message', message: { id: 1 } })).toBeNull();
    expect(parseServerFrame({ type: 'history_result', hasMore: false })).toBeNull();
  });

  it('accepts hidden and cleared frames', () => {
    expect(parseServerFrame({ type: 'hidden', messageId: 5, rev: 2 })).toEqual({ type: 'hidden', messageId: 5, rev: 2 });
    expect(parseServerFrame({ type: 'hidden', messageId: 0, rev: 2 })).toBeNull();
    expect(parseServerFrame({ type: 'cleared', beforeId: 10, rev: 3 })).toEqual({ type: 'cleared', beforeId: 10, rev: 3 });
    expect(parseServerFrame({ type: 'cleared' })).toBeNull();
  });

  it('passes through the extended ready frame', () => {
    const ready = { type: 'ready', roomId: 'r', memberId: 'm', lastReadId: 4, onlineCount: 0, visibleFromId: 5, floorReason: 'join', rev: 0 };
    expect(parseServerFrame(ready)).toEqual(ready);
  });
});
