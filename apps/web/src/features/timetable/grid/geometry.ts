/**
 * Owner: T3, timetable web core. The week grid's arithmetic, kept pure so it is tested: the hour height that fits
 * 09:00-21:00 on screen, snapping a tap to a slot, and the swipe rules (axis lock, edge guard, when a swipe changes
 * the week). The grid itself sizes with CSS (timetable.css) from the same formula, so a resize re-renders nothing.
 * 维护者：T3，课表网页核心。周课表的计算，保持为纯函数以便测试：让 09:00-21:00 放进屏幕的小时高度、把点按对齐到时间格，
 * 以及滑动规则（锁定方向、边缘保护、何时切换周）。课表本身用 CSS（timetable.css）按同一公式定尺寸，因此调整窗口大小不会重新渲染。
 */
import { TIMETABLE_DAY_END_MIN, TIMETABLE_DAY_START_MIN, TIMETABLE_MEETING_MIN_MIN } from '@utmmsc/shared';

export const GRID_HOURS = (TIMETABLE_DAY_END_MIN - TIMETABLE_DAY_START_MIN) / 60;
/** Header 48 px, tabs row 40 px and day heads 36 px above the hours. */
/** 小时区域上方的标题栏 48 px、标签行 40 px 与日期行 36 px。 */
export const GRID_CHROME_PX = 48 + 40 + 36;
/** In a short landscape window the tabs join the header, leaving 48 px plus the day heads. */
/** 在较矮的横屏窗口中，标签并入标题栏，只剩 48 px 加日期行。 */
export const GRID_CHROME_COMPACT_PX = 48 + 36;
export const MIN_HOUR_PX = 44;
export const MIN_HOUR_COMPACT_PX = 32;
/** The latest start a tap on an empty slot offers. */
/** 点按空白时间格时提供的最晚开始时间。 */
export const LATEST_TAP_START_MIN = 20 * 60 + 30;
export const DEFAULT_DURATION_MIN = 60;

/** A touch that moved more than this is a drag, not a tap, and its axis is then locked. */
/** 移动超过这个距离的触摸是拖动而不是点按，此时锁定其方向。 */
export const DRAG_SLOP_PX = 10;
/** Touches that start this close to a screen edge belong to the system back gesture. */
/** 从距屏幕边缘这么近处开始的触摸属于系统返回手势。 */
export const EDGE_GUARD_PX = 20;
/** A swipe changes the week past this share of the width, or when faster than SWIPE_VELOCITY_PX_MS. */
/** 滑动超过宽度的这一比例，或快于 SWIPE_VELOCITY_PX_MS 时切换周。 */
export const SWIPE_DISTANCE_SHARE = 0.25;
export const SWIPE_VELOCITY_PX_MS = 0.3;
export const SWIPE_ANIMATION_MS = 200;

/** A tall desktop window stops growing the hours here, so blocks keep a sensible size. */
/** 高大的桌面窗口在此处停止放大小时高度，使方块保持合适的大小。 */
export const MAX_HOUR_PX = 88;

/**
 * One hour's height: (window height - safe areas - chrome - 1 px) / 12, at least 44 px (32 px in a short landscape
 * window) and at most 88 px; below the minimum the grid scrolls. The pixel less keeps rounding from making a grid
 * that fits scroll by a hair. About 53 px on a 390x844 phone. timetable.css computes the same.
 * 一小时的高度：（窗口高度 - 安全区 - 上方栏 - 1 px）/ 12，至少 44 px（较矮的横屏窗口为 32 px），至多 88 px；低于最小值时课表可以滚动。
 * 少算的一像素避免四舍五入让刚好放得下的课表出现一丝滚动。在 390x844 的手机上约为 53 px。timetable.css 的计算与此相同。
 */
export function hourHeightPx(viewportHeight: number, safeTop: number, safeBottom: number, compact = false): number {
  const chrome = compact ? GRID_CHROME_COMPACT_PX : GRID_CHROME_PX;
  const fit = (viewportHeight - safeTop - safeBottom - chrome - 1) / GRID_HOURS;
  return Math.min(MAX_HOUR_PX, Math.max(compact ? MIN_HOUR_COMPACT_PX : MIN_HOUR_PX, fit));
}

/** A short landscape window: 500 px tall or less and wider than tall. */
/** 较矮的横屏窗口：高度不超过 500 px 且宽大于高。 */
export function isCompactWindow(width: number, height: number): boolean {
  return height <= 500 && width > height;
}

/** Where a minute sits down the grid, in hours from 09:00. */
/** 某一分钟在课表中的纵向位置，以距 09:00 的小时数表示。 */
export function hoursFromTop(minute: number): number {
  return (minute - TIMETABLE_DAY_START_MIN) / 60;
}

/**
 * The start a tap on an empty slot offers: the half hour at or above the tap, no later than 20:30.
 * 点按空白时间格时提供的开始时间：点按位置所在或其上方的半点，不晚于 20:30。
 */
export function slotStartAt(offsetY: number, columnHeight: number): number {
  if (!(columnHeight > 0)) return TIMETABLE_DAY_START_MIN;
  const share = Math.min(1, Math.max(0, offsetY / columnHeight));
  const minute = TIMETABLE_DAY_START_MIN + share * (TIMETABLE_DAY_END_MIN - TIMETABLE_DAY_START_MIN);
  const snapped = Math.floor(minute / 30) * 30;
  return Math.min(LATEST_TAP_START_MIN, Math.max(TIMETABLE_DAY_START_MIN, snapped));
}

/** The end for a new class: the last duration used, never past 21:00 nor under 10 minutes. */
/** 新课的结束时间：使用上次的时长，不晚于 21:00，也不短于 10 分钟。 */
export function endForDuration(startMin: number, durationMin: number): number {
  const wanted = startMin + Math.max(TIMETABLE_MEETING_MIN_MIN, Math.round(durationMin / 5) * 5);
  return Math.min(TIMETABLE_DAY_END_MIN, Math.max(startMin + TIMETABLE_MEETING_MIN_MIN, wanted));
}

/** The axis a drag is locked to once it moves past the slop, or null while it is still a possible tap. */
/** 拖动超过阈值后锁定的方向；仍可能是点按时为 null。 */
export function lockAxis(dx: number, dy: number, slop = DRAG_SLOP_PX): 'x' | 'y' | null {
  if (Math.abs(dx) <= slop && Math.abs(dy) <= slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

export function startsAtEdge(clientX: number, viewportWidth: number, guard = EDGE_GUARD_PX): boolean {
  return clientX < guard || clientX > viewportWidth - guard;
}

/**
 * The week a released swipe goes to: next when dragged left, previous when dragged right, or null to spring back.
 * A slow drag must pass a quarter of the width; a flick faster than 0.3 px/ms in the drag's direction is enough.
 * 松手后的滑动去往哪一周：向左拖动为下一周，向右为上一周，为 null 时弹回。慢速拖动需超过宽度的四分之一；
 * 沿拖动方向快于 0.3 px/ms 的轻扫即可。
 */
export function swipeTarget(dx: number, velocityPxMs: number, width: number): 'next' | 'prev' | null {
  if (dx === 0) return null;
  const far = Math.abs(dx) > width * SWIPE_DISTANCE_SHARE;
  const fast = Math.abs(velocityPxMs) > SWIPE_VELOCITY_PX_MS && Math.sign(velocityPxMs) === Math.sign(dx);
  if (!far && !fast) return null;
  return dx < 0 ? 'next' : 'prev';
}

export interface MoveSample {
  x: number;
  t: number;
}

/** Speed over the last 100 ms of samples, in px/ms; 0 with too little to tell. */
/** 最近 100 毫秒样本的速度（px/ms）；样本不足时为 0。 */
export function releaseVelocity(samples: readonly MoveSample[], windowMs = 100): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0; i -= 1) {
    const sample = samples[i];
    if (!sample || last.t - sample.t > windowMs) break;
    first = sample;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.x - first.x) / dt : 0;
}
