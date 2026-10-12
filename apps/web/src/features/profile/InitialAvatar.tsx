import { useMediaUrl } from './media';

export function InitialAvatar({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-800 ${className}`}>
      {name.slice(0, 1)}
    </div>
  );
}

export function MemberAvatar({ name, avatarKey, className = '' }: { name: string; avatarKey?: string | null; className?: string }) {
  const url = useMediaUrl(avatarKey);
  if (url) return <img src={url} alt="" className={`shrink-0 rounded-full object-cover ${className}`} />;
  return <InitialAvatar name={name} className={className} />;
}
