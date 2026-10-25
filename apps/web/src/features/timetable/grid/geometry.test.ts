import { describe, expect, it } from 'vitest';
import {
  endForDuration,
  hourHeightPx,
  hoursFromTop,
  isCompactWindow,
  lockAxis,
  releaseVelocity,
  slotStartAt,
  startsAtEdge,
  swipeTarget,
} from './geometry';

describe('hourHeightPx', () => {
  it('fits 09:00-21:00 on a 390x844 phone at about 53 px an hour', () => {
    expect(hourHeightPx(844, 47, 34)).toBeCloseTo(53.17, 2);
  });

  it('scrolls by a few pixels at most on an iPhone SE', () => {
    // 667 - 20 - 124 - 1 = 522, over 12 hours: 43.5 px, so the 44 px floor scrolls by 6 px at most.
    // 667 - 20 - 124 - 1 = 522，分成 12 小时为 43.5 px，44 px 的下限最多只多出 6 px 的滚动。
    expect(hourHeightPx(667, 20, 0)).toBe(44);
    expect(hourHeightPx(700, 20, 0)).toBeCloseTo(46.25, 2);
  });

  it('never goes under 44 px, or 32 px in a short landscape window', () => {
    expect(hourHeightPx(500, 0, 0)).toBe(44);
    expect(hourHeightPx(390, 0, 21, true)).toBe(32);
    expect(hourHeightPx(480, 0, 0, true)).toBeCloseTo(32.92, 2);
  });

  it('stops growing on a tall desktop window', () => {
    expect(hourHeightPx(1440, 0, 0)).toBe(88);
  });

  it('knows a short landscape window', () => {
    expect(isCompactWindow(844, 390)).toBe(true);
    expect(isCompactWindow(390, 844)).toBe(false);
    expect(isCompactWindow(1024, 700)).toBe(false);
  });
});

describe('tap to slot', () => {
  it('snaps to the half hour at or above the tap', () => {
    const column = 12 * 50;
    expect(slotStartAt(0, column)).toBe(540);
    expect(slotStartAt(49, column)).toBe(570);
    expect(slotStartAt(50, column)).toBe(600);
    expect(slotStartAt(74, column)).toBe(600);
    expect(slotStartAt(75, column)).toBe(630);
  });

  it('starts no later than 20:30 and clamps outside the column', () => {
    expect(slotStartAt(599, 600)).toBe(1230);
    expect(slotStartAt(5000, 600)).toBe(1230);
    expect(slotStartAt(-20, 600)).toBe(540);
    expect(slotStartAt(10, 0)).toBe(540);
  });

  it('ends after the last duration but never past 21:00 nor under 10 minutes', () => {
    expect(endForDuration(600, 60)).toBe(660);
    expect(endForDuration(600, 90)).toBe(690);
    expect(endForDuration(1230, 60)).toBe(1260);
    expect(endForDuration(600, 3)).toBe(610);
    expect(endForDuration(600, 52)).toBe(650);
  });

  it('puts minutes in hours from 09:00', () => {
    expect(hoursFromTop(540)).toBe(0);
    expect(hoursFromTop(1260)).toBe(12);
    expect(hoursFromTop(615)).toBe(1.25);
  });
});

describe('swipe', () => {
  it('locks the axis only after 10 px', () => {
    expect(lockAxis(6, 8)).toBeNull();
    expect(lockAxis(10, 0)).toBeNull();
    expect(lockAxis(11, 3)).toBe('x');
    expect(lockAxis(-4, -12)).toBe('y');
    expect(lockAxis(12, -12)).toBe('y');
  });

  it('leaves touches at the screen edges to the back gesture', () => {
    expect(startsAtEdge(19, 390)).toBe(true);
    expect(startsAtEdge(20, 390)).toBe(false);
    expect(startsAtEdge(371, 390)).toBe(true);
    expect(startsAtEdge(200, 390)).toBe(false);
  });

  it('changes week past a quarter of the width or on a flick', () => {
    expect(swipeTarget(-100, 0, 360)).toBe('next');
    expect(swipeTarget(91, 0, 360)).toBe('prev');
    expect(swipeTarget(-89, 0, 360)).toBeNull();
    expect(swipeTarget(-40, -0.5, 360)).toBe('next');
    expect(swipeTarget(40, 0.31, 360)).toBe('prev');
    expect(swipeTarget(40, -0.8, 360)).toBeNull();
    expect(swipeTarget(0, 2, 360)).toBeNull();
  });

  it('measures the release speed over the last 100 ms', () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ x: 0, t: 0 }])).toBe(0);
    expect(
      releaseVelocity([
        { x: 0, t: 0 },
        { x: -10, t: 200 },
        { x: -40, t: 250 },
        { x: -70, t: 300 },
      ]),
    ).toBeCloseTo(-0.6, 5);
  });
});
