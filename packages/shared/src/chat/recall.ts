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
