import { describe, expect, it } from 'vitest';
import type { ChatMessage, QuotePreview, StickerRef } from '@utmmsc/shared';
import {
  applyAuthor,
  applyChanged,
  applyCleared,
  applyDeleted,
  applyHidden,
  applyMessage,
  applyRecalled,
  advanceRev,
  createMessageStore,
  distrustRev,
  dropBelowFloor,
  mergePage,
  mergeStale,
  quoteTargetState,
  restoreHidden,
  trimOldest,
} from './messageStore';

function row(id: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    roomId: 'channel:ch_test',
    author: { id: 'mem_a', displayName: 'Alice' },
    text: `message ${id}`,
    imageKey: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, id)).toISOString(),
    deleted: false,
    recalled: false,
    ...extra,
  };
}

function quoteOf(id: number, extra: Partial<QuotePreview> = {}): QuotePreview {
  return { id, authorId: 'mem_a', authorName: 'Alice', excerpt: `message ${id}`, hasImage: false, state: 'ok', ...extra };
}

/** A row shaped like today's server output, with none of the new optional fields. */
/** 与当前服务端输出形状相同、没有任何新可选字段的消息。 */
function legacyRow(id: number): ChatMessage {
  return { id, roomId: 'channel:ch_test', author: { id: 'mem_b', displayName: 'Bob' }, text: 'hi', imageKey: null, createdAt: '2026-01-01T00:00:00.000Z', deleted: false, recalled: false };
}

const ids = (state: { messages: { id: number }[] }) => state.messages.map((m) => m.id);

const STICKER: StickerRef = { id: 'stk_0123456789abcdefghijkl', type: 'gif', width: 240, height: 240, animated: true, bytes: 182_044, thumb: 'AbCdEfGhIjKlMnOpQrStUv' };

/** A sticker row as the room sends it, with the alias image old clients show. */
/** 房间发送的表情消息，带有旧客户端显示的别名图片。 */
function stickerRow(id: number, extra: Partial<ChatMessage> = {}): ChatMessage {
  return row(id, { text: '', imageKey: `chat/channel/ch_test/${STICKER.id}.gif`, imageWidth: 240, imageHeight: 240, thumbKey: null, sticker: STICKER, ...extra });
}

describe('normalization', () => {
  it('fills defaults on rows from an old server', () => {
    const state = applyMessage(createMessageStore(), legacyRow(1));
    expect(state.messages[0]).toMatchObject({ kind: 'user', system: null, replyTo: null, imageWidth: null, imageHeight: null, thumbKey: null, sticker: null, clientId: null, deletedBy: null, rev: 0 });
  });
});

describe('mergePage', () => {
  it('keeps the list ascending and paging flags from an older page that reaches below it', () => {
    let state = mergePage(createMessageStore(), { messages: [row(51), row(52)], hasMore: true }, 'latest');
    state = mergePage(state, { messages: [row(49), row(50)], hasMore: false, reachedFloor: true, floorReason: 'join', beforeId: 51 }, 'older');
    expect(ids(state)).toEqual([49, 50, 51, 52]);
    expect(state.hasMore).toBe(false);
    expect(state.reachedFloor).toBe(true);
    expect(state.floorReason).toBe('join');
  });

  it('ignores paging flags from an older page that does not reach below the current oldest row', () => {
    let state = mergePage(createMessageStore(), { messages: [row(10), row(11)], hasMore: false }, 'latest');
    state = mergePage(state, { messages: [row(11), row(12)], hasMore: true }, 'older');
    expect(state.hasMore).toBe(false);
    state = mergePage(state, { messages: [], hasMore: true, beforeId: 30 }, 'older');
    expect(state.hasMore).toBe(false);
  });

  it('replaces on latest but keeps rows that arrived live after the page', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2), row(3)], hasMore: false }, 'latest');
    state = applyMessage(state, row(9));
    state = mergePage(state, { messages: [row(7), row(8)], hasMore: true }, 'latest');
    expect(ids(state)).toEqual([7, 8, 9]);
    expect(state.hasMore).toBe(true);
  });

  it('applies newer-page flags only when the caller passes them', () => {
    let state = mergePage(createMessageStore(), { messages: [row(5)], hasMore: true }, 'latest');
    state = mergePage(state, { messages: [row(6)] }, 'newer');
    expect(state.hasMore).toBe(true);
    state = mergePage(state, { messages: [row(7)], hasMore: false, reachedFloor: true }, 'newer');
    expect(state.hasMore).toBe(false);
    expect(state.reachedFloor).toBe(true);
  });

  it('records the page revision', () => {
    const state = mergePage(createMessageStore(), { messages: [row(1)], hasMore: false, rev: 14 }, 'latest');
    expect(state.lastRev).toBe(14);
    expect(advanceRev(state, 3).lastRev).toBe(14);
    expect(advanceRev(state, undefined)).toBe(state);
  });

  it('trusts the revision only of a latest page that carries one', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1)], hasMore: false, rev: 14 }, 'latest');
    expect(state.revTrusted).toBe(true);
    state = mergePage(state, { messages: [row(0)], hasMore: false, rev: 30, beforeId: 1 }, 'older');
    expect(state.revTrusted).toBe(true);
    state = mergePage(state, { messages: [row(2)], hasMore: false }, 'latest');
    expect(state.revTrusted).toBe(false);
    expect(distrustRev(state)).toBe(state);
  });

  it('takes the revision of a latest page even when it is lower', () => {
    const state = mergePage(createMessageStore({ lastRev: 40 }), { messages: [row(1)], hasMore: false, rev: 9 }, 'latest');
    expect(state).toMatchObject({ lastRev: 9, revTrusted: true });
  });
});

describe('redaction', () => {
  it('keeps a row redacted when the recalled frame arrives before the history row', () => {
    let state = applyRecalled(createMessageStore(), 5);
    state = mergePage(state, { messages: [row(5, { text: 'secret', imageKey: 'chat/x.png', imageWidth: 10, imageHeight: 10 })], hasMore: false }, 'latest');
    const message = state.messages[0];
    expect(message?.recalled).toBe(true);
    expect(message?.text).toBe('');
    expect(message?.imageKey).toBeNull();
    expect(message?.imageWidth).toBeNull();
    state = applyMessage(state, row(5, { text: 'secret again' }));
    expect(state.messages[0]?.text).toBe('');
  });

  it('redacts loaded replies when their target is recalled or deleted', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2, { replyTo: quoteOf(1) }), row(3, { replyTo: quoteOf(2) })], hasMore: false }, 'latest');
    state = applyRecalled(state, 1);
    expect(state.messages[0]?.text).toBe('');
    expect(state.messages[1]?.replyTo).toEqual({ ...quoteOf(1), excerpt: '', state: 'recalled', hasSticker: false });
    state = applyDeleted(state, 2, 'moderator');
    expect(state.messages[1]?.deletedBy).toBe('moderator');
    expect(state.messages[1]?.replyTo).toBeNull();
    expect(state.messages[2]?.replyTo?.state).toBe('deleted');
    expect(state.messages[2]?.replyTo?.excerpt).toBe('');
  });

  it('redacts quotes in rows that arrive after their target was withdrawn', () => {
    let state = applyRecalled(createMessageStore(), 1);
    state = applyMessage(state, row(4, { replyTo: quoteOf(1) }));
    expect(state.messages[0]?.replyTo?.state).toBe('recalled');
    expect(state.messages[0]?.replyTo?.excerpt).toBe('');
  });

  it('redacts a message recalled while offline, and its quotes, from catch-up changes', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2), row(3, { replyTo: quoteOf(2) })], hasMore: false }, 'latest');
    state = applyChanged(state, [row(2, { text: '', recalled: true, rev: 9 })], []);
    expect(state.messages[1]?.recalled).toBe(true);
    expect(state.messages[1]?.text).toBe('');
    expect(state.messages[2]?.replyTo).toMatchObject({ state: 'recalled', excerpt: '' });
    // A stale page that still carries the old body cannot bring it back.
    // 仍带旧正文的过期页无法恢复正文。
    state = mergePage(state, { messages: [row(2, { text: 'old body' })], hasMore: false, beforeId: 3 }, 'older');
    expect(state.messages[1]?.text).toBe('');
  });

  it('applies hides from another device during catch-up', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2), row(3)], hasMore: false }, 'latest');
    state = applyChanged(state, [], [2]);
    expect(ids(state)).toEqual([1, 3]);
  });
});

describe('applyMessage', () => {
  it('ignores a duplicate echo', () => {
    const first = applyMessage(createMessageStore(), row(3, { clientId: 'c1' }));
    const second = applyMessage(first, row(3, { clientId: 'c1' }));
    expect(second).toBe(first);
    expect(second.messages).toHaveLength(1);
  });

  it('drops rows below the visible floor', () => {
    const state = applyMessage(createMessageStore({ visibleFromId: 10 }), row(4));
    expect(state.messages).toHaveLength(0);
  });
});

describe('hide, clear and floor', () => {
  it('keeps a hidden row out even when a late page includes it, and can undo the hide', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2)], hasMore: false }, 'latest');
    const hiddenRow = state.messages[1]!;
    state = applyHidden(state, 2);
    expect(ids(state)).toEqual([1]);
    state = mergePage(state, { messages: [row(1), row(2)], hasMore: false }, 'newer');
    expect(ids(state)).toEqual([1]);
    state = restoreHidden(state, hiddenRow);
    expect(ids(state)).toEqual([1, 2]);
  });

  it('clears rows below beforeId and reports the clear floor', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2), row(3)], hasMore: true }, 'latest');
    state = applyCleared(state, 4);
    expect(state.messages).toHaveLength(0);
    expect(state).toMatchObject({ visibleFromId: 4, floorReason: 'clear', hasMore: false, reachedFloor: true });
    state = applyMessage(state, row(2));
    expect(state.messages).toHaveLength(0);
  });

  it('drops rows below a raised floor', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2), row(3)], hasMore: false }, 'latest');
    state = dropBelowFloor(state, 3, 'join');
    expect(ids(state)).toEqual([3]);
    expect(state.floorReason).toBe('join');
    expect(dropBelowFloor(state, 3, 'join')).toBe(state);
  });
});

describe('trimOldest and authors', () => {
  it('keeps the newest rows and marks more history available', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 1));
    const state = trimOldest(mergePage(createMessageStore(), { messages: rows, hasMore: false, reachedFloor: true }, 'latest'), 4);
    expect(ids(state)).toEqual([7, 8, 9, 10]);
    expect(state.hasMore).toBe(true);
    expect(state.reachedFloor).toBe(false);
  });

  it('updates names on rows and quotes', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2, { author: { id: 'mem_b', displayName: 'Bob' }, replyTo: quoteOf(1) })], hasMore: false }, 'latest');
    state = applyAuthor(state, { id: 'mem_a', displayName: 'Alicia', avatarKey: null });
    expect(state.messages[0]?.author.displayName).toBe('Alicia');
    expect(state.messages[1]?.replyTo?.authorName).toBe('Alicia');
    expect(applyAuthor(state, { id: 'mem_a', displayName: 'Alicia', avatarKey: null })).toBe(state);
  });
});

describe('quotes of withdrawn rows', () => {
  it('redacts loaded replies when an older page brings their target already recalled', () => {
    let state = mergePage(createMessageStore(), { messages: [row(10), row(11, { replyTo: quoteOf(3, { excerpt: 'secret plan' }) })], hasMore: true }, 'latest');
    state = mergePage(state, { messages: [row(3, { text: '', recalled: true }), row(4)], hasMore: false, beforeId: 10 }, 'older');
    expect(state.messages.find((m) => m.id === 11)?.replyTo).toMatchObject({ state: 'recalled', excerpt: '' });
  });

  it('redacts quotes of a row the member hid, without showing the row again', () => {
    let state = mergePage(createMessageStore(), { messages: [row(1), row(2, { replyTo: quoteOf(1, { excerpt: 'secret' }) })], hasMore: false }, 'latest');
    state = applyHidden(state, 1);
    state = applyChanged(state, [row(1, { text: '', deleted: true, deletedBy: 'moderator', rev: 7 })], [1]);
    expect(ids(state)).toEqual([2]);
    expect(state.messages[0]?.replyTo).toMatchObject({ state: 'deleted', excerpt: '' });
  });

  it('keeps a recalled row hidden on a device that never saw the hide', () => {
    let state = mergePage(createMessageStore(), { messages: [row(2, { replyTo: quoteOf(1) }), row(3)], hasMore: false }, 'latest');
    state = applyChanged(state, [row(1, { text: '', recalled: true, rev: 5 })], [1]);
    expect(ids(state)).toEqual([2, 3]);
    expect(state.messages[0]?.replyTo?.state).toBe('recalled');
  });
});

describe('gaps', () => {
  it('drops an older page asked for below a row that was trimmed away meanwhile', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i + 11));
    let state = mergePage(createMessageStore(), { messages: rows, hasMore: true }, 'latest');
    state = trimOldest(state, 4);
    expect(ids(state)).toEqual([17, 18, 19, 20]);
    const late = mergePage(state, { messages: [row(9), row(10, { text: '', recalled: true })], hasMore: true, beforeId: 11 }, 'older');
    expect(ids(late)).toEqual([17, 18, 19, 20]);
    expect(quoteTargetState(late, 10)).toBe('recalled');
  });

  it('updates only rows inside the loaded range from a stale result', () => {
    let state = mergePage(createMessageStore(), { messages: [row(5), row(6), row(7)], hasMore: true }, 'latest');
    state = mergeStale(state, [row(2), row(6, { text: 'edited name', author: { id: 'mem_a', displayName: 'Alicia' } }), row(12)]);
    expect(ids(state)).toEqual([5, 6, 7]);
    expect(state.messages[1]?.author.displayName).toBe('Alicia');
  });
});

describe('stickers', () => {
  it('keeps the sticker and drops the alias image', () => {
    const state = applyMessage(createMessageStore(), stickerRow(5));
    expect(state.messages[0]).toMatchObject({ text: '', imageKey: null, imageWidth: null, imageHeight: null, thumbKey: null, sticker: STICKER });
  });

  it('draws a sticker row again when its still or its sticker changes, and only then', () => {
    const first = applyMessage(createMessageStore(), stickerRow(5));
    expect(applyMessage(first, stickerRow(5))).toBe(first);

    const restill = applyMessage(first, stickerRow(5, { sticker: { ...STICKER, thumb: 'ZyXwVuTsRqPoNmLkJiHgFe' } }));
    expect(restill.messages[0]).not.toBe(first.messages[0]);
    expect(restill.messages[0]?.sticker?.thumb).toBe('ZyXwVuTsRqPoNmLkJiHgFe');

    const stillless = applyMessage(restill, stickerRow(5, { sticker: { ...STICKER, thumb: null } }));
    expect(stillless.messages[0]?.sticker?.thumb).toBeNull();

    const other = applyMessage(first, stickerRow(5, { sticker: { ...STICKER, id: 'stk_ZZZZZZZZZZZZZZZZZZZZZZ' } }));
    expect(other.messages[0]?.sticker?.id).toBe('stk_ZZZZZZZZZZZZZZZZZZZZZZ');

    // A row whose sticker turned out invalid shows its alias as a photo instead.
    // 表情无效的消息改为把别名当作图片显示。
    const broken = applyMessage(first, stickerRow(5, { sticker: { ...STICKER, id: 'bad' } }));
    expect(broken.messages[0]).toMatchObject({ sticker: null, imageKey: `chat/channel/ch_test/${STICKER.id}.gif` });
  });

  it('draws a photo row again when its thumbnail arrives', () => {
    const first = applyMessage(createMessageStore(), row(3, { text: '', imageKey: 'chat/channel/ch_test/img_a.png', imageWidth: 10, imageHeight: 10 }));
    const thumbed = applyMessage(first, row(3, { text: '', imageKey: 'chat/channel/ch_test/img_a.png', imageWidth: 10, imageHeight: 10, thumbKey: 'chat/channel/ch_test/img_a_t.webp' }));
    expect(thumbed.messages[0]).not.toBe(first.messages[0]);
    expect(thumbed.messages[0]?.thumbKey).toBe('chat/channel/ch_test/img_a_t.webp');
  });

  it('clears the sticker on a live recall, and a late echo cannot bring it back', () => {
    let state = applyMessage(createMessageStore(), stickerRow(5));
    const before = state.messages[0];
    state = applyRecalled(state, 5);
    expect(state.messages[0]).not.toBe(before);
    expect(state.messages[0]).toMatchObject({ recalled: true, text: '', sticker: null, imageKey: null });
    state = applyMessage(state, stickerRow(5));
    expect(state.messages[0]?.sticker).toBeNull();
  });

  it('clears the sticker of a row recalled while offline, even one that still carries it', () => {
    let state = mergePage(createMessageStore(), { messages: [stickerRow(5), row(6)], hasMore: false }, 'latest');
    state = applyChanged(state, [stickerRow(5, { recalled: true, rev: 9 })], []);
    expect(state.messages[0]).toMatchObject({ recalled: true, sticker: null, imageKey: null, imageWidth: null });
    state = applyDeleted(mergePage(createMessageStore(), { messages: [stickerRow(7)], hasMore: false }, 'latest'), 7, 'moderator');
    expect(state.messages[0]).toMatchObject({ deleted: true, sticker: null });
  });

  it('draws a reply again when its quote gains or loses the sticker flag, and a recall clears the flag', () => {
    const quote = quoteOf(5, { excerpt: '[表情]', hasSticker: true });
    let state = mergePage(createMessageStore(), { messages: [stickerRow(5), row(6, { replyTo: quote })], hasMore: false }, 'latest');
    expect(state.messages[1]?.replyTo?.hasSticker).toBe(true);
    expect(applyMessage(state, row(6, { replyTo: quote }))).toBe(state);

    const flat = applyMessage(state, row(6, { replyTo: { ...quote, hasSticker: false } }));
    expect(flat.messages[1]).not.toBe(state.messages[1]);
    expect(flat.messages[1]?.replyTo?.hasSticker).toBe(false);

    state = applyRecalled(state, 5);
    expect(state.messages[1]?.replyTo).toMatchObject({ state: 'recalled', excerpt: '', hasSticker: false });
  });
});

describe('quoteTargetState', () => {
  it('reports what a quote of the message would show now', () => {
    let state = mergePage(createMessageStore({ visibleFromId: 3 }), { messages: [row(3), row(4), row(5, { kind: 'system', author: { id: 'system', displayName: '' } })], hasMore: false }, 'latest');
    expect(quoteTargetState(state, 3)).toBe('ok');
    expect(quoteTargetState(state, 2)).toBe('unavailable');
    expect(quoteTargetState(state, 5)).toBe('unavailable');
    expect(quoteTargetState(state, 9)).toBe('unknown');
    state = applyHidden(state, 4);
    expect(quoteTargetState(state, 4)).toBe('hidden');
    state = applyRecalled(state, 3);
    expect(quoteTargetState(state, 3)).toBe('recalled');
    expect(quoteTargetState(applyDeleted(state, 9, 'moderator'), 9)).toBe('deleted');
  });
});
