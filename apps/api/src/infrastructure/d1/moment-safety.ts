import {
  canModerateMoment,
  MOMENT_NOTICE_PAGE,
  type MomentBlocksResponse,
  type MomentMedia,
  type MomentRelation,
  type MomentReport,
  type MomentReportReason,
  type MomentReportStatus,
  type Role,
  type UpdateMomentRelationBody,
} from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import type { MomentCursor } from '../../domain/moments/cursor';
import { latestCommentNoticeRecipients } from './moment-notices';
import { momentMediaStatement, toMomentMedia, toMomentPerson, type MomentMediaRow, type MomentReader } from './moments';
import { nowIso } from './time';

interface BlockRow {
  kind: 'hide_from' | 'mute';
  id: string;
  display_name: string;
  avatar_key: string | null;
}

/**
 * 动态设置: the members the reader hides their updates from, and the members they muted, newest setting first.
 * Only active members are listed, since the route can change settings for active members only.
 * 动态设置：读者不让其看自己动态的成员，以及读者设置了不看的成员，最近设置的在前。只列出在用成员，因为接口只能修改对在用成员的设置。
 */
export async function listMomentBlocks(db: D1Database, memberId: string): Promise<MomentBlocksResponse> {
  const result = await db
    .prepare(
      `SELECT b.kind, m.id, m.display_name, m.avatar_key FROM moment_blocks b
       JOIN members m ON m.id = b.target_id AND m.status = 'active'
       WHERE b.member_id = ?
       ORDER BY b.created_at DESC, m.id`,
    )
    .bind(memberId)
    .all<BlockRow>();
  const blocks: MomentBlocksResponse = { hideFrom: [], muted: [] };
  for (const row of result.results) {
    (row.kind === 'hide_from' ? blocks.hideFrom : blocks.muted).push(toMomentPerson(row.id, row.display_name, row.avatar_key));
  }
  return blocks;
}

function relationStatement(db: D1Database, memberId: string, targetId: string): D1PreparedStatement {
  return db.prepare('SELECT kind FROM moment_blocks WHERE member_id = ? AND target_id = ?').bind(memberId, targetId);
}

function toRelation(rows: readonly { kind: string }[]): MomentRelation {
  return { hideFrom: rows.some((row) => row.kind === 'hide_from'), mute: rows.some((row) => row.kind === 'mute') };
}

/** The reader's 不让TA看 and 不看TA settings for one member. */
/** 读者对某位成员的「不让TA看」和「不看TA」设置。 */
export async function findMomentRelation(db: D1Database, memberId: string, targetId: string): Promise<MomentRelation> {
  const result = await relationStatement(db, memberId, targetId).all<{ kind: string }>();
  return toRelation(result.results);
}

/**
 * Applies the fields present in the patch and returns the result. The route checks the target first. Turning
 * 不让TA看 on also deletes the target's notices on the member's posts, so a hidden post leaves 消息, the unread
 * count and the badge as a deleted one does; no new ones arrive while the hide lasts. Uses posts_member and
 * moment_notices_post.
 * 只修改补丁中出现的字段并返回结果。接口事先核对对方。开启「不让TA看」时，同时删除对方收到的、关于该成员动态的消息，
 * 被隐藏的动态因此像已删除的动态一样从「消息」、未读数和角标中消失；隐藏期间也不会再收到新的消息。使用 posts_member 和 moment_notices_post 索引。
 */
export async function updateMomentRelation(db: D1Database, memberId: string, targetId: string, patch: UpdateMomentRelationBody): Promise<MomentRelation> {
  const ts = nowIso();
  const writes: D1PreparedStatement[] = [];
  const fields: [keyof MomentRelation, 'hide_from' | 'mute'][] = [
    ['hideFrom', 'hide_from'],
    ['mute', 'mute'],
  ];
  for (const [field, kind] of fields) {
    const value = patch[field];
    if (value === undefined) continue;
    writes.push(
      value
        ? db.prepare('INSERT OR IGNORE INTO moment_blocks (member_id, target_id, kind, created_at) VALUES (?, ?, ?, ?)').bind(memberId, targetId, kind, ts)
        : db.prepare('DELETE FROM moment_blocks WHERE member_id = ? AND target_id = ? AND kind = ?').bind(memberId, targetId, kind),
    );
  }
  if (patch.hideFrom === true) {
    writes.push(db.prepare('DELETE FROM moment_notices WHERE recipient_id = ?1 AND post_id IN (SELECT id FROM posts WHERE member_id = ?2)').bind(targetId, memberId));
  }
  const results = await db.batch([...writes, relationStatement(db, memberId, targetId)]);
  return toRelation((results[results.length - 1]?.results ?? []) as { kind: string }[]);
}

export interface NewMomentReport {
  reporterId: string;
  postId: string;
  commentId: string | null;
  targetMemberId: string;
  reason: MomentReportReason;
  note: string | null;
}

interface Snapshot {
  body: string;
  media: MomentMedia[];
}

/** The reported content as it is now: a comment's text, or a post's text and media. Null when it is gone. */
/** 被投诉内容当前的样子：评论的文字，或动态的文字和媒体。内容已不存在时为 null。 */
async function snapshotOf(db: D1Database, postId: string, commentId: string | null): Promise<Snapshot | null> {
  if (commentId) {
    const comment = await db.prepare('SELECT body FROM post_comments WHERE id = ? AND post_id = ?').bind(commentId, postId).first<{ body: string }>();
    return comment ? { body: comment.body, media: [] } : null;
  }
  const [post, media] = await db.batch([db.prepare('SELECT body FROM posts WHERE id = ?').bind(postId), momentMediaStatement(db, [postId])]);
  const row = (post?.results ?? [])[0] as { body: string } | undefined;
  if (!row) return null;
  return { body: row.body, media: ((media?.results ?? []) as MomentMediaRow[]).map(toMomentMedia) };
}

/**
 * Stores a report with a snapshot of the content as it is now. A second report by the same member on the
 * same item changes nothing and still succeeds, and so does a report on content deleted meanwhile.
 * 保存一条投诉，并附上内容当前的快照。同一成员对同一内容的再次投诉不做改动，仍然成功；对期间已被删除的内容的投诉也一样。
 */
export async function insertMomentReport(db: D1Database, report: NewMomentReport): Promise<void> {
  const snapshot = await snapshotOf(db, report.postId, report.commentId);
  if (!snapshot) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO moment_reports (id, reporter_id, post_id, comment_id, target_member_id, reason, note, snapshot_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .bind(randomId('mrp'), report.reporterId, report.postId, report.commentId, report.targetMemberId, report.reason, report.note, JSON.stringify(snapshot), nowIso())
    .run();
}

/** Reports the member filed at or after `since`, for the daily cap. Uses moment_reports_reporter. */
/** 成员在 `since` 及之后提交的投诉数，用于每日上限。使用 moment_reports_reporter 索引。 */
export async function countReportsSince(db: D1Database, memberId: string, since: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM moment_reports WHERE reporter_id = ? AND created_at >= ?').bind(memberId, since).first<{ n: number }>();
  return row?.n ?? 0;
}

interface ReportRow {
  id: string;
  reason: MomentReportReason;
  note: string | null;
  created_at: string;
  status: MomentReportStatus;
  post_id: string;
  comment_id: string | null;
  snapshot_json: string;
  reporter_id: string;
  reporter_name: string;
  reporter_avatar: string | null;
  target_id: string;
  target_name: string;
  target_avatar: string | null;
  target_role: Role;
  open_count: number;
  current: 'live' | 'removed' | null;
}

function readSnapshot(raw: string): Snapshot {
  try {
    const value = JSON.parse(raw) as Partial<Snapshot> | null;
    return { body: typeof value?.body === 'string' ? value.body : '', media: Array.isArray(value?.media) ? value.media : [] };
  } catch {
    return { body: '', media: [] };
  }
}

/**
 * The queue for one status, newest first after `cursor`, at most `limit` (MOMENT_NOTICE_PAGE by default).
 * canResolve says whether the moderator outranks the target. Reports about the moderator's own content are
 * left out, so the person reported never sees who reported them or what they wrote; the system admin still
 * lists the president's. Walks moment_reports_queue.
 * 某一状态的投诉队列，从 `cursor` 之后按从新到旧排列，最多 `limit` 条（默认 MOMENT_NOTICE_PAGE）。canResolve 表示管理员职位是否高于被投诉人。
 * 不列出针对管理员本人内容的投诉，被投诉人因此永远看不到是谁投诉了自己、写了什么；主席的投诉仍会列给系统管理员。
 * 按 moment_reports_queue 索引遍历。
 */
export async function listMomentReports(
  db: D1Database,
  moderator: MomentReader,
  options: { status: MomentReportStatus; cursor: MomentCursor | null; limit?: number },
): Promise<{ reports: MomentReport[]; nextCursor: MomentCursor | null }> {
  const limit = options.limit ?? MOMENT_NOTICE_PAGE;
  const values: unknown[] = [options.status, moderator.id];
  let after = '';
  if (options.cursor) {
    after = 'AND (r.created_at, r.id) < (?3, ?4)';
    values.push(options.cursor.at, options.cursor.id);
  }
  values.push(limit + 1);
  const result = await db
    .prepare(
      `SELECT r.id, r.reason, r.note, r.created_at, r.status, r.post_id, r.comment_id, r.snapshot_json,
              rm.id AS reporter_id, rm.display_name AS reporter_name, rm.avatar_key AS reporter_avatar,
              tm.id AS target_id, tm.display_name AS target_name, tm.avatar_key AS target_avatar, tm.role AS target_role,
              (SELECT COUNT(*) FROM moment_reports o WHERE o.status = 'open' AND o.post_id = r.post_id AND o.comment_id IS r.comment_id) AS open_count,
              CASE WHEN r.comment_id IS NULL
                THEN (SELECT CASE WHEN p.removed_at IS NULL THEN 'live' ELSE 'removed' END FROM posts p WHERE p.id = r.post_id)
                ELSE (SELECT CASE WHEN c.removed_at IS NULL THEN 'live' ELSE 'removed' END FROM post_comments c WHERE c.id = r.comment_id)
              END AS current
       FROM moment_reports r
       JOIN members rm ON rm.id = r.reporter_id
       JOIN members tm ON tm.id = r.target_member_id
       WHERE r.status = ?1 AND r.target_member_id <> ?2 ${after}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<ReportRow>();
  const rows = result.results.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    reports: rows.map((row) => ({
      id: row.id,
      reason: row.reason,
      note: row.note,
      createdAt: row.created_at,
      status: row.status,
      reporter: toMomentPerson(row.reporter_id, row.reporter_name, row.reporter_avatar),
      target: toMomentPerson(row.target_id, row.target_name, row.target_avatar),
      reportCount: row.open_count,
      postId: row.post_id,
      commentId: row.comment_id,
      snapshot: readSnapshot(row.snapshot_json),
      current: row.current ?? 'deleted',
      canResolve: canModerateMoment(moderator, { id: row.target_id, role: row.target_role }),
    })),
    nextCursor: result.results.length > limit && last ? { at: last.created_at, id: last.id } : null,
  };
}

/** A report with what resolving it needs. targetRole is null when the account no longer exists. */
/** 一条投诉及处理它所需的信息。账号已不存在时 targetRole 为 null。 */
export interface MomentReportRecord {
  id: string;
  postId: string;
  commentId: string | null;
  targetMemberId: string;
  targetRole: Role | null;
  status: MomentReportStatus;
}

export async function findMomentReport(db: D1Database, reportId: string): Promise<MomentReportRecord | null> {
  const row = await db
    .prepare(
      `SELECT r.id, r.post_id, r.comment_id, r.target_member_id, m.role AS target_role, r.status
       FROM moment_reports r LEFT JOIN members m ON m.id = r.target_member_id
       WHERE r.id = ?`,
    )
    .bind(reportId)
    .first<{ id: string; post_id: string; comment_id: string | null; target_member_id: string; target_role: Role | null; status: MomentReportStatus }>();
  if (!row) return null;
  return {
    id: row.id,
    postId: row.post_id,
    commentId: row.comment_id,
    targetMemberId: row.target_member_id,
    targetRole: row.target_role ?? null,
    status: row.status,
  };
}

/** Marks the open reports on one post (comment null) or one comment as resolved by the moderator. */
/** 把针对某条动态（comment 为 null）或某条评论的未处理投诉标为已由该管理员处理。 */
function resolveReportsStatement(db: D1Database, status: 'removed' | 'dismissed', moderatorId: string, ts: string, postId: string, commentId: string | null): D1PreparedStatement {
  return db
    .prepare("UPDATE moment_reports SET status = ?1, resolved_by = ?2, resolved_at = ?3 WHERE status = 'open' AND post_id = ?4 AND comment_id IS ?5")
    .bind(status, moderatorId, ts, postId, commentId);
}

/** Dismisses every open report on the post or comment and logs dismiss_report, once, when there was one. */
/** 驳回针对该动态或评论的全部未处理投诉，并在确有投诉时记录一次 dismiss_report。 */
export async function dismissMomentReports(db: D1Database, moderatorId: string, target: { postId: string; commentId: string | null }): Promise<void> {
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO moment_actions (id, actor_id, action, post_id, comment_id, target_member_id, reason, created_at)
         SELECT ?1, ?2, 'dismiss_report', post_id, comment_id, target_member_id, NULL, ?3
         FROM moment_reports WHERE status = 'open' AND post_id = ?4 AND comment_id IS ?5
         ORDER BY created_at
         LIMIT 1`,
      )
      .bind(randomId('mac'), moderatorId, ts, target.postId, target.commentId),
    resolveReportsStatement(db, 'dismissed', moderatorId, ts, target.postId, target.commentId),
  ]);
}

/**
 * Soft-removes a post: sets removed_*, resolves its open reports as removed, logs remove_post, and inserts a
 * removed notice (no actor) for the author. Returns the author, or null when the post does not exist. A post
 * already removed keeps its first removal: nothing more is written or logged.
 * 软移除一条动态：填写 removed_*，把针对它的未处理投诉标为已移除，记录 remove_post，并为作者写入一条没有操作者的 removed 消息。
 * 返回作者；动态不存在时返回 null。已被移除的动态保留第一次移除的记录，不会再写入或记录任何内容。
 */
export async function removeMomentPost(db: D1Database, moderatorId: string, postId: string, reason: string): Promise<{ authorId: string } | null> {
  const post = await db.prepare('SELECT member_id FROM posts WHERE id = ?').bind(postId).first<{ member_id: string }>();
  if (!post) return null;
  const ts = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO moment_actions (id, actor_id, action, post_id, comment_id, target_member_id, reason, created_at)
         SELECT ?1, ?2, 'remove_post', id, NULL, member_id, ?3, ?4 FROM posts WHERE id = ?5 AND removed_at IS NULL`,
      )
      .bind(randomId('mac'), moderatorId, reason, ts, postId),
    db
      .prepare(
        `INSERT INTO moment_notices (id, recipient_id, actor_id, post_id, comment_id, kind, created_at)
         SELECT ?1, member_id, NULL, id, NULL, 'removed', ?2 FROM posts WHERE id = ?3 AND removed_at IS NULL`,
      )
      .bind(randomId('mnt'), ts, postId),
    db.prepare('UPDATE posts SET removed_at = ?1, removed_by = ?2, removed_reason = ?3 WHERE id = ?4 AND removed_at IS NULL').bind(ts, moderatorId, reason, postId),
    resolveReportsStatement(db, 'removed', moderatorId, ts, postId, null),
  ]);
  return { authorId: post.member_id };
}

/**
 * Clears removed_* and logs restore_post. The author's removed notice for the post goes too, so 消息 no longer
 * says it is removed. False when the post does not exist or was not removed.
 * 清除 removed_* 并记录 restore_post。作者收到的这条动态的 removed 消息也一并删除，「消息」里不再显示它已被移除。
 * 动态不存在或未被移除时返回 false。
 */
export async function restoreMomentPost(db: D1Database, moderatorId: string, postId: string): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO moment_actions (id, actor_id, action, post_id, comment_id, target_member_id, reason, created_at)
         SELECT ?1, ?2, 'restore_post', id, NULL, member_id, NULL, ?3 FROM posts WHERE id = ?4 AND removed_at IS NOT NULL`,
      )
      .bind(randomId('mac'), moderatorId, nowIso(), postId),
    db.prepare("DELETE FROM moment_notices WHERE post_id = ? AND comment_id IS NULL AND kind = 'removed'").bind(postId),
    db.prepare('UPDATE posts SET removed_at = NULL, removed_by = NULL, removed_reason = NULL WHERE id = ? AND removed_at IS NOT NULL').bind(postId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}

/**
 * Soft-removes a comment like removeMomentPost does a post, and deletes the comment's own notices. Returns the
 * comment's post and author, and recallIds: the members whose newest notice on the post was this comment,
 * read before its notices were deleted, so their push can be replaced. A comment already removed keeps its
 * first removal, as a post does, and its recallIds is empty, since its notices went with that removal.
 * 像 removeMomentPost 处理动态那样软移除一条评论，并删除这条评论自己的消息。返回评论所在的动态和作者，以及 recallIds：
 * 在删除消息之前读取的、在这条动态上最新一条消息正是这条评论的成员，以便替换他们收到的推送。
 * 与动态一样，已被移除的评论保留第一次移除的记录；其消息已随那次移除删除，因此 recallIds 为空。
 */
export async function removeMomentComment(
  db: D1Database,
  moderatorId: string,
  commentId: string,
  reason: string,
): Promise<{ postId: string; authorId: string; recallIds: string[] } | null> {
  const comment = await db.prepare('SELECT post_id, author_id FROM post_comments WHERE id = ?').bind(commentId).first<{ post_id: string; author_id: string }>();
  if (!comment) return null;
  const recallIds = await latestCommentNoticeRecipients(db, comment.post_id, commentId);
  const ts = nowIso();
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO moment_actions (id, actor_id, action, post_id, comment_id, target_member_id, reason, created_at)
         SELECT ?1, ?2, 'remove_comment', post_id, id, author_id, ?3, ?4 FROM post_comments WHERE id = ?5 AND removed_at IS NULL`,
      )
      .bind(randomId('mac'), moderatorId, reason, ts, commentId),
    db
      .prepare(
        `INSERT INTO moment_notices (id, recipient_id, actor_id, post_id, comment_id, kind, created_at)
         SELECT ?1, author_id, NULL, post_id, id, 'removed', ?2 FROM post_comments WHERE id = ?3 AND removed_at IS NULL`,
      )
      .bind(randomId('mnt'), ts, commentId),
    db.prepare('UPDATE post_comments SET removed_at = ?1, removed_by = ?2, removed_reason = ?3 WHERE id = ?4 AND removed_at IS NULL').bind(ts, moderatorId, reason, commentId),
    db.prepare("DELETE FROM moment_notices WHERE comment_id = ? AND kind <> 'removed'").bind(commentId),
    resolveReportsStatement(db, 'removed', moderatorId, ts, comment.post_id, commentId),
  ]);
  const changed = (results[2]?.meta.changes ?? 0) > 0;
  return { postId: comment.post_id, authorId: comment.author_id, recallIds: changed ? recallIds : [] };
}

/** Clears removed_* on a comment, deletes its removed notice and logs restore_comment. False when it does not exist or was not removed. */
/** 清除评论的 removed_*，删除其 removed 消息，并记录 restore_comment。评论不存在或未被移除时返回 false。 */
export async function restoreMomentComment(db: D1Database, moderatorId: string, commentId: string): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO moment_actions (id, actor_id, action, post_id, comment_id, target_member_id, reason, created_at)
         SELECT ?1, ?2, 'restore_comment', post_id, id, author_id, NULL, ?3 FROM post_comments WHERE id = ?4 AND removed_at IS NOT NULL`,
      )
      .bind(randomId('mac'), moderatorId, nowIso(), commentId),
    db.prepare("DELETE FROM moment_notices WHERE comment_id = ? AND kind = 'removed'").bind(commentId),
    db.prepare('UPDATE post_comments SET removed_at = NULL, removed_by = NULL, removed_reason = NULL WHERE id = ? AND removed_at IS NOT NULL').bind(commentId),
  ]);
  return (results[2]?.meta.changes ?? 0) > 0;
}
