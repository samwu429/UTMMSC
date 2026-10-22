import { useState } from 'react';
import { useSessionStore } from '../../shared/session/store';
import { avatarImageSrc } from './media';

export function InitialAvatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-800 ${className}`}>
      {name.slice(0, 1)}
    </div>
  );
}

export function MemberAvatar({ name, avatarKey, className = '' }: { name: string; avatarKey?: string | null; className?: string }) {
  const token = useSessionStore((s) => s.mediaToken);
  const src = avatarImageSrc(avatarKey, token);
  // A missing or expired image falls back to the initial instead of a broken-image icon.
  // 图片丢失或链接过期时退回首字头像，而不是显示破图标。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (src && src !== failedSrc) {
    return <img src={src} alt="" onError={() => setFailedSrc(src)} className={`shrink-0 rounded-full object-cover ${className}`} />;
  }
  return <InitialAvatar name={name} className={className} />;
}
