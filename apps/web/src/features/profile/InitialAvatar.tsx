import { useState } from 'react';
import type { PresetAvatarSize } from '@utmmsc/shared';
import { useReducedMotion } from '../../shared/media/reducedMotion';
import { useSessionStore } from '../../shared/session/store';
import { LIST_AVATAR_PX, avatarImageSrc, avatarPxFromClass } from './media';

/** Chat screens use WeChat's square avatars; everywhere else keeps the circle. */
/** 聊天界面使用微信式方形头像；其他地方仍为圆形。 */
export type AvatarShape = 'circle' | 'square';

function shapeClass(shape: AvatarShape): string {
  return shape === 'square' ? 'rounded-[4px]' : 'rounded-full';
}

export function InitialAvatar({ name, className = '', shape = 'circle' }: { name: string; className?: string; shape?: AvatarShape }) {
  return (
    <div className={`flex shrink-0 items-center justify-center ${shapeClass(shape)} bg-brand-50 font-semibold text-brand-800 ${className}`}>
      {name.slice(0, 1)}
    </div>
  );
}

/**
 * A member's avatar. Its drawn size comes from `displayPx` or the h-N class, which picks the 128 or 256 preset
 * file and sets the image's intrinsic size; `presetSize` forces the file. Off-screen avatars load as they near the
 * screen and decode off the main thread.
 * 成员头像。显示尺寸取自 `displayPx` 或 h-N 类名，据此选择 128 或 256 的预设文件，并设置图片的固有尺寸；`presetSize` 可强制指定文件。
 * 屏幕外的头像在接近屏幕时才加载，并在主线程之外解码。
 */
export function MemberAvatar({
  name,
  avatarKey,
  className = '',
  shape = 'circle',
  displayPx,
  presetSize,
}: {
  name: string;
  avatarKey?: string | null;
  className?: string;
  shape?: AvatarShape;
  displayPx?: number;
  presetSize?: PresetAvatarSize;
}) {
  const token = useSessionStore((s) => s.mediaToken);
  const reducedMotion = useReducedMotion();
  const px = displayPx ?? avatarPxFromClass(className) ?? LIST_AVATAR_PX;
  const src = avatarImageSrc(avatarKey, token, { displayPx: px, presetSize, reducedMotion });
  // A missing or expired image falls back to the initial instead of a broken-image icon.
  // 图片丢失或链接过期时退回首字头像，而不是显示破图标。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return (
      <img
        src={src}
        alt=""
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        className={`shrink-0 ${shapeClass(shape)} object-cover ${className}`}
      />
    );
  }
  return <InitialAvatar name={name} className={className} shape={shape} />;
}
