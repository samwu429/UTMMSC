/**
 * English for the sticker routes' messages (/stickers and the room's sticker refusals): STICKER_MESSAGES of
 * packages/shared/src/chat/stickers.ts, keyed by their Chinese text. The numbers come from the same limits as the
 * Chinese, so a changed limit changes both.
 * Owner: stickers. shared/api/errors.ts merges this file and is otherwise frozen.
 * 表情接口（/stickers 以及房间对表情的拒绝）提示的英文：即 packages/shared/src/chat/stickers.ts 中的 STICKER_MESSAGES，以其中文为键。
 * 其中的数字与中文取自同样的上限，修改上限时两者一同改变。
 * 维护者：表情功能。shared/api/errors.ts 合并本文件，此外不再改动。
 */
import {
  STICKER_ANIMATED_FRAMES_MAX,
  STICKER_ANIMATED_PIXELS_MAX,
  STICKER_DIMENSION_MAX,
  STICKER_MAX_BYTES,
  STICKER_MESSAGES,
  STICKERS_PER_MEMBER_MAX,
  type StickerMessageKey,
} from '@utmmsc/shared';
import type { EnglishPattern } from '../errors';

const MIB = 1024 * 1024;

const BY_KEY: Readonly<Record<StickerMessageKey, string>> = {
  tooLarge: `Stickers must be ${STICKER_MAX_BYTES / MIB} MB or smaller.`,
  dimensions: `The image is too large. Each side can be at most ${STICKER_DIMENSION_MAX} pixels.`,
  animatedSize: `Animated stickers can be at most ${Math.sqrt(STICKER_ANIMATED_PIXELS_MAX)} pixels on each side.`,
  frames: `Animated stickers can have at most ${STICKER_ANIMATED_FRAMES_MAX} frames.`,
  unreadable: "That image couldn't be read.",
  thumb: "Couldn't add it. Try again.",
  checksum: 'The upload was incomplete. Try again.',
  ids: "That didn't work. Try again.",
  notFound: 'This sticker is no longer available.',
  blocked: 'This sticker has been disabled.',
  full: `You can have up to ${STICKERS_PER_MEMBER_MAX} stickers. Delete some first.`,
  daily: "You've uploaded a lot of stickers today. Try again tomorrow.",
  edits: "You've changed your stickers a lot today. Try again tomorrow.",
  clubLimit: "Stickers have reached today's limit. Try again tomorrow.",
  memberStorage: "You've uploaded too many stickers to upload more for now.",
  clubStorage: 'Sticker storage is full. Contact the committee.',
  pending: "Stickers aren't available yet.",
  unavailable: "Stickers aren't available right now. Try again later.",
  blockForbidden: 'Only the system administrator can block stickers.',
};

/** Exact server text to its English. */
/** 服务端原文到英文的对照。 */
export const ENGLISH: Readonly<Record<string, string>> = Object.fromEntries(
  (Object.keys(BY_KEY) as StickerMessageKey[]).map((key) => [STICKER_MESSAGES[key], BY_KEY[key]]),
);

/** The sticker messages embed no varying number or name, so there is no pattern. */
/** 表情提示中不含可变的数字或名称，因此没有模式。 */
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = [];
