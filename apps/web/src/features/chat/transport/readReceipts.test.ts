import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { READ_FLUSH_MS, ReadReceipts } from './readReceipts';

function harness(open = { value: true }) {
  const sent: number[] = [];
  const reads = new ReadReceipts((id) => {
    if (!open.value) return false;
    sent.push(id);
    return true;
  });
  return { reads, sent, open };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 24, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReadReceipts', () => {
  it('sends the first read at once, then at most one per second with the newest id', () => {
    const { reads, sent } = harness();
    reads.mark(10);
    expect(sent).toEqual([10]);
    for (let id = 11; id <= 15; id += 1) {
      vi.advanceTimersByTime(150);
      reads.mark(id);
    }
    expect(sent).toEqual([10]);
    vi.advanceTimersByTime(READ_FLUSH_MS - 750);
    expect(sent).toEqual([10, 15]);
    vi.advanceTimersByTime(5 * READ_FLUSH_MS);
    expect(sent).toEqual([10, 15]);
    expect(reads.sent).toBe(15);
  });

  it('turns a busy minute of messages into at most one write a second', () => {
    const { reads, sent } = harness();
    // A message every 250ms for a minute, each marked read as it shows.
    // 一分钟内每 250 毫秒一条消息，每条显示时都标为已读。
    for (let id = 1; id <= 240; id += 1) {
      reads.mark(id);
      vi.advanceTimersByTime(250);
    }
    vi.advanceTimersByTime(READ_FLUSH_MS);
    expect(sent.length).toBeLessThanOrEqual(61);
    expect(sent.at(-1)).toBe(240);
    expect([...sent].sort((a, b) => a - b)).toEqual(sent);
  });

  it('never repeats or goes back to an id the server has', () => {
    const { reads, sent } = harness();
    reads.reset(50);
    reads.mark(40);
    reads.mark(50);
    vi.advanceTimersByTime(5 * READ_FLUSH_MS);
    expect(sent).toEqual([]);
    reads.mark(51);
    expect(sent).toEqual([51]);
  });

  it('sends what is waiting at once when flushed, as when the page hides or the room closes', () => {
    const { reads, sent } = harness();
    reads.mark(1);
    reads.mark(2);
    expect(reads.flush()).toBe(2);
    expect(sent).toEqual([1, 2]);
    expect(reads.flush()).toBeNull();
    vi.advanceTimersByTime(5 * READ_FLUSH_MS);
    expect(sent).toEqual([1, 2]);
  });

  it('keeps a read the closed socket could not take, and sends it again after a reconnect', () => {
    const { reads, sent, open } = harness();
    open.value = false;
    reads.mark(7);
    expect(sent).toEqual([]);
    expect(reads.flush()).toBeNull();
    open.value = true;
    // The new socket's ready frame says the server only has 3.
    // 新连接的 ready 帧说明服务端只有 3。
    reads.reset(3);
    reads.mark(7);
    expect(sent).toEqual([7]);
  });

  it('goes again when a read was lost with the old socket', () => {
    const { reads, sent } = harness();
    reads.mark(9);
    reads.reset(5);
    vi.advanceTimersByTime(READ_FLUSH_MS);
    reads.mark(9);
    expect(sent).toEqual([9, 9]);
  });

  it('can cancel the timer without losing what waits', () => {
    const { reads, sent } = harness();
    reads.mark(1);
    reads.mark(2);
    reads.cancelTimer();
    vi.advanceTimersByTime(5 * READ_FLUSH_MS);
    expect(sent).toEqual([1]);
    expect(reads.flush()).toBe(2);
  });
});
