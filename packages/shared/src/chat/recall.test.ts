import { describe, expect, it } from 'vitest';
import type { ChatMessage, QuotePreview } from './protocol';
import { RECALL_WINDOW_MS, decideRecall, redactChatBody, redactChatMessage, redactQuotePreview, withinRecallWindow } from './recall';

const base = {
  authorId: 'mem_a',
  actorId: 'mem_a',
  createdAtMs: 1_000_000,
  nowMs: 1_000_000 + 60_000,
  deleted: false,
  recalled: false,
};

describe('decideRecall', () => {
  it('allows only the author inside three minutes', () => {
    expect(decideRecall(base)).toBe('ok');
    expect(decideRecall({ ...base, nowMs: base.createdAtMs + RECALL_WINDOW_MS })).toBe('ok');
  });

  it('rejects other people even inside the window', () => {
    expect(decideRecall({ ...base, actorId: 'mem_b', nowMs: base.createdAtMs + 1_000 })).toBe('not_author');
  });

  it('rejects recalls after the window', () => {
    expect(decideRecall({ ...base, nowMs: base.createdAtMs + RECALL_WINDOW_MS + 1 })).toBe('expired');
    expect(decideRecall({ ...base, createdAtMs: Number.NaN })).toBe('expired');
  });

  it('rejects deleted or already recalled messages', () => {
    expect(decideRecall({ ...base, deleted: true })).toBe('unavailable');
    expect(decideRecall({ ...base, recalled: true })).toBe('unavailable');
  });
});

describe('withinRecallWindow', () => {
  it('matches the server window on an ISO timestamp', () => {
    const created = new Date(base.createdAtMs).toISOString();
    expect(withinRecallWindow(created, base.createdAtMs + RECALL_WINDOW_MS)).toBe(true);
    expect(withinRecallWindow(created, base.createdAtMs + RECALL_WINDOW_MS + 1)).toBe(false);
    expect(withinRecallWindow('not-a-date', base.nowMs)).toBe(false);
  });
});

describe('redactChatBody', () => {
  it('strips text and image after recall or delete', () => {
    expect(redactChatBody({ text: 'secret', imageKey: 'chat/a', deleted: false, recalled: true })).toEqual({
      text: '',
      imageKey: null,
      deleted: false,
      recalled: true,
    });
    expect(redactChatBody({ text: 'secret', imageKey: null, deleted: true, recalled: false }).text).toBe('');
  });

  it('leaves a live message untouched', () => {
    const live = { text: 'hi', imageKey: null, deleted: false, recalled: false };
    expect(redactChatBody(live)).toBe(live);
  });
});

const quote: QuotePreview = { id: 2, authorId: 'mem_b', authorName: 'B', excerpt: 'quoted words', hasImage: true, state: 'ok' };

const message: ChatMessage = {
  id: 9,
  roomId: 'channel:ch_1',
  author: { id: 'mem_a', displayName: 'A' },
  text: 'secret',
  imageKey: 'chat/channel/ch_1/x.png',
  imageWidth: 400,
  imageHeight: 300,
  replyTo: quote,
  createdAt: '2026-01-01T00:00:00.000Z',
  deleted: false,
  recalled: true,
};

describe('redactChatMessage', () => {
  it('blanks body, image, size and quote of a recalled or deleted message', () => {
    const redacted = redactChatMessage(message);
    expect(redacted).toMatchObject({ text: '', imageKey: null, imageWidth: null, imageHeight: null, replyTo: null, recalled: true });
    expect(JSON.stringify(redacted)).not.toContain('secret');
    expect(JSON.stringify(redacted)).not.toContain('quoted words');
    expect(redactChatMessage({ ...message, recalled: false, deleted: true }).text).toBe('');
  });

  it('is idempotent and returns the same object once clean', () => {
    const once = redactChatMessage(message);
    const twice = redactChatMessage(once);
    expect(twice).toBe(once);
    expect(twice).toEqual(once);
  });

  it('leaves a live message untouched', () => {
    const live = { ...message, recalled: false };
    expect(redactChatMessage(live)).toBe(live);
  });
});

describe('redactQuotePreview', () => {
  it('drops excerpt and image flag unless the target is live', () => {
    for (const state of ['recalled', 'deleted', 'unavailable'] as const) {
      expect(redactQuotePreview(quote, state)).toEqual({ ...quote, state, excerpt: '', hasImage: false });
    }
    expect(redactQuotePreview(quote, 'ok')).toBe(quote);
  });

  it('is idempotent', () => {
    const once = redactQuotePreview(quote, 'recalled');
    expect(redactQuotePreview(once, 'recalled')).toBe(once);
  });
});
