import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StickerRef } from '@utmmsc/shared';
import { stickerFileSrc, stickerThumbSrc } from '../stickers/media';

// Server rendering runs no effects, so the playback limit is a plain flag the test sets.
// 服务端渲染不运行 effect，因此播放名额改为测试自己设置的普通标志。
const playback = vi.hoisted(() => ({ playing: false }));
vi.mock('../stickers/playback', () => ({
  useStickerPlayback: (_key: string, _rank: number, eligible: boolean) => ({ ref: () => undefined, playing: eligible && playback.playing }),
}));

// Server rendering fires no load or error events either, so the images that failed are a list the test sets. The
// tile's only array state is that list.
// 服务端渲染也不会触发加载或错误事件，因此加载失败的图片改为测试自己设置的列表。格子唯一的数组 state 就是这个列表。
const tile = vi.hoisted(() => ({ failed: [] as readonly string[] }));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  const state = actual.useState;
  return { ...actual, useState: (initial: unknown) => (Array.isArray(initial) ? [tile.failed, () => undefined] : state(initial)) };
});

const { StickerTile, stickerTileSources } = await import('./StickerTile');

const KIB = 1024;

function ref(overrides: Partial<StickerRef> = {}): StickerRef {
  return { id: `stk_${'a'.repeat(22)}`, type: 'gif', width: 240, height: 240, animated: true, bytes: 300 * KIB, thumb: 'T'.repeat(22), ...overrides };
}

const FILE = stickerFileSrc(ref(), 'tok') ?? '';
const STILL = stickerThumbSrc(ref(), 'tok') ?? '';

function render(sticker: StickerRef, options: { reducedMotion?: boolean; saveData?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(StickerTile, {
      sticker,
      index: 1,
      playKey: 'item:a',
      number: 1,
      token: 'tok',
      reducedMotion: options.reducedMotion ?? false,
      saveData: options.saveData ?? false,
      focusable: true,
      selecting: false,
      checked: false,
    }),
  );
}

/** Each image of the tile in document order, with its address and classes. */
/** 格子中的每张图片，按文档顺序排列，带地址和类名。 */
function images(html: string): { src: string; className: string }[] {
  return [...html.matchAll(/<img [^>]*>/g)].map(([tag]) => ({
    src: (/ src="([^"]*)"/.exec(tag)?.[1] ?? '').replaceAll('&amp;', '&'),
    className: / class="([^"]*)"/.exec(tag)?.[1] ?? '',
  }));
}

describe('stickerTileSources', () => {
  const base = { animated: true, file: FILE, still: STILL, failed: [] as readonly string[], loaded: null };

  it('shows the still in place of a file until the file has loaded', () => {
    expect(stickerTileSources({ ...base, wanted: 'file' })).toEqual({ src: FILE, under: STILL, waiting: true });
    expect(stickerTileSources({ ...base, wanted: 'file', loaded: STILL })).toEqual({ src: FILE, under: STILL, waiting: true });
  });

  it('keeps the still under a loaded file, hidden, so it is back at once when the tile stops', () => {
    // The still stays mounted under the playing file: leaving the playing window shows that element again, never a new one.
    // 静态图一直挂在播放中的文件下面：离开播放名额时重新显示的是这个元素，而不是新建的元素。
    expect(stickerTileSources({ ...base, wanted: 'file', loaded: FILE })).toEqual({ src: FILE, under: STILL, waiting: false });
    expect(stickerTileSources({ ...base, wanted: 'still', loaded: null })).toEqual({ src: STILL, under: null, waiting: false });
  });

  it('keeps nothing under a file when there is no still, or it failed', () => {
    expect(stickerTileSources({ ...base, still: null, wanted: 'file' })).toEqual({ src: FILE, under: null, waiting: false });
    expect(stickerTileSources({ ...base, failed: [STILL], wanted: 'file' })).toEqual({ src: FILE, under: null, waiting: false });
  });

  it('falls back from a failed still to the file only for a static sticker', () => {
    // A static sticker's file shows the same picture, with nothing under it.
    // 静态表情的文件显示的是同一张图，下面不垫任何图片。
    expect(stickerTileSources({ ...base, animated: false, failed: [STILL], wanted: 'still' })).toEqual({ src: FILE, under: null, waiting: false });
    // An animated tile wants its still only where it may not play the file, so it goes gray instead.
    // 动态表情只在不能播放文件时才使用静态图，因此改为灰色格子。
    expect(stickerTileSources({ ...base, failed: [STILL], wanted: 'still' })).toEqual({ src: null, under: null, waiting: false });
  });

  it('falls back to the still when a playing file fails, and is gray only with neither', () => {
    // The still that held the tile stays, instead of the tile going gray.
    // 垫着的静态图留下，格子不会变成灰色。
    expect(stickerTileSources({ ...base, failed: [FILE], wanted: 'file' })).toEqual({ src: STILL, under: null, waiting: false });
    expect(stickerTileSources({ ...base, failed: [FILE, STILL], wanted: 'file' })).toEqual({ src: null, under: null, waiting: false });
    expect(stickerTileSources({ ...base, failed: [STILL, FILE], wanted: 'still' })).toEqual({ src: null, under: null, waiting: false });
    expect(stickerTileSources({ ...base, still: null, failed: [FILE], wanted: 'file' })).toEqual({ src: null, under: null, waiting: false });
    expect(stickerTileSources({ ...base, wanted: 'none' })).toEqual({ src: null, under: null, waiting: false });
  });
});

describe('StickerTile', () => {
  beforeEach(() => {
    playback.playing = false;
    tile.failed = [];
  });

  /** The gray tile shown with no image to show. */
  /** 没有可显示的图片时显示的灰色格子。 */
  const GRAY = 'rounded-[4px] bg-wx-pressed';

  it('never plays an animated file in place of a still that failed, where the grid may not play it', () => {
    tile.failed = [STILL];
    const big = ref({ bytes: 6 * 1024 * KIB, width: 1000, height: 1000 });
    for (const html of [render(ref(), { reducedMotion: true }), render(ref(), { saveData: true }), render(big)]) {
      expect(images(html)).toEqual([]);
      expect(html).toContain(GRAY);
      expect(html).toContain('<svg');
    }
  });

  it('keeps an animated tile gray while it waits for a playback slot, and plays the file once it has one', () => {
    tile.failed = [STILL];
    const waiting = render(ref());
    expect(images(waiting)).toEqual([]);
    expect(waiting).toContain(GRAY);
    expect(waiting).toContain('<svg');
    playback.playing = true;
    const playing = render(ref());
    expect(images(playing).map((image) => image.src)).toEqual([FILE]);
    expect(playing).not.toContain('<svg');
  });

  it('shows the file of a static sticker whose still failed', () => {
    tile.failed = [STILL];
    const html = render(ref({ animated: false }), { reducedMotion: true });
    expect(images(html).map((image) => image.src)).toEqual([FILE]);
    expect(html).not.toContain('<svg');
  });

  it('shows the still with the play mark while an animated sticker waits for its turn', () => {
    const html = render(ref());
    expect(images(html).map((image) => image.src)).toEqual([STILL]);
    expect(html).toContain('<svg');
  });

  it('keeps the still under a file that starts playing, with the file hidden until it loads', () => {
    playback.playing = true;
    const html = render(ref());
    const [under, file, ...rest] = images(html);
    expect(rest).toEqual([]);
    expect(under?.src).toBe(STILL);
    expect(under?.className).toContain('absolute inset-0');
    expect(under?.className).not.toContain('opacity-0');
    expect(file?.src).toBe(FILE);
    expect(file?.className).toContain('opacity-0');
    // The held still keeps its play mark until the file shows.
    // 垫着的静态图保留播放标记，直到文件显示出来。
    expect(html).toContain('<svg');
  });

  it('shows the file at once when there is no still to hold', () => {
    playback.playing = true;
    const shown = images(render(ref({ thumb: null })));
    expect(shown).toHaveLength(1);
    expect(shown[0]?.src).toBe(stickerFileSrc(ref({ thumb: null }), 'tok'));
    expect(shown[0]?.className).not.toContain('opacity-0');
  });
});
