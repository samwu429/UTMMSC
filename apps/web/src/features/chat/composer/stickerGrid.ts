import { STICKER_PICK_MAX, type QuotePreview, type StickerRef } from '@utmmsc/shared';
import { LONG_PRESS_DELAY_MS, LONG_PRESS_TOLERANCE_PX } from '../../../shared/ui/useLongPress';

/**
 * Layout and gestures of the sticker grids (the panel's 我的表情 tab and the manage screen), kept free of React and
 * the DOM so the numbers and the rules of 1.3 can be tested in node.
 * 表情格子（面板中的「我的表情」标签和管理界面）的布局与手势，不依赖 React 和 DOM，1.3 中的数值和规则因此可以在 node 中测试。
 */

/** The width a column aims for; the panel width decides how many fit. */
/** 每列的目标宽度；能放下几列由面板宽度决定。 */
export const STICKER_COLUMN_TARGET_PX = 76;
/** The grid's side padding, both sides together (12 px each). */
/** 格子两侧留白之和（每侧 12px）。 */
export const STICKER_GRID_GUTTER_PX = 24;
export const STICKER_COLUMNS_MIN = 4;
export const STICKER_COLUMNS_MAX = 10;
/** Space between a tile's edge and the sticker inside it. */
/** 格子边缘与其中表情之间的留白。 */
export const STICKER_TILE_PADDING_PX = 6;
/** Space above the first row when there is no heading. */
/** 没有标题时第一行上方的留白。 */
export const STICKER_GRID_TOP_PX = 8;
/** The panel's tab bar, without the safe area under it. */
/** 面板标签栏的高度，不含其下方的安全区。 */
export const STICKER_TAB_BAR_PX = 44;
/** The 0.5 px lines on top of the grid and of the tab bar, together. */
/** 格子顶部和标签栏顶部两条 0.5px 分隔线之和。 */
export const STICKER_PANEL_LINES_PX = 1;
/** A mouse resting on a tile this long shows the peek card. */
/** 鼠标在格子上停留这么久后显示预览卡片。 */
export const STICKER_HOVER_PEEK_MS = 500;
/** A tap this soon after the grid scrolled stopped a fling and sends nothing. */
/** 格子滚动后这么短的时间内的点按是在停住滑动，不发送任何内容。 */
export const STICKER_SCROLL_GUARD_MS = 100;
/** The click that follows a long press arrives within this window and is swallowed. */
/** 长按之后的 click 会在这段时间内到达，并被吞掉。 */
export const STICKER_CLICK_SWALLOW_MS = 350;
/** The peek card is twice the tile, at most this. */
/** 预览卡片为格子的两倍大小，最大为此值。 */
export const STICKER_PEEK_MAX_PX = 160;
/** The peek card stays this far inside the viewport. */
/** 预览卡片与视口边缘至少保持这个距离。 */
export const STICKER_PEEK_MARGIN_PX = 8;
/** Space between the peek card and the tile it is above. */
/** 预览卡片与其下方格子之间的间距。 */
export const STICKER_PEEK_GAP_PX = 8;
/** Room left around the fingertip so the card never sits under it. */
/** 指尖周围留出的空间，卡片因此不会被手指挡住。 */
export const STICKER_PEEK_FINGER_PX = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Columns for a panel this wide: about 76 px each, 4 on most phones, 5 from 404 px, at most 10. */
/** 这个宽度的面板放几列：每列约 76px，多数手机 4 列，404px 起 5 列，最多 10 列。 */
export function stickerColumns(panelWidth: number): number {
  if (!Number.isFinite(panelWidth)) return STICKER_COLUMNS_MIN;
  return clamp(Math.floor((panelWidth - STICKER_GRID_GUTTER_PX) / STICKER_COLUMN_TARGET_PX), STICKER_COLUMNS_MIN, STICKER_COLUMNS_MAX);
}

/** The side of one square tile. */
/** 一个正方形格子的边长。 */
export function stickerTileSize(panelWidth: number): number {
  const width = Number.isFinite(panelWidth) ? Math.max(0, panelWidth - STICKER_GRID_GUTTER_PX) : 0;
  return width / stickerColumns(panelWidth);
}

/**
 * Whether the panel shows the 最近使用 row and the two headings. While the collection and the + tile fit in two rows
 * there is neither, so the first screen shows two full rows of stickers; above that the recent row appears when there
 * is anything recent, and the headings only with it.
 * 面板是否显示「最近使用」一行和两个标题。表情加上 + 格子能放进两行时都不显示，第一屏因此能完整显示两行表情；超过两行后，
 * 有最近使用的表情时才显示这一行，标题只与它一同出现。
 */
export function stickerPanelLayout({ items, columns, recent }: { items: number; columns: number; recent: number }): { showRecent: boolean; showHeadings: boolean } {
  const showRecent = items + 1 > 2 * columns && recent > 0;
  return { showRecent, showHeadings: showRecent };
}

/** Full rows of tiles the first screen of the panel shows when there is no heading. */
/** 没有标题时，面板第一屏能完整显示的格子行数。 */
export function firstScreenRows(panelHeight: number, panelWidth: number, safeBottom = 0): number {
  const tile = stickerTileSize(panelWidth);
  if (tile <= 0) return 0;
  const room = panelHeight - STICKER_TAB_BAR_PX - safeBottom - STICKER_GRID_TOP_PX - STICKER_PANEL_LINES_PX;
  return Math.max(0, Math.floor(room / tile));
}

export type StickerGridTile<I, U> =
  | { kind: 'add'; key: string; inactive: boolean }
  | { kind: 'upload'; key: string; upload: U }
  // `number` is the sticker's 1-based place in its section, for its label.
  // `number` 是表情在所在区域中从 1 开始的位置，用于其朗读标签。
  | { kind: 'sticker'; key: string; sticker: I; number: number };

/**
 * The tiles of 我的表情 in order: the + tile, the upload tiles, then every sticker. The + tile is always first, also
 * while selecting (then inactive), so no tile moves under the finger when selection starts.
 * 「我的表情」中格子的顺序：+ 格子、上传中的格子，然后是每个表情。+ 格子始终在第一位，选择时也一样（此时不可用），
 * 因此开始选择时没有格子会在手指下移动。
 */
export function buildGridTiles<I extends { id: string }, U extends { localId: string }>(
  items: readonly I[],
  uploads: readonly U[],
  { addInactive }: { addInactive: boolean },
): StickerGridTile<I, U>[] {
  const tiles: StickerGridTile<I, U>[] = [{ kind: 'add', key: 'add', inactive: addInactive }];
  for (const upload of uploads) tiles.push({ kind: 'upload', key: `upload:${upload.localId}`, upload });
  items.forEach((sticker, index) => tiles.push({ kind: 'sticker', key: `item:${sticker.id}`, sticker, number: index + 1 }));
  return tiles;
}

/** The one 最近使用 row: as many recent stickers as there are columns. */
/** 「最近使用」这一行：与列数一样多的最近使用的表情。 */
export function buildRecentTiles<I extends { id: string }>(recent: readonly I[], columns: number): StickerGridTile<I, never>[] {
  return recent.slice(0, Math.max(0, columns)).map((sticker, index) => ({ kind: 'sticker', key: `recent:${sticker.id}`, sticker, number: index + 1 }));
}

/**
 * Where focus goes for a key in grids laid out one after another (the recent row, then 我的表情), each starting on a
 * new row. Left and right move by one in reading order; up and down move by a row, to the last tile of a shorter row;
 * Home and End go to the first and last tile. The index stays when there is nowhere to go; null for other keys.
 * 在依次排列的格子区域（最近使用一行，然后是我的表情，每个区域从新的一行开始）中，按键后焦点去哪里。左右键按阅读顺序移动一格；
 * 上下键移动一行，行较短时落在该行最后一格；Home 和 End 到第一格和最后一格。无处可去时位置不变；其他按键为 null。
 */
export function moveGridFocus(index: number, key: string, sections: readonly number[], columns: number): number | null {
  const sizes = sections.map((size) => Math.max(0, Math.floor(size)));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const width = Math.max(1, Math.floor(columns));
  if (total === 0) return null;
  const current = clamp(Math.floor(index), 0, total - 1);
  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, current - 1);
    case 'ArrowRight':
      return Math.min(total - 1, current + 1);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    case 'ArrowUp':
    case 'ArrowDown':
      break;
    default:
      return null;
  }
  let section = 0;
  let start = 0;
  while (current >= start + (sizes[section] ?? 0)) {
    start += sizes[section] ?? 0;
    section += 1;
  }
  const size = sizes[section] ?? 0;
  const offset = current - start;
  const row = Math.floor(offset / width);
  const column = offset % width;
  if (key === 'ArrowDown') {
    if ((row + 1) * width < size) return start + Math.min((row + 1) * width + column, size - 1);
    let next = section + 1;
    const nextStart = start + size;
    while (next < sizes.length && (sizes[next] ?? 0) === 0) next += 1;
    if (next >= sizes.length) return current;
    return nextStart + Math.min(column, (sizes[next] ?? 1) - 1);
  }
  if (row > 0) return start + (row - 1) * width + column;
  let previous = section - 1;
  while (previous >= 0 && (sizes[previous] ?? 0) === 0) previous -= 1;
  if (previous < 0) return current;
  const previousSize = sizes[previous] ?? 0;
  const previousStart = start - previousSize;
  const lastRow = Math.floor((previousSize - 1) / width);
  return previousStart + Math.min(lastRow * width + column, previousSize - 1);
}

/** The side of the peek card: twice the tile, at most 160 px. */
/** 预览卡片的边长：格子的两倍，最大 160px。 */
export function peekCardSize(tileSize: number): number {
  if (!Number.isFinite(tileSize) || tileSize <= 0) return 0;
  return Math.min(2 * tileSize, STICKER_PEEK_MAX_PX);
}

export interface GridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Where the peek card goes: centred above the tile and kept 8 px inside the viewport. When keeping it inside would
 * put it over the finger (a tile near the top), it goes below the finger instead.
 * 预览卡片的位置：在格子上方居中，并与视口边缘保持 8px。若为了留在视口内而会盖住手指（格子靠近顶部时），就改放在手指下方。
 */
export function peekCardPosition({
  tile,
  pointer,
  viewport,
  size,
}: {
  tile: GridRect;
  pointer: GridPoint;
  viewport: { width: number; height: number };
  size: number;
}): { left: number; top: number; below: boolean } {
  const margin = STICKER_PEEK_MARGIN_PX;
  const left = clamp(tile.left + tile.width / 2 - size / 2, margin, Math.max(margin, viewport.width - margin - size));
  const maxTop = Math.max(margin, viewport.height - margin - size);
  const above = tile.top - STICKER_PEEK_GAP_PX - size;
  if (above >= margin) return { left, top: Math.min(above, maxTop), below: false };
  // Pushed down to the top edge: still clear of the finger, or moved under it.
  // 被推到顶部边缘：仍然不挡手指，或者移到手指下方。
  if (margin + size <= pointer.y - STICKER_PEEK_FINGER_PX) return { left, top: margin, below: false };
  return { left, top: clamp(pointer.y + STICKER_PEEK_FINGER_PX, margin, maxTop), below: true };
}

/**
 * A click that ends a press which stopped a moving grid is not a tap on a sticker: the grid scrolled after the pointer
 * went down, or less than 100 ms before.
 * 按下时让正在滚动的格子停住的那次 click 不算点按表情：指针按下之后格子滚动过，或在按下前不到 100ms 内滚动过。
 */
export function shouldIgnoreClick({
  scrolledSinceDown,
  lastScrollAt,
  downAt,
}: {
  scrolledSinceDown: boolean;
  lastScrollAt: number | null;
  downAt: number | null;
}): boolean {
  if (scrolledSinceDown) return true;
  if (lastScrollAt === null || downAt === null) return false;
  return downAt >= lastScrollAt && downAt - lastScrollAt < STICKER_SCROLL_GUARD_MS;
}

/**
 * The quote a sticker takes with it: the pending quote when the input is empty or blank, so a typed reply keeps its
 * quote; otherwise none.
 * 表情随之发送的引用：输入框为空或只有空白时带上待发送的引用，这样已经打好的回复仍保留它的引用；否则不带。
 */
export function quoteForSticker(inputText: string, quote: QuotePreview | null): QuotePreview | null {
  return inputText.trim() === '' ? quote : null;
}

/** Only the fields of a sticker a send needs, without a collection row's extras such as addedAt. */
/** 发送所需的表情字段，不含收藏记录的附加字段（例如 addedAt）。 */
export function stickerRefOf(sticker: StickerRef): StickerRef {
  const { id, type, width, height, animated, bytes, thumb } = sticker;
  return { id, type, width, height, animated, bytes, thumb };
}

/**
 * What a pick of `count` files does: nothing when the collection is already full (the + tile says so), else the
 * first 9, saying so when there were more.
 * 选择 `count` 个文件的处理方式：表情列表已满时什么都不做（+ 格子会说明原因）；否则取前 9 个，超过时提示。
 */
export function planStickerPick(count: number, { held, max }: { held: number; max: number }): { take: number; tooMany: boolean; full: boolean } {
  const full = held >= max;
  if (full) return { take: 0, tooMany: false, full };
  return { take: Math.min(Math.max(0, count), STICKER_PICK_MAX), tooMany: count > STICKER_PICK_MAX, full };
}

export type PeekSource = 'press' | 'hover';

export interface PeekGestureHandlers {
  /** A long press or a resting mouse opened the card on this tile. */
  /** 长按或停留的鼠标在这个格子上打开了卡片。 */
  onPeek(index: number, point: GridPoint, source: PeekSource): void;
  /** The finger or the mouse moved onto another tile while the card shows. */
  /** 卡片显示期间，手指或鼠标移到了另一个格子上。 */
  onPeekMove(index: number, point: GridPoint): void;
  onPeekEnd(): void;
}

export type GridClick = 'send' | 'ignore' | 'swallow';

export interface PeekGesture {
  readonly peeking: boolean;
  readonly source: PeekSource | null;
  /** A pointer went down on a tile; `index` is null for tiles that do not peek (the + tile, uploads). */
  /** 指针在格子上按下；对于不预览的格子（+ 格子、上传中的格子），`index` 为 null。 */
  down(index: number | null, point: GridPoint, pointerId: number, at: number): void;
  /** `hit` finds the peekable tile under a point, or null. */
  /** `hit` 找出某个位置下可预览的格子，没有时为 null。 */
  move(point: GridPoint, pointerId: number, hit: (point: GridPoint) => number | null): void;
  up(pointerId: number, at: number): void;
  cancel(pointerId: number): void;
  scrolled(at: number): void;
  /** What a click should do. Keyboard clicks (and other clicks without a press) always send. */
  /** 一次 click 应当如何处理。键盘触发的 click（以及其他没有按压的 click）总是发送。 */
  click(at: number, fromKeyboard: boolean): GridClick;
  hover(index: number | null, point: GridPoint): void;
  leave(): void;
  dispose(): void;
}

/**
 * The press, peek and click rules of one grid. A 450 ms hold on a sticker peeks (moving more than 10 px first lets
 * the grid scroll instead); while peeking the card follows the finger from tile to tile; lifting the finger only
 * closes it and the click after it is swallowed. A click after the grid moved is ignored. A mouse resting 500 ms on a
 * sticker peeks too, and leaving ends it.
 * 一个表情格子的按压、预览和点击规则。在表情上按住 450ms 会显示预览（在此之前移动超过 10px 则改为让格子滚动）；预览期间卡片随手指
 * 从一个格子移到另一个格子；抬起手指只会关闭卡片，之后的 click 会被吞掉。格子滚动之后的 click 会被忽略。鼠标在表情上停留 500ms
 * 也会预览，移开即结束。
 */
export function createPeekGesture(handlers: PeekGestureHandlers): PeekGesture {
  let phase: 'idle' | 'pressing' | 'peeking' = 'idle';
  let source: PeekSource | null = null;
  let pointerId: number | null = null;
  let start: GridPoint = { x: 0, y: 0 };
  let pressIndex: number | null = null;
  let peekIndex: number | null = null;
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hoverIndex: number | null = null;
  let downAt: number | null = null;
  let moved = false;
  let scrolledSinceDown = false;
  let lastScrollAt: number | null = null;
  let swallowUntil: number | null = null;

  function clearPressTimer(): void {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
  }

  function clearHoverTimer(): void {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = null;
  }

  function endPeek(): void {
    if (phase !== 'peeking') return;
    phase = 'idle';
    source = null;
    peekIndex = null;
    handlers.onPeekEnd();
  }

  function endPress(): void {
    clearPressTimer();
    if (phase === 'pressing') phase = 'idle';
    pointerId = null;
    pressIndex = null;
  }

  return {
    get peeking() {
      return phase === 'peeking';
    },
    get source() {
      return source;
    },
    down(index, point, id, at) {
      clearHoverTimer();
      hoverIndex = null;
      if (source === 'hover') endPeek();
      endPress();
      downAt = at;
      moved = false;
      scrolledSinceDown = false;
      swallowUntil = null;
      pointerId = id;
      start = point;
      if (index === null || phase === 'peeking') return;
      phase = 'pressing';
      pressIndex = index;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        if (phase !== 'pressing' || pressIndex === null) return;
        phase = 'peeking';
        source = 'press';
        peekIndex = pressIndex;
        handlers.onPeek(pressIndex, start, 'press');
      }, LONG_PRESS_DELAY_MS);
    },
    move(point, id, hit) {
      if (id !== pointerId) return;
      if (phase === 'peeking' && source === 'press') {
        const index = hit(point);
        if (index === null || index === peekIndex) return;
        peekIndex = index;
        handlers.onPeekMove(index, point);
        return;
      }
      if (moved) return;
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (dx * dx + dy * dy <= LONG_PRESS_TOLERANCE_PX * LONG_PRESS_TOLERANCE_PX) return;
      // Moved first: this press scrolls the grid and is no tap.
      // 先移动了：这次按压是在滚动格子，不是点按。
      moved = true;
      clearPressTimer();
      if (phase === 'pressing') phase = 'idle';
    },
    up(id, at) {
      if (id !== pointerId) return;
      if (phase === 'peeking' && source === 'press') {
        endPeek();
        swallowUntil = at + STICKER_CLICK_SWALLOW_MS;
      }
      endPress();
    },
    cancel(id) {
      if (id !== pointerId) return;
      if (phase === 'peeking' && source === 'press') endPeek();
      endPress();
      downAt = null;
    },
    scrolled(at) {
      lastScrollAt = at;
      if (downAt === null) return;
      scrolledSinceDown = true;
      if (phase === 'pressing') {
        clearPressTimer();
        phase = 'idle';
      }
    },
    click(at, fromKeyboard) {
      if (swallowUntil !== null) {
        const swallow = at <= swallowUntil;
        swallowUntil = null;
        if (swallow) {
          downAt = null;
          return 'swallow';
        }
      }
      if (fromKeyboard || downAt === null) return 'send';
      const ignore = moved || shouldIgnoreClick({ scrolledSinceDown, lastScrollAt, downAt });
      downAt = null;
      return ignore ? 'ignore' : 'send';
    },
    hover(index, point) {
      if (phase === 'pressing' || (phase === 'peeking' && source === 'press')) return;
      if (index === null) {
        hoverIndex = null;
        clearHoverTimer();
        endPeek();
        return;
      }
      if (phase === 'peeking') {
        hoverIndex = index;
        if (index === peekIndex) return;
        peekIndex = index;
        handlers.onPeekMove(index, point);
        return;
      }
      // Moving onto the image inside the same tile keeps the countdown going.
      // 移到同一个格子里的图片上时，倒计时继续。
      if (index === hoverIndex && hoverTimer) return;
      hoverIndex = index;
      clearHoverTimer();
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        if (phase !== 'idle') return;
        phase = 'peeking';
        source = 'hover';
        peekIndex = index;
        handlers.onPeek(index, point, 'hover');
      }, STICKER_HOVER_PEEK_MS);
    },
    leave() {
      hoverIndex = null;
      clearHoverTimer();
      if (source === 'hover') endPeek();
    },
    dispose() {
      clearHoverTimer();
      clearPressTimer();
      phase = 'idle';
      source = null;
      pointerId = null;
    },
  };
}
