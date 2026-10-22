import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';

interface RowOffset {
  key: string;
  /** row.offsetTop - scrollTop when it was recorded. */
  /** 记录时的 row.offsetTop - scrollTop。 */
  offset: number;
}

export interface ScrollAnchorPoint extends RowOffset {
  /** scrollTop when it was recorded. */
  /** 记录时的 scrollTop。 */
  scrollTop: number;
  /** The rows right after the anchor, used when the anchor row itself is gone. */
  /** 紧随锚点之后的几行，锚点行本身不在时使用。 */
  next: RowOffset[];
}

export interface ScrollAnchor {
  /** Records the first message row whose bottom is below the top edge of the list. */
  /** 记录底边位于列表上沿之下的第一条消息行。 */
  record(): void;
  /** Puts that row back at the recorded offset. */
  /** 把该行放回记录时的偏移位置。 */
  restore(): void;
  /** Forgets any restore in progress after a deliberate jump, then records afresh. */
  /** 在有意的跳转之后放弃进行中的恢复，并重新记录。 */
  reset(): void;
}

interface Options {
  /** True while the list is pinned to the bottom; the anchor is not restored then. */
  /** 列表贴底时为 true；此时不恢复锚点。 */
  isStuck(): boolean;
  /** Runs once per animation frame while the list scrolls, after the anchor is recorded. */
  /** 列表滚动时每帧执行一次，在记录锚点之后。 */
  onFrame?(): void;
}

/** Without scrollend (iOS Safari), a gesture counts as settled after this long with no scroll event. */
/** 不支持 scrollend 时（iOS Safari），这么久没有滚动事件即视为手势已结束。 */
const SETTLE_IDLE_MS = 200;
const FALLBACK_ROWS = 2;

/**
 * Only message rows anchor the position. Time dividers, the unread marker and the join tip come and go
 * with their neighbours: the first row's divider disappears once an older page gives that row a
 * predecessor less than five minutes earlier, so anchoring on it would lose the position.
 * 只有消息行用作定位锚点。时间分隔、未读分隔线和加入提示会随相邻消息出现或消失：当更早的一页给第一条消息带来五分钟以内的前一条消息时，
 * 它上方的时间分隔就会消失，以它为锚点会丢失位置。
 */
const ANCHOR_PREFIXES = ['m:', 'c:'] as const;
const ANCHOR_ROWS = ANCHOR_PREFIXES.map((prefix) => `[data-key^="${prefix}"]`).join(', ');

export function isAnchorKey(key: string): boolean {
  return ANCHOR_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * True when a scroll step after a restore looks like iOS momentum carrying on from where it was before
 * the restore, which undoes the restore, rather than the member scrolling on. The member's own step is
 * close to the scroll velocity just before the restore; an override is close to that velocity minus the
 * restore's jump. Steps with wheel, key or mouse input behind them are always the member's own.
 * 当恢复之后的某次滚动看起来是 iOS 惯性滚动从恢复前的位置继续（从而抵消了恢复），而不是成员继续滚动时为 true。成员自己的滚动接近恢复前一刻的
 * 滚动速度；覆盖则接近该速度减去恢复的位移。背后有滚轮、按键或鼠标输入的滚动总是属于成员自己。
 */
export function isMomentumOverride(step: number, jump: number, velocity: number, userInput: boolean): boolean {
  if (userInput || jump === 0) return false;
  return Math.abs(step - (velocity - jump)) < Math.abs(step - velocity);
}

export function findAnchor(list: HTMLElement): ScrollAnchorPoint | null {
  const rows = Array.from(list.querySelectorAll<HTMLElement>(ANCHOR_ROWS));
  const top = list.scrollTop;
  // Rows are in document order, so their positions only grow; a binary search finds the first visible one.
  // 各行按文档顺序排列，位置单调递增；用二分查找找到第一条可见的行。
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const row = rows[mid];
    if (!row) break;
    if (row.offsetTop + row.offsetHeight > top) {
      found = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }
  const offsetOf = (row: HTMLElement | undefined): RowOffset | null => {
    const key = row?.dataset.key;
    return row && key ? { key, offset: row.offsetTop - top } : null;
  };
  const anchor = offsetOf(rows[found]);
  if (!anchor) return null;
  const next = rows.slice(found + 1, found + 1 + FALLBACK_ROWS).flatMap((row) => offsetOf(row) ?? []);
  return { ...anchor, scrollTop: top, next };
}

function rowByKey(list: HTMLElement, key: string): HTMLElement | null {
  return list.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
}

/** The recorded row, or the first recorded follower still on the page, with its recorded offset. */
/** 记录的锚点行；不在时取仍在页面上的第一个后续行，并给出其记录的偏移。 */
function locate(list: HTMLElement, point: ScrollAnchorPoint): { row: HTMLElement; offset: number } | null {
  for (const candidate of [point, ...point.next]) {
    const row = rowByKey(list, candidate.key);
    if (row) return { row, offset: candidate.offset };
  }
  return null;
}

/** A restore waiting for the gesture to settle, so its point stays fixed until then. */
/** 等待手势结束的恢复；在此之前其锚点保持不变。 */
interface PendingRestore {
  /** How far the restore moved scrollTop; cleared once an override has been absorbed. */
  /** 本次恢复移动 scrollTop 的距离；吸收一次覆盖后清零。 */
  jump: number;
}

/** scrollTop and its change per frame, as last seen by the scroll handler. */
/** 滚动处理函数最近一次看到的 scrollTop 及其每帧变化量。 */
interface Motion {
  lastTop: number;
  velocity: number;
  at: number;
}

/** A frame step older than this says nothing about the current speed. */
/** 早于此时长的帧位移不能反映当前速度。 */
const VELOCITY_FRESH_MS = 100;

/**
 * Keeps the reading position when rows are added or resized above it, by restoring the first visible
 * message row (data-key) to its recorded offset. It never relies on scrollHeight deltas, so it is unaffected
 * by images that load late. After a restore the anchor stays fixed until the gesture settles (scrollend, or
 * a short pause in scrolling where scrollend is missing): later scroll steps keep counting as the member's
 * own movement, except a step that undoes the restore, which is iOS momentum overriding it. The settle pass
 * then re-applies the anchor. The list must be positioned so that rows measure their offsetTop against it.
 * 通过把第一条可见的消息行（data-key）恢复到记录的偏移位置，在其上方插入或改变大小时保持阅读位置。它从不依赖 scrollHeight 的差值，
 * 因此不受延迟加载的图片影响。恢复之后锚点保持不变，直到手势结束（scrollend，或不支持时滚动短暂停止）：之后的滚动仍算作成员自己的移动，
 * 只有抵消恢复的那一步被视为 iOS 惯性滚动的覆盖。手势结束时再应用一次锚点。列表需要设置定位，各行的 offsetTop 才以它为基准。
 */
export function useScrollAnchor(listRef: RefObject<HTMLElement | null>, options: Options): ScrollAnchor {
  const optionsRef = useRef(options);
  const point = useRef<ScrollAnchorPoint | null>(null);
  const pending = useRef<PendingRestore | null>(null);
  const motion = useRef<Motion>({ lastTop: 0, velocity: 0, at: 0 });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const anchor = useMemo(() => {
    function clearSettle() {
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }

    function scheduleSettle() {
      clearSettle();
      settleTimer.current = setTimeout(settle, SETTLE_IDLE_MS);
    }

    function measure() {
      const list = listRef.current;
      point.current = list ? findAnchor(list) : null;
    }

    /** Moves the list so the anchor row is back at its offset; returns how far scrollTop moved. */
    /** 移动列表使锚点行回到其偏移位置；返回 scrollTop 移动的距离。 */
    function apply(): number {
      const list = listRef.current;
      const current = point.current;
      if (!list || !current) return 0;
      const found = locate(list, current);
      if (!found) {
        pending.current = null;
        measure();
        return 0;
      }
      // Scrolling since the record (or since an absorbed override) is the member's own and is kept.
      // 记录之后（或吸收覆盖之后）的滚动属于成员自己，会被保留。
      const target = found.row.offsetTop - found.offset + (list.scrollTop - current.scrollTop);
      const before = list.scrollTop;
      if (Math.abs(before - target) < 1) return 0;
      list.scrollTop = target;
      return list.scrollTop - before;
    }

    function settle() {
      clearSettle();
      if (!pending.current) return;
      if (!optionsRef.current.isStuck()) apply();
      pending.current = null;
      measure();
    }

    return {
      record() {
        // While a restore waits to settle, its point is the reference; re-recording would adopt an overridden position.
        // 恢复等待结束期间以其锚点为准；重新记录会采用被覆盖后的位置。
        if (!pending.current) measure();
      },
      restore() {
        const list = listRef.current;
        const jump = apply();
        if (!list || jump === 0) return;
        measure();
        // The jump itself is not a scroll step, and a speed from a stale frame no longer applies.
        // 恢复造成的位移本身不算滚动；过时的帧所反映的速度也不再适用。
        const seen = motion.current;
        const fresh = performance.now() - seen.at < VELOCITY_FRESH_MS;
        motion.current = { lastTop: list.scrollTop, velocity: fresh ? seen.velocity : 0, at: seen.at };
        pending.current = { jump };
        scheduleSettle();
      },
      reset() {
        clearSettle();
        pending.current = null;
        // A deliberate jump is not scrolling speed.
        // 有意的跳转不算滚动速度。
        motion.current = { lastTop: listRef.current?.scrollTop ?? 0, velocity: 0, at: 0 };
        measure();
      },
      settle,
      scheduleSettle,
    };
  }, [listRef]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    let frame = 0;
    let input = false;
    let pointerHeld = false;

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const top = list.scrollTop;
        const seen = motion.current;
        const step = top - seen.lastTop;
        let velocity = step;
        const waiting = pending.current;
        const current = point.current;
        if (waiting) {
          if (current && isMomentumOverride(step, waiting.jump, seen.velocity, input || pointerHeld)) {
            // The override is not the member's movement, so the frozen point absorbs it and the settle pass undoes it.
            // 覆盖不是成员的移动，因此由冻结的锚点吸收，并在手势结束时撤销。
            point.current = { ...current, scrollTop: current.scrollTop + step };
            velocity = step + waiting.jump;
            waiting.jump = 0;
          }
          anchor.scheduleSettle();
        } else {
          anchor.record();
        }
        motion.current = { lastTop: top, velocity, at: performance.now() };
        input = false;
        optionsRef.current.onFrame?.();
      });
    };
    const onInput = () => {
      input = true;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') pointerHeld = true;
    };
    const onPointerUp = () => {
      pointerHeld = false;
    };

    list.addEventListener('scroll', onScroll, { passive: true });
    list.addEventListener('scrollend', anchor.settle);
    list.addEventListener('wheel', onInput, { passive: true });
    list.addEventListener('keydown', onInput);
    list.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = null;
      list.removeEventListener('scroll', onScroll);
      list.removeEventListener('scrollend', anchor.settle);
      list.removeEventListener('wheel', onInput);
      list.removeEventListener('keydown', onInput);
      list.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [listRef, anchor]);

  return anchor;
}
