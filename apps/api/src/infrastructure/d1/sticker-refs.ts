import { isStickerId, type StickerRef, type StickerType } from '@utmmsc/shared';

/**
 * How a chat room reads a sticker it is asked to send (sticker_objects, migration 0019). The room stores what this
 * returns, never what the client claims, and adds only the sender's still.
 * 聊天房间如何读取被要求发送的表情（sticker_objects，迁移 0019）。房间保存的是这里返回的描述，而不是客户端声称的内容，只另外加上发送者的静态图。
 */

interface StickerObjectRow {
  id: string;
  type: StickerType;
  width: number;
  height: number;
  bytes: number;
  animated: number;
}

/**
 * The description of a ready, unblocked sticker file, or null when the id is unknown, still uploading, being swept or
 * blocked. One batch: the first send also sets sent_at, which keeps the file out of the sweep for good, and the read
 * after it sees the same state. D1 errors (a missing table included) are thrown for the caller to report.
 * 已就绪且未被封禁的表情文件的描述；id 不存在、仍在上传、正被清理或已被封禁时为 null。一个批次完成：第一次发送时同时写入 sent_at，
 * 使文件从此不会被清理任务删除，随后的读取看到的是同一状态。D1 出错（包括表不存在）时抛出，由调用方处理。
 */
export async function findStickerRef(db: D1Database, id: string, nowIso: string): Promise<Omit<StickerRef, 'thumb'> | null> {
  if (!isStickerId(id)) return null;
  const [, found] = await db.batch<StickerObjectRow>([
    // Mark the first send, which keeps the file out of the sweep for good.
    // 记下第一次发送，文件从此不会被清理任务删除。
    db
      .prepare("UPDATE sticker_objects SET sent_at = ?2 WHERE id = ?1 AND sent_at IS NULL AND state = 'ready' AND blocked_at IS NULL")
      .bind(id, nowIso),
    // The description a message stores.
    // 消息中保存的描述。
    db.prepare("SELECT id, type, width, height, bytes, animated FROM sticker_objects WHERE id = ?1 AND state = 'ready' AND blocked_at IS NULL").bind(id),
  ]);
  const row = found?.results[0];
  if (!row) return null;
  return { id: row.id, type: row.type, width: row.width, height: row.height, animated: row.animated === 1, bytes: row.bytes };
}
