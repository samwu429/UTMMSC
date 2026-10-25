import type { ChannelIconPresetId, ChannelIconResponse, SetChannelIconPresetBody } from '@utmmsc/shared';
import { api } from '../../../shared/api/client';
import type { SquareIconFiles } from '../../../shared/media/encodeSquareIcon';
import { useSessionStore } from '../../../shared/session/store';
import { useOverviewStore } from '../state/overviewStore';

/**
 * The channel icon routes (admin-design.md 2.3), which need channels.manage, and what every surface does after a
 * change. Used by chat info and the admin channel settings alike, so it imports nothing from admin.
 * 频道图标接口（admin-design.md 2.3，需要 channels.manage），以及每次修改之后各处要做的事。聊天信息和管理后台的频道设置共用，因此不从
 * 管理后台导入任何内容。
 */

const enc = encodeURIComponent;

export const channelIconApi = {
  /** multipart: `icon` (256 px) and `thumb` (96 px) of one type. The answer carries a media token for the new image. */
  /** multipart：同一类型的 `icon`（256px）和 `thumb`（96px）。返回的结果带有新图片所用的媒体令牌。 */
  upload(channelId: string, files: SquareIconFiles): Promise<ChannelIconResponse> {
    const form = new FormData();
    form.append('icon', files.icon, files.icon.name);
    form.append('thumb', files.thumb, files.thumb.name);
    return api<ChannelIconResponse>(`/channels/${enc(channelId)}/icon`, { method: 'POST', rawBody: form });
  },
  preset(channelId: string, id: ChannelIconPresetId): Promise<ChannelIconResponse> {
    const body: SetChannelIconPresetBody = { id };
    return api<ChannelIconResponse>(`/channels/${enc(channelId)}/icon/preset`, { method: 'POST', body });
  },
  /** Back to the text tile; an uploaded image is deleted on the server. */
  /** 恢复为文字头像；服务器会删除上传的图片。 */
  clear(channelId: string): Promise<ChannelIconResponse> {
    return api<ChannelIconResponse>(`/channels/${enc(channelId)}/icon`, { method: 'DELETE' });
  },
};

/**
 * After the server saved an icon: the new image's media token goes to the session, so it loads at once, and the
 * chat list fetches again, so the row shows the new icon without waiting for its 30 s poll.
 * 服务器保存图标之后：新图片的媒体令牌写入会话，图片因此立即加载；聊天列表重新获取，不必等 30 秒一次的轮询就显示新图标。
 */
export function applyIconResponse(response: ChannelIconResponse): void {
  if (response.mediaToken) useSessionStore.getState().setMediaToken(response.mediaToken);
  void useOverviewStore.getState().refresh({ force: true });
}
