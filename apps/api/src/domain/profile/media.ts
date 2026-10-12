import {
  MOMENT_IMAGE_LIMIT,
  MOMENT_IMAGE_TYPES,
  MOMENT_VIDEO_TYPES,
  type PostMedia,
} from '@utmmsc/shared';
import { randomId } from '../crypto/encoding';
import { FieldError } from './fields';

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export function describeContentType(contentType: string): { ext: string; kind: PostMedia['kind'] } | null {
  if ((MOMENT_IMAGE_TYPES as readonly string[]).includes(contentType) && IMAGE_EXT[contentType]) {
    return { ext: IMAGE_EXT[contentType], kind: 'image' };
  }
  if ((MOMENT_VIDEO_TYPES as readonly string[]).includes(contentType) && VIDEO_EXT[contentType]) {
    return { ext: VIDEO_EXT[contentType], kind: 'video' };
  }
  return null;
}

export function avatarObjectKey(memberId: string, contentType: string): string {
  const described = describeContentType(contentType);
  if (!described || described.kind !== 'image') {
    throw new FieldError('头像只支持 JPEG、PNG、WebP、GIF');
  }
  return `avatar/${memberId}/${randomId('ava')}.${described.ext}`;
}

export function coverObjectKey(memberId: string, contentType: string): string {
  const described = describeContentType(contentType);
  if (!described || described.kind !== 'image') {
    throw new FieldError('封面只支持 JPEG、PNG、WebP、GIF');
  }
  return `cover/${memberId}/${randomId('cov')}.${described.ext}`;
}

export function momentObjectKey(memberId: string, contentType: string): string {
  const described = describeContentType(contentType);
  if (!described) throw new FieldError('只支持 JPEG、PNG、WebP、GIF 照片，或 MP4、MOV、WebM 视频');
  return `moments/${memberId}/${randomId('med')}.${described.ext}`;
}

function ownsPrefixedKey(prefix: string, key: string, ext: string): boolean {
  if (!key.startsWith(prefix) || key.includes('..')) return false;
  const rest = key.slice(prefix.length);
  return rest.length > ext.length + 1 && !rest.includes('/') && rest.endsWith(`.${ext}`);
}

export function ownsMomentKey(memberId: string, key: string, contentType: string): boolean {
  const described = describeContentType(contentType);
  if (!described) return false;
  return ownsPrefixedKey(`moments/${memberId}/`, key, described.ext);
}

/** Photos and a video cannot share one post. A post can hold nine photos or one video. */
/** 照片和视频不能出现在同一条动态里。一条动态最多九张照片，或一个视频。 */
export function normalizePostMedia(memberId: string, value: unknown): PostMedia[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new FieldError('照片或视频的格式不对');
  const items: PostMedia[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new FieldError('照片或视频的格式不对');
    const key = (item as { key?: unknown }).key;
    const contentType = (item as { contentType?: unknown }).contentType;
    if (typeof key !== 'string' || typeof contentType !== 'string') throw new FieldError('照片或视频的格式不对');
    const described = describeContentType(contentType);
    if (!described || !ownsMomentKey(memberId, key, contentType)) throw new FieldError('有照片或视频无法使用，请重新选择');
    items.push({ key, contentType, kind: described.kind });
  }
  const videos = items.filter((item) => item.kind === 'video');
  const images = items.filter((item) => item.kind === 'image');
  if (videos.length > 1) throw new FieldError('一条动态只能有一个视频');
  if (videos.length === 1 && images.length > 0) throw new FieldError('照片和视频不能发在同一条里');
  if (images.length > MOMENT_IMAGE_LIMIT) throw new FieldError(`最多 ${MOMENT_IMAGE_LIMIT} 张照片`);
  return items;
}
