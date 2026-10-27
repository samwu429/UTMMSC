import type {
  ApiError,
  StickerAddBody,
  StickerAddResponse,
  StickerBlockResponse,
  StickerFrontResponse,
  StickerIdsBody,
  StickerListResponse,
  StickerRemoveResponse,
} from '@utmmsc/shared';
import { api } from '../../../shared/api/client';
import { API_BASE_URL } from '../../../shared/api/config';
import { ApiClientError } from '../../../shared/api/errors';
import { useSessionStore } from '../../../shared/session/store';

/**
 * The /stickers routes of the API: the member's collection (我的表情) and the system administrator's block. Uploads
 * go through upload.ts, which reports progress.
 * 接口的 /stickers 路由：成员的表情列表（我的表情）以及系统管理员的封禁。上传走 upload.ts，以便报告进度。
 */

/**
 * POST /stickers/remove with fetch's keepalive, so a removal committed while the page goes away still reaches the
 * server. api() cannot set keepalive, so the bearer token and the error envelope are handled here the same way.
 * 用 fetch 的 keepalive 发送 POST /stickers/remove，页面离开时提交的删除仍能到达服务端。api() 无法设置 keepalive，
 * 所以这里以同样的方式附加 Bearer 令牌并解析错误结构。
 */
async function removeKeepalive(body: StickerIdsBody): Promise<StickerRemoveResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = useSessionStore.getState().token;
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE_URL}/stickers/remove`, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true });
  const json = (response.headers.get('content-type') ?? '').includes('application/json');
  if (!response.ok) {
    let code = 'http_error';
    let message = `请求失败（${response.status}）`;
    if (json) {
      const data = (await response.json().catch(() => ({}))) as Partial<ApiError>;
      code = data.error?.code ?? code;
      message = data.error?.message ?? message;
    }
    if (response.status === 401) useSessionStore.getState().clear();
    throw new ApiClientError(response.status, code, message);
  }
  return (await response.json()) as StickerRemoveResponse;
}

export const stickerApi = {
  /** The collection, or `unchanged` when `version` is the one the server holds. */
  /** 表情列表；`version` 与服务端一致时返回 `unchanged`。 */
  list: (version?: number) => api<StickerListResponse>(version === undefined ? '/stickers' : `/stickers?v=${encodeURIComponent(String(version))}`),
  /**
   * Adds a stored sticker, with the still of the message it comes from. A missing still is left out of the body
   * rather than sent as null, so the route never has to read null as "present".
   * 添加一个已存储的表情，附带来源消息的静态图。没有静态图时不放进请求体，而不是发送 null，接口因此不必把 null 当作「已提供」。
   */
  add: (id: string, thumb: string | null) => {
    const body: StickerAddBody = thumb ? { id, thumb } : { id };
    return api<StickerAddResponse>('/stickers/add', { method: 'POST', body });
  },
  front: (ids: readonly string[]) => {
    const body: StickerIdsBody = { ids: [...ids] };
    return api<StickerFrontResponse>('/stickers/front', { method: 'POST', body });
  },
  remove: (ids: readonly string[], options: { keepalive?: boolean } = {}) => {
    const body: StickerIdsBody = { ids: [...ids] };
    if (options.keepalive) return removeKeepalive(body);
    return api<StickerRemoveResponse>('/stickers/remove', { method: 'POST', body });
  },
  block: (id: string) => api<StickerBlockResponse>('/stickers/block', { method: 'POST', body: { id } }),
};

export type StickerApi = typeof stickerApi;
