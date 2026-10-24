/**
 * Pure geometry that keeps a comment target visible above the comment bar and the keyboard, and the check that
 * waits for the visual viewport to stop moving before the page is scrolled. Nothing here touches window or
 * document, so it runs in Node.
 * 让评论目标在评论栏和键盘上方保持可见的纯几何计算，以及在滚动页面之前等待可视视口停止变化的判断。这里不访问 window 或
 * document，因此可以在 Node 中运行。
 */

/** A vertical stretch in layout-viewport pixels, as getBoundingClientRect reports it. */
/** 布局视口坐标中的一段纵向范围，与 getBoundingClientRect 给出的一致。 */
export interface VerticalSpan {
  top: number;
  bottom: number;
}

/** The part of window.visualViewport the alignment reads. */
/** 对齐时读取的 window.visualViewport 字段。 */
export interface ViewportFacts {
  offsetTop: number;
  height: number;
}

/** Gap kept between the target and the header above it or the bar below it. */
/** 目标与上方顶栏或下方评论栏之间保留的间距。 */
export const ALIGN_MARGIN_PX = 8;

/** The viewport must hold still for this many frames in a row before the page is scrolled. */
/** 可视视口必须连续这么多帧不变，才滚动页面。 */
export const SETTLE_FRAMES = 2;

/** The page is scrolled after this long even if the viewport is still moving. */
/** 即使可视视口仍在变化，过了这段时间也会滚动页面。 */
export const SETTLE_MAX_MS = 450;

/**
 * The band of the page that is neither under the fixed header nor under the bar: on iPhone the visual
 * viewport starts offsetTop pixels down the layout viewport while the keyboard is up; on Android offsetTop
 * stays 0 and the height shrinks instead. `headerBottom` is the safe area plus the header height, and
 * `barHeight` the bar as laid out at the bottom of the visual viewport.
 * 页面上既不在固定顶栏之下、也不在评论栏之下的区域：iPhone 弹出键盘时，可视视口从布局视口向下 offsetTop 像素处开始；
 * 安卓上 offsetTop 保持为 0，改为高度变小。`headerBottom` 为安全区加顶栏高度，`barHeight` 为排在可视视口底部的评论栏高度。
 */
export function visibleBand(viewport: ViewportFacts, headerBottom: number, barHeight: number): VerticalSpan {
  return {
    top: viewport.offsetTop + headerBottom,
    bottom: viewport.offsetTop + viewport.height - barHeight,
  };
}

/**
 * How far to scroll the page (positive scrolls down) so the target sits inside the visible band with
 * `margin` to spare: a target below the band rises until its bottom is `margin` above the bar, one above the
 * band comes down until its top is `margin` under the header, and one already inside stays (0). A target
 * taller than the band has its bottom aligned, because that is where the conversation continues.
 * 页面需要滚动的距离（正数向下滚动），使目标留出 `margin` 位于可见区域内：在区域下方的目标上移到底边距评论栏 `margin`；
 * 在区域上方的目标下移到顶边距顶栏 `margin`；已在区域内的不动（0）。比可见区域还高的目标对齐其底边，因为对话在那里继续。
 */
export function alignDelta(target: VerticalSpan, visible: VerticalSpan, margin: number = ALIGN_MARGIN_PX): number {
  const lowest = visible.bottom - margin;
  const highest = visible.top + margin;
  const tall = target.bottom - target.top > lowest - highest;
  if (tall || target.bottom > lowest) return target.bottom - lowest;
  if (target.top < highest) return target.top - highest;
  return 0;
}

/** Progress of one wait for the visual viewport to settle. */
/** 一次等待可视视口稳定的进度。 */
export interface SettleState {
  last: ViewportFacts;
  /** Frames in a row whose viewport matched the one before. */
  /** 可视视口与上一帧相同的连续帧数。 */
  stableFrames: number;
  /** The viewport has moved since the wait began, or no move was expected. */
  /** 自等待开始后可视视口已经变化过，或者本来就不预期变化。 */
  moved: boolean;
  startedAt: number;
}

/**
 * Starts a wait. With `expectMove` (the keyboard is about to rise and has not yet), frames before the first
 * change do not count, so the page is not scrolled for the old viewport a moment before the keyboard arrives.
 * 开始一次等待。设置 `expectMove` 时（键盘即将弹出但尚未弹出），第一次变化之前的帧不计入，页面因此不会在键盘到来前一刻按旧视口滚动。
 */
export function startSettle(viewport: ViewportFacts, now: number, expectMove: boolean): SettleState {
  return { last: viewport, stableFrames: 0, moved: !expectMove, startedAt: now };
}

function sameViewport(a: ViewportFacts, b: ViewportFacts): boolean {
  return Math.abs(a.offsetTop - b.offsetTop) < 0.5 && Math.abs(a.height - b.height) < 0.5;
}

/**
 * Feeds one animation frame. Settled once the viewport has held still for SETTLE_FRAMES frames after it moved
 * (or at once, when no move was expected), or when SETTLE_MAX_MS has passed.
 * 输入一帧动画。可视视口变化之后（或在不预期变化时立即）连续 SETTLE_FRAMES 帧不变即为稳定；超过 SETTLE_MAX_MS 也视为稳定。
 */
export function stepSettle(state: SettleState, viewport: ViewportFacts, now: number): { state: SettleState; settled: boolean } {
  const still = sameViewport(state.last, viewport);
  const next: SettleState = {
    last: viewport,
    stableFrames: still ? state.stableFrames + 1 : 0,
    moved: state.moved || !still,
    startedAt: state.startedAt,
  };
  const settled = (next.moved && next.stableFrames >= SETTLE_FRAMES) || now - state.startedAt >= SETTLE_MAX_MS;
  return { state: next, settled };
}
