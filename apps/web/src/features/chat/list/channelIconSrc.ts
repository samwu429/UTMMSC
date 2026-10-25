import { CHANNEL_ICON_SIZE, CHANNEL_ICON_THUMB_SIZE, channelIconPresetId, channelIconThumbKey, isChannelIconUploadKey, type ChannelIconPresetId } from '@utmmsc/shared';
import { mediaUrl } from '../../profile/media';

/**
 * Where a channel icon's image comes from, as pure functions so the chat list, chat info and admin share one rule.
 * 频道图标的图片地址，用纯函数实现，聊天列表、聊天信息和管理后台共用同一规则。
 */

export interface ChannelIconImage {
  src: string;
  /**
   * Uploads only: the 96 px thumbnail and the 256 px image, so a 2x screen loads the thumbnail and a 3x screen
   * the full image. A preset is an SVG, which is sharp at every size.
   * 仅上传的图标：96px 缩略图和 256px 图片，2 倍屏加载缩略图，3 倍屏加载完整图片。预设是 SVG，任何尺寸都清晰。
   */
  srcSet: string | null;
}

/** public/channel-icons/<id>.svg, bundled with the app and precached. */
/** public/channel-icons/<id>.svg，随应用发布并预缓存。 */
export function presetChannelIconUrl(id: ChannelIconPresetId, base: string = import.meta.env.BASE_URL): string {
  return `${base}channel-icons/${id}.svg`;
}

/**
 * The image for a stored icon key, or null to keep the text tile: no icon, an unknown preset, a key that is not a
 * valid upload, or an upload before the session has a media token.
 * 已存图标键对应的图片；以下情况返回 null，继续显示文字头像：没有图标、未知预设、不是合法上传键，或会话还没有媒体令牌时的上传图标。
 */
export function channelIconSrc(iconKey: string | null | undefined, token: string | null | undefined, base: string = import.meta.env.BASE_URL): ChannelIconImage | null {
  if (!iconKey) return null;
  const preset = channelIconPresetId(iconKey);
  if (preset) return { src: presetChannelIconUrl(preset, base), srcSet: null };
  if (!isChannelIconUploadKey(iconKey) || !token) return null;
  const full = mediaUrl(iconKey, token);
  const thumb = mediaUrl(channelIconThumbKey(iconKey), token);
  return { src: full, srcSet: `${thumb} ${CHANNEL_ICON_THUMB_SIZE}w, ${full} ${CHANNEL_ICON_SIZE}w` };
}
