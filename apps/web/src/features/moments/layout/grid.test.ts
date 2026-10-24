import { describe, expect, it } from 'vitest';
import { gridCellSize, gridColumns, mediaLayout, momentContentWidth, singleLongEdge, singleMediaBox } from './grid';

function items(count: number, width: number | null = 1200, height: number | null = 900) {
  return Array.from({ length: count }, () => ({ width, height }));
}

/** Content width, cell and single long edge for the column widths of common phones and the 672px desktop column. */
/** 常见手机和 672px 桌面页面列宽下的内容宽度、格子大小和单张长边。 */
const COLUMNS = [
  { column: 320, content: 236, cell: 76, long: 146, square: 124 },
  { column: 375, content: 291, cell: 94, long: 180, square: 153 },
  { column: 430, content: 346, cell: 112, long: 215, square: 183 },
  { column: 672, content: 588, cell: 112, long: 220, square: 187 },
];

describe('content width and cells', () => {
  it.each(COLUMNS)('column $column gives content $content, cell $cell and long edge $long', ({ column, content, cell, long }) => {
    expect(momentContentWidth(column)).toBe(content);
    expect(gridCellSize(content)).toBe(cell);
    expect(singleLongEdge(content)).toBe(long);
  });

  it('keeps the cell between 72 and 112 px', () => {
    expect(gridCellSize(0)).toBe(72);
    expect(gridCellSize(100)).toBe(72);
    expect(gridCellSize(2000)).toBe(112);
    expect(gridCellSize(Number.NaN)).toBe(72);
  });

  it('never gives a negative content width', () => {
    expect(momentContentWidth(40)).toBe(0);
    expect(momentContentWidth(Number.NaN)).toBe(0);
  });

  it('uses two columns for four and up to three otherwise', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(gridColumns)).toEqual([1, 2, 3, 2, 3, 3, 3, 3, 3]);
  });
});

describe('mediaLayout', () => {
  it('has nothing to lay out without media', () => {
    expect(mediaLayout([], 291)).toBeNull();
  });

  it.each(COLUMNS)('lays out every count from 1 to 9 at column $column', ({ content, cell, long }) => {
    const expected: Record<number, { columns: number; rows: number }> = {
      2: { columns: 2, rows: 1 },
      3: { columns: 3, rows: 1 },
      4: { columns: 2, rows: 2 },
      5: { columns: 3, rows: 2 },
      6: { columns: 3, rows: 2 },
      7: { columns: 3, rows: 3 },
      8: { columns: 3, rows: 3 },
      9: { columns: 3, rows: 3 },
    };
    const single = mediaLayout(items(1), content);
    expect(single?.kind).toBe('single');
    if (single?.kind === 'single') expect(single.box.width).toBe(long);
    for (let count = 2; count <= 9; count += 1) {
      const layout = mediaLayout(items(count), content);
      const { columns, rows } = expected[count] ?? { columns: 0, rows: 0 };
      expect(layout).toEqual({
        kind: 'grid',
        columns,
        rows,
        cell,
        gap: 4,
        width: columns * cell + (columns - 1) * 4,
        height: rows * cell + (rows - 1) * 4,
      });
      // The grid always fits the content column.
      // 宫格始终放得进内容列。
      if (layout?.kind === 'grid') expect(layout.width).toBeLessThanOrEqual(content);
    }
  });

  it('keeps the same cell size for every count', () => {
    const cells = [2, 3, 4, 5, 9].map((count) => {
      const layout = mediaLayout(items(count), 291);
      return layout?.kind === 'grid' ? layout.cell : null;
    });
    expect(new Set(cells)).toEqual(new Set([94]));
  });

  it('ignores sizes in a grid, where every cell is a square crop', () => {
    expect(mediaLayout([{ width: 100, height: 5000 }, { width: null, height: null }], 291)).toMatchObject({ kind: 'grid', cell: 94, width: 192, height: 94 });
  });
});

describe('singleMediaBox', () => {
  const content = 291;

  it('sizes a landscape photo by its width', () => {
    expect(singleMediaBox(4000, 3000, content)).toEqual({ width: 180, height: 135, cropped: false, align: 'center', legacy: false });
    expect(singleMediaBox(1200, 1000, content)).toEqual({ width: 180, height: 150, cropped: false, align: 'center', legacy: false });
  });

  it('sizes a portrait photo by its height', () => {
    expect(singleMediaBox(3000, 4000, content)).toEqual({ width: 135, height: 180, cropped: false, align: 'center', legacy: false });
  });

  it('draws ratios from 0.9 to 1.1 as an 85% square', () => {
    expect(singleMediaBox(1000, 1000, content)).toEqual({ width: 153, height: 153, cropped: false, align: 'center', legacy: false });
    expect(singleMediaBox(900, 1000, content)).toEqual({ width: 153, height: 153, cropped: false, align: 'center', legacy: false });
    expect(singleMediaBox(1100, 1000, content)).toEqual({ width: 153, height: 153, cropped: false, align: 'center', legacy: false });
  });

  it('crops a 1:5 photo from the top and marks it 长图', () => {
    expect(singleMediaBox(1000, 5000, content)).toEqual({ width: 60, height: 180, cropped: true, align: 'top', legacy: false });
  });

  it('crops a 5:1 panorama around its centre', () => {
    expect(singleMediaBox(5000, 1000, content)).toEqual({ width: 180, height: 60, cropped: true, align: 'center', legacy: false });
  });

  it('stretches up to exactly 3:1 without cropping', () => {
    expect(singleMediaBox(3000, 1000, content)).toEqual({ width: 180, height: 60, cropped: false, align: 'center', legacy: false });
    expect(singleMediaBox(1000, 3000, content)).toEqual({ width: 60, height: 180, cropped: false, align: 'center', legacy: false });
  });

  it.each(COLUMNS)('gives media without a size a fixed $square px square at column $column', ({ content: width, square }) => {
    expect(singleMediaBox(null, null, width)).toEqual({ width: square, height: square, cropped: false, align: 'center', legacy: true });
    expect(singleMediaBox(1200, undefined, width)).toMatchObject({ width: square, height: square, legacy: true });
    expect(singleMediaBox(0, 900, width)).toMatchObject({ width: square, height: square, legacy: true });
    expect(singleMediaBox(Number.NaN, 900, width)).toMatchObject({ legacy: true });
  });

  it('boxes a single video the same way', () => {
    expect(mediaLayout([{ width: 1920, height: 1080 }], content)).toEqual({
      kind: 'single',
      box: { width: 180, height: 101, cropped: false, align: 'center', legacy: false },
    });
    expect(mediaLayout([{ width: 1080, height: 1920 }], content)).toEqual({
      kind: 'single',
      box: { width: 101, height: 180, cropped: false, align: 'center', legacy: false },
    });
  });

  it('caps the long edge at 220 px on wide columns', () => {
    expect(singleMediaBox(4000, 3000, 588)).toEqual({ width: 220, height: 165, cropped: false, align: 'center', legacy: false });
  });
});
