import type { ReactNode } from 'react';

/**
 * Icons of 好友动态, drawn in currentColor like the chat icons, plus the play glyph and the blank poster that
 * keep the native play triangle off video tiles.
 * 好友动态使用的图标，与聊天图标一样以 currentColor 绘制；另有播放标志和空白封面，用来避免视频格子上出现系统自带的播放三角。
 */

/**
 * A transparent one-pixel poster. Without a poster the Android WebView draws its own grey play button until the
 * first frame arrives. Copied from the splash screen, not imported, so the two stay independent.
 * 透明的单像素封面。没有封面时，安卓 WebView 会在第一帧到达之前画出自己的灰色播放按钮。从开屏页复制而来，没有导入，两者互不影响。
 */
export const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Line({ children, className }: { children: ReactNode; className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      {children}
    </svg>
  );
}

const HEART = 'M12 19.5s-7.5-4.6-7.5-10.1A4.15 4.15 0 0 1 8.65 5.25c1.4 0 2.6.7 3.35 1.85.75-1.15 1.95-1.85 3.35-1.85a4.15 4.15 0 0 1 4.15 4.15c0 5.5-7.5 10.1-7.5 10.1Z';

/** 赞. Filled once liked; the likes row uses the filled heart in wx-link. */
/** 赞。点赞后为实心；点赞行使用 wx-link 色的实心心形。 */
export function HeartIcon({ filled = false, className = 'h-5 w-5' }: { filled?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} fill={filled ? 'currentColor' : 'none'} aria-hidden>
      <path d={HEART} />
    </svg>
  );
}

/** Comment. */
/** 评论。 */
export function CommentIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Line className={className}>
      <path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8.5a1.5 1.5 0 0 1-1.5 1.5H11l-4.5 3.5v-3.5h-1A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5Z" />
    </Line>
  );
}

/** The header camera: tap for the post sheet, long press for a text-only post. */
/** 顶栏的相机：轻触打开发表菜单，长按直接发文字。 */
export function CameraIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} strokeWidth={1.75} aria-hidden>
      <path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13.5" r="3.4" />
    </svg>
  );
}

/**
 * Our play glyph for video tiles and the player: a black disc at 40% with a thin white ring and a white
 * triangle. `size` is the diameter in px (44 on tiles).
 * 视频格子和播放器使用的播放标志：40% 黑色圆盘、白色细圈和白色三角。`size` 为直径像素（格子上为 44）。
 */
export function PlayGlyph({ size = 44, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 44 44" width={size} height={size} className={`pointer-events-none drop-shadow ${className}`} aria-hidden>
      <circle cx="22" cy="22" r="21" fill="#000" fillOpacity="0.4" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.5" />
      <path d="M18 14.5v15a.8.8 0 0 0 1.2.7l12.2-7.5a.8.8 0 0 0 0-1.4l-12.2-7.5a.8.8 0 0 0-1.2.7Z" fill="#fff" />
    </svg>
  );
}

/** 仅自己: shown beside the time on the author's own private posts. */
/** 仅自己：显示在作者自己仅自己可见的动态时间旁边。 */
export function LockIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <Line className={className}>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Line>
  );
}

/** 全社团: the club-wide audience. */
/** 全社团：全社团可见。 */
export function GlobeIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <Line className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
    </Line>
  );
}

/** 好友: the friends audience. */
/** 好友：好友可见。 */
export function FriendsIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Line className={className}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.4-3.2 2.6-5.2 5.5-5.2s5.1 2 5.5 5.2" />
      <path d="M15.5 5.8a3 3 0 0 1 0 5.4M17 13.9c2 .6 3.2 2.4 3.5 5.1" />
    </Line>
  );
}

/** Location. */
/** 所在位置。 */
export function LocationIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <Line className={className}>
      <path d="M12 20.5s-6-5.3-6-10.5a6 6 0 0 1 12 0c0 5.2-6 10.5-6 10.5Z" />
      <circle cx="12" cy="10" r="2.3" />
    </Line>
  );
}

/** The "··" that opens the 赞 / 评论 pill, two dots as WeChat draws them. */
/** 打开「赞 / 评论」浮条的「··」，与微信一样画成两个点。 */
export function DotsIcon({ className = 'h-4 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 16" className={className} fill="currentColor" aria-hidden>
      <circle cx="6.5" cy="8" r="1.7" />
      <circle cx="13.5" cy="8" r="1.7" />
    </svg>
  );
}

/** The header ··· of the detail page and the album. */
/** 详情页和相册顶栏的「···」。 */
export function MoreIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  );
}

/** The 「‹」 of the header back control. */
/** 顶栏返回按钮的「‹」。 */
export function BackIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} strokeWidth={2} aria-hidden>
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  );
}
