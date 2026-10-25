import { describe, expect, it } from 'vitest';
import { centredSquare, cropOutputSize, fullRect, halvingSteps, isUsableSize, planVariant, scaleToLongEdge, type VariantSpec } from './sizing';

const JPEG = { type: 'image/jpeg', quality: 0.8 } as const;

describe('isUsableSize, fullRect and centredSquare', () => {
  it('accepts only finite positive sizes', () => {
    expect(isUsableSize(1, 1)).toBe(true);
    expect(isUsableSize(0, 10)).toBe(false);
    expect(isUsableSize(10, -1)).toBe(false);
    expect(isUsableSize(Number.NaN, 10)).toBe(false);
    expect(isUsableSize(Number.POSITIVE_INFINITY, 10)).toBe(false);
  });

  it('takes the whole source or its largest centred square', () => {
    expect(fullRect({ width: 4032, height: 3024 })).toEqual({ sx: 0, sy: 0, sw: 4032, sh: 3024 });
    expect(centredSquare({ width: 4032, height: 3024 })).toEqual({ sx: 504, sy: 0, sw: 3024, sh: 3024 });
    expect(centredSquare({ width: 300, height: 500 })).toEqual({ sx: 0, sy: 100, sw: 300, sh: 300 });
  });
});

describe('scaleToLongEdge', () => {
  it('keeps the ratio and never scales up or below 1px', () => {
    expect(scaleToLongEdge({ width: 4032, height: 3024 }, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(scaleToLongEdge({ width: 3024, height: 4032 }, 360)).toEqual({ width: 270, height: 360 });
    expect(scaleToLongEdge({ width: 800, height: 600 }, 2048)).toEqual({ width: 800, height: 600 });
    expect(scaleToLongEdge({ width: 100_000, height: 1 }, 360)).toEqual({ width: 360, height: 1 });
  });
});

describe('planVariant', () => {
  const main: VariantSpec = { longEdge: 2048, onlyWhenLarger: true, ...JPEG };
  const thumb: VariantSpec = { longEdge: 360, shortEdgeMin: 120, longEdgeMax: 1080, onlyWhenLarger: true, ...JPEG };
  const avatar: VariantSpec = { longEdge: 320, square: true, ...JPEG };

  it('scales a 12MP photo to a 2048px long edge', () => {
    expect(planVariant({ width: 4032, height: 3024 }, main)).toEqual({ crop: { sx: 0, sy: 0, sw: 4032, sh: 3024 }, size: { width: 2048, height: 1536 } });
  });

  it('makes nothing when onlyWhenLarger finds the source small enough', () => {
    expect(planVariant({ width: 2048, height: 1000 }, main)).toBeNull();
    expect(planVariant({ width: 360, height: 360 }, thumb)).toBeNull();
  });

  it('keeps a short edge of 120px for a panorama, but caps the long edge', () => {
    expect(planVariant({ width: 6000, height: 1000 }, thumb)?.size).toEqual({ width: 720, height: 120 });
    expect(planVariant({ width: 20_000, height: 1000 }, thumb)?.size).toEqual({ width: 1080, height: 54 });
    expect(planVariant({ width: 1000, height: 300 }, thumb)?.size).toEqual({ width: 400, height: 120 });
  });

  it('never scales up, even for the short edge minimum', () => {
    expect(planVariant({ width: 2000, height: 100 }, thumb)?.size).toEqual({ width: 1080, height: 54 });
    expect(planVariant({ width: 500, height: 80 }, thumb)?.size).toEqual({ width: 500, height: 80 });
  });

  it('crops a square from the centre for an avatar', () => {
    expect(planVariant({ width: 4032, height: 3024 }, avatar)).toEqual({ crop: { sx: 504, sy: 0, sw: 3024, sh: 3024 }, size: { width: 320, height: 320 } });
    expect(planVariant({ width: 200, height: 100 }, avatar)).toEqual({ crop: { sx: 50, sy: 0, sw: 100, sh: 100 }, size: { width: 100, height: 100 } });
  });

  it('refuses an unusable source', () => {
    expect(planVariant({ width: 0, height: 100 }, avatar)).toBeNull();
    expect(planVariant({ width: Number.NaN, height: 100 }, main)).toBeNull();
  });
});

describe('halvingSteps', () => {
  it('halves while the next half still covers the target, then lands on it', () => {
    expect(halvingSteps({ width: 4032, height: 3024 }, { width: 360, height: 270 })).toEqual([
      { width: 2016, height: 1512 },
      { width: 1008, height: 756 },
      { width: 504, height: 378 },
      { width: 360, height: 270 },
    ]);
  });

  it('stops halving exactly at the target', () => {
    expect(halvingSteps({ width: 1024, height: 1024 }, { width: 256, height: 256 })).toEqual([
      { width: 512, height: 512 },
      { width: 256, height: 256 },
    ]);
  });

  it('draws a small step or an upscale once', () => {
    expect(halvingSteps({ width: 500, height: 500 }, { width: 320, height: 320 })).toEqual([{ width: 320, height: 320 }]);
    expect(halvingSteps({ width: 100, height: 100 }, { width: 320, height: 320 })).toEqual([{ width: 320, height: 320 }]);
    expect(halvingSteps({ width: 320, height: 320 }, { width: 320, height: 320 })).toEqual([{ width: 320, height: 320 }]);
  });
});

describe('cropOutputSize', () => {
  it('follows the frame shape and caps the width', () => {
    expect(cropOutputSize(3000, { width: 390, height: 192 }, 1280)).toEqual({ width: 1280, height: 630 });
  });

  it('never scales the source up', () => {
    expect(cropOutputSize(640.4, { width: 390, height: 192 }, 1280)).toEqual({ width: 640, height: 315 });
  });

  it('returns a 1px size for an unusable frame', () => {
    expect(cropOutputSize(3000, { width: 0, height: 192 }, 1280)).toEqual({ width: 1, height: 1 });
    expect(cropOutputSize(0, { width: 390, height: 192 }, 1280)).toEqual({ width: 1, height: 1 });
  });
});
