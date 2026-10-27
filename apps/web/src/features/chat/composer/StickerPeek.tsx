import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { StickerRef } from '@utmmsc/shared';
import { useSessionStore } from '../../../shared/session/store';
import { stickerFileSrc, stickerThumbSrc } from '../stickers/media';
import { peekCardPosition, peekCardSize, type GridPoint, type GridRect } from './stickerGrid';

/**
 * The card a long press, a resting mouse or keyboard focus shows above a sticker tile: twice the tile (at most 160 px),
 * playing the file, since the member asked to see it. It is visual only: hidden from screen readers and from pointers,
 * so `document.elementFromPoint` under the finger always finds the tile, never the card.
 * 长按、鼠标停留或键盘聚焦时在表情格子上方显示的卡片：格子的两倍大小（最大 160px），播放表情文件，因为这是成员主动要看的。
 * 它只用于视觉：对读屏软件和指针都不可见，所以手指下的 `document.elementFromPoint` 总是找到格子，而不是卡片。
 */
export function StickerPeek({ sticker, tile, point, tileSize }: { sticker: StickerRef; tile: GridRect; point: GridPoint; tileSize: number }) {
  const token = useSessionStore((s) => s.mediaToken);
  const [loaded, setLoaded] = useState<string | null>(null);
  const size = peekCardSize(tileSize);
  if (typeof document === 'undefined' || typeof window === 'undefined' || size <= 0) return null;
  const { left, top } = peekCardPosition({ tile, pointer: point, viewport: { width: window.innerWidth, height: window.innerHeight }, size });
  const file = stickerFileSrc(sticker, token);
  const still = stickerThumbSrc(sticker, token);
  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[70] box-border rounded-[8px] bg-white p-2 shadow-[0_4px_18px_rgba(0,0,0,0.18)]"
      style={{ left, top, width: size, height: size }}
    >
      <span className="relative block h-full w-full">
        {/* The still holds the place until the file has loaded. */}
        {/* 文件加载完成之前先用静态图占位。 */}
        {still && loaded !== file ? <img src={still} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" /> : null}
        {file ? (
          <img
            key={file}
            src={file}
            alt=""
            draggable={false}
            onLoad={() => setLoaded(file)}
            className={`absolute inset-0 h-full w-full object-contain ${loaded === file ? '' : 'opacity-0'}`}
          />
        ) : null}
      </span>
    </div>,
    document.body,
  );
}
