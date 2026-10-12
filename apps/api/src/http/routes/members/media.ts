import { readProfileMediaToken } from '../../../domain/profile/media-token';
import { mediaObjectResponse } from '../../../infrastructure/r2/objects';
import { requireBucket } from '../../bindings';
import type { AppEnv } from '../../context';
import { forbidden, notFound, unauthorized } from '../../errors';
import type { Context } from 'hono';

/** Image and video elements cannot send the session header, so they present a signed media token. */
/** 图片和视频元素无法附带会话头，因此使用签名过的媒体令牌。 */
export async function serveMemberMedia(c: Context<AppEnv>): Promise<Response> {
  const token = c.req.query('t') ?? '';
  if (!(await readProfileMediaToken(c.env.SESSION_SECRET, token))) throw unauthorized('媒体链接已过期');
  const key = decodeURIComponent(c.req.path.replace(/^\/members\/media\//, ''));
  if (key.includes('..') || (!key.startsWith('avatar/') && !key.startsWith('moments/'))) throw forbidden();
  const response = await mediaObjectResponse(requireBucket(c.env), key, c.req.raw);
  if (!response) throw notFound('文件不存在');
  return response;
}
