import { describe, expect, it } from 'vitest';
import {
  fitSticker,
  fitStickerPreview,
  STICKER_BOX_MAX,
  STICKER_FALLBACK_SIDE,
  STICKER_LOAD_START,
  STICKER_TAP_MIN,
  stickerAttemptSrc,
  stickerLoadStep,
  type StickerLoadEvent,
  type StickerLoadState,
} from './stickerBox';

describe('fitSticker', () => {
  it('fits a large sticker into 150 px keeping its shape', () => {
    expect(fitSticker(600, 300)).toEqual({ width: 150, height: 75, boxWidth: 150, boxHeight: 75 });
    expect(fitSticker(240, 240)).toEqual({ width: 150, height: 150, boxWidth: 150, boxHeight: 150 });
    expect(fitSticker(300, 1000)).toEqual({ width: 45, height: 150, boxWidth: 48, boxHeight: 150 });
  });

  it('never draws a small sticker more than twice its size', () => {
    expect(fitSticker(60, 40)).toEqual({ width: 120, height: 80, boxWidth: 120, boxHeight: 80 });
    expect(fitSticker(100, 100)).toEqual({ width: 150, height: 150, boxWidth: 150, boxHeight: 150 });
  });

  it('keeps a tiny sticker at twice its size inside a 48 px tap area', () => {
    expect(fitSticker(16, 16)).toEqual({ width: 32, height: 32, boxWidth: STICKER_TAP_MIN, boxHeight: STICKER_TAP_MIN });
    expect(fitSticker(1, 1)).toEqual({ width: 2, height: 2, boxWidth: 48, boxHeight: 48 });
  });

  it('gives very wide and very tall stickers a 48 px short side to tap', () => {
    expect(fitSticker(1500, 100)).toEqual({ width: 150, height: 10, boxWidth: 150, boxHeight: 48 });
    expect(fitSticker(100, 1500)).toEqual({ width: 10, height: 150, boxWidth: 48, boxHeight: 150 });
    // Never rounds a side away to nothing.
    // 绝不会把某条边舍入为零。
    expect(fitSticker(20_000, 1)).toEqual({ width: 150, height: 1, boxWidth: 150, boxHeight: 48 });
  });

  it('never exceeds the box on either side', () => {
    for (const [w, h] of [
      [2048, 2048],
      [2048, 7],
      [3, 2048],
      [151, 149],
    ] as const) {
      const fit = fitSticker(w, h);
      expect(Math.max(fit.width, fit.height)).toBeLessThanOrEqual(STICKER_BOX_MAX);
      expect(fit.boxWidth).toBeGreaterThanOrEqual(fit.width);
      expect(fit.boxHeight).toBeGreaterThanOrEqual(fit.height);
    }
  });

  it('gives a 120 px square for unusable sizes', () => {
    const square = { width: STICKER_FALLBACK_SIDE, height: STICKER_FALLBACK_SIDE, boxWidth: 120, boxHeight: 120 };
    expect(fitSticker(null, 100)).toEqual(square);
    expect(fitSticker(100, undefined)).toEqual(square);
    expect(fitSticker(0, 100)).toEqual(square);
    expect(fitSticker(-5, 100)).toEqual(square);
    expect(fitSticker(Number.NaN, 100)).toEqual(square);
    expect(fitSticker(100, Number.POSITIVE_INFINITY)).toEqual(square);
  });
});

describe('fitStickerPreview', () => {
  it('uses at most 300 px on a wide screen', () => {
    expect(fitStickerPreview(600, 600, 1280)).toEqual({ width: 300, height: 300 });
    expect(fitStickerPreview(1000, 500, 1280)).toEqual({ width: 300, height: 150 });
  });

  it('leaves 32 px on each side of a phone screen', () => {
    expect(fitStickerPreview(600, 600, 360)).toEqual({ width: 296, height: 296 });
    expect(fitStickerPreview(400, 800, 320)).toEqual({ width: 128, height: 256 });
  });

  it('never draws a sticker more than three times its size', () => {
    expect(fitStickerPreview(40, 40, 1280)).toEqual({ width: 120, height: 120 });
    expect(fitStickerPreview(100, 50, 1280)).toEqual({ width: 300, height: 150 });
    expect(fitStickerPreview(120, 120, 393)).toEqual({ width: 300, height: 300 });
  });

  it('gives a square of the preview side for unusable sizes and a usable side for odd viewports', () => {
    expect(fitStickerPreview(0, 0, 360)).toEqual({ width: 296, height: 296 });
    expect(fitStickerPreview(null, 10, 1280)).toEqual({ width: 300, height: 300 });
    expect(fitStickerPreview(600, 600, 0)).toEqual({ width: 300, height: 300 });
    expect(fitStickerPreview(600, 600, 80)).toEqual({ width: 48, height: 48 });
  });
});

function run(events: StickerLoadEvent[], start: StickerLoadState = STICKER_LOAD_START): StickerLoadState {
  return events.reduce(stickerLoadStep, start);
}

describe('stickerLoadStep', () => {
  it('shows a sticker that loads at once', () => {
    expect(run([{ type: 'loaded' }])).toEqual({ phase: 'shown', retry: 0 });
  });

  it('retries once silently with a new address, and shows it if that works', () => {
    const retrying = run([{ type: 'error' }]);
    expect(retrying).toEqual({ phase: 'retrying', retry: 1 });
    expect(stickerLoadStep(retrying, { type: 'loaded' })).toEqual({ phase: 'shown', retry: 1 });
  });

  it('probes the file after the second failure', () => {
    expect(run([{ type: 'error' }, { type: 'error' }])).toEqual({ phase: 'probing', retry: 1 });
  });

  it('says gone only when the server answers 404', () => {
    const probing = run([{ type: 'error' }, { type: 'error' }]);
    expect(stickerLoadStep(probing, { type: 'probed', status: 404, still: false })).toEqual({ phase: 'gone', retry: 1 });
    expect(stickerLoadStep(probing, { type: 'probed', status: 404, still: true }).phase).toBe('gone');
  });

  it('treats other statuses and network errors as a failed load', () => {
    const probing = run([{ type: 'error' }, { type: 'error' }]);
    for (const status of [200, 403, 410, 500, 503, null]) {
      expect(stickerLoadStep(probing, { type: 'probed', status, still: false })).toEqual({ phase: 'failed', retry: 1 });
    }
  });

  it('calls only the still broken when its file answers', () => {
    const probing = run([{ type: 'error' }, { type: 'error' }]);
    expect(stickerLoadStep(probing, { type: 'probed', status: 200, still: true })).toEqual({ phase: 'stillBroken', retry: 1 });
    expect(stickerLoadStep(probing, { type: 'probed', status: 500, still: true }).phase).toBe('failed');
    expect(stickerLoadStep(probing, { type: 'probed', status: null, still: true }).phase).toBe('failed');
  });

  it('loads again with a new retry value on a tap after failing', () => {
    const failed = run([{ type: 'error' }, { type: 'error' }, { type: 'probed', status: 503, still: false }]);
    const again = stickerLoadStep(failed, { type: 'tap' });
    expect(again).toEqual({ phase: 'loading', retry: 2 });
    // A failure after the tap is retried silently once more, with yet another address.
    // 点按之后的失败同样先静默重试一次，并换用另一个地址。
    expect(stickerLoadStep(again, { type: 'error' })).toEqual({ phase: 'retrying', retry: 3 });
  });

  it('ignores taps everywhere but a failed tile', () => {
    for (const state of [STICKER_LOAD_START, run([{ type: 'loaded' }]), run([{ type: 'error' }]), run([{ type: 'error' }, { type: 'error' }])]) {
      expect(stickerLoadStep(state, { type: 'tap' })).toBe(state);
    }
    const gone = run([{ type: 'error' }, { type: 'error' }, { type: 'probed', status: 404, still: false }]);
    expect(stickerLoadStep(gone, { type: 'tap' })).toBe(gone);
  });

  it('ignores late events once settled', () => {
    const gone = run([{ type: 'error' }, { type: 'error' }, { type: 'probed', status: 404, still: false }]);
    expect(stickerLoadStep(gone, { type: 'loaded' })).toBe(gone);
    expect(stickerLoadStep(gone, { type: 'error' })).toBe(gone);
    const shown = run([{ type: 'loaded' }]);
    expect(stickerLoadStep(shown, { type: 'probed', status: 404, still: false })).toBe(shown);
    expect(stickerLoadStep(shown, { type: 'loaded' })).toBe(shown);
  });

  it('retries a shown sticker whose new address fails, such as after a token change', () => {
    expect(run([{ type: 'loaded' }, { type: 'error' }])).toEqual({ phase: 'retrying', retry: 1 });
  });
});

describe('stickerAttemptSrc', () => {
  it('adds the retry number only after the first attempt', () => {
    expect(stickerAttemptSrc('https://api/members/media/k?t=tok', 0)).toBe('https://api/members/media/k?t=tok');
    expect(stickerAttemptSrc('https://api/members/media/k?t=tok', 2)).toBe('https://api/members/media/k?t=tok&retry=2');
    expect(stickerAttemptSrc('/plain', 1)).toBe('/plain?retry=1');
    expect(stickerAttemptSrc(null, 3)).toBeNull();
  });
});
