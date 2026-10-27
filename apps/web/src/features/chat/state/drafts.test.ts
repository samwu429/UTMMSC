import { afterEach, describe, expect, it } from 'vitest';
import { MESSAGE_TEXT_MAX, type MemberSelf, type QuotePreview } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { DRAFTS_MAX, DRAFTS_STORAGE_KEY, RECENT_EMOJI_MAX, bindDraftsToSession, createDraftsStore, draftFor } from './drafts';
import { createSafeStorage } from './safeStorage';

function memoryBackend() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => void data.set(name, value),
    removeItem: (name: string) => void data.delete(name),
  };
}

function memoryStorage() {
  const backend = memoryBackend();
  return createSafeStorage(() => backend);
}

function throwingBackend() {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

const quote: QuotePreview = { id: 7, authorId: 'mem_b', authorName: 'Bob', excerpt: 'see you at 6', hasImage: false, state: 'ok' };

describe('safe storage', () => {
  it('reads null and drops writes when storage throws or is missing', () => {
    const blocked = createSafeStorage(throwingBackend);
    expect(() => blocked.setItem('k', 'v')).not.toThrow();
    expect(blocked.getItem('k')).toBeNull();
    expect(() => blocked.removeItem('k')).not.toThrow();

    const denied = createSafeStorage(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(denied.getItem('k')).toBeNull();
    expect(() => denied.setItem('k', 'v')).not.toThrow();

    const missing = createSafeStorage(() => undefined);
    expect(missing.getItem('k')).toBeNull();
  });
});

describe('drafts store', () => {
  it('saves, persists and restores a draft with its quote', () => {
    const backend = memoryBackend();
    const store = createDraftsStore(createSafeStorage(() => backend));
    store.getState().setDraft('mem_a', 'channel:ch_1', { text: 'hello', quote });
    expect(store.getState().getDraft('mem_a', 'channel:ch_1')).toMatchObject({ text: 'hello', quote });
    expect(backend.data.has(DRAFTS_STORAGE_KEY)).toBe(true);

    const reopened = createDraftsStore(createSafeStorage(() => backend));
    expect(reopened.getState().getDraft('mem_a', 'channel:ch_1')).toMatchObject({ text: 'hello', quote });
  });

  it('keeps drafts apart per member and per room', () => {
    const store = createDraftsStore(memoryStorage());
    store.getState().setDraft('mem_a', 'channel:ch_1', { text: 'mine' });
    expect(store.getState().getDraft('mem_b', 'channel:ch_1')).toBeNull();
    expect(store.getState().getDraft('mem_a', 'channel:ch_2')).toBeNull();
    expect(draftFor(store.getState(), 'mem_a', 'channel:ch_1')?.text).toBe('mine');
  });

  it('caps text at MESSAGE_TEXT_MAX without splitting a surrogate pair', () => {
    const store = createDraftsStore(memoryStorage());
    store.getState().setDraft('mem_a', 'r', { text: 'x'.repeat(MESSAGE_TEXT_MAX + 50) });
    expect(store.getState().getDraft('mem_a', 'r')?.text).toHaveLength(MESSAGE_TEXT_MAX);

    const emoji = String.fromCodePoint(0x1f600);
    store.getState().setDraft('mem_a', 'r', { text: 'x'.repeat(MESSAGE_TEXT_MAX - 1) + emoji });
    const text = store.getState().getDraft('mem_a', 'r')?.text ?? '';
    expect(text).toHaveLength(MESSAGE_TEXT_MAX - 1);
    expect(text.endsWith('x')).toBe(true);
  });

  it('deletes the entry for empty text without a quote, but keeps a quote alone', () => {
    const store = createDraftsStore(memoryStorage());
    store.getState().setDraft('mem_a', 'r', { text: 'draft' });
    store.getState().setDraft('mem_a', 'r', { text: '   ' });
    expect(store.getState().getDraft('mem_a', 'r')).toBeNull();

    store.getState().setDraft('mem_a', 'r', { text: '', quote });
    expect(store.getState().getDraft('mem_a', 'r')).toMatchObject({ text: '', quote });
    store.getState().clearDraft('mem_a', 'r');
    expect(store.getState().getDraft('mem_a', 'r')).toBeNull();
  });

  it('never stores the excerpt of a quote that is no longer visible', () => {
    const store = createDraftsStore(memoryStorage());
    store.getState().setDraft('mem_a', 'r', { text: 'reply', quote: { ...quote, state: 'recalled' } });
    expect(store.getState().getDraft('mem_a', 'r')?.quote).toMatchObject({ state: 'recalled', excerpt: '', hasImage: false });
  });

  it('keeps the sticker flag of a quote through storage, and drops it once the quote is no longer visible', () => {
    const backend = memoryBackend();
    const store = createDraftsStore(createSafeStorage(() => backend));
    const stickerQuote: QuotePreview = { ...quote, excerpt: '[表情]', hasSticker: true };
    store.getState().setDraft('mem_a', 'r', { text: '', quote: stickerQuote });
    expect(store.getState().getDraft('mem_a', 'r')?.quote).toEqual(stickerQuote);
    expect(createDraftsStore(createSafeStorage(() => backend)).getState().getDraft('mem_a', 'r')?.quote).toEqual(stickerQuote);

    // Saving the same quote again changes nothing; losing the flag is a change.
    // 再次保存相同的引用不会有任何变化；去掉标记则算作变化。
    const saved = store.getState().drafts;
    store.getState().setDraft('mem_a', 'r', { text: '', quote: { ...stickerQuote } });
    expect(store.getState().drafts).toBe(saved);
    store.getState().setDraft('mem_a', 'r', { text: '', quote: { ...stickerQuote, hasSticker: false } });
    expect(store.getState().getDraft('mem_a', 'r')?.quote?.hasSticker).toBe(false);

    store.getState().setDraft('mem_a', 'r', { text: 'reply', quote: { ...stickerQuote, state: 'recalled' } });
    expect(store.getState().getDraft('mem_a', 'r')?.quote).toMatchObject({ state: 'recalled', excerpt: '', hasImage: false, hasSticker: false });

    const odd = memoryBackend();
    odd.data.set(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({ version: 1, state: { drafts: { 'mem_a|r': { text: 'x', quote: { ...stickerQuote, hasSticker: 'yes' }, updatedAt: '2026-10-22T00:00:00.000Z' } }, recentEmoji: [] } }),
    );
    expect(createDraftsStore(createSafeStorage(() => odd)).getState().getDraft('mem_a', 'r')?.quote?.hasSticker).toBe(false);
  });

  it('keeps only the newest drafts', () => {
    const store = createDraftsStore(memoryStorage());
    for (let index = 0; index <= DRAFTS_MAX; index += 1) store.getState().setDraft('mem_a', `room${index}`, { text: `t${index}` });
    expect(Object.keys(store.getState().drafts)).toHaveLength(DRAFTS_MAX);
    expect(store.getState().getDraft('mem_a', `room${DRAFTS_MAX}`)?.text).toBe(`t${DRAFTS_MAX}`);
    expect(store.getState().getDraft('mem_a', 'room0')).toBeNull();

    // Editing an old draft again makes it the newest one.
    // 再次编辑旧草稿会让它成为最新的一条。
    store.getState().setDraft('mem_a', 'room1', { text: 'edited' });
    store.getState().setDraft('mem_a', 'room-new', { text: 'new' });
    expect(store.getState().getDraft('mem_a', 'room1')?.text).toBe('edited');
    expect(store.getState().getDraft('mem_a', 'room2')).toBeNull();
  });

  it('orders recent emoji newest first, without duplicates, at most 16', () => {
    const store = createDraftsStore(memoryStorage());
    const smile = String.fromCodePoint(0x1f604);
    const thumbs = String.fromCodePoint(0x1f44d);
    store.getState().pushRecentEmoji(smile);
    store.getState().pushRecentEmoji(thumbs);
    store.getState().pushRecentEmoji(smile);
    expect(store.getState().recentEmoji).toEqual([smile, thumbs]);
    for (let code = 0x1f600; code < 0x1f600 + 30; code += 1) store.getState().pushRecentEmoji(String.fromCodePoint(code));
    expect(store.getState().recentEmoji).toHaveLength(RECENT_EMOJI_MAX);
    expect(store.getState().recentEmoji[0]).toBe(String.fromCodePoint(0x1f600 + 29));
  });

  it('degrades silently when storage throws', () => {
    const store = createDraftsStore(createSafeStorage(throwingBackend));
    expect(() => store.getState().setDraft('mem_a', 'r', { text: 'offline' })).not.toThrow();
    expect(store.getState().getDraft('mem_a', 'r')?.text).toBe('offline');
    expect(() => store.getState().pushRecentEmoji(String.fromCodePoint(0x1f604))).not.toThrow();
    expect(() => store.getState().clearDraft('mem_a', 'r')).not.toThrow();
  });

  it('ignores corrupted or malformed stored data', () => {
    const corrupted = memoryBackend();
    corrupted.data.set(DRAFTS_STORAGE_KEY, '{not json');
    expect(() => createDraftsStore(createSafeStorage(() => corrupted))).not.toThrow();
    expect(createDraftsStore(createSafeStorage(() => corrupted)).getState().drafts).toEqual({});

    const malformed = memoryBackend();
    malformed.data.set(
      DRAFTS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        state: {
          drafts: { 'mem_a|r1': { text: 'ok', quote: null, updatedAt: '2026-10-22T00:00:00.000Z' }, 'mem_a|r2': { text: 5 }, 'mem_a|r3': 'nope' },
          recentEmoji: ['a', 7, 'a', 'b'],
        },
      }),
    );
    const store = createDraftsStore(createSafeStorage(() => malformed));
    expect(Object.keys(store.getState().drafts)).toEqual(['mem_a|r1']);
    expect(store.getState().recentEmoji).toEqual(['a', 'b']);
  });
});

describe('session binding', () => {
  const member = (id: string) => ({ id }) as MemberSelf;
  let unbind: (() => void) | null = null;

  afterEach(() => {
    unbind?.();
    unbind = null;
    useSessionStore.setState({ token: null, member: null, mediaToken: null });
  });

  it('resets when the member signs out or changes, but not on sign-in', () => {
    const store = createDraftsStore(memoryStorage());
    unbind = bindDraftsToSession(store);

    useSessionStore.setState({ token: 't1', member: member('mem_a') });
    store.getState().setDraft('mem_a', 'r', { text: 'keep' });
    store.getState().pushRecentEmoji('a');
    useSessionStore.setState({ mediaToken: 'm1' });
    expect(store.getState().getDraft('mem_a', 'r')?.text).toBe('keep');

    useSessionStore.setState({ member: member('mem_b') });
    expect(store.getState().drafts).toEqual({});
    expect(store.getState().recentEmoji).toEqual([]);

    store.getState().setDraft('mem_b', 'r', { text: 'again' });
    useSessionStore.setState({ token: null, member: null });
    expect(store.getState().drafts).toEqual({});
  });
});
