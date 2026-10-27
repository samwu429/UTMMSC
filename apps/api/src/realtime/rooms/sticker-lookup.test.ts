import { afterEach, describe, expect, it, vi } from 'vitest';
import { STICKER_LOOKUP_TIMEOUT_MS, STICKER_LOOKUP_TTL_MS, StickerLookup, type StickerDescription } from './sticker-lookup';

const id = (n: number) => `stk_${String(n).padStart(22, '0')}`;
const describeSticker = (stickerId: string): StickerDescription => ({ id: stickerId, type: 'gif', width: 240, height: 240, animated: true, bytes: 182044 });

function setup(known: readonly string[], options: { max?: number } = {}) {
  let now = 1_000_000;
  const loads: string[] = [];
  const loader = vi.fn(async (stickerId: string) => {
    loads.push(stickerId);
    return known.includes(stickerId) ? describeSticker(stickerId) : null;
  });
  const lookup = new StickerLookup(loader, { now: () => now, ...options });
  return { lookup, loader, loads, advance: (ms: number) => (now += ms) };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('StickerLookup', () => {
  afterEach(() => vi.useRealTimers());

  it('answers a hit synchronously from peek, after one load', async () => {
    const { lookup, loads } = setup([id(1)]);
    expect(lookup.peek(id(1))).toBeUndefined();
    expect(await lookup.load(id(1))).toEqual(describeSticker(id(1)));
    expect(lookup.peek(id(1))).toEqual(describeSticker(id(1)));
    expect(await lookup.load(id(1))).toEqual(describeSticker(id(1)));
    expect(loads).toEqual([id(1)]);
  });

  it('lets an entry expire after ten minutes, so a block reaches the room', async () => {
    const { lookup, loads, advance } = setup([id(1)]);
    await lookup.load(id(1));
    advance(STICKER_LOOKUP_TTL_MS - 1);
    expect(lookup.peek(id(1))).toBeDefined();
    advance(1);
    expect(lookup.peek(id(1))).toBeUndefined();
    await lookup.load(id(1));
    expect(loads).toEqual([id(1), id(1)]);
  });

  it('never caches a miss', async () => {
    const { lookup, loads } = setup([]);
    expect(await lookup.load(id(2))).toBeNull();
    expect(lookup.peek(id(2))).toBeUndefined();
    expect(await lookup.load(id(2))).toBeNull();
    expect(loads).toEqual([id(2), id(2)]);
  });

  it('shares one call between concurrent loads of one id, and calls again once it settled', async () => {
    const { lookup, loader } = setup([id(1)]);
    const held = deferred<StickerDescription | null>();
    loader.mockImplementationOnce(() => held.promise);
    const first = lookup.load(id(1));
    const second = lookup.load(id(1));
    expect(second).toBe(first);
    held.resolve(null);
    expect(await first).toBeNull();
    expect(await lookup.load(id(1))).toEqual(describeSticker(id(1)));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('gives unavailable when the loader fails, and tries again next time', async () => {
    const { lookup, loader } = setup([id(1)]);
    loader.mockRejectedValueOnce(new Error('D1_ERROR: no such table: sticker_objects'));
    expect(await lookup.load(id(1))).toBe('unavailable');
    expect(lookup.peek(id(1))).toBeUndefined();
    expect(await lookup.load(id(1))).toEqual(describeSticker(id(1)));
  });

  it('gives unavailable when the loader throws before returning a promise', async () => {
    const lookup = new StickerLookup(() => {
      throw new Error('binding missing');
    });
    expect(await lookup.load(id(1))).toBe('unavailable');
  });

  it('gives up after five seconds, lets the next load try again, and keeps a late answer', async () => {
    vi.useFakeTimers();
    const { lookup, loader } = setup([id(1)]);
    const held = deferred<StickerDescription | null>();
    loader.mockImplementationOnce(() => held.promise);
    const pending = lookup.load(id(1));
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(STICKER_LOOKUP_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('unavailable');

    const again = deferred<StickerDescription | null>();
    loader.mockImplementationOnce(() => again.promise);
    const retry = lookup.load(id(1));
    expect(retry).not.toBe(pending);
    expect(loader).toHaveBeenCalledTimes(2);

    held.resolve(describeSticker(id(1)));
    await Promise.resolve();
    expect(lookup.peek(id(1))).toEqual(describeSticker(id(1)));
    again.resolve(describeSticker(id(1)));
    expect(await retry).toEqual(describeSticker(id(1)));
  });

  it('keeps at most `max` descriptions, dropping the least recently used', async () => {
    const { lookup, loads } = setup([id(1), id(2), id(3)], { max: 2 });
    await lookup.load(id(1));
    await lookup.load(id(2));
    // Using the first one makes the second the least recently used.
    // 使用第一个之后，第二个就成了最久未使用的。
    expect(lookup.peek(id(1))).toBeDefined();
    await lookup.load(id(3));
    expect(lookup.size).toBe(2);
    expect(lookup.peek(id(1))).toBeDefined();
    expect(lookup.peek(id(3))).toBeDefined();
    expect(lookup.peek(id(2))).toBeUndefined();
    expect(loads).toEqual([id(1), id(2), id(3)]);
  });
});
