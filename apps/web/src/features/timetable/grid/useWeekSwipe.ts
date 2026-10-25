/**
 * Owner: T3, timetable web core. Swiping between weeks (timetable-final.md section 9). Three weeks sit side by
 * side in a track; a drag moves the track with transform only, written straight to the DOM in an animation frame,
 * so nothing re-renders while the finger moves. The axis locks after 10 px (a vertical drag stays a native
 * scroll), touches starting within 20 px of a screen edge are left to the system back gesture, and a release past
 * 25% of the width or faster than 0.3 px/ms changes week with a 200 ms slide (instant under reduced motion).
 * will-change is set only while moving. When the slide ends, the new week is committed in one synchronous render
 * and the track jumps back to the middle in the same frame, so the screen never flickers.
 * 维护者：T3，课表网页核心。在周之间滑动（timetable-final.md 第 9 节）。三周并排放在一条轨道上；拖动只通过 transform 移动轨道，
 * 在动画帧中直接写入 DOM，因此手指移动期间不会重新渲染。移动 10 px 后锁定方向（纵向拖动仍是系统滚动），从距屏幕边缘 20 px 内开始的触摸
 * 留给系统返回手势；松手时超过宽度的 25% 或快于 0.3 px/ms，就以 200 ms 的滑动切换周（减少动态效果时立即切换）。只在移动期间设置
 * will-change。滑动结束时，新的一周在一次同步渲染中生效，轨道在同一帧跳回中间，因此屏幕不会闪烁。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { SWIPE_ANIMATION_MS, lockAxis, releaseVelocity, startsAtEdge, swipeTarget, type MoveSample } from './geometry';
import { prefersReducedMotion } from '../ui/useMedia';

export type WeekStep = 'next' | 'prev';

export interface WeekSwipeHandle {
  /** Slides to the next or previous week, as a swipe would. */
  /** 像滑动一样切换到下一周或上一周。 */
  go(step: WeekStep): void;
}

interface Options {
  tracks: readonly RefObject<HTMLElement>[];
  viewport: RefObject<HTMLElement>;
  /** Must update the week synchronously; it runs inside flushSync. */
  /** 必须同步更新周；它在 flushSync 中运行。 */
  onStep: (step: WeekStep) => void;
  enabled: boolean;
}

type Phase = 'idle' | 'pending' | 'drag' | 'settling';

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const SAMPLE_KEEP = 8;

export function useWeekSwipe({ tracks, viewport, onStep, enabled }: Options) {
  const onStepRef = useRef(onStep);
  useLayoutEffect(() => {
    onStepRef.current = onStep;
  });

  const gesture = useRef({
    phase: 'idle' as Phase,
    pointerId: -1,
    x0: 0,
    y0: 0,
    dx: 0,
    width: 0,
    samples: [] as MoveSample[],
    frame: 0,
    swallowClick: false,
    settleTimer: null as ReturnType<typeof setTimeout> | null,
    settleEnd: null as (() => void) | null,
  });

  const api = useMemo(() => {
    const g = gesture.current;

    function each(write: (element: HTMLElement) => void) {
      for (const ref of tracks) if (ref.current) write(ref.current);
    }

    function place(offset: number | WeekStep | null, animate: boolean) {
      each((element) => {
        element.style.transition = animate ? `transform ${SWIPE_ANIMATION_MS}ms ${EASE}` : 'none';
        if (offset === null) element.style.transform = '';
        else if (offset === 'next') element.style.transform = 'translate3d(-66.666667%, 0, 0)';
        else if (offset === 'prev') element.style.transform = 'translate3d(0, 0, 0)';
        else element.style.transform = `translate3d(calc(-33.333333% + ${offset}px), 0, 0)`;
      });
    }

    function moving(on: boolean) {
      each((element) => element.classList.toggle('is-moving', on));
    }

    function finishSettle() {
      if (g.settleTimer !== null) clearTimeout(g.settleTimer);
      g.settleTimer = null;
      const end = g.settleEnd;
      g.settleEnd = null;
      end?.();
    }

    /** Slides to the step (or back to the middle) and commits the step when the slide ends. */
    /** 滑到目标（或回到中间），滑动结束时让切换生效。 */
    function settle(step: WeekStep | null) {
      g.phase = 'settling';
      const done = () => {
        if (step) flushSync(() => onStepRef.current(step));
        place(null, false);
        moving(false);
        g.phase = 'idle';
      };
      if (prefersReducedMotion()) {
        done();
        return;
      }
      const target = tracks[tracks.length - 1]?.current;
      if (!target) {
        done();
        return;
      }
      moving(true);
      place(step, true);
      const onEnd = (event: TransitionEvent) => {
        if (event.target === target && event.propertyName === 'transform') finishSettle();
      };
      target.addEventListener('transitionend', onEnd);
      g.settleEnd = () => {
        target.removeEventListener('transitionend', onEnd);
        done();
      };
      // transitionend does not fire when nothing moved or the tab is hidden.
      // 没有移动或标签页隐藏时不会触发 transitionend。
      g.settleTimer = setTimeout(finishSettle, SWIPE_ANIMATION_MS + 80);
    }

    function frame() {
      g.frame = 0;
      if (g.phase === 'drag') place(Math.max(-g.width, Math.min(g.width, g.dx)), false);
    }

    function cancelDrag() {
      if (g.frame) cancelAnimationFrame(g.frame);
      g.frame = 0;
    }

    function go(step: WeekStep) {
      if (g.phase === 'settling') finishSettle();
      if (g.phase !== 'idle') return;
      settle(step);
    }

    function onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!enabled || !event.isPrimary) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // A new touch during the slide finishes it at once, so the grid is never left half way.
      // 滑动过程中的新触摸会让滑动立即完成，课表不会停在半途。
      if (g.phase === 'settling') finishSettle();
      g.swallowClick = false;
      if (startsAtEdge(event.clientX, window.innerWidth)) {
        g.phase = 'idle';
        return;
      }
      g.phase = 'pending';
      g.pointerId = event.pointerId;
      g.x0 = event.clientX;
      g.y0 = event.clientY;
      g.dx = 0;
      g.width = viewport.current?.clientWidth || window.innerWidth;
      g.samples = [{ x: event.clientX, t: event.timeStamp }];
    }

    function onPointerMove(event: PointerEvent<HTMLElement>) {
      if (event.pointerId !== g.pointerId || (g.phase !== 'pending' && g.phase !== 'drag')) return;
      const dx = event.clientX - g.x0;
      const dy = event.clientY - g.y0;
      if (g.phase === 'pending') {
        const axis = lockAxis(dx, dy);
        if (axis === null) return;
        if (axis === 'y') {
          g.phase = 'idle';
          return;
        }
        g.phase = 'drag';
        g.swallowClick = true;
        moving(true);
        // Touch pointers stay with the element they started on; a mouse needs capturing to keep its moves.
        // 触摸指针始终发给开始时的元素；鼠标需要捕获才能持续收到移动事件。
        if (event.pointerType === 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
      }
      g.dx = dx;
      g.samples.push({ x: event.clientX, t: event.timeStamp });
      if (g.samples.length > SAMPLE_KEEP) g.samples.shift();
      if (!g.frame) g.frame = requestAnimationFrame(frame);
    }

    function onPointerUp(event: PointerEvent<HTMLElement>) {
      if (event.pointerId !== g.pointerId) return;
      if (g.phase !== 'drag') {
        g.phase = 'idle';
        return;
      }
      cancelDrag();
      g.samples.push({ x: event.clientX, t: event.timeStamp });
      const step = swipeTarget(event.clientX - g.x0, releaseVelocity(g.samples), g.width);
      settle(step);
    }

    function onPointerCancel(event: PointerEvent<HTMLElement>) {
      if (event.pointerId !== g.pointerId) return;
      if (g.phase === 'drag') {
        cancelDrag();
        settle(null);
        return;
      }
      g.phase = 'idle';
    }

    /** The click that ends a drag is not a tap on a block or a slot. */
    /** 拖动结束时的点击不算点按方块或时间格。 */
    function onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!g.swallowClick) return;
      g.swallowClick = false;
      event.preventDefault();
      event.stopPropagation();
    }

    function dispose() {
      cancelDrag();
      if (g.settleTimer !== null) clearTimeout(g.settleTimer);
      g.settleTimer = null;
      g.settleEnd = null;
      if (g.phase !== 'idle') {
        place(null, false);
        moving(false);
      }
      g.phase = 'idle';
    }

    return { go, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture }, dispose };
  }, [enabled, tracks, viewport]);

  useEffect(() => api.dispose, [api]);

  const go = useCallback((step: WeekStep) => api.go(step), [api]);
  return { handlers: api.handlers, go };
}
