import { useState } from 'react';
import { useSessionStore } from '../../shared/session/store';
import { avatarImageSrc } from './media';

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

export function MemberAvatar({ name, avatarKey, className = '', shape = 'circle' }: { name: string; avatarKey?: string | null; className?: string; shape?: AvatarShape }) {
  const token = useSessionStore((s) => s.mediaToken);
  const src = avatarImageSrc(avatarKey, token);
  // A missing or expired image falls back to the initial instead of a broken-image icon.
  // 图片丢失或链接过期时退回首字头像，而不是显示破图标。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return <img src={src} alt="" onError={() => setFailedSrc(src)} className={`shrink-0 ${shapeClass(shape)} object-cover ${className}`} />;
  }
  return <InitialAvatar name={name} className={className} shape={shape} />;
}
