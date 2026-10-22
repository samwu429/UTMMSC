/**
 * Thin line icons for the composer, drawn in currentColor like WeChat's input bar.
 * 输入栏使用的细线图标，以 currentColor 绘制，与微信输入栏一致。
 */

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function EmojiIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <circle cx="14" cy="14" r="11.25" />
      <path d="M9.25 16.25a5.4 5.4 0 0 0 9.5 0" />
      <circle cx="10.25" cy="11.25" r="0.6" fill="currentColor" strokeWidth="1.2" />
      <circle cx="17.75" cy="11.25" r="0.6" fill="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function KeyboardIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <circle cx="14" cy="14" r="11.25" />
      <path d="M9 11h.01M12.33 11h.01M15.67 11h.01M19 11h.01M9 14h.01M12.33 14h.01M15.67 14h.01M19 14h.01" strokeWidth="2" />
      <path d="M10.5 17.5h7" />
    </svg>
  );
}

export function PlusCircleIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <circle cx="14" cy="14" r="11.25" />
      <path d="M14 8.5v11M8.5 14h11" />
    </svg>
  );
}

export function CloseCircleIcon({ className = 'h-[18px] w-[18px]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden>
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path d="m6 6 6 6M12 6l-6 6" fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function BackspaceIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      <path d="M9 5h10.5A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H9l-6-7 6-7Z" />
      <path d="m11.5 9.5 5 5M16.5 9.5l-5 5" />
    </svg>
  );
}

export function PhotoIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <rect x="3.75" y="5.75" width="20.5" height="16.5" rx="2" />
      <circle cx="10" cy="11.5" r="1.75" />
      <path d="m4.5 20 6-5.5 4 3.5 3.5-3 5.5 4.5" />
    </svg>
  );
}

export function CameraIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <path d="M3.75 9.5A1.75 1.75 0 0 1 5.5 7.75h3.25l1.75-2.5h7l1.75 2.5h3.25a1.75 1.75 0 0 1 1.75 1.75v11a1.75 1.75 0 0 1-1.75 1.75h-17a1.75 1.75 0 0 1-1.75-1.75v-11Z" />
      <circle cx="14" cy="14.75" r="4" />
    </svg>
  );
}

export function SearchIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} {...LINE} aria-hidden>
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.5 10.5 3.25 3.25" />
    </svg>
  );
}

/** Stand-in for the quoted photo: a quote carries no image key, so the strip cannot load the real thumbnail. */
/** 被引用照片的占位图：引用不包含图片键，引用条无法加载真实缩略图。 */
export function ImageTileIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect width="24" height="24" rx="3" fill="#D6D6D6" />
      <circle cx="8.5" cy="8.5" r="2" fill="#FFFFFF" />
      <path d="m3.5 19 5.5-5.5 3.5 3 3-2.5 5 5H3.5Z" fill="#FFFFFF" />
    </svg>
  );
}

export function EveryoneIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3 19.5a6 6 0 0 1 12 0" />
      <path d="M15.5 5.6a3.25 3.25 0 0 1 0 5.8M18 14.2a6 6 0 0 1 3 5.3" />
    </svg>
  );
}
