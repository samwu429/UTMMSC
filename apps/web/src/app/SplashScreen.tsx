import { useEffect, useRef, useState } from 'react';

type Phase = 'play' | 'leave' | 'done';

/** Plays the opening film on every launch, then lets the app through. */
/** 每次打开都先播开屏，播完再进入应用。 */
export function SplashScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>('play');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setPhase('done');
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    const play = video.play();
    if (play) {
      play.catch(() => {
        window.setTimeout(() => {
          if (video.paused && video.currentTime === 0) setPhase('done');
        }, 700);
      });
    }
    const cap = window.setTimeout(() => setPhase((current) => (current === 'play' ? 'leave' : current)), 12000);
    return () => window.clearTimeout(cap);
  }, []);

  if (phase === 'done') return null;

  return (
    <div
      className={`fixed inset-0 z-[80] flex items-center justify-center bg-black transition-opacity duration-500 ${phase === 'leave' ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
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
        onEnded={() => setPhase('leave')}
        onError={() => setPhase('done')}
      />
    </div>
  );
}
