import { describe, expect, it } from 'vitest';
import { createMinuteClock, type ClockPort } from './minuteClock';

function fakePort(start: number) {
  let now = start;
  let visible = true;
  const timers = new Map<number, { at: number; task: () => void }>();
  const visibilityListeners = new Set<() => void>();
  let seq = 0;
  const port: ClockPort = {
    now: () => now,
    setTimer: (task, ms) => {
      seq += 1;
      timers.set(seq, { at: now + ms, task });
      return seq;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    visible: () => visible,
    onVisibility: (listener) => {
      visibilityListeners.add(listener);
      return () => visibilityListeners.delete(listener);
    },
  };
  return {
    port,
    timers,
    /** Moves time on, running timers that come due. */
    /** 推进时间，并运行到期的计时器。 */
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].task();
      }
      now = end;
    },
    setVisible(value: boolean) {
      visible = value;
      for (const listener of visibilityListeners) listener();
    },
    listeners: visibilityListeners,
  };
}

const T0 = Date.parse('2026-10-19T14:00:30.000Z');

describe('createMinuteClock', () => {
  it('ticks just after each whole minute and keeps a stable value in between', () => {
    const fake = fakePort(T0);
    const clock = createMinuteClock(fake.port);
    let ticks = 0;
    clock.subscribe(() => (ticks += 1));
    const first = clock.getSnapshot();
    fake.advance(29_000);
    expect(ticks).toBe(0);
    expect(clock.getSnapshot()).toBe(first);
    fake.advance(1_100);
    expect(ticks).toBe(1);
    expect(Math.floor(clock.getSnapshot() / 60_000)).toBe(Math.floor(T0 / 60_000) + 1);
    fake.advance(60_000);
    expect(ticks).toBe(2);
  });

  it('stops while hidden and catches up when shown', () => {
    const fake = fakePort(T0);
    const clock = createMinuteClock(fake.port);
    let ticks = 0;
    clock.subscribe(() => (ticks += 1));
    fake.setVisible(false);
    expect(fake.timers.size).toBe(0);
    fake.advance(5 * 60_000);
    expect(ticks).toBe(0);
    fake.setVisible(true);
    expect(ticks).toBe(1);
    expect(fake.timers.size).toBe(1);
  });

  it('runs nothing once the last listener leaves', () => {
    const fake = fakePort(T0);
    const clock = createMinuteClock(fake.port);
    const stop = clock.subscribe(() => undefined);
    expect(fake.timers.size).toBe(1);
    expect(fake.listeners.size).toBe(1);
    stop();
    expect(fake.timers.size).toBe(0);
    expect(fake.listeners.size).toBe(0);
    fake.advance(120_000);
    expect(clock.getSnapshot()).toBe(T0 + 120_000);
  });
});
