import { describe, expect, it } from 'vitest';
import { inDeleteZone, moveItem, shiftedSlot, slotAt, slotOrigin, tileMoves, tileSide, type GridGeometry } from './reorder';

const grid: GridGeometry = { left: 20, top: 100, cell: 100, gap: 6, columns: 3 };

/** The centre of slot `index` in client px. */
/** 第 `index` 个位置的中心（client 坐标）。 */
function centre(index: number): { x: number; y: number } {
  const origin = slotOrigin(grid, index);
  return { x: grid.left + origin.x + grid.cell / 2, y: grid.top + origin.y + grid.cell / 2 };
}

describe('moving tiles', () => {
  it('moves an item forwards and backwards without touching the input', () => {
    const list = ['a', 'b', 'c', 'd'] as const;
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(list, 2, 3)).toEqual(['a', 'b', 'd', 'c']);
    expect(list).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the order for the same index or an index out of range', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 1, 1)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
    expect(moveItem(list, 0, 3)).toEqual(list);
    expect(moveItem(list, 0.5, 1)).toEqual(list);
    expect(moveItem(list, 1, 1)).not.toBe(list);
  });

  it('offers 设为第一张, 前移 and 后移 only where they move something', () => {
    expect(tileMoves(0, 3)).toEqual({ first: false, earlier: false, later: true });
    expect(tileMoves(1, 3)).toEqual({ first: true, earlier: true, later: true });
    expect(tileMoves(2, 3)).toEqual({ first: true, earlier: true, later: false });
    expect(tileMoves(0, 1)).toEqual({ first: false, earlier: false, later: false });
    expect(tileMoves(5, 3)).toEqual({ first: false, earlier: false, later: false });
  });
});

describe('drag geometry', () => {
  it('fits three squares and two gaps in the grid width', () => {
    expect(tileSide(312)).toBe(100);
    expect(tileSide(0)).toBe(0);
    expect(tileSide(Number.NaN)).toBe(0);
  });

  it('lays slots out in rows of three', () => {
    expect(slotOrigin(grid, 0)).toEqual({ x: 0, y: 0 });
    expect(slotOrigin(grid, 2)).toEqual({ x: 212, y: 0 });
    expect(slotOrigin(grid, 4)).toEqual({ x: 106, y: 106 });
    expect(slotOrigin(grid, 8)).toEqual({ x: 212, y: 212 });
  });

  it('finds the slot under the centre of the held tile', () => {
    for (let index = 0; index < 9; index += 1) {
      const { x, y } = centre(index);
      expect(slotAt(grid, 9, x, y)).toBe(index);
    }
  });

  it('gives a point in a gap to the nearer slot', () => {
    // The gap between slot 0 and slot 1 spans x 120..126; its left half belongs to slot 0.
    // 位置 0 与位置 1 之间的间距为 x 120..126；左半边归位置 0。
    expect(slotAt(grid, 9, 122, 150)).toBe(0);
    expect(slotAt(grid, 9, 124, 150)).toBe(1);
  });

  it('clamps points outside the grid, and never targets the + tile', () => {
    expect(slotAt(grid, 9, -500, -500)).toBe(0);
    expect(slotAt(grid, 9, 5000, 150)).toBe(2);
    expect(slotAt(grid, 9, 5000, 5000)).toBe(8);
    // Four tiles: the + tile sits in slot 4, so a drop there lands on the last tile.
    // 四个图块时「+」位于位置 4，拖到那里会落在最后一个图块上。
    const plus = centre(4);
    expect(slotAt(grid, 4, plus.x, plus.y)).toBe(3);
    expect(slotAt(grid, 0, 0, 0)).toBe(0);
  });

  it('shifts the tiles between the start and the target by one', () => {
    // Holding tile 1 over slot 3 among five: 0 stays, 2 and 3 move back, 4 stays.
    // 五个图块中把图块 1 悬停在位置 3：0 不动，2 和 3 前移一格，4 不动。
    expect([0, 1, 2, 3, 4].map((index) => shiftedSlot(index, 1, 3))).toEqual([0, 3, 1, 2, 4]);
    // Holding tile 3 over slot 0: 0, 1 and 2 move forward.
    // 把图块 3 悬停在位置 0：0、1、2 后移一格。
    expect([0, 1, 2, 3, 4].map((index) => shiftedSlot(index, 3, 0))).toEqual([1, 2, 3, 0, 4]);
    expect([0, 1, 2].map((index) => shiftedSlot(index, 1, 1))).toEqual([0, 1, 2]);
  });

  it('tells when the finger is over the delete zone', () => {
    expect(inDeleteZone(700, 700)).toBe(true);
    expect(inDeleteZone(760, 700)).toBe(true);
    expect(inDeleteZone(699, 700)).toBe(false);
    expect(inDeleteZone(Number.NaN, 700)).toBe(false);
  });
});
