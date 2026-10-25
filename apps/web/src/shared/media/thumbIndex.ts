/**
 * Which thumbnail belongs to which chat image, learned from every message the room loads and from every upload this
 * device finishes. Image keys are random and never reused, so an entry never goes stale. The image row and the viewer
 * read it, so a row can show the 360px copy without every caller passing it along. Cleared on sign-out.
 * 哪张缩略图属于哪张聊天图片：从房间加载的每条消息以及本设备完成的每次上传中得知。图片键是随机的且不会重复使用，
 * 因此记录永远不会过时。图片消息行和查看器读取它，消息行无需每个调用方逐层传递就能显示 360px 的副本。退出登录时清空。
 */

const THUMB_INDEX_MAX = 2000;
const thumbs = new Map<string, string>();

export function rememberThumb(imageKey: string | null | undefined, thumbKey: string | null | undefined): void {
  if (!imageKey || !thumbKey || thumbs.get(imageKey) === thumbKey) return;
  thumbs.delete(imageKey);
  thumbs.set(imageKey, thumbKey);
  if (thumbs.size > THUMB_INDEX_MAX) {
    const oldest = thumbs.keys().next().value;
    if (oldest !== undefined) thumbs.delete(oldest);
  }
}

/** Remembers the thumbnails of a list of messages; rows without an image or a thumbnail are skipped. */
/** 记下一组消息的缩略图；没有图片或没有缩略图的消息会被跳过。 */
export function rememberThumbsOf(messages: readonly { imageKey: string | null; thumbKey?: string | null }[]): void {
  for (const message of messages) {
    if (message.imageKey && message.thumbKey) rememberThumb(message.imageKey, message.thumbKey);
  }
}

export function thumbKeyFor(imageKey: string | null | undefined): string | null {
  return imageKey ? (thumbs.get(imageKey) ?? null) : null;
}

export function forgetThumbs(): void {
  thumbs.clear();
}
