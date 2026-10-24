import { afterEach, describe, expect, it } from 'vitest';
import { LOCATION_MAX, type MemberSelf } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { createSafeStorage } from '../../chat/state/safeStorage';
import type { ComposeBatch } from './composeQueue';
import {
  COMPOSE_DRAFT_PREFIX,
  RECENT_PLACES_PREFIX,
  bindComposeDraftsToSession,
  claimKeptMedia,
  createComposeDrafts,
  draftHasContent,
  dropKeptMedia,
  keepMedia,
  normalizePlace,
  peekKeptMedia,
  withRecentPlace,
} from './drafts';

function memoryBackend() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (name: string) => data.get(name) ?? null,
    setItem: (name: string, value: string) => void data.set(name, value),
    removeItem: (name: string) => void data.delete(name),
  };
}

function setup() {
  const backend = memoryBackend();
  const drafts = createComposeDrafts(createSafeStorage(() => backend), () => new Date('2026-10-24T08:00:00.000Z'));
  return { backend, drafts };
}

/** Just enough of a batch to see whether it was released. */
/** 只实现到能看出是否被释放的批次。 */
function fakeBatch(): ComposeBatch & { released: number } {
  const batch = { released: 0, release: () => void (batch.released += 1) };
  return batch as unknown as ComposeBatch & { released: number };
}

const member = (id: string) => ({ id, displayName: id }) as unknown as MemberSelf;

afterEach(() => {
  dropKeptMedia();
  useSessionStore.setState({ token: null, member: null, mediaToken: null });
});

describe('compose drafts', () => {
  it('keeps text, audience and location per member', () => {
    const { backend, drafts } = setup();
    drafts.save('mem_a', { text: '今天的晚霞', audience: 'club', location: ' 多伦多  大学 ', mediaCount: 3 });
    expect(drafts.load('mem_a')).toEqual({ text: '今天的晚霞', audience: 'club', location: '多伦多 大学', mediaCount: 3, savedAt: '2026-10-24T08:00:00.000Z' });
    expect(drafts.load('mem_b')).toBeNull();
    expect(backend.data.has(`${COMPOSE_DRAFT_PREFIX}mem_a`)).toBe(true);
  });

  it('removes the saved draft when there is nothing worth keeping', () => {
    const { backend, drafts } = setup();
    drafts.save('mem_a', { text: 'hello', audience: 'friends', location: null, mediaCount: 0 });
    drafts.save('mem_a', { text: '   ', audience: 'club', location: 'UTM', mediaCount: 0 });
    expect(drafts.load('mem_a')).toBeNull();
    expect(backend.data.size).toBe(0);
  });

  it('keeps a draft with media but no text, so it can say 照片需要重新选择', () => {
    const { drafts } = setup();
    drafts.save('mem_a', { text: '', audience: 'friends', location: null, mediaCount: 2 });
    expect(drafts.load('mem_a')).toMatchObject({ text: '', mediaCount: 2 });
  });

  it('clears one member without touching another', () => {
    const { drafts } = setup();
    drafts.save('mem_a', { text: 'a', audience: 'friends', location: null, mediaCount: 0 });
    drafts.save('mem_b', { text: 'b', audience: 'friends', location: null, mediaCount: 0 });
    drafts.clear('mem_a');
    expect(drafts.load('mem_a')).toBeNull();
    expect(drafts.load('mem_b')?.text).toBe('b');
  });

  it('repairs or drops broken entries instead of crashing', () => {
    const { backend, drafts } = setup();
    backend.data.set(`${COMPOSE_DRAFT_PREFIX}mem_a`, '{not json');
    expect(drafts.load('mem_a')).toBeNull();
    expect(backend.data.has(`${COMPOSE_DRAFT_PREFIX}mem_a`)).toBe(false);

    backend.data.set(`${COMPOSE_DRAFT_PREFIX}mem_b`, JSON.stringify({ text: 'hi', audience: 'everyone', location: 7, mediaCount: 99 }));
    expect(drafts.load('mem_b')).toEqual({ text: 'hi', audience: 'friends', location: null, mediaCount: 9, savedAt: new Date(0).toISOString() });

    backend.data.set(`${COMPOSE_DRAFT_PREFIX}mem_c`, JSON.stringify({ audience: 'club' }));
    expect(drafts.load('mem_c')).toBeNull();
  });

  it('keeps working when storage throws', () => {
    const fail = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    const drafts = createComposeDrafts(createSafeStorage(() => ({ getItem: fail, setItem: fail, removeItem: fail })));
    expect(() => drafts.save('mem_a', { text: 'x', audience: 'friends', location: null, mediaCount: 0 })).not.toThrow();
    expect(drafts.load('mem_a')).toBeNull();
    expect(drafts.recentPlaces('mem_a')).toEqual([]);
    expect(() => drafts.rememberPlace('mem_a', 'UTM')).not.toThrow();
  });

  it('caps very long text while keeping surrogate pairs whole', () => {
    const { drafts } = setup();
    const text = `${'a'.repeat(7999)}\u{20000}\u{20000}`;
    drafts.save('mem_a', { text, audience: 'friends', location: null, mediaCount: 0 });
    const saved = drafts.load('mem_a')?.text ?? '';
    expect(saved.length).toBe(7999);
    expect(saved.endsWith('a')).toBe(true);
  });

  it('tells content from a bare place or audience', () => {
    expect(draftHasContent({ text: 'x', mediaCount: 0 })).toBe(true);
    expect(draftHasContent({ text: ' \n ', mediaCount: 0 })).toBe(false);
    expect(draftHasContent({ text: '', mediaCount: 1 })).toBe(true);
  });
});

describe('recent places', () => {
  it('normalizes a typed place', () => {
    expect(normalizePlace('  Deerfield\tHall \n 3F ')).toBe('Deerfield Hall 3F');
    expect(normalizePlace('\u200B')).toBe('');
    expect(normalizePlace('长'.repeat(60))).toHaveLength(LOCATION_MAX);
    // A character across the cut is dropped whole.
    // 跨越截断处的字符整个舍去。
    expect(normalizePlace(`${'a'.repeat(LOCATION_MAX - 1)}\u{20000}`)).toBe('a'.repeat(LOCATION_MAX - 1));
  });

  it('puts the newest first, once, and keeps five', () => {
    expect(withRecentPlace(['UTM', 'Robarts'], 'utm')).toEqual(['utm', 'Robarts']);
    expect(withRecentPlace(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd']);
    expect(withRecentPlace(['a'], '   ')).toEqual(['a']);
  });

  it('remembers places per member and survives junk in storage', () => {
    const { backend, drafts } = setup();
    for (const place of ['Robarts', 'UTM', 'Deerfield', 'IB', 'CCT', 'Robarts']) drafts.rememberPlace('mem_a', place);
    expect(drafts.recentPlaces('mem_a')).toEqual(['Robarts', 'CCT', 'IB', 'Deerfield', 'UTM']);
    expect(drafts.recentPlaces('mem_b')).toEqual([]);

    backend.data.set(`${RECENT_PLACES_PREFIX}mem_c`, JSON.stringify(['ok', 3, null, ' ok ', 'two']));
    expect(drafts.recentPlaces('mem_c')).toEqual(['ok', 'two']);
    backend.data.set(`${RECENT_PLACES_PREFIX}mem_d`, '"a string"');
    expect(drafts.recentPlaces('mem_d')).toEqual([]);
  });

  it('forgets the draft and the places together', () => {
    const { backend, drafts } = setup();
    drafts.save('mem_a', { text: 'x', audience: 'friends', location: null, mediaCount: 0 });
    drafts.rememberPlace('mem_a', 'UTM');
    drafts.forget('mem_a');
    expect(backend.data.size).toBe(0);
  });
});

describe('kept media', () => {
  it('holds one batch for its member until claimed', () => {
    const batch = fakeBatch();
    keepMedia('mem_a', batch);
    expect(peekKeptMedia('mem_a')).toBe(batch);
    expect(peekKeptMedia('mem_b')).toBeNull();
    claimKeptMedia(batch);
    expect(peekKeptMedia('mem_a')).toBeNull();
    expect(batch.released).toBe(0);
  });

  it('releases a batch that another one replaces, or that is dropped', () => {
    const first = fakeBatch();
    const second = fakeBatch();
    keepMedia('mem_a', first);
    keepMedia('mem_a', first);
    expect(first.released).toBe(0);
    keepMedia('mem_a', second);
    expect(first.released).toBe(1);
    claimKeptMedia(first);
    expect(peekKeptMedia('mem_a')).toBe(second);
    dropKeptMedia();
    expect(second.released).toBe(1);
    expect(peekKeptMedia('mem_a')).toBeNull();
  });

  it('clears everything of a member who signs out', () => {
    const { backend, drafts } = setup();
    const stop = bindComposeDraftsToSession(drafts);
    useSessionStore.setState({ token: 't', member: member('mem_a') });
    drafts.save('mem_a', { text: 'x', audience: 'friends', location: null, mediaCount: 1 });
    drafts.rememberPlace('mem_a', 'UTM');
    const batch = fakeBatch();
    keepMedia('mem_a', batch);

    useSessionStore.getState().clear();
    expect(batch.released).toBe(1);
    expect(peekKeptMedia('mem_a')).toBeNull();
    expect(backend.data.size).toBe(0);
    stop();
  });

  it('drops the media of the member signed in before when another signs in', () => {
    const { drafts } = setup();
    const stop = bindComposeDraftsToSession(drafts);
    useSessionStore.setState({ token: 't', member: member('mem_a') });
    const batch = fakeBatch();
    keepMedia('mem_a', batch);
    useSessionStore.setState({ token: 't2', member: member('mem_b') });
    expect(batch.released).toBe(1);
    // A refresh of the same member keeps everything.
    // 同一成员的资料刷新不会清除任何内容。
    const again = fakeBatch();
    keepMedia('mem_b', again);
    useSessionStore.setState({ member: member('mem_b') });
    expect(again.released).toBe(0);
    stop();
  });
});
