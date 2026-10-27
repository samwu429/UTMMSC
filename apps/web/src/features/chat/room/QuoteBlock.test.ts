import { describe, expect, it } from 'vitest';
import { normalizeChatMessage, type QuotePreview } from '@utmmsc/shared';
import { quoteBody, quoteText } from './QuoteBlock';
import { translatorFor } from './timeline';

const zh = translatorFor('zh');
const en = translatorFor('en');

function quote(patch: Partial<QuotePreview> = {}): QuotePreview {
  return { id: 7, authorId: 'mem_a', authorName: '张三', excerpt: '你好', hasImage: false, state: 'ok', hasSticker: false, ...patch };
}

/** A sticker quote as the room builds it: the excerpt is the fallback for builds without stickers. */
/** 房间生成的表情引用：摘录是给不支持表情的版本的后备文字。 */
const STICKER_QUOTE = quote({ excerpt: '[表情]', hasSticker: true });

describe('quoteText', () => {
  it('shows a sticker quote with the sticker label in both languages', () => {
    expect(quoteText(STICKER_QUOTE, zh)).toBe('张三：[表情]');
    expect(quoteText(STICKER_QUOTE, en)).toBe('张三: [Sticker]');
  });

  it('ignores the excerpt of a sticker quote, whatever it holds', () => {
    expect(quoteText(quote({ excerpt: '', hasSticker: true }), en)).toBe('张三: [Sticker]');
    expect(quoteText(quote({ excerpt: 'anything', hasSticker: true, hasImage: true }), zh)).toBe('张三：[表情]');
  });

  it('keeps text and photo quotes as they were', () => {
    expect(quoteText(quote(), zh)).toBe('张三：你好');
    expect(quoteText(quote({ excerpt: '', hasImage: true }), zh)).toBe('张三：[图片]');
    expect(quoteText(quote({ excerpt: '', hasImage: true }), en)).toBe('张三: [Photo]');
    // A quote from a server that predates stickers has no hasSticker at all.
    // 早于表情功能的服务端发来的引用根本没有 hasSticker。
    const legacy: QuotePreview = { id: 7, authorId: 'mem_a', authorName: '张三', excerpt: '[表情]', hasImage: false, state: 'ok' };
    expect(quoteText(legacy, en)).toBe('张三: [表情]');
  });

  it('falls back to a generic name', () => {
    expect(quoteText(quote({ authorName: '  ', excerpt: '[表情]', hasSticker: true }), en)).toBe('Member: [Sticker]');
  });

  it('never shows a sticker label once the quoted sticker is recalled or deleted', () => {
    // The protocol clears hasSticker for any state but ok; the state alone decides the text anyway.
    // 协议会在状态不是 ok 时清除 hasSticker；而且文字只由状态决定。
    expect(quoteText(quote({ state: 'recalled', excerpt: '', hasSticker: true }), zh)).toBe('引用内容已撤回');
    expect(quoteText(quote({ state: 'deleted', excerpt: '', hasSticker: true }), en)).toBe('Quoted message was deleted');
    expect(quoteText(quote({ state: 'unavailable', excerpt: '', hasSticker: true }), zh)).toBe('引用内容不可见');
  });

  it('reads a sticker quote straight off the wire', () => {
    const row = normalizeChatMessage({
      id: 9,
      roomId: 'channel:ch_test',
      author: { id: 'mem_b', displayName: 'Bob' },
      text: 'nice',
      imageKey: null,
      createdAt: '2026-10-22T10:00:00.000Z',
      deleted: false,
      recalled: false,
      replyTo: { id: 7, authorId: 'mem_a', authorName: '张三', excerpt: '[表情]', hasImage: false, hasSticker: true, state: 'ok' },
    });
    expect(row.replyTo).not.toBeNull();
    if (!row.replyTo) return;
    expect(quoteText(row.replyTo, en)).toBe('张三: [Sticker]');
    const recalled = normalizeChatMessage({ ...row, replyTo: { ...row.replyTo, state: 'recalled' } });
    expect(recalled.replyTo?.hasSticker).toBe(false);
  });
});

describe('quoteBody', () => {
  it('is the label for stickers, else the excerpt, else the photo label', () => {
    expect(quoteBody(STICKER_QUOTE, en)).toBe('[Sticker]');
    expect(quoteBody(quote(), en)).toBe('你好');
    expect(quoteBody(quote({ excerpt: '', hasImage: true }), en)).toBe('[Photo]');
    expect(quoteBody(quote({ excerpt: '' }), en)).toBe('');
  });
});
