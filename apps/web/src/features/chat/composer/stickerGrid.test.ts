import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuotePreview, StickerRef } from '@utmmsc/shared';
import { DEFAULT_KEYBOARD_PX } from './keyboardHeight';
import {
  STICKER_CLICK_SWALLOW_MS,
  STICKER_HOVER_PEEK_MS,
  STICKER_PEEK_MARGIN_PX,
  buildRecentTiles,
  createPeekGesture,
  firstScreenRows,
  moveGridFocus,
  peekCardPosition,
  peekCardSize,
  planStickerPick,
  quoteForSticker,
  shouldIgnoreClick,
  stickerColumns,
  stickerPanelLayout,
  stickerRefOf,
  stickerTileSize,
  type PeekGestureHandlers,
} from './stickerGrid';

describe('stickerColumns', () => {
  it('gives 4 columns up to 403 px, 5 from 404 px and at most 10', () => {
    const widths = [320, 360, 393, 403, 404, 430, 768, 1280];
    expect(widths.map(stickerColumns)).toEqual([4, 4, 4, 4, 5, 5, 9, 10]);
  });

  it('falls back to 4 for a width that cannot be measured', () => {
    expect(stickerColumns(Number.NaN)).toBe(4);
    expect(stickerColumns(0)).toBe(4);
  });

  it('makes square tiles of the width left after the side padding', () => {
    expect(stickerTileSize(360)).toBe(84);
    expect(stickerTileSize(404)).toBe(76);
    expect(stickerTileSize(430)).toBeCloseTo(81.2);
  });
});

describe('stickerPanelLayout', () => {
  it('shows no recent row and no headings while the collection and the + tile fit in two rows', () => {
    // 4 columns: 7 stickers and the + tile fill exactly two rows.
    // 4 列：7 个表情加上 + 格子正好占满两行。
    expect(stickerPanelLayout({ items: 7, columns: 4, recent: 5 })).toEqual({ showRecent: false, showHeadings: false });
    expect(stickerPanelLayout({ items: 9, columns: 5, recent: 5 })).toEqual({ showRecent: false, showHeadings: false });
  });

  it('shows the recent row and the headings once the collection is bigger than two rows', () => {
    expect(stickerPanelLayout({ items: 8, columns: 4, recent: 1 })).toEqual({ showRecent: true, showHeadings: true });
    expect(stickerPanelLayout({ items: 10, columns: 5, recent: 3 })).toEqual({ showRecent: true, showHeadings: true });
  });

  it('shows neither when nothing was sent recently, however big the collection', () => {
    expect(stickerPanelLayout({ items: 500, columns: 4, recent: 0 })).toEqual({ showRecent: false, showHeadings: false });
  });
});

describe('firstScreenRows', () => {
  it('shows two full rows in the default 280 px panel on phones, with or without a 34 px safe area', () => {
    expect(DEFAULT_KEYBOARD_PX).toBe(280);
    for (const width of [320, 360, 375, 390, 393, 402, 403, 404, 412, 430]) {
      expect(firstScreenRows(DEFAULT_KEYBOARD_PX, width)).toBeGreaterThanOrEqual(2);
      expect(firstScreenRows(DEFAULT_KEYBOARD_PX, width, 34)).toBe(2);
    }
  });

  it('counts the safe area and the two hairlines under the tab bar', () => {
    expect(firstScreenRows(260, 360, 34)).toBe(2);
    expect(firstScreenRows(220, 360, 34)).toBe(1);
    // The old 260 px default cut the second row on a 393 px iPhone with a home indicator.
    // 原来 260px 的默认高度在带主屏幕指示条的 393px iPhone 上会截掉第二行。
    expect(firstScreenRows(260, 393, 34)).toBe(1);
    // At 403 px two rows of 94.75 px take 189.5 px, plus 87 px for the tab bar, its safe area, the top gap and the hairlines.
    // 在 403px 宽时，两行 94.75px 的格子占 189.5px，另加标签栏、其安全区、顶部留白和分隔线共 87px。
    expect(firstScreenRows(277, 403, 34)).toBe(2);
    expect(firstScreenRows(276, 403, 34)).toBe(1);
  });
});

describe('buildRecentTiles', () => {
  it('keeps one row', () => {
    const recent = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
    expect(buildRecentTiles(recent, 4).map((tile) => tile.key)).toEqual(['recent:a', 'recent:b', 'recent:c', 'recent:d']);
    expect(buildRecentTiles(recent, 4).map((tile) => (tile.kind === 'sticker' ? tile.number : 0))).toEqual([1, 2, 3, 4]);
  });
});

describe('moveGridFocus', () => {
  // One grid of 10 tiles in 4 columns: rows [0..3], [4..7], [8, 9].
  // 一个 4 列共 10 格的区域：各行为 [0..3]、[4..7]、[8, 9]。
  const one = [10];

  it('moves by one across row edges and stops at both ends', () => {
    expect(moveGridFocus(3, 'ArrowRight', one, 4)).toBe(4);
    expect(moveGridFocus(4, 'ArrowLeft', one, 4)).toBe(3);
    expect(moveGridFocus(0, 'ArrowLeft', one, 4)).toBe(0);
    expect(moveGridFocus(9, 'ArrowRight', one, 4)).toBe(9);
  });

  it('moves by a row, to the last tile of the shorter last row', () => {
    expect(moveGridFocus(1, 'ArrowDown', one, 4)).toBe(5);
    expect(moveGridFocus(5, 'ArrowDown', one, 4)).toBe(9);
    expect(moveGridFocus(7, 'ArrowDown', one, 4)).toBe(9);
    expect(moveGridFocus(4, 'ArrowDown', one, 4)).toBe(8);
    expect(moveGridFocus(9, 'ArrowUp', one, 4)).toBe(5);
    expect(moveGridFocus(2, 'ArrowUp', one, 4)).toBe(2);
    expect(moveGridFocus(8, 'ArrowDown', one, 4)).toBe(8);
  });

  it('goes to the first and last tile with Home and End', () => {
    expect(moveGridFocus(6, 'Home', one, 4)).toBe(0);
    expect(moveGridFocus(6, 'End', one, 4)).toBe(9);
  });

  it('moves between the recent row and the grid below it by column', () => {
    // A recent row of 3, then 6 tiles: rows [0..2], [3..6], [7, 8].
    // 最近使用 3 个，然后 6 格：各行为 [0..2]、[3..6]、[7, 8]。
    const sections = [3, 6];
    expect(moveGridFocus(1, 'ArrowDown', sections, 4)).toBe(4);
    expect(moveGridFocus(2, 'ArrowDown', sections, 4)).toBe(5);
    expect(moveGridFocus(6, 'ArrowUp', sections, 4)).toBe(2);
    expect(moveGridFocus(3, 'ArrowUp', sections, 4)).toBe(0);
    expect(moveGridFocus(2, 'ArrowRight', sections, 4)).toBe(3);
  });

  it('skips empty sections and ignores other keys', () => {
    expect(moveGridFocus(1, 'ArrowDown', [0, 2], 4)).toBe(1);
    expect(moveGridFocus(0, 'ArrowUp', [0, 2], 4)).toBe(0);
    expect(moveGridFocus(0, 'Enter', one, 4)).toBeNull();
    expect(moveGridFocus(0, 'ArrowDown', [0], 4)).toBeNull();
  });
});

describe('peek card', () => {
  const viewport = { width: 360, height: 740 };

  it('is twice the tile, at most 160 px', () => {
    expect(peekCardSize(64)).toBe(128);
    expect(peekCardSize(84)).toBe(160);
    expect(peekCardSize(0)).toBe(0);
  });

  it('sits centred above the tile', () => {
    const tile = { left: 100, top: 500, width: 84, height: 84 };
    expect(peekCardPosition({ tile, pointer: { x: 142, y: 540 }, viewport, size: 160 })).toEqual({ left: 62, top: 332, below: false });
  });

  it('stays 8 px inside the left and right edges', () => {
    const atLeft = { left: 12, top: 500, width: 84, height: 84 };
    const atRight = { left: 264, top: 500, width: 84, height: 84 };
    expect(peekCardPosition({ tile: atLeft, pointer: { x: 40, y: 540 }, viewport, size: 160 }).left).toBe(STICKER_PEEK_MARGIN_PX);
    expect(peekCardPosition({ tile: atRight, pointer: { x: 300, y: 540 }, viewport, size: 160 }).left).toBe(360 - 8 - 160);
  });

  it('stays at the top edge when that keeps it clear of the finger', () => {
    const tile = { left: 100, top: 150, width: 84, height: 84 };
    expect(peekCardPosition({ tile, pointer: { x: 142, y: 200 }, viewport, size: 160 })).toEqual({ left: 62, top: 8, below: false });
  });

  it('goes below the finger when the top edge would put it under the finger', () => {
    const tile = { left: 100, top: 100, width: 84, height: 84 };
    const placed = peekCardPosition({ tile, pointer: { x: 142, y: 120 }, viewport, size: 160 });
    expect(placed).toEqual({ left: 62, top: 144, below: true });
    // The card never covers the fingertip.
    // 卡片永远不会盖住指尖。
    expect(placed.top).toBeGreaterThan(120);
  });

  it('stays 8 px inside the bottom edge below the finger', () => {
    const tile = { left: 100, top: 100, width: 84, height: 84 };
    expect(peekCardPosition({ tile, pointer: { x: 142, y: 120 }, viewport: { width: 360, height: 250 }, size: 160 }).top).toBe(250 - 8 - 160);
  });
});

describe('shouldIgnoreClick', () => {
  it('ignores a click when the grid scrolled after the pointer went down', () => {
    expect(shouldIgnoreClick({ scrolledSinceDown: true, lastScrollAt: 900, downAt: 1000 })).toBe(true);
  });

  it('ignores a click whose press came 50 ms after a scroll', () => {
    expect(shouldIgnoreClick({ scrolledSinceDown: false, lastScrollAt: 950, downAt: 1000 })).toBe(true);
  });

  it('sends a click whose press came 200 ms after a scroll', () => {
    expect(shouldIgnoreClick({ scrolledSinceDown: false, lastScrollAt: 800, downAt: 1000 })).toBe(false);
  });

  it('sends when the grid never scrolled or there was no press', () => {
    expect(shouldIgnoreClick({ scrolledSinceDown: false, lastScrollAt: null, downAt: 1000 })).toBe(false);
    expect(shouldIgnoreClick({ scrolledSinceDown: false, lastScrollAt: 990, downAt: null })).toBe(false);
  });
});

describe('quoteForSticker', () => {
  const quote: QuotePreview = { id: 7, authorId: 'm1', authorName: '张三', excerpt: '你好', hasImage: false, state: 'ok' };

  it('takes the quote along only when the input is empty or blank', () => {
    expect(quoteForSticker('', quote)).toBe(quote);
    expect(quoteForSticker('  \n ', quote)).toBe(quote);
    expect(quoteForSticker('好的', quote)).toBeNull();
    expect(quoteForSticker('', null)).toBeNull();
  });
});

describe('stickerRefOf', () => {
  it('keeps only the fields a send needs', () => {
    const ref: StickerRef = { id: 'stk_AAAAAAAAAAAAAAAAAAAAAA', type: 'gif', width: 200, height: 100, animated: true, bytes: 5000, thumb: null };
    expect(stickerRefOf({ ...ref, addedAt: '2026-10-26T00:00:00.000Z' } as StickerRef)).toEqual(ref);
  });
});

describe('planStickerPick', () => {
  it('takes the first 9 and says when there were more', () => {
    expect(planStickerPick(3, { held: 0, max: 999 })).toEqual({ take: 3, tooMany: false, full: false });
    expect(planStickerPick(11, { held: 10, max: 999 })).toEqual({ take: 9, tooMany: true, full: false });
  });

  it('takes nothing when the collection is full', () => {
    expect(planStickerPick(2, { held: 999, max: 999 })).toEqual({ take: 0, tooMany: false, full: true });
  });
});

describe('createPeekGesture', () => {
  let handlers: { [K in keyof PeekGestureHandlers]: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = { onPeek: vi.fn(), onPeekMove: vi.fn(), onPeekEnd: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function gesture() {
    return createPeekGesture(handlers as unknown as PeekGestureHandlers);
  }

  it('peeks after 450 ms of holding still, not before', () => {
    const g = gesture();
    g.down(3, { x: 50, y: 50 }, 1, 0);
    vi.advanceTimersByTime(449);
    expect(handlers.onPeek).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handlers.onPeek).toHaveBeenCalledWith(3, { x: 50, y: 50 }, 'press');
    expect(g.peeking).toBe(true);
  });

  it('lets a movement of 10 px pass and cancels on more, before the delay', () => {
    const g = gesture();
    const hit = () => null;
    g.down(3, { x: 50, y: 50 }, 1, 0);
    g.move({ x: 56, y: 58 }, 1, hit);
    vi.advanceTimersByTime(450);
    expect(handlers.onPeek).toHaveBeenCalledTimes(1);
    g.up(1, 500);

    const h = gesture();
    h.down(3, { x: 50, y: 50 }, 2, 1000);
    h.move({ x: 50, y: 60.5 }, 2, hit);
    vi.advanceTimersByTime(1000);
    expect(handlers.onPeek).toHaveBeenCalledTimes(1);
    expect(h.click(1600, false)).toBe('ignore');
  });

  it('follows the finger to the tile underneath and never sends on release', () => {
    const g = gesture();
    g.down(3, { x: 50, y: 50 }, 1, 0);
    vi.advanceTimersByTime(450);
    g.move({ x: 140, y: 50 }, 1, () => 4);
    g.move({ x: 142, y: 50 }, 1, () => 4);
    g.move({ x: 142, y: 400 }, 1, () => null);
    expect(handlers.onPeekMove).toHaveBeenCalledTimes(1);
    expect(handlers.onPeekMove).toHaveBeenCalledWith(4, { x: 140, y: 50 });
    g.up(1, 900);
    expect(handlers.onPeekEnd).toHaveBeenCalledTimes(1);
    expect(g.click(910, false)).toBe('swallow');
    // Only the click of that release is swallowed.
    // 只吞掉那次松开产生的 click。
    g.down(5, { x: 10, y: 10 }, 1, 2000);
    g.up(1, 2050);
    expect(g.click(2060, false)).toBe('send');
  });

  it('forgets the swallow when no click came', () => {
    const g = gesture();
    g.down(3, { x: 50, y: 50 }, 1, 0);
    vi.advanceTimersByTime(450);
    g.up(1, 500);
    expect(g.click(500 + STICKER_CLICK_SWALLOW_MS + 1, true)).toBe('send');
  });

  it('ignores the click of a press that stopped a scroll, and sends a later tap', () => {
    const g = gesture();
    g.scrolled(1000);
    g.down(2, { x: 10, y: 10 }, 1, 1050);
    g.up(1, 1100);
    expect(g.click(1100, false)).toBe('ignore');
    g.down(2, { x: 10, y: 10 }, 1, 1300);
    g.up(1, 1350);
    expect(g.click(1350, false)).toBe('send');
  });

  it('ignores the click when the grid scrolled during the press, and stops the long press', () => {
    const g = gesture();
    g.down(2, { x: 10, y: 10 }, 1, 1000);
    g.scrolled(1100);
    vi.advanceTimersByTime(450);
    expect(handlers.onPeek).not.toHaveBeenCalled();
    g.up(1, 1200);
    expect(g.click(1200, false)).toBe('ignore');
  });

  it('always sends a keyboard click', () => {
    const g = gesture();
    g.scrolled(1000);
    expect(g.click(1010, true)).toBe('send');
  });

  it('peeks after a 500 ms hover and ends when the mouse leaves', () => {
    const g = gesture();
    g.hover(1, { x: 20, y: 20 });
    vi.advanceTimersByTime(STICKER_HOVER_PEEK_MS - 1);
    expect(handlers.onPeek).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(handlers.onPeek).toHaveBeenCalledWith(1, { x: 20, y: 20 }, 'hover');
    g.hover(2, { x: 100, y: 20 });
    expect(handlers.onPeekMove).toHaveBeenCalledWith(2, { x: 100, y: 20 });
    g.leave();
    expect(handlers.onPeekEnd).toHaveBeenCalledTimes(1);
    expect(g.peeking).toBe(false);
  });

  it('keeps counting while the mouse moves inside the same tile', () => {
    const g = gesture();
    g.hover(1, { x: 20, y: 20 });
    vi.advanceTimersByTime(300);
    g.hover(1, { x: 24, y: 22 });
    vi.advanceTimersByTime(200);
    expect(handlers.onPeek).toHaveBeenCalledTimes(1);
  });

  it('does not peek when the mouse leaves before 500 ms', () => {
    const g = gesture();
    g.hover(1, { x: 20, y: 20 });
    vi.advanceTimersByTime(300);
    g.leave();
    vi.advanceTimersByTime(1000);
    expect(handlers.onPeek).not.toHaveBeenCalled();
  });

  it('ends the peek when the pointer is cancelled, with nothing to swallow', () => {
    const g = gesture();
    g.down(3, { x: 50, y: 50 }, 1, 0);
    vi.advanceTimersByTime(450);
    g.cancel(1);
    expect(handlers.onPeekEnd).toHaveBeenCalledTimes(1);
    expect(g.click(600, true)).toBe('send');
  });

  it('does not peek on a tile that has no preview', () => {
    const g = gesture();
    g.down(null, { x: 50, y: 50 }, 1, 0);
    vi.advanceTimersByTime(1000);
    expect(handlers.onPeek).not.toHaveBeenCalled();
    g.up(1, 1000);
    expect(g.click(1000, false)).toBe('send');
  });
});
