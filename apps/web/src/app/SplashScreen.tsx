import { useEffect, useRef, useState } from 'react';
import { prepareLatestApp } from './pwa';

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

/** Plays the opening film on every launch, then lets the app through. */
/** 每次打开都先播开屏，播完再进入应用。 */
export function SplashScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('play');
  // The film stays invisible until it is really playing, so no browser's play button or blank first paint shows;
  // when autoplay is refused (iPhone Low Power Mode) the black backdrop is all there is.
  // 开屏视频真正开始播放之前保持不可见，任何浏览器的播放按钮或空白首帧都不会露出来；自动播放被拒绝时（iPhone 低电量模式）只显示黑色背景。
  const [playing, setPlaying] = useState(false);
  const videoDone = useRef(false);
  const updateDone = useRef(false);
  const reloading = useRef(false);

  function finish() {
    if (reloading.current || !videoDone.current || !updateDone.current) return;
    setPhase('leave');
  }

  useEffect(() => {
    let cancel = false;
    prepareLatestApp().then((result) => {
      if (cancel || result === 'reload') {
        reloading.current = result === 'reload';
        return;
      }
      updateDone.current = true;
      finish();
    });

    // A stalled first download of the film must not hold the app behind a black screen.
    // 首次下载开屏视频卡住时，不能让应用一直停在黑屏后面。
    const cap = window.setTimeout(() => {
      videoDone.current = true;
      finish();
    }, 4000);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const video = videoRef.current;
    if (reduce || !video) {
      videoDone.current = true;
      finish();
      return () => {
        cancel = true;
        window.clearTimeout(cap);
      };
    }
    if (Number.isFinite(video.duration) && video.duration > 0) video.playbackRate = video.duration;
    const play = video.play();
    if (play) {
      play.catch(() => {
        window.setTimeout(() => {
          if (video.paused && video.currentTime === 0) {
            videoDone.current = true;
            finish();
          }
        }, 700);
      });
    }
    return () => {
      cancel = true;
      window.clearTimeout(cap);
    };
  }, []);

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
        disablePictureInPicture
        disableRemotePlayback
        aria-hidden
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onTimeUpdate={(event) => {
          if (event.currentTarget.currentTime > 0) setPlaying(true);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          // The file is two seconds. Playing at that rate finishes it in one second.
          // 成片是两秒。按片长做播放速度，正好一秒播完。
          if (Number.isFinite(video.duration) && video.duration > 0) video.playbackRate = video.duration;
        }}
        onEnded={() => {
          videoDone.current = true;
          finish();
        }}
        onError={() => {
          videoDone.current = true;
          finish();
        }}
      />
    </div>
  );
}
