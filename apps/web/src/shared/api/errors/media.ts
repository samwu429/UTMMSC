/**
 * English for media messages: uploads and serving, such as chat thumbnails and resized avatars.
 * Owner: P-images, images, avatars and room runtime. shared/api/errors.ts merges this file and is otherwise frozen.
 * 媒体相关提示的英文：上传与读取，例如聊天缩略图和缩小后的头像。
 * 维护者：P-images，图片、头像与聊天室运行时。shared/api/errors.ts 合并本文件，此外不再改动。
 */
import type { EnglishPattern } from '../errors';

/** Exact server text to its English. */
/** 服务端原文到英文的对照。 */
export const ENGLISH: Readonly<Record<string, string>> = {
  '头像只支持 JPEG、PNG、WebP、GIF': 'Profile photos must be JPEG, PNG, WebP, or GIF.',
  '封面只支持 JPEG、PNG、WebP、GIF': 'Covers must be JPEG, PNG, WebP, or GIF.',
  '没有这个头像': 'That built-in profile photo does not exist.',
  '文件存储尚未开通，请联系主席团': 'File storage is not set up yet. Contact the presidium.',
  '缺少文件名': 'The file needs a name.',
};

/** Server text that embeds a number or a name. */
/** 含数字或名称的服务端提示。 */
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = [
  // The avatar limit is meant to drop from 8MB once every build resizes before upload, so the number is read.
  // 所有版本都在上传前缩小之后，头像上限会从 8MB 降低，因此读取其中的数字。
  [/^头像不能超过 (\d+)MB$/, (m) => `Profile photos must be ${m[1]}MB or smaller.`],
  [/^封面不能超过 (\d+)MB$/, (m) => `Covers must be ${m[1]}MB or smaller.`],
];
