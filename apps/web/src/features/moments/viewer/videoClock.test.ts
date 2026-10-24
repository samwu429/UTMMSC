import { describe, expect, it } from 'vitest';
import { formatVideoClock } from './videoClock';

describe('formatVideoClock', () => {
  it('shows minutes and two-digit seconds', () => {
    expect(formatVideoClock(15_000)).toBe('0:15');
    expect(formatVideoClock(65_000)).toBe('1:05');
    expect(formatVideoClock(600_000)).toBe('10:00');
  });

  it('adds hours with two-digit minutes past an hour', () => {
    expect(formatVideoClock(3_723_000)).toBe('1:02:03');
    expect(formatVideoClock(3_600_000)).toBe('1:00:00');
    expect(formatVideoClock(36_000_000 + 59_000)).toBe('10:00:59');
  });

  it('rounds to the nearest second', () => {
    expect(formatVideoClock(14_499)).toBe('0:14');
    expect(formatVideoClock(14_500)).toBe('0:15');
    expect(formatVideoClock(59_600)).toBe('1:00');
  });

  it('never shows a short clip as empty', () => {
    expect(formatVideoClock(0)).toBe('0:00');
    expect(formatVideoClock(1)).toBe('0:01');
    expect(formatVideoClock(400)).toBe('0:01');
  });

  it('gives null for a missing or invalid duration', () => {
    expect(formatVideoClock(null)).toBeNull();
    expect(formatVideoClock(undefined)).toBeNull();
    expect(formatVideoClock(Number.NaN)).toBeNull();
    expect(formatVideoClock(Number.POSITIVE_INFINITY)).toBeNull();
    expect(formatVideoClock(-1)).toBeNull();
  });
});
