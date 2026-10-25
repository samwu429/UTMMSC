import { describe, expect, it } from 'vitest';
import { nextRowIndex } from './listKeyboard';

describe('list keys', () => {
  it('moves one row at a time and stops at the ends', () => {
    expect(nextRowIndex(3, 0, 'ArrowDown')).toBe(1);
    expect(nextRowIndex(3, 2, 'ArrowDown')).toBe(2);
    expect(nextRowIndex(3, 2, 'ArrowUp')).toBe(1);
    expect(nextRowIndex(3, 0, 'ArrowUp')).toBe(0);
  });

  it('enters the list from the search field with the first row', () => {
    expect(nextRowIndex(3, -1, 'ArrowDown')).toBe(0);
    expect(nextRowIndex(3, -1, 'ArrowUp')).toBe(0);
  });

  it('jumps to the ends, and has nowhere to go in an empty list', () => {
    expect(nextRowIndex(5, 2, 'Home')).toBe(0);
    expect(nextRowIndex(5, 2, 'End')).toBe(4);
    expect(nextRowIndex(0, -1, 'ArrowDown')).toBe(-1);
    expect(nextRowIndex(0, -1, 'End')).toBe(-1);
  });
});
