import { describe, expect, it } from 'vitest';
import {
  ICON_BACKGROUND,
  ICON_IDENTITY,
  ICON_PREVIEW_SIZE,
  ICON_WORKING_EDGE,
  ICON_ZOOM_MAX,
  IconImageError,
  clampTransform,
  coverScale,
  cropRect,
  downscaleSteps,
  encodingType,
  frameSide,
  iconDrawSides,
  iconFileName,
  iconImageStyle,
  iconProblemText,
  isIconPickType,
  panBy,
  pickEncoding,
  pinchTransform,
  rescaleTransform,
  scaleCrop,
  toggleZoom,
  wheelZoom,
  zoomAround,
} from './squareIcon';

const tr = (zh: string, en: string) => `${zh}|${en}`;

describe('cover scale', () => {
  it('fits the short edge of the image to the frame', () => {
    expect(coverScale(4000, 3000, 300)).toBeCloseTo(0.1);
    expect(coverScale(1000, 2000, 320)).toBeCloseTo(0.32);
    expect(coverScale(256, 256, 256)).toBe(1);
  });

  it('is 0 for an unusable size', () => {
    expect(coverScale(0, 100, 300)).toBe(0);
    expect(coverScale(100, Number.NaN, 300)).toBe(0);
    expect(coverScale(100, 100, 0)).toBe(0);
  });
});

describe('frame side', () => {
  it('is 80% of the window, at most 320', () => {
    expect(frameSide(375)).toBe(300);
    expect(frameSide(320)).toBe(256);
    expect(frameSide(1440)).toBe(320);
    expect(frameSide(0)).toBe(320);
  });
});

describe('clamp', () => {
  it('keeps the zoom between 1x and 4x', () => {
    expect(clampTransform({ zoom: 0.5, x: 0, y: 0 }, 400, 300, 300).zoom).toBe(1);
    expect(clampTransform({ zoom: 9, x: 0, y: 0 }, 400, 300, 300).zoom).toBe(ICON_ZOOM_MAX);
    expect(clampTransform({ zoom: Number.NaN, x: 0, y: 0 }, 400, 300, 300).zoom).toBe(1);
  });

  it('keeps the image covering the frame', () => {
    // 400x300 in a 300 frame: shown 400x300 at 1x, so x may move 50 each way and y not at all.
    // 400x300 放进 300 的方框：1 倍时显示为 400x300，因此 x 可以左右各移动 50，y 不能移动。
    expect(clampTransform({ zoom: 1, x: 200, y: 80 }, 400, 300, 300)).toEqual({ zoom: 1, x: 50, y: 0 });
    expect(clampTransform({ zoom: 1, x: -200, y: -80 }, 400, 300, 300)).toEqual({ zoom: 1, x: -50, y: 0 });
    // At 2x it is shown 800x600: x within 250, y within 150.
    // 2 倍时显示为 800x600：x 在 250 以内，y 在 150 以内。
    expect(clampTransform({ zoom: 2, x: 999, y: -999 }, 400, 300, 300)).toEqual({ zoom: 2, x: 250, y: -150 });
  });

  it('falls back to the identity for an unusable image', () => {
    expect(clampTransform({ zoom: 3, x: 10, y: 10 }, 0, 0, 300)).toEqual(ICON_IDENTITY);
  });
});

describe('crop rectangle', () => {
  it('is the centred square at 1x', () => {
    expect(cropRect(ICON_IDENTITY, 4000, 3000, 300)).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(cropRect(ICON_IDENTITY, 1000, 2000, 320)).toEqual({ sx: 0, sy: 500, size: 1000 });
  });

  it('shrinks with the zoom around the centre', () => {
    const crop = cropRect({ zoom: 2, x: 0, y: 0 }, 4000, 3000, 300);
    expect(crop.size).toBeCloseTo(1500);
    expect(crop.sx).toBeCloseTo(1250);
    expect(crop.sy).toBeCloseTo(750);
  });

  it('moves the opposite way to the image', () => {
    // The image moved 50 CSS px right (the limit at 1x), so the frame shows its left edge.
    // 图片向右移动了 50 CSS 像素（1 倍时的上限），方框因此显示图片的左边缘。
    expect(cropRect({ zoom: 1, x: 50, y: 0 }, 4000, 3000, 300)).toEqual({ sx: 0, sy: 0, size: 3000 });
    expect(cropRect({ zoom: 1, x: -50, y: 0 }, 4000, 3000, 300)).toEqual({ sx: 1000, sy: 0, size: 3000 });
  });

  it('clamps an out-of-range transform before measuring, so the crop stays inside the image', () => {
    const crop = cropRect({ zoom: 4, x: 10_000, y: -10_000 }, 4000, 3000, 300);
    expect(crop.sx).toBeCloseTo(0);
    expect(crop.sy + crop.size).toBeCloseTo(3000);
    expect(crop.size).toBeCloseTo(750);
  });

  it('is empty for an unusable image', () => {
    expect(cropRect(ICON_IDENTITY, 0, 100, 300)).toEqual({ sx: 0, sy: 0, size: 0 });
  });
});

describe('gestures', () => {
  it('pans and stops at the edges', () => {
    const t = panBy(ICON_IDENTITY, 30, 30, 400, 300, 300);
    expect(t).toEqual({ zoom: 1, x: 30, y: 0 });
    expect(panBy(t, 100, 0, 400, 300, 300).x).toBe(50);
  });

  it('zooms around the focal point, keeping the image point under it', () => {
    // 2x around the frame's right edge (150, 0) of a 300x300 image in a 300 frame.
    // 以方框右边缘 (150, 0) 为中心，把 300 方框中的 300x300 图片放大到 2 倍。
    const t = zoomAround(ICON_IDENTITY, 2, { x: 150, y: 0 }, 300, 300, 300);
    expect(t).toEqual({ zoom: 2, x: -150, y: 0 });
    const crop = cropRect(t, 300, 300, 300);
    // The right half of the image fills the frame; its right edge is still under the focal point.
    // 图片的右半部分填满方框；图片右边缘仍在焦点之下。
    expect(crop).toEqual({ sx: 150, sy: 75, size: 150 });
  });

  it('pinches around the starting midpoint and follows it', () => {
    const t = pinchTransform(ICON_IDENTITY, { x: 0, y: 0 }, { x: 20, y: -10 }, 2, 400, 400, 300);
    expect(t.zoom).toBe(2);
    expect(t.x).toBeCloseTo(20);
    expect(t.y).toBeCloseTo(-10);
    expect(pinchTransform(ICON_IDENTITY, { x: 0, y: 0 }, { x: 0, y: 0 }, 100, 400, 400, 300).zoom).toBe(ICON_ZOOM_MAX);
    expect(pinchTransform(ICON_IDENTITY, { x: 0, y: 0 }, { x: 0, y: 0 }, 0, 400, 400, 300).zoom).toBe(1);
  });

  it('toggles 1x and 2x on a double-tap', () => {
    const inT = toggleZoom(ICON_IDENTITY, { x: 0, y: 0 }, 400, 400, 300);
    expect(inT.zoom).toBe(2);
    expect(toggleZoom(inT, { x: 40, y: 40 }, 400, 400, 300)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(toggleZoom({ zoom: 3.5, x: 0, y: 0 }, { x: 0, y: 0 }, 400, 400, 300).zoom).toBe(1);
  });

  it('zooms in for a negative wheel delta and stays in range', () => {
    expect(wheelZoom(1, -100)).toBeGreaterThan(1);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
    expect(wheelZoom(1, 100)).toBe(1);
    expect(wheelZoom(3.9, -10_000)).toBe(ICON_ZOOM_MAX);
    expect(wheelZoom(2, Number.NaN)).toBe(2);
  });

  it('keeps the same place when the frame is resized', () => {
    expect(rescaleTransform({ zoom: 2, x: 30, y: -60 }, 300, 240)).toEqual({ zoom: 2, x: 24, y: -48 });
    expect(rescaleTransform({ zoom: 2, x: 30, y: -60 }, 0, 240)).toEqual({ zoom: 2, x: 30, y: -60 });
  });
});

describe('downscale steps', () => {
  it('halves while the half stays clearly above the target, ending on the target', () => {
    expect(downscaleSteps(1500, 256)).toEqual([750, 375, 256]);
    expect(downscaleSteps(4000, 256)).toEqual([2000, 1000, 500, 256]);
    expect(downscaleSteps(256, 96)).toEqual([128, 96]);
  });

  it('draws once for a small step or an upscale', () => {
    expect(downscaleSteps(512, 256)).toEqual([256]);
    expect(downscaleSteps(600, 256)).toEqual([256]);
    expect(downscaleSteps(256, 256)).toEqual([256]);
    expect(downscaleSteps(100, 256)).toEqual([256]);
  });

  it('never shrinks by more than 2.5x in one draw', () => {
    for (const from of [257, 333, 640, 641, 999, 1281, 3024, 4096]) {
      let side = from;
      for (const step of downscaleSteps(from, 256)) {
        expect(side / step).toBeLessThanOrEqual(2.5);
        side = step;
      }
      expect(side).toBe(256);
    }
  });
});

describe('icon draw sides', () => {
  it('halves the crop itself down to the icon, so a crop of at least 256 is never enlarged', () => {
    // A 1000 px crop of a 16000x4000 panorama at 4x, and the full width of a 1080x12000 screenshot at 1x.
    // 16000x4000 全景照片放大 4 倍后的 1000px 裁剪区域，以及 1080x12000 长截图 1 倍时的整个宽度。
    expect(iconDrawSides(1000, 256)).toEqual([500, 256]);
    expect(iconDrawSides(1080, 256)).toEqual([540, 256]);
    expect(iconDrawSides(4000, 256)).toEqual([2000, 1000, 500, 256]);
    expect(iconDrawSides(4096, 256)).toEqual([2048, 1024, 512, 256]);
    for (const from of [256, 300, 640, 1000, 1080, 3024, 4096, 4097, 6048, 12000]) {
      let side = from;
      for (const step of iconDrawSides(from, 256)) {
        expect(step).toBeLessThanOrEqual(side);
        side = step;
      }
    }
  });

  it('draws a crop over 4096 straight to 2048, and never makes a larger canvas', () => {
    expect(iconDrawSides(4097, 256)).toEqual([2048, 1024, 512, 256]);
    expect(iconDrawSides(12000, 256)).toEqual([2048, 1024, 512, 256]);
    for (const from of [100, 2048, 4096, 4097, 6048, 12000, 50_000]) {
      expect(Math.max(...iconDrawSides(from, 256))).toBeLessThanOrEqual(ICON_WORKING_EDGE);
    }
  });

  it('enlarges only a crop that is itself under 256 source px', () => {
    expect(iconDrawSides(184, 256)).toEqual([256]);
    expect(iconDrawSides(Number.NaN, 256)).toEqual([256]);
  });
});

describe('crop scaling', () => {
  it('moves a crop measured on the shown image onto the decoded one', () => {
    expect(scaleCrop({ sx: 125, sy: 0, size: 750 }, 4, { width: 4000, height: 3000 })).toEqual({ sx: 500, sy: 0, size: 3000 });
    expect(scaleCrop({ sx: 1000, sy: 500, size: 4000 }, 0.256, { width: 2048, height: 1536 })).toEqual({ sx: 256, sy: 128, size: 1024 });
    // Rounding at the edge stays inside the image.
    // 边缘处的取整仍保持在图片之内。
    const edge = scaleCrop({ sx: 3999, sy: 0, size: 4001 }, 0.5, { width: 4000, height: 2000 });
    expect(edge.sx + edge.size).toBeLessThanOrEqual(4000);
  });
});

describe('crop screen image style', () => {
  it('backs both images with the colour the encoder fills, so transparent parts show as saved', () => {
    expect(ICON_BACKGROUND).toBe('#FFFFFF');
    const stage = iconImageStyle({ width: 400, height: 300 }, 300, { zoom: 2, x: 10, y: -20 }, 1);
    const preview = iconImageStyle({ width: 400, height: 300 }, 300, { zoom: 2, x: 10, y: -20 }, ICON_PREVIEW_SIZE / 300);
    expect(stage.backgroundColor).toBe(ICON_BACKGROUND);
    expect(preview.backgroundColor).toBe(ICON_BACKGROUND);
  });

  it('sizes the image to cover the frame at 1x and places it by the transform', () => {
    expect(iconImageStyle({ width: 400, height: 300 }, 300, { zoom: 2, x: 10, y: -20 }, 1)).toEqual({
      width: '400px',
      height: '300px',
      maxWidth: 'none',
      backgroundColor: ICON_BACKGROUND,
      transform: 'translate(-50%, -50%) translate(10px, -20px) scale(2)',
    });
    const half = iconImageStyle({ width: 1000, height: 2000 }, 320, { zoom: 1.5, x: 8, y: 4 }, 0.5);
    expect(half.width).toBe('160px');
    expect(half.height).toBe('320px');
    expect(half.transform).toBe('translate(-50%, -50%) translate(4px, 2px) scale(1.5)');
  });
});

describe('encoding', () => {
  it('uses WebP only when the canvas really wrote WebP', () => {
    expect(pickEncoding('image/webp')).toBe('webp');
    expect(pickEncoding('image/png')).toBe('jpeg');
    expect(pickEncoding('')).toBe('jpeg');
    expect(pickEncoding(null)).toBe('jpeg');
    expect(encodingType('webp')).toBe('image/webp');
    expect(encodingType('jpeg')).toBe('image/jpeg');
  });

  it('names the two files', () => {
    expect(iconFileName('webp', false)).toBe('icon.webp');
    expect(iconFileName('jpeg', true)).toBe('icon-96.jpg');
  });
});

describe('picking', () => {
  it('takes JPEG, PNG and WebP, and an empty type, but not GIF or HEIC', () => {
    expect(isIconPickType('image/jpeg')).toBe(true);
    expect(isIconPickType('image/png')).toBe(true);
    expect(isIconPickType('image/webp')).toBe(true);
    expect(isIconPickType('')).toBe(true);
    expect(isIconPickType('image/gif')).toBe(false);
    expect(isIconPickType('image/heic')).toBe(false);
  });

  it('says why an image was refused', () => {
    expect(iconProblemText(new IconImageError('type'), tr)).toBe('只支持 JPEG、PNG、WebP|Only JPEG, PNG, and WebP are supported.');
    expect(iconProblemText(new IconImageError('decode'), tr)).toBe("图片无法读取，请换一张|Couldn't read that image. Try another.");
    expect(iconProblemText(new Error('x'), tr)).toBe("图片无法读取，请换一张|Couldn't read that image. Try another.");
  });
});
