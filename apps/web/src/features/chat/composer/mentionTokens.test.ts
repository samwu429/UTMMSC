import { MENTIONS_MAX, MESSAGE_TEXT_MAX } from '@utmmsc/shared';
import { describe, expect, it } from 'vitest';
import {
  MENTION_END,
  capMessageText,
  collectMentions,
  deleteBackward,
  insertAtSelection,
  insertMention,
  mentionLabel,
  mentionToken,
  presentMentions,
  removeTokenOnBackspace,
  repairBrokenToken,
  typedMentionTrigger,
  type MentionTarget,
} from './mentionTokens';

const FULL_WIDTH_AT = String.fromCharCode(0xff20);
const ZWJ = String.fromCharCode(0x200d);
const NEWLINE = String.fromCharCode(0x0a);
const SMILE = String.fromCodePoint(0x1f600);
const zhang: MentionTarget = { kind: 'member', id: 'mem_zhang', label: '张三' };
const li: MentionTarget = { kind: 'member', id: 'mem_li', label: 'Li Si' };
const everyone: MentionTarget = { kind: 'all', label: '所有人' };

function at(caret: number) {
  return { start: caret, end: caret };
}

describe('mentionLabel and mentionToken', () => {
  it('collapses whitespace so the closing U+2005 stays unique', () => {
    expect(mentionLabel(['  Li ', ' Si', MENTION_END, ' '].join(NEWLINE))).toBe('Li Si');
    expect(mentionToken('张三')).toBe('@张三' + MENTION_END);
  });

  it('caps long names by code point', () => {
    const long = SMILE.repeat(80);
    expect(Array.from(mentionLabel(long))).toHaveLength(64);
  });
});

describe('insertMention', () => {
  it('inserts the token at the caret', () => {
    expect(insertMention('hi  there', at(3), zhang)).toEqual({ text: 'hi @张三' + MENTION_END + ' there', caret: 3 + 4 });
  });

  it('turns the typed at sign into the start of the token', () => {
    const typed = 'hi @';
    const edit = insertMention(typed, at(typed.length), zhang, { replaceTrigger: true });
    expect(edit).toEqual({ text: 'hi @张三' + MENTION_END, caret: 'hi @张三'.length + 1 });
  });

  it('also replaces a full-width at sign', () => {
    expect(insertMention(FULL_WIDTH_AT, at(1), zhang, { replaceTrigger: true })?.text).toBe('@张三' + MENTION_END);
  });

  it('keeps an earlier at sign when no trigger was typed', () => {
    expect(insertMention('@', at(1), zhang)?.text).toBe('@@张三' + MENTION_END);
  });

  it('replaces a selection', () => {
    expect(insertMention('abcdef', { start: 4, end: 1 }, zhang)?.text).toBe('a@张三' + MENTION_END + 'ef');
  });

  it('refuses to pass the message limit', () => {
    const full = 'x'.repeat(MESSAGE_TEXT_MAX - 2);
    expect(insertMention(full, at(full.length), zhang)).toBeNull();
    expect(insertMention('', at(0), { kind: 'member', id: 'mem_x', label: '' })).toBeNull();
  });
});

describe('typedMentionTrigger', () => {
  it('detects a single at sign typed before the caret', () => {
    expect(typedMentionTrigger('hi ', 'hi @', 4)).toBe(true);
    expect(typedMentionTrigger('ab', 'a@b', 2)).toBe(true);
    expect(typedMentionTrigger('', FULL_WIDTH_AT, 1)).toBe(true);
  });

  it('ignores pastes, deletions and other characters', () => {
    expect(typedMentionTrigger('', '@a', 2)).toBe(false);
    expect(typedMentionTrigger('@a', '@', 1)).toBe(false);
    expect(typedMentionTrigger('a', 'ab', 2)).toBe(false);
    expect(typedMentionTrigger('ab', 'a@b', 3)).toBe(false);
  });
});

describe('removeTokenOnBackspace', () => {
  const text = 'hi @张三' + MENTION_END + 'and @Li Si' + MENTION_END;

  it('deletes the whole token when the caret is right after it', () => {
    const afterZhang = 'hi @张三'.length + 1;
    expect(removeTokenOnBackspace(text, at(afterZhang), [zhang, li])).toEqual({ text: 'hi and @Li Si' + MENTION_END, caret: 3 });
    expect(removeTokenOnBackspace(text, at(text.length), [zhang, li])).toEqual({ text: 'hi @张三' + MENTION_END + 'and ', caret: text.length - '@Li Si'.length - 1 });
  });

  it('removes an untracked token without spaces, such as one restored from a draft', () => {
    expect(removeTokenOnBackspace('@王五' + MENTION_END, at(4), [])).toEqual({ text: '', caret: 0 });
    expect(removeTokenOnBackspace('@Li Si' + MENTION_END, at(7), [])).toBeNull();
  });

  it('leaves ordinary deletes alone', () => {
    expect(removeTokenOnBackspace(text, at(2), [zhang])).toBeNull();
    expect(removeTokenOnBackspace(text, at('hi @张'.length), [zhang])).toBeNull();
    expect(removeTokenOnBackspace(text, { start: 0, end: 5 }, [zhang])).toBeNull();
    expect(removeTokenOnBackspace('a b', at(2), [])).toBeNull();
  });
});

describe('repairBrokenToken', () => {
  it('finishes a token delete the keyboard could not cancel', () => {
    const prev = 'hi @张三' + MENTION_END + '!';
    const caret = 'hi @张三'.length;
    const next = prev.slice(0, caret) + prev.slice(caret + 1);
    expect(repairBrokenToken(prev, next, caret, [zhang])).toEqual({ text: 'hi !', caret: 3 });
  });

  it('ignores any other edit', () => {
    expect(repairBrokenToken('abc', 'ab', 2, [])).toBeNull();
    expect(repairBrokenToken('@张三' + MENTION_END, '@张' + MENTION_END, 2, [zhang])).toBeNull();
    expect(repairBrokenToken('ab', 'abc', 3, [])).toBeNull();
  });
});

describe('deleteBackward', () => {
  it('removes one grapheme, including emoji built from several code points', () => {
    const family = [0x1f468, 0x1f469, 0x1f467].map((code) => String.fromCodePoint(code)).join(ZWJ);
    expect(deleteBackward('a' + family, at(1 + family.length), [])).toEqual({ text: 'a', caret: 1 });
    expect(deleteBackward('a' + SMILE, at(3), [])).toEqual({ text: 'a', caret: 1 });
    expect(deleteBackward('ab', at(1), [])).toEqual({ text: 'b', caret: 0 });
  });

  it('removes a selection or a whole token first', () => {
    expect(deleteBackward('abcd', { start: 1, end: 3 }, [])).toEqual({ text: 'ad', caret: 1 });
    expect(deleteBackward('x@张三' + MENTION_END, at(5), [zhang])).toEqual({ text: 'x', caret: 1 });
  });

  it('does nothing at the start', () => {
    expect(deleteBackward('ab', at(0), [])).toEqual({ text: 'ab', caret: 0 });
  });
});

describe('collectMentions', () => {
  it('returns only the mentions still present after edits', () => {
    let text = '';
    const tracked: MentionTarget[] = [];
    for (const target of [zhang, li]) {
      const edit = insertMention(text, at(text.length), target);
      if (!edit) throw new Error('insert failed');
      text = edit.text + ' ';
      tracked.push(target);
    }
    expect(collectMentions(text, tracked, { allowAll: false })).toEqual({ mentions: ['mem_zhang', 'mem_li'], mentionAll: false });
    const removed = removeTokenOnBackspace(text, at('@张三'.length + 1), tracked);
    if (!removed) throw new Error('remove failed');
    expect(collectMentions(removed.text, tracked, { allowAll: false })).toEqual({ mentions: ['mem_li'], mentionAll: false });
    expect(collectMentions(text.replace('Si', 'S'), tracked, { allowAll: false }).mentions).toEqual(['mem_zhang']);
  });

  it('counts everyone only when allowed', () => {
    const text = mentionToken('所有人') + 'meeting';
    expect(collectMentions(text, [everyone], { allowAll: true })).toEqual({ mentions: [], mentionAll: true });
    expect(collectMentions(text, [everyone], { allowAll: false })).toEqual({ mentions: [], mentionAll: false });
  });

  it('dedupes repeats and keeps one id per occurrence of a shared name', () => {
    const twin: MentionTarget = { kind: 'member', id: 'mem_zhang_2', label: '张三' };
    const once = mentionToken('张三');
    expect(collectMentions(once + once, [zhang, zhang], { allowAll: false }).mentions).toEqual(['mem_zhang']);
    expect(collectMentions(once, [zhang, twin], { allowAll: false }).mentions).toEqual(['mem_zhang']);
    expect(collectMentions(once + once, [zhang, twin], { allowAll: false }).mentions).toEqual(['mem_zhang', 'mem_zhang_2']);
    expect(presentMentions('', [zhang])).toEqual([]);
  });

  it('caps the list at MENTIONS_MAX', () => {
    const many: MentionTarget[] = Array.from({ length: MENTIONS_MAX + 5 }, (_, index) => ({ kind: 'member', id: `mem_${index}`, label: `m${index}` }));
    const text = many.map((target) => mentionToken(target.label)).join('');
    expect(collectMentions(text, many, { allowAll: false }).mentions).toHaveLength(MENTIONS_MAX);
  });
});

describe('insertAtSelection and capMessageText', () => {
  it('inserts at the caret within the limit', () => {
    expect(insertAtSelection('ac', at(1), 'b')).toEqual({ text: 'abc', caret: 2 });
    expect(insertAtSelection('abc', at(9), 'd')).toEqual({ text: 'abcd', caret: 4 });
    expect(insertAtSelection('x'.repeat(MESSAGE_TEXT_MAX), at(0), 'y')).toBeNull();
  });

  it('never cuts a surrogate pair in half', () => {
    const text = 'x'.repeat(MESSAGE_TEXT_MAX - 1) + SMILE;
    expect(capMessageText(text)).toHaveLength(MESSAGE_TEXT_MAX - 1);
    expect(capMessageText('abc')).toBe('abc');
  });
});
