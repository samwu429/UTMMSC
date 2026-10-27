import { MENTIONS_MAX, STICKER_TEXT, type LastMessagePreview, type SystemEvent, type SystemMemberRef } from '@utmmsc/shared';

const PREVIEW_MAX = 80;

function capped(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text;
}

/** Single-line excerpt for conversation lists. Image-only messages and stickers get a fixed label. */
/** 会话列表使用的单行摘要。仅图片的消息和表情使用固定文案。 */
export function previewOf(text: string, hasImage: boolean, hasSticker = false): string {
  if (hasSticker) return STICKER_TEXT;
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return hasImage ? '[图片]' : '';
  return capped(hasImage ? `[图片] ${collapsed}` : collapsed);
}

/** Conversation-list line. A withdrawn message never contributes its original text. */
/** 会话列表上的一行。已撤回的消息不会带上原文。 */
export function conversationPreview(input: { text: string; hasImage: boolean; hasSticker?: boolean; deleted: boolean; recalled: boolean }): string {
  if (input.recalled) return '撤回了一条消息';
  if (input.deleted) return '';
  return previewOf(input.text, input.hasImage, input.hasSticker === true);
}

function memberRef(value: unknown): SystemMemberRef | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string') return null;
  return { id: record.id, displayName: typeof record.displayName === 'string' ? record.displayName : '' };
}

/** Reads a stored system event. Anything malformed reads as null rather than failing the page. */
/** 读取已存的系统事件。格式不对时返回 null，而不是让整页失败。 */
export function parseSystemEvent(json: string | null): SystemEvent | null {
  if (!json) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'join') return null;
  const members = Array.isArray(record.members)
    ? record.members.map(memberRef).filter((m): m is SystemMemberRef => m !== null).slice(0, MENTIONS_MAX)
    : [];
  const more = typeof record.more === 'number' && Number.isInteger(record.more) && record.more > 0 ? record.more : 0;
  return { type: 'join', actor: memberRef(record.actor), members, more };
}

/** The stored row fields that decide a list preview. */
/** 决定列表预览的已存行字段。 */
export interface PreviewRow {
  id: number;
  kind: string;
  author_id: string;
  author_name: string;
  text: string;
  image_key: string | null;
  created_at: string;
  deleted: number;
  recalled: number;
  deleted_by: string | null;
  system_json: string | null;
  /** Room schema 8: set on a sticker message. */
  /** 房间结构版本 8：表情消息时有值。 */
  sticker_json?: string | null;
}

/**
 * Structured preview of the newest visible row. Recalled and deleted rows carry their kind only,
 * never their original text, and clients render the wording in the viewer's language. A sticker carries
 * '[表情]' as its text, which builds that predate the kind show as is.
 * 最新可见一行的结构化预览。撤回和删除的行只带类型，不带原文，由客户端按观看者的语言生成文案。
 * 表情的文字为 '[表情]'，早于这个类型的版本会直接显示它。
 */
export function lastMessagePreview(row: PreviewRow): LastMessagePreview {
  const base = { id: row.id, authorId: row.author_id, authorName: row.author_name, at: row.created_at, text: '', system: null };
  if (row.kind === 'system') return { ...base, kind: 'system', system: parseSystemEvent(row.system_json) };
  if (row.recalled === 1) return { ...base, kind: 'recalled' };
  if (row.deleted === 1) return { ...base, kind: row.deleted_by === 'moderator' ? 'moderator_deleted' : 'deleted' };
  if (row.sticker_json) return { ...base, kind: 'sticker', text: STICKER_TEXT };
  const collapsed = row.text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return { ...base, kind: row.image_key ? 'image' : 'text' };
  return { ...base, kind: 'text', text: capped(collapsed) };
}
