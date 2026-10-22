import { describe, expect, it } from 'vitest';
import { OverlayHistory, type HistoryPort } from './overlayHistory';

/** A session history whose traversals land later, as in browsers, with one popstate each. */
/** 模拟的会话历史：与浏览器一样，跳转稍后才完成，每次跳转触发一次 popstate。 */
class FakeHistory {
  stack: unknown[];
  index = 0;
  traversals: number[] = [];
  private queued: number[] = [];
  private tasks: (() => void)[] = [];
  private listeners: (() => void)[] = [];

  constructor(initial: unknown = { idx: 0, key: 'room' }) {
    this.stack = [initial];
  }

  readonly port: HistoryPort = {
    readState: () => this.stack[this.index],
    pushState: (state) => this.push(state),
    go: (delta) => {
      this.traversals.push(delta);
      this.queued.push(delta);
    },
    onPop: (listener) => {
      this.listeners.push(listener);
    },
    later: (task) => {
      this.tasks.push(task);
    },
  };

  push(state: unknown): void {
    this.stack = [...this.stack.slice(0, this.index + 1), state];
    this.index = this.stack.length - 1;
  }

  /** The member's back gesture. */
  /** 成员的返回手势。 */
  back(): void {
    this.queued.push(-1);
    this.settle();
  }

  settle(): void {
    for (;;) {
      const task = this.tasks.shift();
      if (task) {
        task();
        continue;
      }
      const delta = this.queued.shift();
      if (delta === undefined) return;
      this.index = Math.max(0, Math.min(this.stack.length - 1, this.index + delta));
      for (const listener of this.listeners) listener();
    }
  }
}

function setup(initial?: unknown) {
  const history = new FakeHistory(initial);
  const overlays = new OverlayHistory(history.port, 'page');
  const closed: string[] = [];
  const open = (name: string) => overlays.open(() => closed.push(name));
  return { history, open, closed };
}

describe('OverlayHistory', () => {
  it('gives each overlay an entry that keeps the router state, and back closes the top one', () => {
    const { history, open, closed } = setup();
    open('viewer');
    history.settle();
    open('sheet');
    history.settle();
    expect(history.stack).toHaveLength(3);
    expect(history.stack[1]).toMatchObject({ idx: 0, key: 'room' });
    history.back();
    expect(closed).toEqual(['sheet']);
    history.back();
    expect(closed).toEqual(['sheet', 'viewer']);
    expect(history.index).toBe(0);
  });

  it('pops its own entry when the overlay closes by its own controls', () => {
    const { history, open, closed } = setup();
    const release = open('viewer');
    history.settle();
    release();
    history.settle();
    expect(history.index).toBe(0);
    expect(history.traversals).toEqual([-1]);
    expect(closed).toEqual([]);
  });

  it('pushes nothing for an overlay mounted and unmounted in the same task', () => {
    const { history, open } = setup();
    const first = open('picker');
    first();
    open('picker');
    history.settle();
    expect(history.stack).toHaveLength(2);
    expect(history.traversals).toEqual([]);
  });

  it('keeps the entry when the overlay navigates away, then skips it on the way back', () => {
    const { history, open, closed } = setup();
    const release = open('sheet');
    history.settle();
    release();
    history.push({ idx: 1, key: 'profile' });
    history.settle();
    expect(history.index).toBe(2);
    expect(history.traversals).toEqual([]);
    history.back();
    expect(history.index).toBe(0);
    expect(closed).toEqual([]);
  });

  it('waits for its own traversal before pushing the next overlay', () => {
    const { history, open } = setup();
    const release = open('sheet');
    history.settle();
    release();
    open('confirm');
    history.settle();
    expect(history.stack).toHaveLength(2);
    expect(history.index).toBe(1);
  });

  it('pops several closed entries in one traversal', () => {
    const { history, open } = setup();
    const viewer = open('viewer');
    history.settle();
    const sheet = open('sheet');
    history.settle();
    viewer();
    sheet();
    history.settle();
    expect(history.traversals).toEqual([-2]);
    expect(history.index).toBe(0);
  });

  it('ignores marks left by an earlier page load', () => {
    const { history, open, closed } = setup({ idx: 0, key: 'room', wxOverlay: { page: 'earlier', id: 9 } });
    open('viewer');
    history.settle();
    history.back();
    expect(closed).toEqual(['viewer']);
  });
});
