import { describe, expect, it } from 'vitest';
import { createSlotLimiter } from './translate';

describe('createSlotLimiter', () => {
  it('resets after the window', () => {
    const take = createSlotLimiter(2, 1_000);
    expect(take(0)).toBe(true);
    expect(take(10)).toBe(true);
    expect(take(20)).toBe(false);
    expect(take(1_000)).toBe(true);
  });
});
