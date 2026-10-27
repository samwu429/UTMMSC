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

/** The 我的表情 tab of the expression panel. */
/** 表情面板中「我的表情」标签的图标。 */
export function HeartIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      <path d="M12 19.5s-7.25-4.4-7.25-9.6A3.9 3.9 0 0 1 8.7 6c1.45 0 2.6.75 3.3 1.9.7-1.15 1.85-1.9 3.3-1.9a3.9 3.9 0 0 1 3.95 3.9c0 5.2-7.25 9.6-7.25 9.6Z" />
    </svg>
  );
}

/** 整理表情, at the right end of the panel's tab bar. */
/** 「整理表情」，位于面板标签栏的右端。 */
export function GearIcon({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...LINE} aria-hidden>
      <path d="M10.78 5.11 10.9 3.07h2.2l.12 2.04 2.8 1.16 1.52-1.36 1.55 1.55-1.36 1.52 1.16 2.8 2.04.12v2.2l-2.04.12-1.16 2.8 1.36 1.52-1.55 1.55-1.52-1.36-2.8 1.16-.12 2.04h-2.2l-.12-2.04-2.8-1.16-1.52 1.36-1.55-1.55 1.36-1.52-1.16-2.8-2.04-.12v-2.2l2.04-.12 1.16-2.8-1.36-1.52 1.55-1.55 1.52 1.36 2.8-1.16Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/** The plus of the 添加表情 tile. */
/** 「添加表情」格子中的加号。 */
export function PlusIcon({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={className} {...LINE} aria-hidden>
      <path d="M14 6.5v15M6.5 14h15" />
    </svg>
  );
}

/** The selection mark of a sticker on the manage screen: a filled check when chosen, an empty ring otherwise. */
/** 管理界面中表情的选择标记：选中时为实心对勾，否则为空心圆圈。 */
export function CheckCircleIcon({ checked, className = 'h-[22px] w-[22px]' }: { checked: boolean; className?: string }) {
  if (!checked) {
    return (
      <svg viewBox="0 0 22 22" className={className} aria-hidden>
        <circle cx="11" cy="11" r="9.75" fill="rgba(0,0,0,0.12)" stroke="#FFFFFF" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 22 22" className={className} aria-hidden>
      <circle cx="11" cy="11" r="10.5" fill="#3C165F" stroke="#FFFFFF" strokeWidth="1" />
      <path d="m6.5 11.25 3 3 6-6.25" fill="none" stroke="#FFFFFF" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The small play mark on an animated sticker shown as its still, in grids and in chats. */
/** 以静态图显示的动态表情上的小播放标记，表情格子和聊天中通用。 */
export function StickerPlayIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      <circle cx="10" cy="10" r="9" fill="rgba(0,0,0,0.45)" stroke="#FFFFFF" strokeWidth="1" />
      <path d="M8 6.25v7.5L14 10 8 6.25Z" fill="#FFFFFF" />
    </svg>
  );
}
