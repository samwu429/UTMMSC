import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { encodeSquareIcon, type SquareIconFiles } from '../../../shared/media/encodeSquareIcon';
import {
  ICON_BACKGROUND,
  ICON_IDENTITY,
  ICON_KEY_PAN_STEP,
  ICON_KEY_PAN_STEP_LARGE,
  ICON_KEY_ZOOM_FACTOR,
  ICON_PREVIEW_SIZE,
  ICON_ZOOM_MAX,
  ICON_ZOOM_MIN,
  IconImageError,
  clampTransform,
  cropRect,
  frameSide,
  iconImageStyle,
  iconProblemText,
  panBy,
  pinchTransform,
  rescaleTransform,
  toggleZoom,
  wheelZoom,
  zoomAround,
  type IconPoint,
  type IconSize,
  type IconTransform,
} from '../../../shared/media/squareIcon';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';

type Phase = 'idle' | 'processing' | 'uploading';

/** A press that moves less than this and lifts within TAP_MS is a tap; two taps close together are a double-tap. */
/** 移动少于此距离并在 TAP_MS 内抬起的按压算点按；相隔很近的两次点按算双击。 */
const TAP_SLOP_PX = 8;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 30;
/** Room kept above and below the frame when the screen is short (a phone held sideways). */
/** 屏幕较矮时（横持手机）方框上下保留的空间。 */
const FRAME_MARGIN_PX = 32;

export interface IconCropScreenProps {
  file: File;
  onCancel: () => void;
  /**
   * Receives the 256 px icon and 96 px thumbnail. The screen waits (正在上传…) until it settles; the caller closes
   * the screen on success. A rejection keeps the screen open and shows the error.
   * 接收 256px 图标和 96px 缩略图。界面会等待它完成（「正在上传…」）；成功后由调用方关闭界面。失败时界面保持打开并显示错误。
   */
  onDone: (files: SquareIconFiles) => Promise<void>;
  /** The wait after encoding, 正在上传… by default. */
  /** 编码之后等待阶段的文字，默认为「正在上传…」。 */
  waitingLabel?: string;
}

interface Gesture {
  pointers: Map<number, IconPoint>;
  /** The last position of the one finger (or mouse) dragging. */
  /** 正在拖动的单指（或鼠标）的上一个位置。 */
  pan: IconPoint | null;
  pinch: { start: IconTransform; mid: IconPoint; distance: number } | null;
  press: { at: number; point: IconPoint; moved: boolean } | null;
  lastTap: { at: number; point: IconPoint } | null;
}

function distance(a: IconPoint, b: IconPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: IconPoint, b: IconPoint): IconPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A pointer position relative to the centre of the stage, which is the centre of the frame. */
/** 指针相对舞台中心（即方框中心）的位置。 */
function relativeTo(stage: HTMLElement | null, clientX: number, clientY: number): IconPoint {
  const rect = stage?.getBoundingClientRect();
  if (!rect) return { x: 0, y: 0 };
  return { x: clientX - (rect.left + rect.width / 2), y: clientY - (rect.top + rect.height / 2) };
}

/** The frame's side for a stage of this size: 80% of the width up to 320, and short enough to fit the height. */
/** 舞台为此尺寸时方框的边长：宽度的 80%，最大 320，并且不超出高度。 */
function frameFor(width: number, height: number): number {
  const side = frameSide(width);
  return height > 0 ? Math.max(96, Math.min(side, Math.round(height - FRAME_MARGIN_PX))) : side;
}

/**
 * The square crop of a channel icon, full-screen black like WeChat's avatar crop: a 320 px (at most 80% of the
 * width) white frame, one-finger pan, two-finger pinch around the midpoint, wheel zoom, double-tap for 1x and 2x,
 * arrow keys and +/−, a 1x–4x 缩放 slider and a live 48 px preview of the chat list avatar. 完成 encodes the square
 * (正在处理…) and hands it on (正在上传…). Back and Esc cancel.
 * 频道图标的方形裁剪，与微信头像裁剪一样为全屏黑色：320px（最多为宽度的 80%）的白色方框，单指平移，双指以中点为中心捏合，滚轮缩放，
 * 双击在 1 倍与 2 倍之间切换，方向键和 +/−，1 到 4 倍的「缩放」滑块，以及聊天列表头像的 48px 实时预览。「完成」先编码这个正方形
 * （「正在处理…」），再交给调用方（「正在上传…」）。返回和 Esc 表示取消。
 */
export function IconCropScreen({ file, onCancel, onDone, waitingLabel }: IconCropScreenProps) {
  const tr = useTr();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<IconSize | null>(null);
  const [frame, setFrame] = useState(() => frameSide(typeof window === 'undefined' ? 0 : window.innerWidth));
  const [transform, setTransform] = useState<IconTransform>(ICON_IDENTITY);
  const [phase, setPhase] = useState<Phase>('idle');
  const mounted = useRef(true);
  const gesture = useRef<Gesture>({ pointers: new Map(), pan: null, pinch: null, press: null, lastTap: null });
  // Pointer and wheel handlers read the latest values here instead of closing over a stale render.
  // 指针和滚轮处理函数从这里读取最新的值，而不是捕获过时的渲染结果。
  const live = useRef({ natural, frame, transform, phase });
  useLayoutEffect(() => {
    live.current = { natural, frame, transform, phase };
  });
  const cancelRef = useRef(onCancel);
  useLayoutEffect(() => {
    cancelRef.current = onCancel;
  });

  useStatusBarColor('#000000');
  useBackToClose(onCancel);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Made in an effect, so StrictMode's second mount gets a live address rather than a revoked one.
  // 在副作用中创建，StrictMode 的第二次挂载因此拿到的是有效的地址，而不是已撤销的地址。
  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || live.current.phase === 'uploading') return;
      event.preventDefault();
      cancelRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  /** Sets the next transform from the current one, kept in bounds. */
  /** 由当前变换得出下一个变换，并保持在范围之内。 */
  const update = useCallback((next: (current: IconTransform, size: IconSize, side: number) => IconTransform) => {
    const size = live.current.natural;
    if (!size || live.current.phase !== 'idle') return;
    const side = live.current.frame;
    setTransform((current) => next(current, size, side));
  }, []);

  // The frame follows the stage: a rotation or a resized window keeps the same crop under a resized frame.
  // 方框跟随舞台：旋转或调整窗口大小后，在改变了尺寸的方框下保持相同的裁剪。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const next = frameFor(stage.clientWidth, stage.clientHeight);
      const previous = live.current.frame;
      if (next === previous) return;
      setFrame(next);
      const size = live.current.natural;
      setTransform((current) => (size ? clampTransform(rescaleTransform(current, previous, next), size.width, size.height, next) : current));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // The wheel needs a listener that may cancel scrolling, which React's onWheel cannot be.
  // 滚轮需要一个可以取消滚动的监听器，React 的 onWheel 做不到。
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
      const focal = relativeTo(stage, event.clientX, event.clientY);
      update((current, size, side) => zoomAround(current, wheelZoom(current.zoom, delta), focal, size.width, size.height, side));
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [update]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!live.current.natural || live.current.phase !== 'idle') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const g = gesture.current;
    const point = relativeTo(stageRef.current, event.clientX, event.clientY);
    g.pointers.set(event.pointerId, point);
    if (g.pointers.size === 1) {
      g.pan = point;
      g.pinch = null;
      g.press = { at: event.timeStamp, point, moved: false };
    } else if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()] as [IconPoint, IconPoint];
      g.pinch = { start: live.current.transform, mid: midpoint(a, b), distance: Math.max(1, distance(a, b)) };
      g.pan = null;
      g.press = null;
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g.pointers.has(event.pointerId)) return;
    const point = relativeTo(stageRef.current, event.clientX, event.clientY);
    g.pointers.set(event.pointerId, point);
    if (g.pinch && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()] as [IconPoint, IconPoint];
      const pinch = g.pinch;
      update((_current, size, side) => pinchTransform(pinch.start, pinch.mid, midpoint(a, b), distance(a, b) / pinch.distance, size.width, size.height, side));
      return;
    }
    if (!g.pan) return;
    const dx = point.x - g.pan.x;
    const dy = point.y - g.pan.y;
    g.pan = point;
    if (g.press && distance(point, g.press.point) > TAP_SLOP_PX) g.press.moved = true;
    update((current, size, side) => panBy(current, dx, dy, size.width, size.height, side));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    if (!g.pointers.delete(event.pointerId)) return;
    if (g.pointers.size === 1) {
      // A pinch ended with one finger still down: it keeps dragging from where it is.
      // 捏合结束时还有一根手指按着：从它当前的位置继续拖动。
      g.pinch = null;
      g.pan = [...g.pointers.values()][0] ?? null;
      g.press = null;
      return;
    }
    if (g.pointers.size > 0) return;
    const press = g.press;
    g.pan = null;
    g.pinch = null;
    g.press = null;
    if (cancelled || !press || press.moved || event.timeStamp - press.at > TAP_MS) {
      g.lastTap = null;
      return;
    }
    const last = g.lastTap;
    if (last && press.at - last.at < DOUBLE_TAP_MS && distance(press.point, last.point) < DOUBLE_TAP_SLOP_PX) {
      g.lastTap = null;
      update((current, size, side) => toggleZoom(current, press.point, size.width, size.height, side));
    } else {
      g.lastTap = { at: event.timeStamp, point: press.point };
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The slider moves the zoom with its own arrow keys.
    // 滑块用它自己的方向键调整缩放。
    if (event.target instanceof HTMLInputElement || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? ICON_KEY_PAN_STEP_LARGE : ICON_KEY_PAN_STEP;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      update((current, size, side) => panBy(current, move[0], move[1], size.width, size.height, side));
      return;
    }
    const factor = event.key === '+' || event.key === '=' ? ICON_KEY_ZOOM_FACTOR : event.key === '-' || event.key === '_' ? 1 / ICON_KEY_ZOOM_FACTOR : null;
    if (factor === null) return;
    event.preventDefault();
    update((current, size, side) => zoomAround(current, current.zoom * factor, { x: 0, y: 0 }, size.width, size.height, side));
  }

  async function finish() {
    if (!natural || phase !== 'idle') return;
    setPhase('processing');
    let files: SquareIconFiles;
    try {
      files = await encodeSquareIcon(file, cropRect(transform, natural.width, natural.height, frame), natural);
    } catch (err) {
      toast(iconProblemText(err, tr));
      if (mounted.current) setPhase('idle');
      return;
    }
    if (!mounted.current) return;
    setPhase('uploading');
    try {
      await onDone(files);
    } catch (err) {
      toast(errorMessage(err));
      if (mounted.current) setPhase('idle');
    }
  }

  const previewScale = ICON_PREVIEW_SIZE / frame;
  const busy = phase !== 'idle';

  // Both images sit on the encoder's fill, so a transparent logo looks here as it will be saved.
  // 两张图片都以编码器的填充色为背景，透明的标志在这里看到的就是保存后的样子。
  const imageStyle = (scale: number) => (natural ? iconImageStyle(natural, frame, transform, scale) : undefined);

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={tr('裁剪频道图标', 'Crop the channel icon')}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="wx-fade fixed inset-0 z-[65] flex select-none flex-col bg-black text-white outline-none"
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <p className="px-4 pb-1 pt-4 text-center text-[14px] text-white/70">{tr('拖动、缩放图片，方框内的部分会成为图标', 'Drag and zoom. What is inside the square becomes the icon.')}</p>
      <div
        ref={stageRef}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => onPointerEnd(event, false)}
        onPointerCancel={(event) => onPointerEnd(event, true)}
      >
        {url ? (
          <img
            src={url}
            alt=""
            draggable={false}
            onLoad={(event) => {
              const image = event.currentTarget;
              if (!(image.naturalWidth > 0) || !(image.naturalHeight > 0)) {
                toast(iconProblemText(new IconImageError('decode'), tr));
                onCancel();
                return;
              }
              setNatural({ width: image.naturalWidth, height: image.naturalHeight });
              setTransform(ICON_IDENTITY);
            }}
            onError={() => {
              toast(iconProblemText(new IconImageError('decode'), tr));
              onCancel();
            }}
            className={`pointer-events-none absolute left-1/2 top-1/2 origin-center will-change-transform ${natural ? '' : 'invisible'}`}
            style={imageStyle(1)}
          />
        ) : null}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ring-2 ring-white"
          style={{ width: `${frame}px`, height: `${frame}px`, boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.6)' }}
        />
      </div>

      <div className="flex items-center gap-4 px-5 pb-2 pt-3">
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div aria-hidden className="relative h-12 w-12 overflow-hidden rounded-[4px]" style={{ backgroundColor: ICON_BACKGROUND }}>
            {url && natural ? <img src={url} alt="" draggable={false} className="absolute left-1/2 top-1/2 origin-center" style={imageStyle(previewScale)} /> : null}
          </div>
          <span className="text-[11px] leading-none text-white/60">{tr('预览', 'Preview')}</span>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 text-[14px] text-white/80">{tr('缩放', 'Zoom')}</span>
          <input
            type="range"
            min={ICON_ZOOM_MIN}
            max={ICON_ZOOM_MAX}
            step={0.01}
            value={transform.zoom}
            disabled={!natural || busy}
            aria-valuetext={`${transform.zoom.toFixed(1)}x`}
            onChange={(event) => {
              const zoom = Number(event.target.value);
              update((current, size, side) => zoomAround(current, zoom, { x: 0, y: 0 }, size.width, size.height, side));
            }}
            className="h-11 min-w-0 flex-1 accent-gold"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-3 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={phase === 'uploading'}
          className="min-h-11 rounded-lg bg-white/10 px-4 text-[16px] text-white active:bg-white/20 disabled:text-white/40"
        >
          {tr('取消', 'Cancel')}
        </button>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={!natural || busy}
          aria-busy={busy || undefined}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gold px-4 text-[16px] font-medium text-brand-900 active:brightness-95 disabled:opacity-60"
        >
          {busy ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : null}
          {phase === 'processing' ? tr('正在处理…', 'Processing…') : phase === 'uploading' ? (waitingLabel ?? tr('正在上传…', 'Uploading…')) : tr('完成', 'Done')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
