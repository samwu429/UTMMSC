/**
 * Pure geometry of the WeChat media grid on a post card: the content width beside the avatar, the cell size,
 * the columns for each count, and the sized box of a single photo or video. No DOM, so it is tested in Node.
 * 动态卡片上微信式媒体宫格的纯几何计算：头像右侧的内容宽度、格子大小、各数量对应的列数，以及单张照片或单个视频的尺寸。
 * 不访问 DOM，因此可以在 Node 中测试。
 */

/** Left and right padding of a card. */
/** 卡片左右的内边距。 */
export const CARD_GUTTER = 16;
export const CARD_AVATAR = 42;
/** Space between the avatar and the content column. */
/** 头像与内容列之间的间距。 */
export const CARD_AVATAR_GAP = 10;
export const GRID_GAP = 4;
export const GRID_CELL_MIN = 72;
export const GRID_CELL_MAX = 112;
/** Long edge of a single box: this share of the content width, at most SINGLE_LONG_MAX. */
/** 单张媒体的长边：内容宽度的这一比例，最多 SINGLE_LONG_MAX。 */
export const SINGLE_SHARE = 0.62;
export const SINGLE_LONG_MAX = 220;
/** Squares (ratios 0.9 to 1.1) and media without a recorded size use this share of the long edge. */
/** 正方形（比例 0.9 到 1.1）和没有记录尺寸的媒体使用长边的这一比例。 */
export const SQUARE_SHARE = 0.85;
export const SQUARE_RATIO_MIN = 0.9;
export const SQUARE_RATIO_MAX = 1.1;
/** Beyond this ratio either way the box stops stretching, the rest is cropped and 长图 is shown. */
/** 任一方向超过这个比例时，尺寸不再拉伸，多出部分裁切，并显示「长图」。 */
export const CROP_RATIO = 3;

export interface SingleBox {
  width: number;
  height: number;
  /** The ratio is beyond 3:1, so the box shows a crop and the 长图 badge. */
  /** 比例超过 3:1，格子显示裁切后的画面和「长图」标记。 */
  cropped: boolean;
  /** Tall crops keep the top of the picture, as WeChat does; everything else is centred. */
  /** 与微信一致，竖向裁切保留画面顶部；其余情况居中。 */
  align: 'top' | 'center';
  /** No size was recorded (media posted before sizes were stored), so the box is a fixed square. */
  /** 没有记录尺寸（记录尺寸之前发布的媒体），因此使用固定的正方形。 */
  legacy: boolean;
}

export type MediaLayout =
  | { kind: 'single'; box: SingleBox }
  | {
      kind: 'grid';
      columns: number;
      rows: number;
      /** Side of every square cell, the same for every count. */
      /** 每个正方形格子的边长，各种数量下都相同。 */
      cell: number;
      gap: number;
      width: number;
      height: number;
    };

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The content column of a card in a column of `columnWidth` px: column − 16 − 42 − 10 − 16. */
/** 在 `columnWidth` 像素宽的页面列中，卡片内容列的宽度：列宽 − 16 − 42 − 10 − 16。 */
export function momentContentWidth(columnWidth: number): number {
  if (!Number.isFinite(columnWidth)) return 0;
  return Math.max(0, columnWidth - CARD_GUTTER - CARD_AVATAR - CARD_AVATAR_GAP - CARD_GUTTER);
}

/** Side of a grid cell: a third of the content width less two gaps, kept between 72 and 112 px. */
/** 宫格格子的边长：内容宽度减去两个间隔后的三分之一，限制在 72 到 112 像素之间。 */
export function gridCellSize(contentWidth: number): number {
  const width = Number.isFinite(contentWidth) ? contentWidth : 0;
  return clamp(Math.floor((width - 2 * GRID_GAP) / 3), GRID_CELL_MIN, GRID_CELL_MAX);
}

/** One item is a single box; four make two columns; otherwise up to three columns. */
/** 一项为单张显示；四项为两列；其余最多三列。 */
export function gridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count === 4) return 2;
  return Math.min(count, 3);
}

/** The long edge of a single box: 62% of the content width, at most 220 px. */
/** 单张媒体的长边：内容宽度的 62%，最多 220 像素。 */
export function singleLongEdge(contentWidth: number): number {
  const width = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  return Math.round(Math.min(width * SINGLE_SHARE, SINGLE_LONG_MAX));
}

/**
 * The reserved box of one photo or video from its recorded size. Near-squares get 85% of the long edge;
 * landscape keeps the long edge as width and portrait as height, the short side never under a third of it.
 * 根据记录的尺寸为一张照片或一个视频预留的大小。接近正方形的取长边的 85%；横图以长边为宽，竖图以长边为高，短边不小于长边的三分之一。
 */
export function singleMediaBox(width: number | null | undefined, height: number | null | undefined, contentWidth: number): SingleBox {
  const long = singleLongEdge(contentWidth);
  const square = Math.round(long * SQUARE_SHARE);
  if (!positive(width) || !positive(height)) return { width: square, height: square, cropped: false, align: 'center', legacy: true };
  const ratio = width / height;
  if (ratio >= SQUARE_RATIO_MIN && ratio <= SQUARE_RATIO_MAX) return { width: square, height: square, cropped: false, align: 'center', legacy: false };
  if (ratio > SQUARE_RATIO_MAX) {
    return { width: long, height: Math.round(Math.max(long / ratio, long / CROP_RATIO)), cropped: ratio > CROP_RATIO, align: 'center', legacy: false };
  }
  const cropped = ratio < 1 / CROP_RATIO;
  return { width: Math.round(Math.max(long * ratio, long / CROP_RATIO)), height: long, cropped, align: cropped ? 'top' : 'center', legacy: false };
}

/** Where every item of a post goes; null when the post has no media. */
/** 一条动态的每项媒体放在哪里；没有媒体时为 null。 */
export function mediaLayout(media: readonly { width?: number | null; height?: number | null }[], contentWidth: number): MediaLayout | null {
  const count = media.length;
  if (count === 0) return null;
  const first = media[0];
  if (count === 1) return { kind: 'single', box: singleMediaBox(first?.width, first?.height, contentWidth) };
  const columns = gridColumns(count);
  const rows = Math.ceil(count / columns);
  const cell = gridCellSize(contentWidth);
  return {
    kind: 'grid',
    columns,
    rows,
    cell,
    gap: GRID_GAP,
    width: columns * cell + (columns - 1) * GRID_GAP,
    height: rows * cell + (rows - 1) * GRID_GAP,
  };
}
