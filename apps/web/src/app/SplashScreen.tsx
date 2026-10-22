import { useEffect, useRef, useState } from 'react';
import { prepareLatestApp } from './pwa';

type Phase = 'play' | 'leave' | 'done';

/** Plays the opening film on every launch, then lets the app through. */
/** 每次打开都先播开屏，播完再进入应用。 */
export function SplashScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('play');
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
        className="h-full w-full object-cover landscape:object-contain"
        autoPlay
        muted
        playsInline
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
