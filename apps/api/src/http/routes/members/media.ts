import { isChannelIconObjectKey } from '@utmmsc/shared';
import { readProfileMediaToken } from '../../../domain/profile/media-token';
import { IMMUTABLE_MEDIA_CACHE, mediaObjectResponse } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { forbidden, notFound, unauthorized } from '../../errors';
import type { Context } from 'hono';
import { decodeKeyPath } from '../../validation';

/** Prefixes of the member media this route serves, besides channel icons. */
/** 本接口提供的成员媒体前缀（频道图标另行判断）。 */
const MEMBER_MEDIA_PREFIXES = ['avatar/', 'cover/', 'moments/'] as const;

/**
 * Whether this route may serve the key: an avatar, cover or moment upload, or an uploaded channel icon or its
 * thumbnail (checked against the exact key shape, so nothing else under channel-icon/ is reachable).
 * 本接口能否提供该键：头像、封面或动态的上传文件，或者上传的频道图标及其缩略图（按确切的键格式检查，channel-icon/ 下的其他内容无法访问）。
 */
export function isServableMediaKey(key: string): boolean {
  if (key.includes('..')) return false;
  return MEMBER_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix)) || isChannelIconObjectKey(key);
}

/** Image and video elements cannot send the session header, so they present a signed media token. */
/** 图片和视频元素无法附带会话头，因此使用签名过的媒体令牌。 */
export async function serveMemberMedia(c: Context<AppEnv>): Promise<Response> {
  const token = c.req.query('t') ?? '';
  if (!(await readProfileMediaToken(c.env.SESSION_SECRET, token))) throw unauthorized('媒体链接已过期');
  const key = decodeKeyPath(c.req.path.replace(/^\/members\/media\//, ''));
  if (!isServableMediaKey(key)) throw forbidden();
  // A channel icon key is random and never written twice, so its file may be kept for a year whatever the default.
  // 频道图标的键是随机的且从不重复写入，因此无论默认值如何，其文件都可以缓存一年。
  const options = isChannelIconObjectKey(key) ? { cacheControl: IMMUTABLE_MEDIA_CACHE } : {};
  const response = await mediaObjectResponse(requireBucket(c.env), key, c.req.raw, options);
  if (!response) throw notFound('文件不存在');
  return response;
}
