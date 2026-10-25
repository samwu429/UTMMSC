import { useCallback, useEffect, useRef, useState } from 'react';
import { consumeUpdateReload, pageSessionStorage, type FlagStorage } from './pwa';

type Phase = 'play' | 'leave' | 'done';

/**
 * A transparent one-pixel poster. Without a poster the Android WebView draws its own grey play button until the
 * first frame arrives.
 * 透明的单像素封面。没有封面时，安卓 WebView 会在第一帧到达之前画出自己的灰色播放按钮。
 */
const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
/** The fade lasts 200 ms; past this the splash is removed even without transitionend. */
/** 淡出持续 200 毫秒；超过这个时间，即使没有 transitionend 也会移除开屏。 */
const LEAVE_FALLBACK_MS = 400;
/**
 * The film is one second long. A first download that stalls must not hold the app behind a black screen, so the
 * splash leaves after this whatever the film is doing.
 * 影片时长一秒。首次下载卡住时不能让应用一直停在黑屏后面，所以无论影片处于什么状态，超过这个时间开屏都会离开。
 */
const FILM_CAP_MS = 3000;
/** How long a refused autoplay (iPhone Low Power Mode) may keep the black backdrop before the app shows. */
/** 自动播放被拒绝时（iPhone 低电量模式），黑色背景最多停留多久再显示应用。 */
const REFUSED_PLAY_MS = 700;

/**
 * Whether a launch skips the film: the reload that follows an update (the member just saw the app), or reduced
 * motion. The update flag is always consumed, so the launch after this one plays the film again.
 * 一次启动是否跳过影片：更新之后的重新加载（成员刚刚还在看应用），或者开启了减少动态效果。更新标记总会被取走，所以下一次启动会照常播放影片。
 */
export function filmSkipped(storage: FlagStorage | null, prefersReducedMotion: () => boolean): boolean {
  const afterUpdate = consumeUpdateReload(storage);
  if (afterUpdate) return true;
  try {
    return prefersReducedMotion();
  } catch {
    return false;
  }
}

/**
 * Decided once per page and kept at module level, so a second render or StrictMode cannot read the update flag twice.
 * 每个页面只决定一次并保存在模块级，第二次渲染或 StrictMode 都不会再读一次更新标记。
 */
let skipDecision: boolean | null = null;
function skipFilm(): boolean {
  skipDecision ??= filmSkipped(pageSessionStorage(), () => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return skipDecision;
}

/**
 * Plays the opening film on every launch, then lets the app through. The app is drawn underneath meanwhile; nothing
 * here waits for the network, and update checks run in the background (pwa.ts).
 * 每次打开都先播开屏影片，播完再进入应用。应用在下面同时绘制；这里不等待任何网络请求，更新检查在后台进行（pwa.ts）。
 */
export function SplashScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [skip] = useState(skipFilm);
  const [phase, setPhase] = useState<Phase>(skip ? 'done' : 'play');
  // The film stays invisible until it is really playing, so no browser's play button or blank first paint shows;
  // when autoplay is refused (iPhone Low Power Mode) the black backdrop is all there is.
  // 开屏视频真正开始播放之前保持不可见，任何浏览器的播放按钮或空白首帧都不会露出来；自动播放被拒绝时（iPhone 低电量模式）只显示黑色背景。
  const [playing, setPlaying] = useState(false);

  const leave = useCallback(() => setPhase((current) => (current === 'play' ? 'leave' : current)), []);

  useEffect(() => {
    if (skip) return;
    const cap = window.setTimeout(leave, FILM_CAP_MS);
    const video = videoRef.current;
    if (!video) {
      leave();
      return () => window.clearTimeout(cap);
    }
    let refused: number | undefined;
    const play = video.play();
    if (play) {
      play.catch(() => {
        refused = window.setTimeout(() => {
          if (video.paused && video.currentTime === 0) leave();
        }, REFUSED_PLAY_MS);
      });
    }
    return () => {
      window.clearTimeout(cap);
      if (refused !== undefined) window.clearTimeout(refused);
    };
  }, [skip, leave]);

  // The fade normally ends in transitionend, which never comes when the page is hidden or the transition is
  // skipped, so the splash is removed anyway shortly after the fade should have finished.
  // 淡出通常以 transitionend 结束；页面被隐藏或过渡被跳过时它不会触发，因此在淡出本应结束后不久无论如何都移除开屏。
  useEffect(() => {
    if (phase !== 'leave') return;
    const timer = window.setTimeout(() => setPhase('done'), LEAVE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'done') return null;

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black transition-opacity duration-200 ${phase === 'leave' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      onTransitionEnd={() => {
        if (phase === 'leave') setPhase('done');
      }}
    >
      <video
        ref={videoRef}
        src={`${import.meta.env.BASE_URL}splash/open.mp4`}
        poster={BLANK_POSTER}
        className={`splash-film h-full w-full object-cover landscape:object-contain ${playing ? 'opacity-100' : 'opacity-0'}`}
        autoPlay
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime > 0) setPlaying(true);
        }}
        onEnded={leave}
        onError={leave}
      />
    </div>
  );
}
