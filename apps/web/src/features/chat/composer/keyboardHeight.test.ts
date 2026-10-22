import { describe, expect, it } from 'vitest';
import { KEYBOARD_VAR, besideKeyboard } from './keyboardHeight';

describe('besideKeyboard', () => {
  it('sizes the space by what the keyboard does not cover, never below zero', () => {
    expect(besideKeyboard(300)).toBe(`max(0px, calc(300px - var(${KEYBOARD_VAR}, 0px)))`);
    expect(besideKeyboard(259.6)).toBe(`max(0px, calc(260px - var(${KEYBOARD_VAR}, 0px)))`);
    expect(besideKeyboard(-5)).toBe(`max(0px, calc(0px - var(${KEYBOARD_VAR}, 0px)))`);
  });
});
