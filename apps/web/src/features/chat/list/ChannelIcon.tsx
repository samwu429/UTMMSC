import { useState } from 'react';
import { useSessionStore } from '../../../shared/session/store';
import { channelIconSrc } from './channelIconSrc';
import { conversationInitial } from './conversations';

/** Box and initial size per pixel size: chat info rows 32, search 40, the chat list 48, admin and pickers 64 and 72. */
/** 每种像素尺寸的方框与首字大小：聊天信息行 32，搜索 40，聊天列表 48，管理后台与选择器 64 和 72。 */
const TILE = {
  32: 'h-8 w-8 rounded-[4px] text-[14px]',
  40: 'h-10 w-10 rounded-[4px] text-[17px]',
  48: 'h-12 w-12 rounded-[4px] text-[20px]',
  64: 'h-16 w-16 rounded-[6px] text-[26px]',
  72: 'h-[72px] w-[72px] rounded-[6px] text-[30px]',
} as const;

export type ChannelIconSize = keyof typeof TILE;

/**
 * A channel's square icon. The text tile (brand colour and the first character of the name) is always drawn, and
 * the uploaded or preset image sits on top of it. While the image loads, or when it fails, the tile shows through,
 * so there is never a broken-image icon or a shift in layout.
 * 频道的方形图标。文字头像（品牌色底加名称首字）始终绘制，上传或预设的图片叠在其上。图片加载中或加载失败时露出文字头像，
 * 因此不会出现破图标，也不会改变布局。
 */
export function ChannelIcon({ name, iconKey, size = 48, className = '' }: { name: string; iconKey: string | null | undefined; size?: ChannelIconSize; className?: string }) {
  const token = useSessionStore((s) => s.mediaToken);
  const image = channelIconSrc(iconKey, token);
  // Keyed by address: a new icon or a new token tries again, the same failing address does not.
  // 按地址记录：换了图标或令牌会重新尝试，同一个失败的地址不再尝试。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = image !== null && image.src !== failedSrc;
  return (
    <div aria-hidden className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden bg-brand-700 font-medium text-white ${TILE[size]} ${className}`}>
      {conversationInitial(name)}
      {showImage ? (
        <img
          src={image.src}
          srcSet={image.srcSet ?? undefined}
          sizes={image.srcSet ? `${size}px` : undefined}
          width={size}
          height={size}
          alt=""
          draggable={false}
          decoding="async"
          loading="lazy"
          onError={() => setFailedSrc(image.src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </div>
  );
}
