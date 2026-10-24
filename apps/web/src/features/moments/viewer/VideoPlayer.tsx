import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { MomentMedia } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { centredBox, coverTransform, fitContain, type Size } from '../../chat/room/imageBox';
import { mediaUrl } from '../../profile/media';
import { BLANK_POSTER, PlayGlyph } from '../icons';
import type { LocalMedia } from '../model';
import { formatVideoClock } from './videoClock';

export interface VideoPlayerProps {
  media: MomentMedia;
  /** This device's copy, for a post that is still being published. */
  /** 本设备上的副本，用于仍在发表中的动态。 */
  localMedia?: LocalMedia | null;
  mediaToken: string | null;
  /** The tapped tile, for the zoom out of it. */
  /** 被点击的格子，用于从它放大。 */
  startRect: DOMRect | null;
  onClose(): void;
}

const ANIMATION_MS = 240;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** The spinner joins the preview only when the first frame takes longer than this. */
/** 第一帧超过这段时间仍未出现时，才在预览图上显示加载转圈。 */
const SPINNER_DELAY_MS = 300;
const TAP_SLOP_PX = 8;
const DISMISS_PX = 110;
const DISMISS_VELOCITY = 0.6;
/** A primed element no player took over within this long is stopped, so nothing plays behind the page. */
/** 预先启动的元素若在这段时间内没有被播放器接管就会停止，页面背后不会有声音。 */
const PRIMED_TTL_MS = 1500;
/** A player's element is kept this long after unmount, for StrictMode's second mount to take it back. */
/** 播放器卸载后保留其元素这么久，供 StrictMode 的第二次挂载取回。 */
const PARKED_TTL_MS = 300;

/**
 * starting: play() was asked for and no frame has shown yet (the preview, then a spinner). playing: frames are
 * showing, with the native controls. refused: the browser would not play without another tap (our glyph).
 * ended: 重播. failed: the file did not load (tap to retry).
 * starting：已请求 play()，还没有画面（显示预览图，之后加转圈）。playing：画面已出现，带系统控件。refused：浏览器要求再点一次才播放
 * （显示我们的播放标志）。ended：显示「重播」。failed：文件加载失败（轻触重试）。
 */
type Status = 'starting' | 'playing' | 'refused' | 'ended' | 'failed';
type Phase = 'enter' | 'open' | 'exit';

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function positive(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function videoSrc(media: MomentMedia, localMedia: LocalMedia | null, mediaToken: string | null): string | null {
  if (localMedia?.fileUrl) return localMedia.fileUrl;
  return media.key && mediaToken ? mediaUrl(media.key, mediaToken) : null;
}

function previewSrc(media: MomentMedia, localMedia: LocalMedia | null, mediaToken: string | null): string | null {
  if (localMedia?.previewUrl) return localMedia.previewUrl;
  return media.previewKey && mediaToken ? mediaUrl(media.previewKey, mediaToken) : null;
}

/* The element started in the tap */
/* 在点击中启动的元素 */

interface PrimedVideo {
  video: HTMLVideoElement;
  src: string;
  /** The play() started in the tap; null when none was started or it threw. */
  /** 在点击中发起的 play()；没有发起或抛错时为 null。 */
  play: Promise<void> | null;
  /** Parked by a player that was playing, so the next one plays it again. */
  /** 由正在播放的播放器暂存，下一个播放器会继续播放。 */
  resume: boolean;
  timer: ReturnType<typeof setTimeout>;
}

let primed: PrimedVideo | null = null;
let lot: HTMLDivElement | null = null;

/** Where a primed element waits: inside the document, so iOS plays it inline, but out of sight. */
/** 预先启动的元素等待的地方：位于文档中，iOS 因此会内联播放，但不可见。 */
function parkingLot(): HTMLDivElement {
  if (lot?.isConnected) return lot;
  lot = document.createElement('div');
  lot.setAttribute('aria-hidden', 'true');
  lot.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
  document.body.appendChild(lot);
  return lot;
}

function createVideo(src: string, poster: string | null): HTMLVideoElement {
  const video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.preload = 'auto';
  // Without a poster the Android WebView paints its own grey play button until the first frame.
  // 没有封面时，安卓 WebView 会在第一帧之前画出自己的灰色播放按钮。
  video.poster = poster ?? BLANK_POSTER;
  video.muted = false;
  video.src = src;
  return video;
}

function releaseVideo(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  // Loading the empty source stops the download.
  // 加载空的来源会停止下载。
  video.load();
  video.remove();
}

function dropPrimed(): void {
  if (!primed) return;
  clearTimeout(primed.timer);
  releaseVideo(primed.video);
  primed = null;
}

function park(video: HTMLVideoElement, src: string, ttl: number): PrimedVideo {
  dropPrimed();
  parkingLot().appendChild(video);
  const entry: PrimedVideo = {
    video,
    src,
    play: null,
    resume: false,
    timer: setTimeout(() => {
      if (primed === entry) dropPrimed();
    }, ttl),
  };
  primed = entry;
  return entry;
}

function takePrimed(src: string): PrimedVideo | null {
  const entry = primed;
  if (!entry) return null;
  primed = null;
  clearTimeout(entry.timer);
  if (entry.src === src) return entry;
  releaseVideo(entry.video);
  return null;
}

function startPlay(video: HTMLVideoElement): Promise<void> | null {
  try {
    const play = video.play();
    // A refusal is handled by whoever watches this promise; this keeps it from being reported as unhandled.
    // 拒绝由关注这个 promise 的一方处理；这里避免它被报告为未处理。
    play.catch(() => undefined);
    return play;
  } catch {
    return null;
  }
}

/**
 * Call in the tap that opens the player, before the state change that mounts it: it starts playback inside the
 * user gesture, so the sound plays on iPhone, and the VideoPlayer that mounts next takes the element over.
 * 在打开播放器的那次点击中、挂载播放器的状态变化之前调用：它在用户手势内开始播放，iPhone 上因此能播放声音；随后挂载的 VideoPlayer 接管这个元素。
 */
export function primeMomentVideo(media: MomentMedia, localMedia: LocalMedia | null, mediaToken: string | null): void {
  if (typeof document === 'undefined') return;
  const src = videoSrc(media, localMedia, mediaToken);
  if (!src) return;
  const entry = park(createVideo(src, previewSrc(media, localMedia, mediaToken)), src, PRIMED_TTL_MS);
  entry.play = startPlay(entry.video);
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v3.2h3.2" />
    </svg>
  );
}

/**
 * Full-screen player that zooms out of the tile and shows the preview with our glyph until the first frame
 * plays; controls appear only then, so the native triangle never shows. Drag down, Escape and back close it;
 * at the end it offers 重播.
 * 从格子放大打开的全屏播放器；第一帧播放之前显示预览图和我们的播放标志，之后才出现控件，因此不会出现系统的播放三角。
 * 下拉、Escape 和返回可以关闭；播放结束时提供「重播」。
 */
export function VideoPlayer({ media, localMedia = null, mediaToken, startRect, onClose }: VideoPlayerProps) {
  const tr = useTr();
  const rootRef = useRef<HTMLDivElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reduced] = useState(reducedMotion);
  const [phase, setPhase] = useState<Phase>(() => (reduced ? 'open' : 'enter'));
  const [animating, setAnimating] = useState(false);
  const [viewport, setViewport] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [natural, setNatural] = useState<Size | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [slow, setSlow] = useState(false);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  // The first address that could be built stays: a refreshed media token must not restart the video.
  // 保留第一个能生成的地址：媒体令牌刷新时不能让视频从头播放。
  const [src, setSrc] = useState(() => videoSrc(media, localMedia, mediaToken));
  const [preview, setPreview] = useState(() => previewSrc(media, localMedia, mediaToken));
  const watchRef = useRef<(play: Promise<void> | null) => void>(() => undefined);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const gesture = useRef({ id: -1, mode: 'idle' as 'idle' | 'pending' | 'dismiss' | 'ignore', startX: 0, startY: 0, startAt: 0, moved: false });

  useEffect(() => {
    if (!src) setSrc(videoSrc(media, localMedia, mediaToken));
    if (!preview) setPreview(previewSrc(media, localMedia, mediaToken));
  }, [src, preview, media, localMedia, mediaToken]);

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  useEffect(() => {
    const pending = timers.current;
    return () => {
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

  // The page behind scrolls the document, which a wheel over the fixed player would otherwise move.
  // 后面的页面滚动的是文档，滚轮在固定的播放器上滚动时本会带动它。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const stop = (event: WheelEvent) => event.preventDefault();
    root.addEventListener('wheel', stop, { passive: false });
    return () => root.removeEventListener('wheel', stop);
  }, []);

  // Takes over the element started in the tap, or makes one, and follows it until the first frame, the end or an error.
  // 接管在点击中启动的元素，或新建一个，并跟踪它直到出现第一帧、播放结束或出错。
  useLayoutEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    if (!src) {
      setStatus('failed');
      return;
    }
    const entry = takePrimed(src);
    const video = entry?.video ?? createVideo(src, preview);
    video.className = 'block h-full w-full object-contain';
    video.tabIndex = 0;
    holder.appendChild(video);
    videoRef.current = video;
    let disposed = false;

    const watch = (play: Promise<void> | null) => {
      if (!play) {
        if (!disposed) setStatus('refused');
        return;
      }
      play.then(undefined, (error: unknown) => {
        // AbortError: a pause or a new load replaced this request, which is not a refusal.
        // AbortError：暂停或重新加载取代了这次请求，并不是被拒绝。
        if (disposed || (error instanceof DOMException && error.name === 'AbortError')) return;
        setStatus(video.error ? 'failed' : 'refused');
      });
    };
    watchRef.current = watch;

    const showing = () => {
      if (!disposed && !video.paused && video.currentTime > 0) setStatus((now) => (now === 'starting' || now === 'refused' ? 'playing' : now));
    };
    const onPlaying = () => {
      if (!disposed) setStatus((now) => (now === 'failed' ? now : 'playing'));
    };
    const onEnded = () => {
      if (!disposed) setStatus('ended');
    };
    const onError = () => {
      if (!disposed) setStatus('failed');
    };
    const onMetadata = () => {
      if (!disposed && positive(video.videoWidth) && positive(video.videoHeight)) setNatural({ width: video.videoWidth, height: video.videoHeight });
    };
    video.addEventListener('playing', onPlaying);
    // Some WebViews never send playing; a moving clock means frames are showing.
    // 有些 WebView 从不发出 playing；时间在走就说明画面已经出现。
    video.addEventListener('timeupdate', showing);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onMetadata);
    if (video.readyState >= 1) onMetadata();

    setStatus('starting');
    if (!entry) watch(startPlay(video));
    else if (entry.resume) watch(startPlay(video));
    else if (entry.play) watch(entry.play);
    else watch(null);
    showing();

    return () => {
      disposed = true;
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('timeupdate', showing);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onMetadata);
      const resume = !video.paused && !video.ended;
      video.pause();
      videoRef.current = null;
      watchRef.current = () => undefined;
      // Parked instead of dropped, so StrictMode's second mount takes the same element, which iPhone already
      // allowed to play with sound; a real unmount releases it a moment later.
      // 暂存而不是丢弃，StrictMode 的第二次挂载因此取回同一个元素（iPhone 已允许它有声播放）；真正卸载时稍后释放。
      park(video, src, PARKED_TTL_MS).resume = resume;
    };
    // The preview only seeds a new element's poster; changing it must not replace the element.
    // 预览图只用作新元素的封面；它变化时不能替换元素。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Controls only once frames show, so the native play triangle never appears over the preview; none at the end, where 重播 takes over.
  // 画面出现后才加上控件，系统的播放三角因此不会出现在预览图上；播放结束时也不显示控件，由「重播」接替。
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.controls = status === 'playing';
  }, [status]);

  useEffect(() => {
    if (status !== 'starting') {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  useLayoutEffect(() => {
    if (phase !== 'enter') return;
    // Flush the start frame so the change below animates.
    // 先提交起始帧，下面的变化才会产生动画。
    void rootRef.current?.offsetWidth;
    setAnimating(true);
    setPhase('open');
    later(() => setAnimating(false), ANIMATION_MS);
  }, [phase]);

  function close() {
    if (phase === 'exit') return;
    videoRef.current?.pause();
    if (reduced) {
      onClose();
      return;
    }
    setAnimating(true);
    setPhase('exit');
    later(onClose, ANIMATION_MS);
  }

  // The system back gesture closes the player instead of leaving the page.
  // 系统返回手势关闭播放器，而不是离开页面。
  useBackToClose(close);

  // Escape is heard on the document, so it still closes the player when the focused button (重播, the glyph)
  // has just gone away.
  // 在 document 上监听 Escape，因此刚刚获得焦点的按钮（「重播」、播放标志）消失之后，它仍能关闭播放器。
  const closeRef = useRef(close);
  useLayoutEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function play() {
    const video = videoRef.current;
    if (!video) return;
    // The button pressed (重播, the glyph, retry) is about to go; focus stays in the player.
    // 按下的按钮（「重播」、播放标志、重试）即将消失；焦点保留在播放器内。
    if (document.activeElement instanceof HTMLElement && stageRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
    if (status === 'failed') video.load();
    else if (status === 'ended' || video.ended) video.currentTime = 0;
    setStatus('starting');
    watchRef.current(startPlay(video));
  }

  function snapBack() {
    setAnimating(true);
    setDrag({ x: 0, y: 0 });
    later(() => setAnimating(false), ANIMATION_MS);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (phase !== 'open' || state.mode !== 'idle') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button')) return;
    state.id = event.pointerId;
    state.mode = 'pending';
    state.startX = event.clientX;
    state.startY = event.clientY;
    state.startAt = performance.now();
    state.moved = false;
    setAnimating(false);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (event.pointerId !== state.id) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.mode === 'pending') {
      if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
      state.moved = true;
      // Only a downward drag is ours; sideways is left to the native scrubber.
      // 只有向下拖动由这里处理；横向拖动留给系统的进度条。
      if (dy > 0 && dy > Math.abs(dx)) {
        state.mode = 'dismiss';
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } else {
        state.mode = 'ignore';
      }
    }
    if (state.mode === 'dismiss') setDrag({ x: dx, y: Math.max(0, dy) });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (event.pointerId !== state.id) return;
    const mode = state.mode;
    state.mode = 'idle';
    state.id = -1;
    if (mode !== 'dismiss') return;
    const dy = event.clientY - state.startY;
    const elapsed = Math.max(1, performance.now() - state.startAt);
    if (event.type !== 'pointercancel' && (dy > DISMISS_PX || dy / elapsed > DISMISS_VELOCITY)) close();
    else snapBack();
  }

  function onBackdropClick() {
    if (gesture.current.moved) return;
    close();
  }

  function onStageClick(event: MouseEvent<HTMLDivElement>) {
    if (gesture.current.moved || (event.target instanceof Element && event.target.closest('button'))) return;
    // While frames show, taps belong to the native controls.
    // 画面出现后，点击交给系统控件处理。
    if (status === 'refused' || status === 'failed') play();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    // Tab stays inside the player.
    // Tab 停留在播放器内部。
    const stops = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button, video[controls]') ?? []);
    event.preventDefault();
    const at = stops.findIndex((stop) => stop === document.activeElement);
    const next = event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
    stops[next]?.focus();
  }

  const dims: Size | null =
    positive(media.width) && positive(media.height)
      ? { width: media.width, height: media.height }
      : (natural ?? (startRect && positive(startRect.width) && positive(startRect.height) ? { width: startRect.width, height: startRect.height } : null));
  const fit = dims ? fitContain(dims, viewport) : { width: viewport.width, height: Math.min(viewport.height, (viewport.width * 9) / 16) };
  const box = centredBox(fit, viewport);
  const transition = animating ? `transform ${ANIMATION_MS}ms ${EASE}, opacity ${ANIMATION_MS}ms ${EASE}` : 'none';
  const dismissProgress = Math.min(1, drag.y / (viewport.height * 0.5));
  let backdrop = 1 - dismissProgress;
  let stageTransform = `translate3d(${drag.x}px, ${drag.y}px, 0) scale(${1 - dismissProgress * 0.4})`;
  let stageOpacity = 1;
  if (phase === 'enter' || phase === 'exit') {
    backdrop = 0;
    if (startRect) {
      const t = coverTransform({ left: startRect.left, top: startRect.top, width: startRect.width, height: startRect.height }, box);
      stageTransform = `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.scale})`;
    } else {
      stageOpacity = 0;
    }
  }

  const framesShowing = status === 'playing' || status === 'ended';
  const clock = formatVideoClock(media.durationMs ?? null);
  const playLabel = clock ? tr(`播放视频，时长 ${clock}`, `Play video, ${clock}`) : tr('播放视频', 'Play video');

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={tr('视频播放器', 'Video player')}
      tabIndex={-1}
      className="fixed inset-0 z-[55] select-none overflow-hidden outline-none"
      style={{ touchAction: 'none', overscrollBehavior: 'contain', WebkitTouchCallout: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <div className="absolute inset-0 bg-black" style={{ opacity: backdrop, transition }} onClick={onBackdropClick} aria-hidden />
      <div
        ref={stageRef}
        className="absolute overflow-hidden bg-black"
        style={{ left: box.left, top: box.top, width: box.width, height: box.height, transform: stageTransform, opacity: stageOpacity, transition, willChange: 'transform' }}
        onClick={onStageClick}
      >
        {preview && !framesShowing ? <img src={preview} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-contain" /> : null}
        {/* The element is placed here by the effect above; it stays invisible until frames show. */}
        {/* 元素由上面的 effect 放进这里；画面出现之前保持不可见。 */}
        <div ref={holderRef} className="absolute inset-0" style={{ opacity: framesShowing ? 1 : 0 }} />
        {status === 'starting' && slow ? (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <WxSpinner className="!text-white/80" />
          </span>
        ) : null}
        {status === 'refused' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              play();
            }}
            aria-label={playLabel}
            className="absolute inset-0 flex items-center justify-center"
          >
            <PlayGlyph size={64} />
          </button>
        ) : null}
        {status === 'failed' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              play();
            }}
            className="absolute inset-0 flex items-center justify-center px-6 text-center text-[15px] text-white/90"
          >
            {tr('视频加载失败，轻触重试', "Couldn't load the video. Tap to retry")}
          </button>
        ) : null}
        {status === 'ended' ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              play();
            }}
            className="absolute left-1/2 top-1/2 flex min-h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/50 px-5 text-[15px] text-white active:bg-black/70"
          >
            <ReplayIcon />
            {tr('重播', 'Replay')}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={tr('关闭', 'Close')}
        className="absolute flex h-11 w-11 items-center justify-center rounded-full text-white active:bg-white/10"
        style={{ top: 'calc(var(--safe-top) + 4px)', left: 'calc(var(--safe-left) + 4px)', opacity: backdrop, transition }}
      >
        <CloseIcon />
      </button>
    </div>,
    document.body,
  );
}
