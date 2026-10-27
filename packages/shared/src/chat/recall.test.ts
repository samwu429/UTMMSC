import { describe, expect, it } from 'vitest';
import type { ChatMessage, QuotePreview } from './protocol';
import { RECALL_WINDOW_MS, decideRecall, redactChatBody, redactChatMessage, redactQuotePreview, withinRecallWindow } from './recall';
import type { StickerRef } from './stickers';

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

const sticker: StickerRef = { id: 'stk_0123456789abcdefghijkl', type: 'webp', width: 300, height: 300, animated: false, bytes: 40_000, thumb: 'AbCdEfGhIjKlMnOpQrStUv' };

describe('redactChatMessage with stickers and thumbnails', () => {
  const withdrawn: ChatMessage = { ...message, text: '', imageKey: null, imageWidth: null, imageHeight: null, replyTo: null, recalled: true };

  it('clears the sticker of a recalled or deleted message', () => {
    const recalled = redactChatMessage({ ...withdrawn, sticker });
    expect(recalled.sticker).toBeNull();
    expect(JSON.stringify(recalled)).not.toContain(sticker.id);
    expect(redactChatMessage({ ...withdrawn, recalled: false, deleted: true, sticker }).sticker).toBeNull();
  });

  it('clears a thumbnail left on a withdrawn message', () => {
    const redacted = redactChatMessage({ ...withdrawn, thumbKey: 'chat/channel/ch_1/img_t.jpg' });
    expect(redacted.thumbKey).toBeNull();
    expect(redacted.sticker).toBeNull();
  });

  it('is still free once clean, with or without the new fields present', () => {
    expect(redactChatMessage(withdrawn)).toBe(withdrawn);
    const explicit = { ...withdrawn, thumbKey: null, sticker: null };
    expect(redactChatMessage(explicit)).toBe(explicit);
    const once = redactChatMessage({ ...withdrawn, sticker });
    expect(redactChatMessage(once)).toBe(once);
  });

  it('keeps the sticker of a live message', () => {
    const live = { ...withdrawn, recalled: false, sticker };
    expect(redactChatMessage(live)).toBe(live);
  });
});

describe('redactQuotePreview', () => {
  it('drops excerpt, image flag and sticker flag unless the target is live', () => {
    for (const state of ['recalled', 'deleted', 'unavailable'] as const) {
      expect(redactQuotePreview(quote, state)).toEqual({ ...quote, state, excerpt: '', hasImage: false, hasSticker: false });
    }
    expect(redactQuotePreview(quote, 'ok')).toBe(quote);
  });

  it('clears the sticker flag of a quote whose target went away', () => {
    const stickerQuote: QuotePreview = { ...quote, excerpt: '[表情]', hasImage: false, hasSticker: true };
    expect(redactQuotePreview(stickerQuote, 'recalled')).toMatchObject({ state: 'recalled', excerpt: '', hasImage: false, hasSticker: false });
    expect(redactQuotePreview(stickerQuote, 'ok')).toBe(stickerQuote);
    const cleared = { ...stickerQuote, state: 'deleted' as const, excerpt: '' };
    expect(redactQuotePreview(cleared, 'deleted').hasSticker).toBe(false);
  });

  it('is idempotent', () => {
    const once = redactQuotePreview(quote, 'recalled');
    expect(redactQuotePreview(once, 'recalled')).toBe(once);
    const old: QuotePreview = { id: 2, authorId: 'mem_b', authorName: 'B', excerpt: '', hasImage: false, state: 'deleted' };
    expect(redactQuotePreview(old, 'deleted')).toBe(old);
  });
});
