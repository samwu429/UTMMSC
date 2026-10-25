import { describe, expect, it } from 'vitest';
import { IDLE_PRELOADS, preloadOneByOne } from './pages';

/** An idle host whose callbacks run only when the test says so. */
/** 一个空闲宿主，它的回调只在测试要求时才运行。 */
function manualHost({ idle = true } = {}) {
  const queue: Array<{ callback: () => void; via: 'idle' | 'timeout'; arg: unknown }> = [];
  const host = {
    requestIdleCallback: idle
      ? (callback: () => void, options?: { timeout: number }) => {
          queue.push({ callback, via: 'idle', arg: options });
          return queue.length;
        }
      : undefined,
    setTimeout: (callback: () => void, ms: number) => {
      queue.push({ callback, via: 'timeout', arg: ms });
      return queue.length;
    },
  };
  return {
    host,
    queue,
    /** Runs the oldest pending callback. */
    runNext() {
      const next = queue.shift();
      next?.callback();
      return next;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const direct = (load: () => Promise<unknown>) => load().catch(() => undefined);

describe('preloadOneByOne', () => {
  it('runs one loader per idle period, in order, each after the previous one finished', async () => {
    const started: string[] = [];
    let finishA: () => void = () => undefined;
    const loaders = [
      () => {
        started.push('a');
        return new Promise<void>((resolve) => (finishA = resolve));
      },
      async () => {
        started.push('b');
      },
      async () => {
        started.push('c');
      },
    ];
    const { host, queue, runNext } = manualHost();
    preloadOneByOne(loaders, host, direct);
    expect(started).toEqual([]);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ via: 'idle', arg: { timeout: 5000 } });
    runNext();
    expect(started).toEqual(['a']);
    await flush();
    // b waits for a, not only for the next idle period.
    // b 要等 a 完成，而不只是等下一个空闲时段。
    expect(queue).toHaveLength(0);
    finishA();
    await flush();
    expect(queue).toHaveLength(1);
    runNext();
    await flush();
    runNext();
    await flush();
    expect(started).toEqual(['a', 'b', 'c']);
    expect(queue).toHaveLength(0);
  });

  it('goes on after a loader fails', async () => {
    const started: string[] = [];
    const loaders = [
      async () => {
        started.push('a');
        throw new Error('offline');
      },
      async () => {
        started.push('b');
      },
    ];
    const { host, runNext } = manualHost();
    preloadOneByOne(loaders, host, direct);
    runNext();
    await flush();
    runNext();
    await flush();
    expect(started).toEqual(['a', 'b']);
  });

  it('falls back to a short timer where there is no requestIdleCallback (Safari)', () => {
    const { host, queue } = manualHost({ idle: false });
    preloadOneByOne([async () => undefined], host, direct);
    expect(queue).toEqual([expect.objectContaining({ via: 'timeout', arg: 200 })]);
  });

  it('stops what has not started yet', async () => {
    const started: string[] = [];
    const loaders = [
      async () => {
        started.push('a');
      },
      async () => {
        started.push('b');
      },
    ];
    const { host, runNext } = manualHost();
    const stop = preloadOneByOne(loaders, host, direct);
    runNext();
    await flush();
    stop();
    runNext();
    await flush();
    expect(started).toEqual(['a']);
  });

  it('does nothing for an empty list', () => {
    const { host, queue } = manualHost();
    preloadOneByOne([], host, direct);
    expect(queue).toHaveLength(0);
  });
});

describe('IDLE_PRELOADS', () => {
  it('preloads a handful of pages, never every page', () => {
    expect(IDLE_PRELOADS.length).toBeGreaterThanOrEqual(2);
    expect(IDLE_PRELOADS.length).toBeLessThanOrEqual(8);
  });
});
