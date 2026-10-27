import type { ChatMessage, QuotePreview, QuoteState } from './protocol';

/** How long the author may withdraw a message. The server clock is the authority. */
/** 作者可以撤回消息的时长。以服务器时钟为准。 */
export const RECALL_WINDOW_MS = 3 * 60 * 1000;

export type RecallDecision = 'ok' | 'not_author' | 'expired' | 'unavailable';

export function decideRecall(input: {
  authorId: string;
  actorId: string;
  createdAtMs: number;
  nowMs: number;
  deleted: boolean;
  recalled: boolean;
}): RecallDecision {
  if (input.deleted || input.recalled) return 'unavailable';
  if (input.authorId !== input.actorId) return 'not_author';
  if (!Number.isFinite(input.createdAtMs) || !Number.isFinite(input.nowMs)) return 'expired';
  if (input.nowMs - input.createdAtMs > RECALL_WINDOW_MS) return 'expired';
  return 'ok';
}

export function withinRecallWindow(createdAtIso: string, nowMs: number): boolean {
  const createdAtMs = Date.parse(createdAtIso);
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - createdAtMs <= RECALL_WINDOW_MS;
}

/** Drops body fields once a message is withdrawn or removed. */
/** 消息被撤回或删除后去掉正文。 */
export function redactChatBody<T extends { text: string; imageKey: string | null; deleted: boolean; recalled: boolean }>(message: T): T {
  if (!message.deleted && !message.recalled) return message;
  if (message.text === '' && message.imageKey === null) return message;
  return { ...message, text: '', imageKey: null };
}

/**
 * Full redaction for a withdrawn or removed message: body, image, image size, thumbnail, sticker and quote all go.
 * Returns the same object when there is nothing left to remove, so repeated calls are free.
 * 撤回或删除后的完整清理：正文、图片、图片尺寸、缩略图、表情和引用全部去掉。已无可清理内容时返回原对象，重复调用没有开销。
 */
export function redactChatMessage<T extends ChatMessage>(message: T): T {
  if (!message.deleted && !message.recalled) return message;
  const clean =
    message.text === '' &&
    message.imageKey === null &&
    (message.imageWidth ?? null) === null &&
    (message.imageHeight ?? null) === null &&
    (message.thumbKey ?? null) === null &&
    (message.sticker ?? null) === null &&
    (message.replyTo ?? null) === null;
  if (clean) return message;
  return { ...message, text: '', imageKey: null, imageWidth: null, imageHeight: null, thumbKey: null, sticker: null, replyTo: null };
}

/** Sets a quote's state and keeps its excerpt, image flag and sticker flag only while the target is live. */
/** 设置引用状态；只有被引用消息仍有效时才保留摘录、图片标记和表情标记。 */
export function redactQuotePreview(quote: QuotePreview, state: QuoteState): QuotePreview {
  if (state === 'ok') return quote.state === 'ok' ? quote : { ...quote, state };
  if (quote.state === state && quote.excerpt === '' && !quote.hasImage && !quote.hasSticker) return quote;
  return { ...quote, state, excerpt: '', hasImage: false, hasSticker: false };
}
