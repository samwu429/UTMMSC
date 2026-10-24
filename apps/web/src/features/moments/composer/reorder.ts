/**
 * Order of the composer's media tiles: the moves behind 设为第一张 / 前移 / 后移, and the geometry of a long-press
 * drag across the 3-column grid with the 拖到此处删除 zone under it. Pure, so the drag math is tested in Node.
 * 编辑器媒体图块的顺序：「设为第一张 / 前移 / 后移」背后的移动，以及在三列网格中长按拖动、拖到下方「拖到此处删除」区域时的几何计算。
 * 都是纯函数，拖动的计算可以在 Node 中测试。
 */

/** The composer grid always has three columns, as WeChat's does. */
/** 编辑器网格固定三列，与微信一致。 */
export const TILE_COLUMNS = 3;
/** Gap between tiles in px. */
/** 图块之间的间距（px）。 */
export const TILE_GAP = 6;
/** Height of the delete zone that slides up from the bottom while a tile is dragged, above the bottom inset. */
/** 拖动图块时从底部升起的删除区域高度，不含底部安全区。 */
export const DELETE_ZONE_HEIGHT = 72;

/** A copy of `list` with the item at `from` moved to `to`; the same order when either index is out of range. */
/** 把 `from` 位置的项目移到 `to` 后得到的新数组；任一位置越界时保持原顺序。 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** Which of 设为第一张, 前移 and 后移 apply to the tile at `index` of `count`. 删除 always applies. */
/** 第 `index` 个图块（共 `count` 个）可以使用「设为第一张」「前移」「后移」中的哪些。「删除」总是可用。 */
export function tileMoves(index: number, count: number): { first: boolean; earlier: boolean; later: boolean } {
  const valid = Number.isInteger(index) && index >= 0 && index < count;
  return { first: valid && index > 0, earlier: valid && index > 0, later: valid && index < count - 1 };
}

/** Where the grid sits on screen when the drag starts, in client px. */
/** 拖动开始时网格在屏幕上的位置（client 坐标，px）。 */
export interface GridGeometry {
  left: number;
  top: number;
  /** Side of one square tile. */
  /** 单个正方形图块的边长。 */
  cell: number;
  gap: number;
  columns: number;
}

/** Tile side for a grid `width` px wide: three squares and two gaps fill it. */
/** 宽度为 `width` px 的网格中图块的边长：三个正方形加两条间距正好排满。 */
export function tileSide(width: number, gap = TILE_GAP, columns = TILE_COLUMNS): number {
  if (!(width > 0)) return 0;
  return Math.max(0, (width - gap * (columns - 1)) / columns);
}

/** Top-left corner of slot `index`, relative to the grid. */
/** 第 `index` 个位置的左上角，相对于网格。 */
export function slotOrigin(geometry: Pick<GridGeometry, 'cell' | 'gap' | 'columns'>, index: number): { x: number; y: number } {
  const step = geometry.cell + geometry.gap;
  return { x: (index % geometry.columns) * step, y: Math.floor(index / geometry.columns) * step };
}

/**
 * The slot under the centre of the dragged tile at (x, y) in client px, among `count` tiles. A point in a
 * gap belongs to the nearer slot, and points outside the grid clamp to the first or the last tile, so the
 * "+" tile after the last one is never a target.
 * 被拖动图块的中心位于 (x, y)（client 坐标）时，它在 `count` 个图块中对应的位置。落在间距里的点归到较近的位置；
 * 网格以外的点夹到第一个或最后一个图块，因此最后一个图块之后的「+」永远不是目标。
 */
export function slotAt(geometry: GridGeometry, count: number, x: number, y: number): number {
  if (count <= 0) return 0;
  const step = geometry.cell + geometry.gap;
  if (!(step > 0)) return 0;
  const column = Math.min(geometry.columns - 1, Math.max(0, Math.floor((x - geometry.left + geometry.gap / 2) / step)));
  const row = Math.max(0, Math.floor((y - geometry.top + geometry.gap / 2) / step));
  return Math.min(count - 1, row * geometry.columns + column);
}

/**
 * Where the tile now at `index` is drawn while the tile at `from` is held over slot `to`: the held tile takes
 * `to`, and the ones between shift by one to make room.
 * 当 `from` 位置的图块悬停在 `to` 位置上方时，当前位于 `index` 的图块应画在哪个位置：被拖的图块占据 `to`，
 * 两者之间的图块依次挪动一格让出位置。
 */
export function shiftedSlot(index: number, from: number, to: number): number {
  if (index === from) return to;
  if (from < to && index > from && index <= to) return index - 1;
  if (from > to && index >= to && index < from) return index + 1;
  return index;
}

/** The finger at clientY is over the delete zone, whose top edge is at zoneTop. */
/** 手指位于 clientY 时是否在删除区域内；删除区域的上边缘在 zoneTop。 */
export function inDeleteZone(clientY: number, zoneTop: number): boolean {
  return Number.isFinite(clientY) && Number.isFinite(zoneTop) && clientY >= zoneTop;
}
