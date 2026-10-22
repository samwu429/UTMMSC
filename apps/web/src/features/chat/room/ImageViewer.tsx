import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTr } from '../../../shared/i18n/locale';
import { ActionSheet } from '../../../shared/ui/ActionSheet';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { centredBox, clampPan, coverTransform, fitContain, VIEWER_SCALE_MAX, zoomAbout, type Size } from './imageBox';
import { chatImageSrc } from './ImageMessage';

export interface ViewerImage {
  id: number;
  imageKey: string;
  width: number | null;
  height: number | null;
}

interface Props {
  images: ViewerImage[];
  startId: number;
  startRect: DOMRect | null;
  mediaToken: string | null;
  /** Where the thumbnail of an image is on screen now, so closing can shrink back into it. */
  /** 某张图片的缩略图当前在屏幕上的位置，关闭时据此缩回。 */
  thumbRect: (id: number) => DOMRect | null;
  onClose: () => void;
}

const ANIMATION_MS = 240;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const TAP_SLOP_PX = 8;
const DOUBLE_TAP_MS = 280;
const LONG_PRESS_MS = 500;
const DOUBLE_TAP_SCALE = 2.5;
const SWIPE_COMMIT = 0.18;
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 0.6;

type Mode = 'idle' | 'pending' | 'pan' | 'swipe' | 'dismiss' | 'pinch' | 'ignore';
type Phase = 'enter' | 'open' | 'exit';

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const NO_ZOOM: Zoom = { scale: 1, x: 0, y: 0 };

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function extensionFor(type: string): string {
  if (type === 'image/png') return 'png';
  if (type === 'image/gif') return 'gif';
  if (type === 'image/webp') return 'webp';
  return 'jpg';
}

/**
 * Full-screen photo viewer. It zooms out of the thumbnail, supports pinch and double-tap zoom, panning
 * while zoomed, swiping between the loaded photos and dragging down to dismiss; a single tap closes it
 * and a long press offers 保存图片. Keyboard: Escape closes, the arrow keys move between photos.
 * 全屏图片查看器。从缩略图放大打开，支持双指和双击缩放、放大后拖动、左右滑动切换已加载的图片、下拉关闭；
 * 单击关闭，长按可保存图片。键盘：Escape 关闭，方向键切换图片。
 */
export function ImageViewer({ images, startId, startRect, mediaToken, thumbRect, onClose }: Props) {
  const tr = useTr();
  const rootRef = useRef<HTMLDivElement>(null);
  const [reduced] = useState(reducedMotion);
  const [currentId, setCurrentId] = useState(startId);
  const [viewport, setViewport] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [natural, setNatural] = useState<Record<number, Size>>({});
  const [zoom, setZoom] = useState<Zoom>(NO_ZOOM);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [exitTarget, setExitTarget] = useState<DOMRect | null>(null);

  const index = images.findIndex((image) => image.id === currentId);
  const current = images[index];
  const dims = (image: ViewerImage | undefined): Size | null => {
    if (!image) return null;
    if (image.width && image.height) return { width: image.width, height: image.height };
    return natural[image.id] ?? null;
  };
  const currentDims = dims(current);
  const fit = currentDims ? fitContain(currentDims, viewport) : null;
  const box = fit ? centredBox(fit, viewport) : null;
  const [phase, setPhase] = useState<Phase>(() => (reduced ? 'open' : 'enter'));

  const gesture = useRef({
    pointers: new Map<number, { x: number; y: number }>(),
    mode: 'idle' as Mode,
    startX: 0,
    startY: 0,
    startAt: 0,
    base: NO_ZOOM,
    pinchDistance: 0,
    pinchMid: { x: 0, y: 0 },
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
    tapTimer: null as ReturnType<typeof setTimeout> | null,
    pressTimer: null as ReturnType<typeof setTimeout> | null,
    longPressed: false,
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  useEffect(() => {
    const state = gesture.current;
    const pending = timers.current;
    return () => {
      if (state.tapTimer) clearTimeout(state.tapTimer);
      if (state.pressTimer) clearTimeout(state.pressTimer);
      for (const timer of pending) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Closes at once when the photo on screen is recalled, removed or hidden.
  // 当前显示的图片被撤回、删除或隐藏时立即关闭。
  useEffect(() => {
    if (index === -1) onClose();
  }, [index, onClose]);

  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    // Flush the start frame so the change below animates.
    // 先提交起始帧，下面的变化才会产生动画。
    void rootRef.current?.offsetWidth;
    setAnimating(true);
    setPhase('open');
    timers.current.push(setTimeout(() => setAnimating(false), ANIMATION_MS));
  }, [phase]);

  function close() {
    if (phase === 'exit') return;
    if (reduced) {
      onClose();
      return;
    }
    setExitTarget(thumbRect(currentId));
    setAnimating(true);
    setPhase('exit');
    later(onClose, ANIMATION_MS);
  }

  // The system back gesture closes the viewer, as in WeChat, instead of leaving the room.
  // 系统返回手势关闭查看器（与微信一致），而不是离开房间。
  useBackToClose(close);

  function go(step: number) {
    const next = images[index + step];
    if (!next || phase !== 'open') return;
    if (reduced) {
      setCurrentId(next.id);
      setZoom(NO_ZOOM);
      setDrag({ x: 0, y: 0 });
      return;
    }
    setAnimating(true);
    setDrag({ x: -step * viewport.width, y: 0 });
    later(() => {
      setAnimating(false);
      setCurrentId(next.id);
      setZoom(NO_ZOOM);
      setDrag({ x: 0, y: 0 });
    }, ANIMATION_MS);
  }

  function settle(next: Zoom) {
    setAnimating(true);
    setZoom(next);
    later(() => setAnimating(false), ANIMATION_MS);
  }

  function centrePoint(clientX: number, clientY: number) {
    const rect = rootRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0) - viewport.width / 2, y: clientY - (rect?.top ?? 0) - viewport.height / 2 };
  }

  function toggleZoom(clientX: number, clientY: number) {
    if (!fit) return;
    if (zoom.scale > 1.01) {
      settle(NO_ZOOM);
      return;
    }
    const offset = zoomAbout(centrePoint(clientX, clientY), { x: 0, y: 0 }, 1, DOUBLE_TAP_SCALE);
    settle({ scale: DOUBLE_TAP_SCALE, ...clampPan(offset.x, offset.y, DOUBLE_TAP_SCALE, fit, viewport) });
  }

  function clearPress() {
    const state = gesture.current;
    if (state.pressTimer) clearTimeout(state.pressTimer);
    state.pressTimer = null;
  }

  function inside(event: { target: EventTarget }) {
    return event.target instanceof Node && rootRef.current?.contains(event.target) === true;
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!inside(event) || phase !== 'open' || sheet) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const state = gesture.current;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setAnimating(false);
    if (state.pointers.size === 1) {
      state.mode = 'pending';
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.startAt = performance.now();
      state.base = zoom;
      state.longPressed = false;
      clearPress();
      state.pressTimer = setTimeout(() => {
        state.pressTimer = null;
        if (state.mode !== 'pending') return;
        state.longPressed = true;
        state.mode = 'ignore';
        setSheet(true);
      }, LONG_PRESS_MS);
    } else if (state.pointers.size === 2) {
      clearPress();
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;
      state.mode = 'pinch';
      state.base = zoom;
      state.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      state.pinchMid = centrePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      setDrag({ x: 0, y: 0 });
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (state.mode === 'pinch' && fit) {
      const [a, b] = [...state.pointers.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const scale = Math.min(VIEWER_SCALE_MAX, Math.max(0.8, (state.base.scale * distance) / state.pinchDistance));
      const mid = centrePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const factor = scale / state.base.scale;
      setZoom({ scale, x: mid.x - (state.pinchMid.x - state.base.x) * factor, y: mid.y - (state.pinchMid.y - state.base.y) * factor });
      return;
    }
    if (state.mode === 'pending') {
      if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      clearPress();
      if (zoom.scale > 1.01) state.mode = 'pan';
      else if (Math.abs(dx) > Math.abs(dy)) state.mode = 'swipe';
      else if (dy > 0) state.mode = 'dismiss';
      else state.mode = 'ignore';
    }
    if (state.mode === 'pan' && fit) {
      setZoom({ scale: state.base.scale, ...clampPan(state.base.x + dx, state.base.y + dy, state.base.scale, fit, viewport) });
    } else if (state.mode === 'swipe') {
      // Resist at either end of the loaded photos.
      // 在已加载图片的两端加阻尼。
      const blocked = (dx > 0 && index === 0) || (dx < 0 && index === images.length - 1);
      setDrag({ x: blocked ? dx / 3 : dx, y: 0 });
    } else if (state.mode === 'dismiss') {
      setDrag({ x: dx, y: Math.max(0, dy) });
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state.pointers.has(event.pointerId)) return;
    state.pointers.delete(event.pointerId);
    clearPress();
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    const elapsed = Math.max(1, performance.now() - state.startAt);

    if (state.mode === 'pinch') {
      if (state.pointers.size === 1) {
        // Carry on as a pan with the finger that is still down.
        // 剩下的那根手指继续拖动。
        const [rest] = [...state.pointers.values()];
        state.mode = 'pan';
        state.startX = rest?.x ?? event.clientX;
        state.startY = rest?.y ?? event.clientY;
        state.base = zoom;
        return;
      }
      state.mode = 'idle';
      if (zoom.scale <= 1.01 || !fit) settle(NO_ZOOM);
      else settle({ scale: zoom.scale, ...clampPan(zoom.x, zoom.y, zoom.scale, fit, viewport) });
      return;
    }
    if (state.pointers.size > 0) return;
    const mode = state.mode;
    state.mode = 'idle';

    if (mode === 'swipe') {
      const step = dx < -viewport.width * SWIPE_COMMIT ? 1 : dx > viewport.width * SWIPE_COMMIT ? -1 : 0;
      if (step !== 0 && images[index + step]) go(step);
      else {
        setAnimating(true);
        setDrag({ x: 0, y: 0 });
        later(() => setAnimating(false), ANIMATION_MS);
      }
      return;
    }
    if (mode === 'dismiss') {
      if (dy > DISMISS_PX || dy / elapsed > DISMISS_VELOCITY) close();
      else {
        setAnimating(true);
        setDrag({ x: 0, y: 0 });
        later(() => setAnimating(false), ANIMATION_MS);
      }
      return;
    }
    if (mode !== 'pending' || state.longPressed || event.type === 'pointercancel') return;

    // A tap: wait briefly to tell a single tap (close) from a double tap (zoom).
    // 单击：稍等片刻以区分单击（关闭）与双击（缩放）。
    const now = performance.now();
    const second = now - state.lastTapAt < DOUBLE_TAP_MS && Math.hypot(event.clientX - state.lastTapX, event.clientY - state.lastTapY) < 30;
    if (second) {
      if (state.tapTimer) clearTimeout(state.tapTimer);
      state.tapTimer = null;
      state.lastTapAt = 0;
      toggleZoom(event.clientX, event.clientY);
      return;
    }
    state.lastTapAt = now;
    state.lastTapX = event.clientX;
    state.lastTapY = event.clientY;
    state.tapTimer = setTimeout(() => {
      state.tapTimer = null;
      close();
    }, DOUBLE_TAP_MS);
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!inside(event)) return;
    event.preventDefault();
    if (phase === 'open') setSheet(true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (sheet || !inside(event)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      go(1);
    } else if (event.key === 'Tab') {
      // The close button is the only stop inside the viewer.
      // 查看器内唯一可聚焦的是关闭按钮。
      event.preventDefault();
      rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }
  }

  async function save() {
    if (!current) return;
    const src = chatImageSrc(current.imageKey, mediaToken);
    if (!src) return;
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `utmmsc-${current.id}.${extensionFor(blob.type)}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast(tr('保存失败', 'Couldn’t save the image'));
    }
  }

  if (!current) return null;

  const transition = animating ? `transform ${ANIMATION_MS}ms ${EASE}, opacity ${ANIMATION_MS}ms ${EASE}` : 'none';
  const dismissProgress = Math.min(1, drag.y / (viewport.height * 0.5));
  let backdrop = 1 - dismissProgress;
  let imageTransform = `translate3d(${zoom.x + (drag.y > 0 ? drag.x : 0)}px, ${zoom.y + drag.y}px, 0) scale(${zoom.scale * (1 - dismissProgress * 0.4)})`;
  let imageOpacity = 1;

  if (phase === 'enter' || phase === 'exit') {
    backdrop = 0;
    const rect = phase === 'enter' ? startRect : exitTarget;
    if (rect && box) {
      const t = coverTransform({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }, box);
      imageTransform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;
    } else {
      imageOpacity = 0;
    }
  }
  const stripX = drag.y > 0 ? 0 : drag.x;

  function slideStyle(image: ViewerImage, offset: number): CSSProperties {
    const size = dims(image);
    const fitted = size ? fitContain(size, viewport) : null;
    const style: CSSProperties = fitted ? { width: fitted.width, height: fitted.height } : { maxWidth: '100%', maxHeight: '100%' };
    if (offset !== 0) return style;
    return { ...style, transform: imageTransform, opacity: imageOpacity, transition, willChange: 'transform' };
  }

  const slides = [-1, 0, 1].flatMap((offset) => {
    const image = images[index + offset];
    return image ? [{ offset, image }] : [];
  });

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={tr('图片查看器', 'Photo viewer')}
      tabIndex={-1}
      className="fixed inset-0 z-[55] select-none overflow-hidden outline-none"
      style={{ touchAction: 'none', overscrollBehavior: 'contain', WebkitTouchCallout: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: backdrop, transition }} aria-hidden />
      <div className="absolute inset-0" style={{ transform: `translate3d(${stripX}px, 0, 0)`, transition }}>
        {slides.map(({ offset, image }) => {
          const src = chatImageSrc(image.imageKey, mediaToken);
          return (
            <div key={image.id} className="absolute inset-0 flex items-center justify-center" style={{ transform: `translateX(${offset * 100}%)` }}>
              {src ? (
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  className="pointer-events-none max-w-none object-contain"
                  style={slideStyle(image, offset)}
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    if (naturalWidth && naturalHeight && !natural[image.id]) setNatural((prev) => ({ ...prev, [image.id]: { width: naturalWidth, height: naturalHeight } }));
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {tr(`第 ${index + 1} 张，共 ${images.length} 张`, `Photo ${index + 1} of ${images.length}`)}
      </p>
      <button
        type="button"
        onClick={close}
        className="sr-only rounded-full bg-black/60 px-4 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:right-3 focus:top-3"
        style={{ marginTop: 'env(safe-area-inset-top)' }}
      >
        {tr('关闭', 'Close')}
      </button>
      {sheet ? <ActionSheet onClose={() => setSheet(false)} options={[{ label: tr('保存图片', 'Save image'), onSelect: () => void save() }]} /> : null}
    </div>,
    document.body,
  );
}
