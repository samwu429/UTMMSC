import { describe, expect, it } from 'vitest';
import { centredBox, clampPan, coverTransform, fitContain, fitThumb, zoomAbout } from './imageBox';

describe('fitThumb', () => {
  it('caps the long edge at 180px and keeps the ratio', () => {
    expect(fitThumb(4000, 3000)).toEqual({ width: 180, height: 135, cropped: false });
    expect(fitThumb(3000, 4000)).toEqual({ width: 135, height: 180, cropped: false });
    expect(fitThumb(1000, 1000)).toEqual({ width: 180, height: 180, cropped: false });
  });

  it('keeps small images at their own size', () => {
    expect(fitThumb(100, 80)).toEqual({ width: 100, height: 80, cropped: false });
  });

  it('raises the short edge to 60px', () => {
    expect(fitThumb(30, 30)).toEqual({ width: 60, height: 60, cropped: false });
    expect(fitThumb(120, 50)).toEqual({ width: 144, height: 60, cropped: false });
  });

  it('clamps the ratio to 1:3 and crops the rest', () => {
    expect(fitThumb(1000, 5000)).toEqual({ width: 60, height: 180, cropped: true });
    expect(fitThumb(2000, 100)).toEqual({ width: 180, height: 60, cropped: true });
    expect(fitThumb(300, 100)).toEqual({ width: 180, height: 60, cropped: false });
  });

  it('gives rows without dimensions a 132px square', () => {
    expect(fitThumb(null, null)).toEqual({ width: 132, height: 132, cropped: true });
    expect(fitThumb(undefined, 200)).toEqual({ width: 132, height: 132, cropped: true });
    expect(fitThumb(0, 200)).toEqual({ width: 132, height: 132, cropped: true });
    expect(fitThumb(Number.NaN, 200)).toEqual({ width: 132, height: 132, cropped: true });
  });
});

describe('viewer geometry', () => {
  const screen = { width: 400, height: 800 };

  it('fits an image inside the screen', () => {
    expect(fitContain({ width: 1000, height: 500 }, screen)).toEqual({ width: 400, height: 200 });
    expect(fitContain({ width: 100, height: 400 }, screen)).toEqual({ width: 200, height: 800 });
    expect(fitContain({ width: 0, height: 400 }, screen)).toEqual({ width: 0, height: 0 });
  });

  it('centres a fitted box', () => {
    expect(centredBox({ width: 400, height: 200 }, screen)).toEqual({ width: 400, height: 200, left: 0, top: 300 });
  });

  it('maps the viewer box onto the thumbnail', () => {
    const to = centredBox({ width: 400, height: 200 }, screen);
    const from = { left: 20, top: 100, width: 180, height: 90 };
    expect(coverTransform(from, to)).toEqual({ x: 110 - 200, y: 145 - 400, scale: 0.45 });
  });

  it('stops panning at the edges', () => {
    const image = { width: 400, height: 200 };
    expect(clampPan(500, 500, 2, image, screen)).toEqual({ x: 200, y: 0 });
    expect(clampPan(-900, -500, 4, image, screen)).toEqual({ x: -600, y: 0 });
    expect(clampPan(-500, -500, 4, image, screen)).toEqual({ x: -500, y: 0 });
    expect(clampPan(50, 50, 1, image, screen)).toEqual({ x: 0, y: 0 });
  });

  it('zooms about a point', () => {
    expect(zoomAbout({ x: 100, y: 0 }, { x: 0, y: 0 }, 1, 2)).toEqual({ x: -100, y: 0 });
    expect(zoomAbout({ x: 0, y: 0 }, { x: 40, y: -20 }, 2, 1)).toEqual({ x: 20, y: -10 });
  });
});
