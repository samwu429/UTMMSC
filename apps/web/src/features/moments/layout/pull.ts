/**
 * The arithmetic of pull to refresh and of the header that fades in over the cover, kept pure so it runs in
 * Node. On iPhone the browser's own rubber band moves the page and the pull is read from scrollY; on Android
 * the page follows the finger at half speed. The hooks in ../hooks only wire these to events.
 * 下拉刷新以及顶栏在封面上方渐显的计算，保持为纯函数，可以在 Node 中运行。iPhone 上由浏览器自带的回弹移动页面，从 scrollY 读出下拉距离；
 * 安卓上页面以手指一半的速度跟随。../hooks 中的 hook 只负责把它们接到事件上。
 */

/** Letting go at or past this pull, in px, refreshes. */
/** 下拉达到或超过这个距离（像素）后松手即刷新。 */
export const PULL_THRESHOLD = 64;
/** The Android pull stops here. */
/** 安卓上的下拉到此为止。 */
export const PULL_MAX = 120;
/** On Android the page moves half as far as the finger. */
/** 安卓上页面移动的距离是手指的一半。 */
export const PULL_RESISTANCE = 0.5;
/**
 * Finger travel, in px, after which a touch is told apart as a pull, a scroll or a sideways swipe. It is below
 * Chrome's own touch slop, so the decision is made while touchmove can still be cancelled.
 * 手指移动超过这个距离（像素）后，才区分这次触摸是下拉、滚动还是横向滑动。它小于 Chrome 自己的触摸阈值，因此做出判断时 touchmove 仍可取消。
 */
export const PULL_SLOP = 4;
/** The spinner turns this many degrees per px of pull. */
/** 每下拉 1 像素，加载图标转动的角度。 */
export const PULL_DEGREES_PER_PX = 3;
/** The spinner stays at least this long, so a fast refresh still reads as one. */
/** 加载图标至少显示这么久，刷新很快时也能看出刷新过。 */
export const MIN_REFRESH_MS = 500;
/** After letting go, the Android pull springs back over this long. */
/** 松手后，安卓上的下拉在这段时间内弹回。 */
export const PULL_SETTLE_MS = 200;

/** The moments cover, the fixed header over it, and the scroll distance the header takes to turn solid. */
/** 动态封面、覆盖在其上方的固定顶栏，以及顶栏变为不透明所需的滚动距离。 */
export const COVER_HEIGHT = 192;
export const HEADER_HEIGHT = 44;
export const HEADER_FADE = 48;

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** iPhone: the rubber band shows as a negative scrollY; its depth is the pull. */
/** iPhone：回弹表现为负的 scrollY，其深度就是下拉距离。 */
export function rubberBandPull(scrollY: number): number {
  return Number.isNaN(scrollY) ? 0 : Math.max(0, -scrollY);
}

/** Android: the finger's downward travel at half speed, up to PULL_MAX. */
/** 安卓：手指向下移动的距离按一半计算，最多 PULL_MAX。 */
export function fingerPull(dy: number): number {
  return clamp(dy * PULL_RESISTANCE, 0, PULL_MAX);
}

/** The spinner's turn in degrees. */
/** 加载图标转动的角度。 */
export function pullAngle(pull: number): number {
  return Math.max(0, pull) * PULL_DEGREES_PER_PX;
}

/** 0 at rest, 1 once letting go would refresh; the indicator fades and slides in with it. */
/** 静止时为 0，松手即可刷新时为 1；指示器随之淡入并滑入。 */
export function pullProgress(pull: number): number {
  return clamp(pull / PULL_THRESHOLD, 0, 1);
}

export function releasesRefresh(pull: number): boolean {
  return pull >= PULL_THRESHOLD;
}

/** One Android touch that may become a pull. */
/** 一次可能成为下拉的安卓触摸。 */
export interface PullGesture {
  startX: number;
  startY: number;
  /** The touch is a pull: its touchmove events are cancelled so the page does not scroll. */
  /** 这次触摸是下拉：其 touchmove 事件会被取消，页面不会滚动。 */
  engaged: boolean;
  pull: number;
}

export function startPullGesture(x: number, y: number): PullGesture {
  return { startX: x, startY: y, engaged: false, pull: 0 };
}

/**
 * The gesture after the finger moved to (x, y), or null when the touch is not a pull and belongs to the page:
 * it went up or sideways first, or the page is no longer at the top. Once engaged a touch stays a pull until
 * it ends, and moving back up only lowers the pull to 0.
 * 手指移动到 (x, y) 之后的手势；这次触摸不是下拉、应交给页面时返回 null：先向上或横向移动，或页面已不在顶部。一旦判定为下拉，
 * 直到触摸结束都保持为下拉，向上移回只会把下拉距离减到 0。
 */
export function movePullGesture(gesture: PullGesture, x: number, y: number, scrollY: number): PullGesture | null {
  const dx = x - gesture.startX;
  const dy = y - gesture.startY;
  if (gesture.engaged) return { ...gesture, pull: fingerPull(dy) };
  if (scrollY > 0) return null;
  if (Math.abs(dx) <= PULL_SLOP && Math.abs(dy) <= PULL_SLOP) return gesture;
  if (dy <= 0 || Math.abs(dx) >= dy) return null;
  return { ...gesture, engaged: true, pull: fingerPull(dy) };
}

/** The pull while springing back from `from`, `elapsedMs` after letting go; 0 once done. */
/** 从 `from` 弹回时、松手 `elapsedMs` 毫秒后的下拉距离；结束后为 0。 */
export function settlePull(from: number, elapsedMs: number): number {
  const t = clamp(elapsedMs / PULL_SETTLE_MS, 0, 1);
  const eased = 1 - (1 - t) ** 3;
  return t >= 1 ? 0 : from * (1 - eased);
}

/**
 * The header over the cover: 0 while the cover shows under it (transparent, white icons), 1 once it is solid,
 * fading over the HEADER_FADE px before the cover's bottom edge reaches the header's.
 * 覆盖在封面上方的顶栏：封面在其下方时为 0（透明、白色图标），变为不透明后为 1；在封面底边到达顶栏底边之前的 HEADER_FADE 像素内渐变。
 */
export function headerProgress(scrollY: number, coverHeight = COVER_HEIGHT, headerHeight = HEADER_HEIGHT, fade = HEADER_FADE): number {
  return clamp((scrollY - (coverHeight - headerHeight - fade)) / fade, 0, 1);
}

/** The cover has gone under the header. */
/** 封面已经滚到顶栏下面。 */
export function isPastCover(scrollY: number, coverHeight = COVER_HEIGHT, headerHeight = HEADER_HEIGHT): boolean {
  return scrollY >= coverHeight - headerHeight;
}
