import { MOMENT_COMMENT_PAGE, type MomentComment, type MomentCommentFacts, type MomentLikeResponse, type Role } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import type { MomentCursor } from '../../domain/moments/cursor';
import type { PlannedNotice } from '../../domain/moments/notices';
import {
  groupMomentLikes,
  isForeignKeyError,
  MOMENT_COMMENT_COLUMNS,
  MOMENT_COMMENT_JOINS,
  MOMENT_COMMENT_VISIBLE,
  MOMENT_FRIEND_CTE,
  MomentSqlParams,
  momentLikesOf,
  momentLikesStatement,
  toMomentComment,
  type MomentAccess,
  type MomentCommentRow,
  type MomentLikeRow,
  type MomentReader,
} from './moments';
import { nowIso } from './time';

/**
 * A stored comment with what the routes check: facts for canReplyToMomentComment (replyToId is the member
 * answered while still active), the author's role for the moderation tier, and the post's author.
 * 已保存的评论及接口需要核对的信息：供 canReplyToMomentComment 使用的 facts（replyToId 为仍在用的被回复成员）、
 * 用于管理档位判断的作者身份，以及动态作者。
 */
export interface MomentCommentRecord {
  id: string;
  facts: MomentCommentFacts;
  authorRole: Role;
  postAuthorId: string;
  /** Stored even when the member answered is no longer active. */
  /** 即使被回复的成员已停用也会保存。 */
  replyToMemberId: string | null;
  body: string;
  clientId: string;
  createdAt: string;
}

export interface NewMomentComment {
  clientId: string;
  /** Normalized by readMomentComment. */
  /** 已由 readMomentComment 规范化。 */
  body: string;
  /** The comment answered and its author, taken from the stored row; null for a plain comment. */
  /** 被回复的评论及其作者，取自已保存的记录；普通评论为 null。 */
  replyTo: { commentId: string; memberId: string } | null;
  /** From planCommentNotices, inserted in the same batch with INSERT OR IGNORE. */
  /** 来自 planCommentNotices，在同一批次中以 INSERT OR IGNORE 写入。 */
  notices: readonly PlannedNotice[];
}

/**
 * created: stored now (201). existing: the same clientId already stored this comment on this post (200).
 * conflict: the clientId was used for a different post or text (409 client_id_conflict). post_gone: the post
 * was deleted between the check and the insert (404 moment_unavailable).
 * created：本次保存（201）。existing：同一 clientId 已在这条动态上保存过这条评论（200）。
 * conflict：该 clientId 用于另一条动态或另一段文字（409 client_id_conflict）。post_gone：核对与写入之间动态被删除（404 moment_unavailable）。
 */
export type InsertMomentCommentResult =
  | { status: 'created' | 'existing'; comment: MomentComment; commentCount: number }
  | { status: 'conflict' }
  | { status: 'post_gone' };

function likeListStatements(db: D1Database, reader: MomentReader, postId: string): D1PreparedStatement[] {
  return [momentLikesStatement(db, reader.id, [postId]), db.prepare('SELECT id FROM posts WHERE id = ?').bind(postId)];
}

/**
 * Sets the reader's like to `liked`, idempotently. Adding a row also inserts `notice` with INSERT OR IGNORE;
 * removing one deletes the like notice. Returns the like list the reader may see afterwards, or null when the
 * post was deleted in between. The notice is written only when this call added the like (RETURNING says so),
 * and only while the like still stands, so repeating liked: true after the author cleared their notices does
 * not bring it back, and an unlike in between leaves no notice behind.
 * 把读者的赞设为 `liked`，可重复调用。新增一行时同时以 INSERT OR IGNORE 写入 `notice`；取消时删除对应的点赞消息。
 * 返回之后读者能看到的点赞列表；期间动态被删除时返回 null。只有本次调用新增了赞（由 RETURNING 得知）且赞仍然存在时才写入消息，
 * 因此作者清空消息之后再次发送 liked: true 不会让它重新出现，期间取消赞也不会留下消息。
 */
export async function setMomentLike(
  db: D1Database,
  reader: MomentReader,
  access: MomentAccess,
  liked: boolean,
  notice: { recipientId: string; kind: 'like' } | null,
): Promise<MomentLikeResponse | null> {
  const ts = nowIso();
  const writes: D1PreparedStatement[] = [];
  if (liked) {
    let added: boolean;
    try {
      const inserted = await db
        .prepare('INSERT OR IGNORE INTO post_likes (post_id, member_id, created_at) VALUES (?1, ?2, ?3) RETURNING member_id')
        .bind(access.postId, reader.id, ts)
        .all<{ member_id: string }>();
      added = inserted.results.length > 0;
    } catch (err) {
      if (isForeignKeyError(err)) return null;
      throw err;
    }
    if (added && notice) {
      writes.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO moment_notices (id, recipient_id, actor_id, post_id, comment_id, kind, created_at)
             SELECT ?1, ?2, ?3, ?4, NULL, 'like', ?5
             WHERE EXISTS (SELECT 1 FROM post_likes WHERE post_id = ?4 AND member_id = ?3)`,
          )
          .bind(randomId('mnt'), notice.recipientId, reader.id, access.postId, ts),
      );
    }
  } else {
    writes.push(
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND member_id = ?').bind(access.postId, reader.id),
      db.prepare("DELETE FROM moment_notices WHERE post_id = ? AND actor_id = ? AND kind = 'like'").bind(access.postId, reader.id),
    );
  }
  let results: D1Result[];
  try {
    results = await db.batch([...writes, ...likeListStatements(db, reader, access.postId)]);
  } catch (err) {
    if (isForeignKeyError(err)) return null;
    throw err;
  }
  const exists = results[results.length - 1]?.results ?? [];
  if (exists.length === 0) return null;
  const list = momentLikesOf(groupMomentLikes((results[results.length - 2]?.results ?? []) as MomentLikeRow[]), access.postId);
  return { likedByMe: list.likedByMe, likes: list.likes, likeCount: list.likeCount };
}

/**
 * The comments the reader may see on a post they may see, oldest first after `cursor`, at most `limit`
 * (MOMENT_COMMENT_PAGE by default). Removed comments appear only to their own author. Walks post_comments_post.
 * 读者在可见动态上能看到的评论，从 `cursor` 之后按从旧到新排列，最多 `limit` 条（默认 MOMENT_COMMENT_PAGE）。
 * 被移除的评论只对其作者显示。按 post_comments_post 索引遍历。
 */
export async function listMomentComments(
  db: D1Database,
  reader: MomentReader,
  access: MomentAccess,
  cursor: MomentCursor | null,
  limit: number = MOMENT_COMMENT_PAGE,
): Promise<{ comments: MomentComment[]; nextCursor: MomentCursor | null }> {
  const params = new MomentSqlParams(reader.id);
  const postId = params.add(access.postId);
  const after = cursor ? `(c.created_at, c.id) > (${params.add(cursor.at)}, ${params.add(cursor.id)})` : '1 = 1';
  const result = await db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       SELECT ${MOMENT_COMMENT_COLUMNS}
       FROM post_comments c
       ${MOMENT_COMMENT_JOINS}
       WHERE c.post_id = ${postId} AND ${after} AND ${MOMENT_COMMENT_VISIBLE}
       ORDER BY c.created_at, c.id
       LIMIT ${params.add(limit + 1)}`,
    )
    .bind(...params.values)
    .all<MomentCommentRow>();
  const rows = result.results.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    comments: rows.map((row) => toMomentComment(row, reader)),
    nextCursor: result.results.length > limit && last ? { at: last.created_at, id: last.id } : null,
  };
}

interface CommentRecordRow {
  id: string;
  post_id: string;
  post_author_id: string;
  author_id: string;
  author_status: string;
  author_role: Role;
  reply_to_member_id: string | null;
  reply_active: string | null;
  body: string;
  client_id: string;
  created_at: string;
  removed_at: string | null;
}

/** A stored comment, removed or not, or null when it does not exist. */
/** 已保存的评论（不论是否被移除）；不存在时为 null。 */
export async function findMomentComment(db: D1Database, commentId: string): Promise<MomentCommentRecord | null> {
  const row = await db
    .prepare(
      `SELECT c.id, c.post_id, p.member_id AS post_author_id, c.author_id, ca.status AS author_status, ca.role AS author_role,
              c.reply_to_member_id, mr.id AS reply_active, c.body, c.client_id, c.created_at, c.removed_at
       FROM post_comments c
       JOIN posts p ON p.id = c.post_id
       JOIN members ca ON ca.id = c.author_id
       LEFT JOIN members mr ON mr.id = c.reply_to_member_id AND mr.status = 'active'
       WHERE c.id = ?`,
    )
    .bind(commentId)
    .first<CommentRecordRow>();
  if (!row) return null;
  return {
    id: row.id,
    facts: {
      postId: row.post_id,
      authorId: row.author_id,
      authorActive: row.author_status === 'active',
      replyToId: row.reply_active,
      removed: row.removed_at !== null,
    },
    authorRole: row.author_role,
    postAuthorId: row.post_author_id,
    replyToMemberId: row.reply_to_member_id,
    body: row.body,
    clientId: row.client_id,
    createdAt: row.created_at,
  };
}

function commentWrites(db: D1Database, reader: MomentReader, access: MomentAccess, input: NewMomentComment, id: string, ts: string, replyToCommentId: string | null): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO post_comments (id, post_id, author_id, reply_to_comment_id, reply_to_member_id, body, client_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (author_id, client_id) DO NOTHING`,
      )
      .bind(id, access.postId, reader.id, replyToCommentId, input.replyTo?.memberId ?? null, input.body, input.clientId, ts),
    ...input.notices.map((notice) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO moment_notices (id, recipient_id, actor_id, post_id, comment_id, kind, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE EXISTS (SELECT 1 FROM post_comments WHERE id = ?5)`,
        )
        .bind(randomId('mnt'), notice.recipientId, reader.id, access.postId, id, notice.kind, ts),
    ),
  ];
}

/**
 * Inserts with ON CONFLICT (author_id, client_id) DO NOTHING, then reads the row back by (author_id, client_id).
 * commentCount is what the reader may see afterwards. Notices are written only for a comment stored by this
 * call. When the comment answered is deleted between the check and the insert, the comment is stored as if it
 * had come first: reply_to_comment_id empty and the member answered kept, as ON DELETE SET NULL leaves it.
 * 以 ON CONFLICT (author_id, client_id) DO NOTHING 写入，再按 (author_id, client_id) 读回。commentCount 为之后读者能看到的评论数。
 * 只有本次调用保存的评论才会写入消息。若被回复的评论在核对与写入之间被删除，则按评论在先的情形保存：
 * reply_to_comment_id 为空、保留被回复的成员，与 ON DELETE SET NULL 的结果一致。
 */
export async function insertMomentComment(db: D1Database, reader: MomentReader, access: MomentAccess, input: NewMomentComment): Promise<InsertMomentCommentResult> {
  const id = randomId('pcm');
  const ts = nowIso();
  try {
    await db.batch(commentWrites(db, reader, access, input, id, ts, input.replyTo?.commentId ?? null));
  } catch (err) {
    if (!isForeignKeyError(err)) throw err;
    const post = await db.prepare('SELECT id FROM posts WHERE id = ?').bind(access.postId).first<{ id: string }>();
    if (!post || !input.replyTo) return { status: 'post_gone' };
    try {
      await db.batch(commentWrites(db, reader, access, input, id, ts, null));
    } catch (retryErr) {
      if (isForeignKeyError(retryErr)) return { status: 'post_gone' };
      throw retryErr;
    }
  }
  const params = new MomentSqlParams(reader.id);
  const postId = params.add(access.postId);
  const [stored, count] = await db.batch([
    db
      .prepare(
        `SELECT ${MOMENT_COMMENT_COLUMNS}
         FROM post_comments c
         JOIN posts p ON p.id = c.post_id
         JOIN members ca ON ca.id = c.author_id
         LEFT JOIN members mr ON mr.id = c.reply_to_member_id AND mr.status = 'active'
         WHERE c.author_id = ?1 AND c.client_id = ?2`,
      )
      .bind(reader.id, input.clientId),
    db
      .prepare(
        `WITH ${MOMENT_FRIEND_CTE}
         SELECT COUNT(*) AS n FROM post_comments c
         ${MOMENT_COMMENT_JOINS}
         WHERE c.post_id = ${postId} AND ${MOMENT_COMMENT_VISIBLE}`,
      )
      .bind(...params.values),
  ]);
  const row = (stored?.results ?? [])[0] as MomentCommentRow | undefined;
  if (!row) return { status: 'post_gone' };
  if (row.post_id !== access.postId || row.body !== input.body) return { status: 'conflict' };
  const commentCount = ((count?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
  return { status: row.id === id ? 'created' : 'existing', comment: toMomentComment(row, reader), commentCount };
}

/** Hard-deletes a comment; its notices cascade. True when a row was deleted. */
/** 彻底删除一条评论，其消息级联删除。删除了记录时返回 true。 */
export async function deleteMomentComment(db: D1Database, commentId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM post_comments WHERE id = ?').bind(commentId).run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * Comments the member wrote at or after `since`, for the daily cap. Uses post_comments_author. The comment being
 * sent (`exceptClientId`) is left out, so a retry of one already stored is not refused by its own count.
 * 成员在 `since` 及之后写的评论数，用于每日上限。使用 post_comments_author 索引。正在发送的评论（`exceptClientId`）不计入，
 * 因此重试一条已保存的评论时不会被它自己计入的数量拒绝。
 */
export async function countCommentsSince(db: D1Database, memberId: string, since: string, exceptClientId: string | null = null): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM post_comments WHERE author_id = ?1 AND created_at >= ?2 AND (?3 IS NULL OR client_id <> ?3)')
    .bind(memberId, since, exceptClientId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
