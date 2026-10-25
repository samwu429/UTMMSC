import { describe, expect, it, vi } from 'vitest';
import type { AuthorCard } from '../../infrastructure/d1/members';
import { AUTHOR_CACHE_TTL_MS, AuthorCache } from './author-cache';

function setup(cards: Record<string, AuthorCard>, options: { max?: number } = {}) {
  let now = 1_000_000;
  const loads: string[][] = [];
  const load = vi.fn(async (ids: string[]) => {
    loads.push([...ids]);
    return new Map(ids.flatMap((id) => (cards[id] ? [[id, { ...cards[id] }] as const] : [])));
  });
  const cache = new AuthorCache(load, { now: () => now, ...options });
  return { cache, loads, load, advance: (ms: number) => (now += ms) };
}

const ann: AuthorCard = { displayName: 'Ann', avatarKey: 'avatar/mem_a/x.jpg' };
const bob: AuthorCard = { displayName: 'Bob', avatarKey: null };

describe('AuthorCache', () => {
  it('reads D1 once for the authors of a page, then serves them from memory', async () => {
    const { cache, loads } = setup({ mem_a: ann, mem_b: bob });
    expect(await cache.cards(['mem_a', 'mem_b', 'mem_a'])).toEqual(new Map([['mem_a', ann], ['mem_b', bob]]));
    expect(await cache.cards(['mem_b', 'mem_a'])).toEqual(new Map([['mem_b', bob], ['mem_a', ann]]));
    expect(loads).toEqual([['mem_a', 'mem_b']]);
  });

  it('reads only the authors it has not seen', async () => {
    const { cache, loads } = setup({ mem_a: ann, mem_b: bob });
    await cache.cards(['mem_a']);
    await cache.cards(['mem_a', 'mem_b']);
    expect(loads).toEqual([['mem_a'], ['mem_b']]);
  });

  it('reads again after five minutes', async () => {
    const { cache, loads, advance } = setup({ mem_a: ann });
    await cache.cards(['mem_a']);
    advance(AUTHOR_CACHE_TTL_MS - 1);
    await cache.cards(['mem_a']);
    expect(loads).toHaveLength(1);
    advance(1);
    await cache.cards(['mem_a']);
    expect(loads).toHaveLength(2);
  });

  it('remembers that a member is gone, so the stored name is used without asking again', async () => {
    const { cache, loads } = setup({});
    expect(await cache.cards(['mem_gone'])).toEqual(new Map());
    expect(await cache.cards(['mem_gone'])).toEqual(new Map());
    expect(loads).toHaveLength(1);
  });

  it('takes a refresh at once and keeps it over a read that started before it', async () => {
    const { cache, load, loads } = setup({ mem_a: ann });
    cache.put('mem_b', { displayName: 'Bobby', avatarKey: 'avatar/mem_b/new.jpg' });
    expect(await cache.cards(['mem_b'])).toEqual(new Map([['mem_b', { displayName: 'Bobby', avatarKey: 'avatar/mem_b/new.jpg' }]]));
    expect(loads).toEqual([]);

    let release: (cards: Map<string, AuthorCard>) => void = () => undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const pending = cache.cards(['mem_a']);
    cache.put('mem_a', { displayName: 'Annie', avatarKey: null });
    release(new Map([['mem_a', ann]]));
    expect((await pending).get('mem_a')).toEqual({ displayName: 'Annie', avatarKey: null });
    expect((await cache.cards(['mem_a'])).get('mem_a')).toEqual({ displayName: 'Annie', avatarKey: null });
  });

  it('uses what it still holds when D1 fails, however old, and leaves out the rest', async () => {
    const { cache, load, advance } = setup({ mem_a: ann });
    await cache.cards(['mem_a']);
    advance(AUTHOR_CACHE_TTL_MS * 3);
    load.mockRejectedValueOnce(new Error('D1 unavailable'));
    expect(await cache.cards(['mem_a', 'mem_b'])).toEqual(new Map([['mem_a', ann]]));
  });

  it('keeps at most `max` authors, dropping the oldest first', async () => {
    const { cache, loads } = setup({ mem_a: ann, mem_b: bob, mem_c: { displayName: 'Cy', avatarKey: null } }, { max: 2 });
    await cache.cards(['mem_a']);
    await cache.cards(['mem_b']);
    await cache.cards(['mem_c']);
    expect(cache.size).toBe(2);
    await cache.cards(['mem_b', 'mem_c']);
    expect(loads).toHaveLength(3);
    await cache.cards(['mem_a']);
    expect(loads).toHaveLength(4);
  });
});
