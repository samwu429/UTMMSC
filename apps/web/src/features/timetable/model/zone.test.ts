import { describe, expect, it } from 'vitest';
import { deviceDiffersFromToronto, torontoOffsetMin } from './zone';

describe('torontoOffsetMin', () => {
  it('follows daylight saving', () => {
    expect(torontoOffsetMin(Date.parse('2026-10-21T16:00:00Z'))).toBe(-240);
    expect(torontoOffsetMin(Date.parse('2026-11-02T16:00:00Z'))).toBe(-300);
    expect(torontoOffsetMin(Date.parse('2026-10-21T16:00:42.500Z'))).toBe(-240);
  });
});

describe('deviceDiffersFromToronto', () => {
  it('is false for a device on Toronto time and true for Beijing or Vancouver', () => {
    const now = Date.parse('2026-10-21T16:00:00Z');
    expect(deviceDiffersFromToronto(now, -240)).toBe(false);
    expect(deviceDiffersFromToronto(now, 480)).toBe(true);
    expect(deviceDiffersFromToronto(now, -420)).toBe(true);
  });
});
