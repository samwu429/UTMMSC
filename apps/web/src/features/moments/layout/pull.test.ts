import { describe, expect, it } from 'vitest';
import {
  COVER_HEIGHT,
  HEADER_HEIGHT,
  PULL_MAX,
  PULL_SETTLE_MS,
  PULL_SLOP,
  PULL_THRESHOLD,
  fingerPull,
  headerProgress,
  isPastCover,
  movePullGesture,
  pullAngle,
  pullProgress,
  releasesRefresh,
  rubberBandPull,
  settlePull,
  startPullGesture,
} from './pull';

describe('rubber band on iPhone', () => {
  it('reads the pull from a negative scrollY and nothing while scrolled down', () => {
    expect(rubberBandPull(-80)).toBe(80);
    expect(rubberBandPull(-0.5)).toBe(0.5);
    expect(rubberBandPull(0)).toBe(0);
    expect(rubberBandPull(300)).toBe(0);
    expect(rubberBandPull(Number.NaN)).toBe(0);
  });

  it('turns the spinner three degrees per px', () => {
    expect(pullAngle(0)).toBe(0);
    expect(pullAngle(30)).toBe(90);
    expect(pullAngle(-10)).toBe(0);
  });
});

describe('threshold', () => {
  it('refreshes from 64px', () => {
    expect(PULL_THRESHOLD).toBe(64);
    expect(releasesRefresh(63.9)).toBe(false);
    expect(releasesRefresh(64)).toBe(true);
    expect(releasesRefresh(120)).toBe(true);
  });

  it('fades the indicator in until the threshold', () => {
    expect(pullProgress(0)).toBe(0);
    expect(pullProgress(32)).toBe(0.5);
    expect(pullProgress(64)).toBe(1);
    expect(pullProgress(200)).toBe(1);
    expect(pullProgress(-5)).toBe(0);
  });
});

describe('Android pull', () => {
  it('follows the finger at half speed up to 120px', () => {
    expect(fingerPull(40)).toBe(20);
    expect(fingerPull(128)).toBe(64);
    expect(fingerPull(1000)).toBe(PULL_MAX);
    expect(fingerPull(-30)).toBe(0);
  });

  it('waits inside the slop before deciding', () => {
    const start = startPullGesture(100, 200);
    expect(movePullGesture(start, 100 + PULL_SLOP, 200 + PULL_SLOP, 0)).toBe(start);
  });

  it('engages for a downward finger at the top and passes the threshold at 128px of travel', () => {
    const start = startPullGesture(100, 200);
    const engaged = movePullGesture(start, 102, 220, 0);
    expect(engaged).toEqual({ startX: 100, startY: 200, engaged: true, pull: 10 });
    const far = movePullGesture(engaged!, 104, 328, 0);
    expect(far?.pull).toBe(64);
    expect(releasesRefresh(far!.pull)).toBe(true);
  });

  it('leaves an upward, sideways or scrolled touch to the page', () => {
    const start = startPullGesture(100, 200);
    expect(movePullGesture(start, 100, 180, 0)).toBeNull();
    expect(movePullGesture(start, 140, 210, 0)).toBeNull();
    expect(movePullGesture(start, 110, 210, 0)).toBeNull();
    expect(movePullGesture(start, 100, 240, 12)).toBeNull();
  });

  it('stays a pull once engaged, down to zero when the finger comes back up', () => {
    const engaged = movePullGesture(startPullGesture(0, 0), 0, 60, 0)!;
    const back = movePullGesture(engaged, 0, -40, 0);
    expect(back).toMatchObject({ engaged: true, pull: 0 });
    expect(movePullGesture(back!, 0, 100, 0)).toMatchObject({ engaged: true, pull: 50 });
  });

  it('springs back to zero after letting go', () => {
    expect(settlePull(80, 0)).toBe(80);
    const half = settlePull(80, PULL_SETTLE_MS / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(40);
    expect(settlePull(80, PULL_SETTLE_MS)).toBe(0);
    expect(settlePull(80, PULL_SETTLE_MS * 3)).toBe(0);
  });
});

describe('header progress', () => {
  it('stays transparent while the cover shows, then fades over 48px', () => {
    expect(headerProgress(0)).toBe(0);
    expect(headerProgress(-40)).toBe(0);
    expect(headerProgress(100)).toBe(0);
    expect(headerProgress(124)).toBe(0.5);
    expect(headerProgress(148)).toBe(1);
    expect(headerProgress(2000)).toBe(1);
  });

  it('is solid exactly when the cover has gone under the header', () => {
    const edge = COVER_HEIGHT - HEADER_HEIGHT;
    expect(isPastCover(edge - 1)).toBe(false);
    expect(isPastCover(edge)).toBe(true);
    expect(headerProgress(edge)).toBe(1);
  });

  it('takes other cover sizes', () => {
    expect(headerProgress(60, 120, 44, 20)).toBe(0.2);
  });
});
