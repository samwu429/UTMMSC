/**
 * Owner: T3, timetable web core. One minute ticker shared by every countdown and now line: it fires just after each
 * :00, stops while the page is hidden, and catches up at once when the page is shown again. Nothing runs while no
 * screen listens.
 * 维护者：T3，课表网页核心。所有倒计时和当前时间线共用的一个分钟计时器：在每个整分钟刚过时触发，页面隐藏时停止，
 * 页面重新显示时立即补上。没有页面监听时什么也不运行。
 */

const MINUTE_MS = 60_000;
/** Fires this long after the minute, so the new minute has surely begun on every clock. */
/** 在整分钟之后这么久触发，确保每个时钟上新的一分钟都已开始。 */
const AFTER_MINUTE_MS = 25;

export interface ClockPort {
  now(): number;
  setTimer(task: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  visible(): boolean;
  /** Calls back when visibility changes; returns the unsubscribe. */
  /** 可见性变化时回调；返回取消订阅函数。 */
  onVisibility(listener: () => void): () => void;
}

export interface MinuteClock {
  subscribe(listener: () => void): () => void;
  /** The instant of the last tick, or of now when nothing listens; stable within a minute. */
  /** 上一次跳动的时刻；没有监听时为现在；在同一分钟内保持不变。 */
  getSnapshot(): number;
}

export function createMinuteClock(port: ClockPort): MinuteClock {
  const listeners = new Set<() => void>();
  let value = port.now();
  let timer: unknown = null;
  let stopVisibility: (() => void) | null = null;

  const minuteOf = (ms: number) => Math.floor(ms / MINUTE_MS);

  function emit() {
    for (const listener of [...listeners]) listener();
  }

  function stopTimer() {
    if (timer !== null) port.clearTimer(timer);
    timer = null;
  }

  function schedule() {
    stopTimer();
    const now = port.now();
    timer = port.setTimer(tick, MINUTE_MS - (now % MINUTE_MS) + AFTER_MINUTE_MS);
  }

  function update() {
    const now = port.now();
    if (minuteOf(now) === minuteOf(value)) return false;
    value = now;
    return true;
  }

  function tick() {
    timer = null;
    if (update()) emit();
    if (listeners.size > 0 && port.visible()) schedule();
  }

  function onVisibility() {
    if (!port.visible()) {
      stopTimer();
      return;
    }
    if (update()) emit();
    schedule();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        update();
        stopVisibility = port.onVisibility(onVisibility);
        if (port.visible()) schedule();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stopTimer();
        stopVisibility?.();
        stopVisibility = null;
      };
    },
    getSnapshot() {
      if (listeners.size === 0) update();
      return value;
    },
  };
}
