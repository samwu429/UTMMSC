import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from '../crypto/encoding';

/**
 * A position in a list ordered by (created_at, id): the last row a page returned. Feeds, albums and notices
 * walk newest first; comments walk oldest first. Rows with the same timestamp are told apart by id.
 * 按 (created_at, id) 排序的列表中的位置，即上一页返回的最后一行。信息流、相册和消息从新到旧；评论从旧到新。
 * 时间相同的行按 id 区分。
 */
export interface MomentCursor {
  /** created_at of the row, an ISO instant. */
  /** 该行的 created_at，ISO 时间。 */
  at: string;
  id: string;
}

/** Every created_at is written by nowIso, so a cursor time is exactly that form. */
/** 所有 created_at 都由 nowIso 写入，因此游标中的时间必须正好是这种格式。 */
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Row ids are randomId values: a prefix, an underscore and base64url. */
/** 行 id 是 randomId 生成的值：前缀、下划线和 base64url。 */
const ID = /^[A-Za-z0-9_-]{1,100}$/;
const ENCODED = /^[A-Za-z0-9_-]{1,400}$/;

/** The opaque, url-safe string clients send back as ?cursor. */
/** 客户端以 ?cursor 回传的不透明、可放进网址的字符串。 */
export function encodeMomentCursor(cursor: MomentCursor): string {
  return bytesToBase64Url(utf8ToBytes(JSON.stringify([cursor.at, cursor.id])));
}

function isCursorTime(value: unknown): value is string {
  if (typeof value !== 'string' || !AT.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value;
}

/**
 * The cursor inside a ?cursor value, or null for a missing, malformed or tampered one. The route answers a
 * present but unreadable value with 400 invalid_cursor.
 * ?cursor 中的游标；缺失、格式错误或被篡改时返回 null。参数存在却无法读取时，接口返回 400 invalid_cursor。
 */
export function decodeMomentCursor(raw: string | null | undefined): MomentCursor | null {
  if (typeof raw !== 'string' || !ENCODED.test(raw)) return null;
  const bytes = base64UrlToBytes(raw);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(bytesToUtf8(bytes));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [at, id] = value as unknown[];
  if (!isCursorTime(at) || typeof id !== 'string' || !ID.test(id)) return null;
  return { at, id };
}

/**
 * Oldest first: negative when a comes before b, comparing created_at and then id. Newest-first lists use the
 * negation, the same order as ORDER BY created_at DESC, id DESC.
 * 从旧到新：a 在 b 之前时为负数，先比较 created_at，再比较 id。从新到旧的列表取相反数，与 ORDER BY created_at DESC, id DESC 一致。
 */
export function compareMomentCursors(a: MomentCursor, b: MomentCursor): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
