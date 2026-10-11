import type { Env } from '../env';
import { serviceUnavailable } from './errors';

/**
 * R2 is enabled separately on the Cloudflare account, so a fresh deployment may run without the
 * bucket binding. Handlers that store objects call this instead of touching env.FILES directly.
 * R2 需在 Cloudflare 账号中单独开通，新部署可能没有存储桶绑定。需要写对象的处理器统一经此取用。
 */
export function requireBucket(env: Env): R2Bucket {
  if (!env.FILES) throw serviceUnavailable('storage_unavailable', '文件存储尚未开通，请联系主席团');
  return env.FILES;
}
