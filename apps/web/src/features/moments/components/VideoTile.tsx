import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MomentMedia } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { suspendAutoplay, useVideoAutoplay } from '../hooks/useVideoAutoplay';
import { BLANK_POSTER, PlayGlyph } from '../icons';
import { MEDIA_CELL_ATTRIBUTE, type LocalMedia } from '../model';
import { formatVideoClock } from '../viewer/videoClock';

export interface VideoTileProps {
  media: MomentMedia;
  /** This device's copy, shown until the server preview has loaded. */
  /** 本设备上的副本，在服务器预览图加载完成之前显示。 */
  local?: LocalMedia | null;
  /** The stored first frame; null when the video has none or no token is known yet. */
  /** 已保存的第一帧；视频没有首帧或尚无令牌时为 null。 */
  previewSrc: string | null;
  /** The stored video, for inline autoplay; null for a post still being published. */
  /** 已保存的视频，用于内联自动播放；仍在发表中的动态为 null。 */
  videoSrc: string | null;
  width: number;
  height: number;
  /** data-moment-cell value from mediaCellValue. */
  /** 来自 mediaCellValue 的 data-moment-cell 值。 */
  cell: string;
  /** A tap opens the player; without it the tile is not a button (a moderator's snapshot). */
  /** 轻触打开播放器；不提供时格子不是按钮（管理员查看快照时）。 */
  onOpen?: (rect: DOMRect | null) => void;
  /** The server preview loaded, or there is none to wait for. */
  /** 服务器预览图已加载完成，或者没有需要等待的预览图。 */
  onServerReady?: () => void;
  /** The address that loaded, so a later token reuses it. */
  /** 加载成功的地址，之后换了令牌也沿用它。 */
  onPreviewLoad?: (src: string) => void;
}

/**
 * A video in the grid without any native player chrome: the first-frame preview, our 44px play glyph and a
 * duration pill. It never shows a bare <video>; the inline autoplay video stays transparent until its first
 * frame plays, over a blank poster, so neither iOS's triangle nor the WebView's grey button can flash. Without
 * a preview it is a dark tile with the glyph.
 * 宫格中不带任何系统播放器外观的视频：首帧预览图、我们的 44px 播放标志和时长标签。它从不显示裸露的 <video>；内联自动播放的视频
 * 使用空白封面，并在第一帧播放之前保持透明，因此 iOS 的三角和 WebView 的灰色按钮都不会闪现。没有预览图时显示深色格子和播放标志。
 */
export function VideoTile({ media, local = null, previewSrc, videoSrc, width, height, cell, onOpen, onServerReady, onPreviewLoad }: VideoTileProps) {
  const tr = useTr();
  const autoplay = useVideoAutoplay<HTMLElement>(Boolean(onOpen && videoSrc));
  const videoRef = useRef<HTMLVideoElement>(null);
  const [inlinePlaying, setInlinePlaying] = useState(false);
  const [retried, setRetried] = useState(false);
  const [serverFailed, setServerFailed] = useState(false);
  const [serverLoaded, setServerLoaded] = useState<string | null>(null);
  const readyRef = useRef(onServerReady);

  useLayoutEffect(() => {
    readyRef.current = onServerReady;
  });

  const serverSrc = previewSrc && !serverFailed ? (retried ? `${previewSrc}&retry=1` : previewSrc) : null;
  const localSrc = local?.previewUrl ?? null;
  const duration = formatVideoClock(media.durationMs ?? local?.durationMs);
  const described = duration ? tr(`视频，时长 ${duration}`, `Video, ${duration}`) : tr('视频', 'Video');
  const label = onOpen ? `${described}${tr('，轻触播放', ', tap to play')}` : described;

  // Nothing to wait for: no stored preview, or it could not be loaded at all.
  // 没有需要等待的内容：没有保存的预览图，或者它完全无法加载。
  useEffect(() => {
    if (!previewSrc || serverFailed) readyRef.current?.();
  }, [previewSrc, serverFailed]);

  useEffect(() => {
    const video = videoRef.current;
    if (!autoplay.active || !video) return;
    // Muted is set as a property before play(), which every autoplay policy requires.
    // 在 play() 之前以属性方式设置静音，这是所有自动播放策略的要求。
    video.muted = true;
    video.defaultMuted = true;
    video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      setInlinePlaying(false);
    };
  }, [autoplay.active]);

  const content = (
    <>
      {serverSrc ? (
        <img
          src={serverSrc}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onLoad={() => {
            setServerLoaded(serverSrc);
            onPreviewLoad?.(serverSrc);
            readyRef.current?.();
          }}
          onError={() => {
            if (!retried) setRetried(true);
            else setServerFailed(true);
          }}
          className={`absolute inset-0 h-full w-full object-cover ${serverLoaded === serverSrc ? '' : 'opacity-0'}`}
        />
      ) : null}
      {localSrc ? <img src={localSrc} alt="" draggable={false} decoding="async" className="absolute inset-0 h-full w-full object-cover" /> : null}
      {autoplay.active && videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          muted
          playsInline
          loop
          preload="none"
          poster={BLANK_POSTER}
          disablePictureInPicture
          tabIndex={-1}
          aria-hidden
          onPlaying={() => setInlinePlaying(true)}
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${inlinePlaying ? '' : 'opacity-0'}`}
        />
      ) : null}
      {inlinePlaying ? null : (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          <PlayGlyph size={44} />
        </span>
      )}
      {duration ? (
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-[3px] bg-black/50 px-1 text-[11px] font-medium leading-4 text-white" aria-hidden>
          {duration}
        </span>
      ) : null}
    </>
  );

  const box = {
    width,
    height,
    WebkitTouchCallout: 'none',
    touchAction: 'manipulation',
  } as const;
  const className = 'relative block shrink-0 select-none overflow-hidden bg-[#2B2B2B]';
  const cellProps = { [MEDIA_CELL_ATTRIBUTE]: cell };

  if (!onOpen) {
    return (
      <div {...cellProps} role="img" aria-label={label} className={className} style={box} onContextMenu={(event) => event.preventDefault()}>
        {content}
      </div>
    );
  }

  return (
    <button
      ref={autoplay.ref}
      type="button"
      {...cellProps}
      aria-label={label}
      className={className}
      style={box}
      onContextMenu={(event) => event.preventDefault()}
      onClick={(event) => {
        suspendAutoplay();
        onOpen(event.currentTarget.getBoundingClientRect());
      }}
    >
      {content}
    </button>
  );
}
