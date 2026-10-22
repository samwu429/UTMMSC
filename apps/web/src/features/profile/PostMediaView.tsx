import { useState } from 'react';
import type { PostMedia } from '@utmmsc/shared';
import { useTr } from '../../shared/i18n/locale';
import { useMediaUrl } from './media';

function Frame({ item, className, onOpen }: { item: PostMedia; className: string; onOpen?: (item: PostMedia) => void }) {
  const url = useMediaUrl(item.key);
  if (!url) return <div className={`bg-stone-200 ${className}`} />;
  if (item.kind === 'video') {
    return <video src={url} controls playsInline preload="metadata" className={`bg-black ${className}`} />;
  }
  if (!onOpen) return <img src={url} alt="" className={`object-cover ${className}`} />;
  return (
    <button type="button" onClick={() => onOpen(item)} className="block overflow-hidden">
      <img src={url} alt="" className={`object-cover ${className}`} />
    </button>
  );
}

export function PostMediaView({ media }: { media: PostMedia[] }) {
  const [open, setOpen] = useState<PostMedia | null>(null);
  const openUrl = useMediaUrl(open?.key);
  const tr = useTr();
  if (media.length === 0) return null;
  const video = media.find((item) => item.kind === 'video');
  const images = media.filter((item) => item.kind === 'image');

  const grid =
    images.length <= 1 ? 'grid-cols-1' : images.length === 2 || images.length === 4 ? 'grid-cols-2' : 'grid-cols-3';
  const width = images.length === 1 ? 'max-w-[260px]' : 'max-w-[280px]';

  return (
    <>
      {video ? <Frame item={video} className="mt-2 max-h-80 w-full rounded-lg" /> : null}
      {images.length > 0 ? (
        <div className={`mt-2 grid gap-1 ${grid} ${width}`}>
          {images.map((item) => (
            <Frame key={item.key} item={item} onOpen={setOpen} className={images.length === 1 ? 'max-h-80 w-full rounded-lg object-contain' : 'aspect-square w-full'} />
          ))}
        </div>
      ) : null}
      {open && openUrl ? (
        <button type="button" className="fixed inset-0 z-50 flex items-center justify-center bg-black" onClick={() => setOpen(null)} aria-label={tr('关闭', 'Close')}>
          <img src={openUrl} alt="" className="max-h-full max-w-full object-contain" />
        </button>
      ) : null}
    </>
  );
}
