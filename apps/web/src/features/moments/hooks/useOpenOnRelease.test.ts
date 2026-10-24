import { describe, expect, it } from 'vitest';
import { RELEASE_EVENTS, callOnRelease } from './useOpenOnRelease';

describe('callOnRelease', () => {
  it('calls once, on the first event that ends the press', () => {
    for (const type of RELEASE_EVENTS) {
      const target = new EventTarget();
      let calls = 0;
      callOnRelease(target, () => {
        calls += 1;
      });
      expect(calls).toBe(0);
      target.dispatchEvent(new Event(type));
      expect(calls).toBe(1);
      // The other release events of the same lift are not a second opening.
      // 同一次松开产生的其他结束事件不会再打开一次。
      for (const other of RELEASE_EVENTS) target.dispatchEvent(new Event(other));
      expect(calls).toBe(1);
    }
  });

  it('ignores what does not end a press', () => {
    const target = new EventTarget();
    let calls = 0;
    callOnRelease(target, () => {
      calls += 1;
    });
    for (const type of ['pointerdown', 'pointermove', 'touchstart', 'click']) target.dispatchEvent(new Event(type));
    expect(calls).toBe(0);
  });

  it('stops waiting when detached', () => {
    const target = new EventTarget();
    let calls = 0;
    const detach = callOnRelease(target, () => {
      calls += 1;
    });
    detach();
    target.dispatchEvent(new Event('pointerup'));
    expect(calls).toBe(0);
  });
});
