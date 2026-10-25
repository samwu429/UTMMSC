import { channelIconPresetId, isChannelIconKey, isChannelIconUploadKey } from '@utmmsc/shared';

/**
 * The icon key stored on a channel row: an upload under channel-icon/ or preset:<id>. Null when the channel has
 * none, when the row predates migration 0018 (the column is then missing), and for any value the app could not
 * show, so a bad row falls back to the text tile instead of a broken image.
 * 频道记录中保存的图标键：channel-icon/ 下的上传图标或 preset:<id>。频道没有图标、记录早于迁移 0018（此时没有这一列），
 * 或者值无法显示时为 null，异常数据因此退回文字头像，而不是显示一张坏图。
 */
export function channelIconKeyOf(row: { icon_key?: unknown }): string | null {
  const value = row.icon_key;
  return typeof value === 'string' && isChannelIconKey(value) ? value : null;
}

/** Whether building the push URL for this key needs a media token: only uploads do; presets are static files. */
/** 为此键生成推送地址时是否需要媒体令牌：只有上传的图标需要；预设图标是静态文件。 */
export function channelIconNeedsToken(iconKey: string | null | undefined): boolean {
  return typeof iconKey === 'string' && isChannelIconUploadKey(iconKey);
}

export interface ChannelIconPushInput {
  iconKey: string | null | undefined;
  /** API_PUBLIC_URL, such as https://utmmsc.com/api. */
  /** API_PUBLIC_URL，例如 https://utmmsc.com/api。 */
  apiBase: string | null | undefined;
  /** APP_BASE_URL, such as https://utmmsc.com/UTMMSC/, where the preset files are published. */
  /** APP_BASE_URL，例如 https://utmmsc.com/UTMMSC/，预设图标文件发布在这里。 */
  appBase: string;
  /** A profile media token, which /members/media/* accepts. Needed for uploads only. */
  /** /members/media/* 接受的个人资料媒体令牌。只有上传的图标需要。 */
  token: string | null | undefined;
}

function withSlash(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}

/** The service worker shows only https icons, so anything else is left out rather than sent for nothing. */
/** Service Worker 只显示 https 图标，其他地址不会发出，免得白白占用推送内容。 */
function httpsOnly(url: string): string | undefined {
  return url.startsWith('https://') ? url : undefined;
}

/**
 * The absolute icon URL for a channel push. An upload is served by the API at /members/media/<key>, in the same
 * form the app builds, so a device that already shows the icon in its chat list can reuse the file; a preset is
 * the 192 px PNG published with the app. Undefined when there is no icon, when an upload has no API address or
 * token to go with it, or when the address is not https; the device then shows the app icon.
 * 频道推送使用的图标绝对地址。上传的图标由接口在 /members/media/<键> 提供，形式与 App 拼出的地址一致，已在聊天列表里显示过该图标的设备可以复用文件；
 * 预设图标是随 App 发布的 192px PNG。没有图标、上传的图标缺少接口地址或令牌、或地址不是 https 时为 undefined，设备随后显示 App 图标。
 */
export function channelIconPushUrl(input: ChannelIconPushInput): string | undefined {
  const key = input.iconKey;
  if (!key) return undefined;
  const preset = channelIconPresetId(key);
  if (preset) return httpsOnly(`${withSlash(input.appBase)}channel-icons/${preset}-192.png`);
  if (!isChannelIconUploadKey(key) || !input.apiBase || !input.token) return undefined;
  const api = input.apiBase.replace(/\/+$/, '');
  return httpsOnly(`${api}/members/media/${encodeURIComponent(key)}?t=${encodeURIComponent(input.token)}`);
}
