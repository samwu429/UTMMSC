import { describe, expect, it } from 'vitest';
import { ALIGN_MARGIN_PX, SETTLE_MAX_MS, alignDelta, startSettle, stepSettle, visibleBand, type SettleState, type ViewportFacts } from './align';

describe('visibleBand', () => {
  it('leaves out the header at the top and the bar at the bottom', () => {
    expect(visibleBand({ offsetTop: 0, height: 800 }, 44, 56)).toEqual({ top: 44, bottom: 744 });
  });

  it('follows the iPhone visual viewport down the layout viewport while the keyboard is up', () => {
    // A 844px layout viewport with a 336px keyboard: the visible 508px start 120px down after iOS panned.
    // 布局视口 844px、键盘 336px：iOS 平移后，可见的 508px 从 120px 处开始。
    expect(visibleBand({ offsetTop: 120, height: 508 }, 47 + 44, 56)).toEqual({ top: 211, bottom: 572 });
  });

  it('matches the Android shape, where only the height shrinks', () => {
    expect(visibleBand({ offsetTop: 0, height: 480 }, 24 + 44, 60)).toEqual({ top: 68, bottom: 420 });
  });
});

describe('alignDelta', () => {
  const visible = { top: 100, bottom: 600 };

  it('raises a target below the band until its bottom is 8px above the bar', () => {
    expect(alignDelta({ top: 560, bottom: 650 }, visible)).toBe(650 - (600 - ALIGN_MARGIN_PX));
    expect(alignDelta({ top: 900, bottom: 960 }, visible)).toBe(368);
  });

  it('brings down a target above the band until its top is 8px under the header', () => {
    expect(alignDelta({ top: 60, bottom: 160 }, visible)).toBe(60 - (100 + ALIGN_MARGIN_PX));
    expect(alignDelta({ top: -300, bottom: -200 }, visible)).toBe(-408);
  });

  it('leaves a target that already fits alone', () => {
    expect(alignDelta({ top: 108, bottom: 592 }, visible)).toBe(0);
    expect(alignDelta({ top: 300, bottom: 400 }, visible)).toBe(0);
  });

  it('aligns the bottom of a target taller than the band, in either direction', () => {
    expect(alignDelta({ top: 50, bottom: 900 }, visible)).toBe(900 - 592);
    expect(alignDelta({ top: -800, bottom: 300 }, visible)).toBe(300 - 592);
    expect(alignDelta({ top: 0, bottom: 592 }, visible)).toBe(0);
  });

  it('works on the iPhone band with the keyboard up', () => {
    const band = visibleBand({ offsetTop: 120, height: 508 }, 91, 56);
    // The InteractionBox at 600-680 in the layout viewport sits under the keyboard; it rises 116px.
    // 布局视口中位于 600-680 的赞和评论区被键盘挡住；它上移 116px。
    expect(alignDelta({ top: 600, bottom: 680 }, band)).toBe(680 - (572 - 8));
    expect(alignDelta({ top: 300, bottom: 380 }, band)).toBe(0);
  });

  it('takes a custom margin', () => {
    expect(alignDelta({ top: 300, bottom: 600 }, visible, 0)).toBe(0);
    expect(alignDelta({ top: 300, bottom: 600 }, visible, 20)).toBe(20);
  });
});

describe('settling', () => {
  function run(state: SettleState, frames: ViewportFacts[], start: number, frameMs = 16): { settledAt: number | null } {
    let current = state;
    for (const [index, viewport] of frames.entries()) {
      const step = stepSettle(current, viewport, start + (index + 1) * frameMs);
      current = step.state;
      if (step.settled) return { settledAt: index };
    }
    return { settledAt: null };
  }

  const before = { offsetTop: 0, height: 844 };
  const after = { offsetTop: 120, height: 508 };

  it('settles after two still frames when no move is expected', () => {
    expect(run(startSettle(after, 0, false), [after, after, after], 0)).toEqual({ settledAt: 1 });
  });

  it('waits for the keyboard when it is about to rise', () => {
    const frames = [before, before, before, { offsetTop: 60, height: 640 }, after, after, after];
    expect(run(startSettle(before, 0, true), frames, 0)).toEqual({ settledAt: 6 });
  });

  it('starts counting again whenever the viewport moves', () => {
    const frames = [after, { offsetTop: 120, height: 470 }, after, after, after];
    expect(run(startSettle(after, 0, false), frames, 0)).toEqual({ settledAt: 4 });
  });

  it('ignores sub-pixel jitter', () => {
    expect(run(startSettle(after, 0, false), [{ offsetTop: 120.2, height: 508.3 }, after], 0)).toEqual({ settledAt: 1 });
  });

  it('gives up waiting after 450 ms', () => {
    const state = startSettle(before, 1000, true);
    expect(stepSettle(state, before, 1000 + SETTLE_MAX_MS - 1).settled).toBe(false);
    expect(stepSettle(state, before, 1000 + SETTLE_MAX_MS).settled).toBe(true);
  });
});
