import { describe, expect, it } from 'vitest';
import type { NotificationPrefs } from '@utmmsc/shared';
import { selectMessageRecipients, type RecipientInput } from './recipients';

const off = (patch: Partial<NotificationPrefs>): NotificationPrefs => ({ messages: true, events: true, preview: true, ...patch });

function input(patch: Partial<RecipientInput> = {}): RecipientInput {
  return {
    readers: ['author', 'a', 'b', 'c'],
    authorId: 'author',
    connected: new Set(),
    muted: new Set(),
    prefs: new Map(),
    mentions: [],
    mentionAll: false,
    ...patch,
  };
}

describe('selectMessageRecipients', () => {
  it('skips the author and defaults everyone else to on', () => {
    expect(selectMessageRecipients(input())).toEqual([
      { memberId: 'a', mentioned: false },
      { memberId: 'b', mentioned: false },
      { memberId: 'c', mentioned: false },
    ]);
  });

  it('skips members watching the room live', () => {
    expect(selectMessageRecipients(input({ connected: new Set(['b']) })).map((r) => r.memberId)).toEqual(['a', 'c']);
  });

  it('skips members who turned message notifications off, even when mentioned', () => {
    const prefs = new Map([['a', off({ messages: false })]]);
    expect(selectMessageRecipients(input({ prefs, mentions: ['a'] })).map((r) => r.memberId)).toEqual(['b', 'c']);
  });

  it('lets an @ through a muted chat, and nothing else', () => {
    const muted = new Set(['a', 'b']);
    expect(selectMessageRecipients(input({ muted, mentions: ['b'] }))).toEqual([
      { memberId: 'b', mentioned: true },
      { memberId: 'c', mentioned: false },
    ]);
  });

  it('treats @所有人 as a mention of everyone', () => {
    const muted = new Set(['a']);
    expect(selectMessageRecipients(input({ muted, mentionAll: true })).every((r) => r.mentioned)).toBe(true);
    expect(selectMessageRecipients(input({ muted, mentionAll: true })).map((r) => r.memberId)).toEqual(['a', 'b', 'c']);
  });

  it('counts a reader listed twice once', () => {
    expect(selectMessageRecipients(input({ readers: ['a', 'a', 'author'] }))).toEqual([{ memberId: 'a', mentioned: false }]);
  });

  it('ignores the events switch for messages', () => {
    const prefs = new Map([['a', off({ events: false, preview: false })]]);
    expect(selectMessageRecipients(input({ prefs })).map((r) => r.memberId)).toEqual(['a', 'b', 'c']);
  });
});
