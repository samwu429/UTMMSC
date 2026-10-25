import { AVATAR_MAX_BYTES } from '@utmmsc/shared';
import type { VariantOutput } from './canvas';
import type { VariantSpec } from './sizing';
import { renderVariants } from './variants';

/**
 * Uploaded profile photos are centre-cropped to a square JPEG before they leave the device. The largest place an
 * avatar is drawn is the 80px profile header, so 320px covers it at 3x and keeps a photo drawn in every chat row near
 * 25KB instead of the up to 8MB a camera file can be. A small GIF stays as it is, since a canvas would drop its
 * animation; a large one becomes a still JPEG.
 * 上传的头像在离开设备前先居中裁成正方形 JPEG。头像最大的显示位置是 80px 的资料页头部，320px 足以覆盖 3 倍屏，
 * 每个聊天行里显示的照片因此约 25KB，而不是相机文件可能达到的 8MB。小 GIF 保持原样，因为画布会丢掉动画；大 GIF 变成静态 JPEG。
 */

export const AVATAR_UPLOAD_PX = 320;
export const AVATAR_UPLOAD_QUALITY = 0.85;
/** GIFs up to this size are uploaded as they are and keep their animation. */
/** 不超过这个大小的 GIF 原样上传，保留动画。 */
export const AVATAR_GIF_KEEP_BYTES = 1024 * 1024;
export const AVATAR_PICK_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export type AvatarProblem = 'type' | 'size' | 'invalid';

export class AvatarPrepError extends Error {
  constructor(public readonly problem: AvatarProblem) {
    super(problem);
  }
}

export const AVATAR_VARIANT: VariantSpec = { longEdge: AVATAR_UPLOAD_PX, square: true, type: 'image/jpeg', quality: AVATAR_UPLOAD_QUALITY };

/** What happens to a picked file: refused, uploaded as it is, or re-encoded. */
/** 选中的文件如何处理：拒绝、原样上传，或重新编码。 */
export function planAvatarUpload(file: { type: string; size: number }): AvatarProblem | 'keep' | 'encode' {
  if (!(AVATAR_PICK_TYPES as readonly string[]).includes(file.type)) return 'type';
  if (file.size <= 0) return 'invalid';
  if (file.type === 'image/gif' && file.size <= AVATAR_GIF_KEEP_BYTES) return 'keep';
  return 'encode';
}

/** The file to upload as the profile photo. Rejects with AvatarPrepError. */
/** 作为头像上传的文件。失败时以 AvatarPrepError 拒绝。 */
export async function prepareAvatarUpload(file: File): Promise<File> {
  const plan = planAvatarUpload(file);
  if (plan === 'keep') return file;
  if (plan !== 'encode') throw new AvatarPrepError(plan);
  let output: VariantOutput;
  try {
    output = (await renderVariants(file, [AVATAR_VARIANT])).outputs[0] ?? null;
  } catch {
    // Neither the worker nor the main thread could decode it.
    // Worker 和主线程都无法解码。
    throw new AvatarPrepError('invalid');
  }
  if (output) return new File([output.blob], 'avatar.jpg', { type: 'image/jpeg' });
  // The canvas failed, but an original within the server's limit can still be uploaded as it is.
  // 画布处理失败，但未超过服务端上限的原图仍可原样上传。
  if (file.size <= AVATAR_MAX_BYTES) return file;
  throw new AvatarPrepError('size');
}

/** What to tell the member when prepareAvatarUpload refuses a file. */
/** prepareAvatarUpload 拒绝文件时给成员的提示。 */
export function avatarProblemText(error: unknown, tr: (zh: string, en: string) => string): string {
  const problem = error instanceof AvatarPrepError ? error.problem : 'invalid';
  if (problem === 'type') return tr('只支持 JPEG、PNG、WebP、GIF', 'Only JPEG, PNG, WebP, and GIF images are supported.');
  if (problem === 'size') {
    const mb = Math.round(AVATAR_MAX_BYTES / (1024 * 1024));
    return tr(`头像不能超过 ${mb}MB`, `Profile photos must be ${mb}MB or smaller.`);
  }
  return tr('图片无法读取，请换一张', 'Couldn’t read that image. Try another.');
}
