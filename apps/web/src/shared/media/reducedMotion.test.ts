import { afterEach, describe, expect, it, vi } from 'vitest';

/** A media query list stand-in whose answer the test flips. */
/** 媒体查询替身，由测试切换其结果。 */
function fakeQuery(matches: boolean, legacy = false) {
  const handlers = new Set<() => void>();
  const list = {
    matches,
    added: 0,
    addEventListener: legacy ? undefined : (_type: string, handler: () => void) => (list.added++, handlers.add(handler)),
    removeEventListener: legacy ? undefined : (_type: string, handler: () => void) => handlers.delete(handler),
    addListener: (handler: () => void) => (list.added++, handlers.add(handler)),
    removeListener: (handler: () => void) => handlers.delete(handler),
    flip(next: boolean) {
      list.matches = next;
      for (const handler of handlers) handler();
    },
    handlers,
  };
  const matchMedia = vi.fn(() => list);
  vi.stubGlobal('window', { matchMedia });
  return { list, matchMedia };
}

async function load() {
  vi.resetModules();
  return import('./reducedMotion');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reduced motion', () => {
  it('reads false where there is no matchMedia', async () => {
    vi.stubGlobal('window', {});
    const { prefersReducedMotion, subscribeReducedMotion } = await load();
    expect(prefersReducedMotion()).toBe(false);
    expect(() => subscribeReducedMotion(() => undefined)()).not.toThrow();
  });

  it('asks the system once and shares one listener among every avatar', async () => {
    const { list, matchMedia } = fakeQuery(false);
    const { prefersReducedMotion, subscribeReducedMotion } = await load();
    const seen: boolean[] = [];
    const stops = Array.from({ length: 50 }, () => subscribeReducedMotion(() => seen.push(prefersReducedMotion())));
    expect(prefersReducedMotion()).toBe(false);
    expect(matchMedia).toHaveBeenCalledTimes(1);
    expect(list.added).toBe(1);
    list.flip(true);
    expect(seen).toHaveLength(50);
    expect(seen.every(Boolean)).toBe(true);
    for (const stop of stops) stop();
    expect(list.handlers.size).toBe(0);
  });

  it('uses the older listener API of Safari before 14', async () => {
    const { list } = fakeQuery(true, true);
    const { prefersReducedMotion, subscribeReducedMotion } = await load();
    const onChange = vi.fn();
    const stop = subscribeReducedMotion(onChange);
    expect(prefersReducedMotion()).toBe(true);
    list.flip(false);
    expect(onChange).toHaveBeenCalledTimes(1);
    stop();
    expect(list.handlers.size).toBe(0);
  });
});
