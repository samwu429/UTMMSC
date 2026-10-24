import {
  canSeeMomentInteraction,
  canSeeMomentPost,
  MOMENT_NOTICE_PAGE,
  type MomentAudience,
  type MomentBadgeResponse,
  type MomentNotice,
  type MomentNoticeKind,
  type MomentPerson,
  type MomentPostFacts,
  type MomentViewer,
} from '@utmmsc/shared';
import type { MomentCursor } from '../../domain/moments/cursor';
import type { Participant } from '../../domain/moments/notices';
import { MOMENT_FRIEND_CTE, MOMENT_NOT_MUTED, MOMENT_POST_VISIBLE, MomentSqlParams, toMomentPerson, type MomentReader } from './moments';
import { nowIso } from './time';

export interface MomentNoticePage {
  notices: MomentNotice[];
  nextCursor: MomentCursor | null;
  /** Unread notices in the whole inbox, not only on this page. */
  /** 整个收件箱中的未读消息数，不只是本页。 */
  unread: number;
}

/** Code points of post text a notice row carries, enough for its three-line excerpt. */
/** 消息行附带的动态正文码点数，足够显示三行摘要。 */
const EXCERPT_MAX = 80;

/** Likers and commenters read for one new comment; planCommentNotices then keeps at most 50 of them. */
/** 为一条新评论读取的点赞者和评论者人数上限；之后 planCommentNotices 最多保留其中 50 人。 */
const PARTICIPANTS_MAX = 500;

/**
 * Notices from members who are no longer active drop out, as their likes and comments do. A removed notice
 * has no actor and always stays.
 * 已停用成员发出的消息不再显示，与其赞和评论一样。removed 消息没有操作者，始终保留。
 */
const ACTOR_ACTIVE = `(n.actor_id IS NULL OR EXISTS (SELECT 1 FROM members ma WHERE ma.id = n.actor_id AND ma.status = 'active'))`;

function unreadStatement(db: D1Database, memberId: string): D1PreparedStatement {
  return db.prepare(`SELECT COUNT(*) AS n FROM moment_notices n WHERE n.recipient_id = ?1 AND n.read_at IS NULL AND ${ACTOR_ACTIVE}`).bind(memberId);
}

function firstCount(result: D1Result | undefined): number {
  return ((result?.results ?? [])[0] as { n: number } | undefined)?.n ?? 0;
}

interface NoticeRow {
  id: string;
  kind: MomentNoticeKind;
  created_at: string;
  read_at: string | null;
  post_id: string;
  comment_id: string | null;
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  post_author_id: string;
  post_author_status: string;
  audience: MomentAudience;
  post_removed_at: string | null;
  post_body: string;
  hidden: number;
  author_friend: number | null;
  media_key: string | null;
  media_preview: string | null;
  media_kind: 'image' | 'video' | null;
  comment_row: string | null;
  comment_body: string | null;
  comment_removed_at: string | null;
  comment_author_id: string | null;
  comment_author_status: string | null;
  comment_author_friend: number | null;
  reply_id: string | null;
  reply_name: string | null;
  reply_avatar: string | null;
  reply_friend: number | null;
}

function excerpt(body: string): string {
  return Array.from(body.replace(/\s+/g, ' ').trim()).slice(0, EXCERPT_MAX).join('');
}

/**
 * One notice re-checked for the reader now. The friendships the shared rules ask about here are with the post
 * author, the comment author and the member answered, so the viewer carries just those.
 * 按读者当前的情况重新核对一条消息。这里共享规则只会问到与动态作者、评论作者和被回复者的好友关系，因此查看者只带这几项。
 */
function toNotice(row: NoticeRow, reader: MomentReader): MomentNotice {
  const friendIds = new Set<string>();
  if (row.author_friend === 1) friendIds.add(row.post_author_id);
  if (row.comment_author_friend === 1 && row.comment_author_id) friendIds.add(row.comment_author_id);
  if (row.reply_friend === 1 && row.reply_id) friendIds.add(row.reply_id);
  const viewer: MomentViewer = { id: reader.id, friendIds };
  const facts: MomentPostFacts = {
    authorId: row.post_author_id,
    authorActive: row.post_author_status === 'active',
    audience: row.audience,
    removed: row.post_removed_at !== null,
    hiddenFromViewer: row.hidden === 1,
  };
  const available = canSeeMomentPost(viewer, facts);
  const reply: MomentPerson | null = row.reply_id && row.reply_name !== null ? toMomentPerson(row.reply_id, row.reply_name, row.reply_avatar) : null;
  let comment: MomentNotice['comment'] = null;
  if (row.comment_id) {
    const readable =
      available &&
      row.comment_row !== null &&
      row.comment_removed_at === null &&
      row.comment_author_status === 'active' &&
      row.comment_author_id !== null &&
      canSeeMomentInteraction(viewer, facts, row.comment_author_id, row.reply_id);
    comment = { id: row.comment_id, body: readable ? row.comment_body : null, replyTo: available ? reply : null };
  }
  return {
    id: row.id,
    kind: row.kind,
    createdAt: row.created_at,
    read: row.read_at !== null,
    actor: row.actor_id && row.actor_name !== null ? toMomentPerson(row.actor_id, row.actor_name, row.actor_avatar) : null,
    post: {
      id: row.post_id,
      excerpt: available ? excerpt(row.post_body) : '',
      // Previews are images. A photo without one falls back to the photo itself; a video posted before 0016 has
      // no frame, so its key is null and the row shows a dark tile with the play glyph.
      // 预览图都是图片。没有预览图的照片退回使用照片本身；0016 之前发的视频没有首帧，因此 key 为 null，消息行显示带播放图标的深色方块。
      preview:
        available && row.media_key && row.media_kind
          ? { key: row.media_preview ?? (row.media_kind === 'image' ? row.media_key : null), kind: row.media_kind }
          : null,
      available,
      clubWide: available && row.audience === 'club',
    },
    comment,
  };
}

/**
 * The reader's notices, newest first after `cursor`, at most `limit` (MOMENT_NOTICE_PAGE by default), each
 * re-checked against current visibility: post.available is false when the post can no longer be seen, and
 * comment.body is null when the comment was deleted or removed. unreadOnly skips notices already read. Nothing
 * of a post the reader can no longer see is sent: its excerpt is empty and it has no preview.
 * 读者的消息，从 `cursor` 之后按从新到旧排列，最多 `limit` 条（默认 MOMENT_NOTICE_PAGE），每条都按当前的可见性重新核对：
 * 动态已无法查看时 post.available 为 false；评论已删除或被移除时 comment.body 为 null。unreadOnly 时跳过已读的消息。
 * 读者已无法查看的动态不会发出任何内容：摘要为空，也没有预览图。
 */
export async function listMomentNotices(
  db: D1Database,
  reader: MomentReader,
  options: { cursor: MomentCursor | null; unreadOnly: boolean; limit?: number },
): Promise<MomentNoticePage> {
  const limit = options.limit ?? MOMENT_NOTICE_PAGE;
  const params = new MomentSqlParams(reader.id);
  const after = options.cursor ? `AND (n.created_at, n.id) < (${params.add(options.cursor.at)}, ${params.add(options.cursor.id)})` : '';
  const unread = options.unreadOnly ? 'AND n.read_at IS NULL' : '';
  const [page, count] = await db.batch([
    db
      .prepare(
        `WITH ${MOMENT_FRIEND_CTE}
         SELECT n.id, n.kind, n.created_at, n.read_at, n.post_id, n.comment_id,
                n.actor_id, ma.display_name AS actor_name, ma.avatar_key AS actor_avatar,
                p.member_id AS post_author_id, pa.status AS post_author_status, p.audience, p.removed_at AS post_removed_at, p.body AS post_body,
                EXISTS (SELECT 1 FROM moment_blocks b WHERE b.member_id = p.member_id AND b.target_id = ?1 AND b.kind = 'hide_from') AS hidden,
                p.member_id IN (SELECT id FROM friend) AS author_friend,
                pm.object_key AS media_key, pm.preview_key AS media_preview, pm.kind AS media_kind,
                c.id AS comment_row, c.body AS comment_body, c.removed_at AS comment_removed_at,
                c.author_id AS comment_author_id, ca.status AS comment_author_status,
                c.author_id IN (SELECT id FROM friend) AS comment_author_friend,
                mr.id AS reply_id, mr.display_name AS reply_name, mr.avatar_key AS reply_avatar,
                mr.id IN (SELECT id FROM friend) AS reply_friend
         FROM moment_notices n
         JOIN posts p ON p.id = n.post_id
         JOIN members pa ON pa.id = p.member_id
         LEFT JOIN members ma ON ma.id = n.actor_id
         LEFT JOIN post_media pm ON pm.id = (SELECT id FROM post_media WHERE post_id = p.id ORDER BY sort_order LIMIT 1)
         LEFT JOIN post_comments c ON c.id = n.comment_id
         LEFT JOIN members ca ON ca.id = c.author_id
         LEFT JOIN members mr ON mr.id = c.reply_to_member_id AND mr.status = 'active'
         WHERE n.recipient_id = ?1 AND (n.actor_id IS NULL OR ma.status = 'active') ${unread} ${after}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT ${params.add(limit + 1)}`,
      )
      .bind(...params.values),
    unreadStatement(db, reader.id),
  ]);
  const rows = (page?.results ?? []) as NoticeRow[];
  const shown = rows.slice(0, limit);
  const last = shown[shown.length - 1];
  return {
    notices: shown.map((row) => toNotice(row, reader)),
    nextCursor: rows.length > limit && last ? { at: last.created_at, id: last.id } : null,
    unread: firstCount(count),
  };
}

/** Marks every notice created at or before `upTo` as read and returns how many stay unread. */
/** 把 `upTo` 及之前创建的消息全部标为已读，并返回仍未读的数量。 */
export async function markMomentNoticesRead(db: D1Database, memberId: string, upTo: string): Promise<number> {
  const [, count] = await db.batch([
    db.prepare('UPDATE moment_notices SET read_at = ?1 WHERE recipient_id = ?2 AND read_at IS NULL AND created_at <= ?3').bind(nowIso(), memberId, upTo),
    unreadStatement(db, memberId),
  ]);
  return firstCount(count);
}

/** 清空: deletes every notice of the member. */
/** 清空：删除成员的全部消息。 */
export async function clearMomentNotices(db: D1Database, memberId: string): Promise<void> {
  await db.prepare('DELETE FROM moment_notices WHERE recipient_id = ?').bind(memberId).run();
}

interface PersonRow {
  id: string;
  display_name: string;
  avatar_key: string | null;
}

/**
 * Unread notices with the latest actor, and home-feed posts by others newer than feed_seen_at with the latest
 * author. Without a moment_reads row there are no new posts until the first visit.
 * 未读消息数及最近的互动者，以及动态首页上晚于 feed_seen_at 的他人动态数及最近的作者。没有 moment_reads 记录时，首次打开前不算新动态。
 */
export async function readMomentBadge(db: D1Database, reader: MomentReader): Promise<MomentBadgeResponse> {
  const [count, actor, posts] = await db.batch([
    unreadStatement(db, reader.id),
    db
      .prepare(
        `SELECT ma.id, ma.display_name, ma.avatar_key FROM moment_notices n
         JOIN members ma ON ma.id = n.actor_id AND ma.status = 'active'
         WHERE n.recipient_id = ?1 AND n.read_at IS NULL
         -- The latest by insertion when two share a millisecond; ids are random.
         -- 两条消息时间相同时按插入顺序取最新的一条；id 是随机的。
         ORDER BY n.created_at DESC, n.rowid DESC
         LIMIT 1`,
      )
      .bind(reader.id),
    db
      .prepare(
        `WITH ${MOMENT_FRIEND_CTE}
         SELECT COUNT(*) OVER () AS n, m.id, m.display_name, m.avatar_key
         FROM posts p
         CROSS JOIN members m ON m.id = p.member_id AND m.status = 'active'
         WHERE p.created_at > (SELECT feed_seen_at FROM moment_reads WHERE member_id = ?1)
           AND p.member_id <> ?1 AND ${MOMENT_POST_VISIBLE} AND ${MOMENT_NOT_MUTED}
         -- The latest by insertion when two share a millisecond; ids are random.
         -- 两条动态时间相同时按插入顺序取最新的一条；id 是随机的。
         ORDER BY p.created_at DESC, p.rowid DESC
         LIMIT 1`,
      )
      .bind(reader.id),
  ]);
  const latestActor = (actor?.results ?? [])[0] as PersonRow | undefined;
  const newest = (posts?.results ?? [])[0] as (PersonRow & { n: number }) | undefined;
  return {
    unread: firstCount(count),
    latestActor: latestActor ? toMomentPerson(latestActor.id, latestActor.display_name, latestActor.avatar_key) : null,
    newPosts: newest?.n ?? 0,
    latestAuthor: newest ? toMomentPerson(newest.id, newest.display_name, newest.avatar_key) : null,
  };
}

/**
 * Stores the newest post time seen on the home feed, keeping the later of `upTo` and the stored time. A time
 * after now is stored as now, so a wrong clock cannot hide new posts in advance.
 * 保存在动态首页看到的最新动态时间，保留 `upTo` 与已存时间中较晚的一个。晚于当前的时间按当前时间保存，错误的时钟不会提前隐藏新动态。
 */
export async function markMomentFeedSeen(db: D1Database, memberId: string, upTo: string): Promise<void> {
  const now = nowIso();
  const seen = upTo > now ? now : upTo;
  await db
    .prepare(
      `INSERT INTO moment_reads (member_id, feed_seen_at, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (member_id) DO UPDATE SET feed_seen_at = MAX(feed_seen_at, excluded.feed_seen_at), updated_at = excluded.updated_at`,
    )
    .bind(memberId, seen, now)
    .run();
}

interface ParticipantRow {
  member_id: string;
  last_at: string;
  friend_of_actor: number;
  friend_of_reply_to: number;
  friend_of_author: number;
  hidden_from: number;
}

/** An accepted friend request in either direction between two member expressions. */
/** 两个成员表达式之间任一方向上已通过的好友申请。 */
function friendsSql(a: string, b: string): string {
  return `(EXISTS (SELECT 1 FROM friend_requests f WHERE f.from_id = ${a} AND f.to_id = ${b} AND f.status = 'accepted')
    OR EXISTS (SELECT 1 FROM friend_requests f WHERE f.from_id = ${b} AND f.to_id = ${a} AND f.status = 'accepted'))`;
}

/**
 * The facts planCommentNotices needs for a new comment: the member answered (when there is one) and the earlier
 * likers and commenters of the post, each with their friendships and whether the author hid the post from them.
 * Only active members count, the actor and the member answered are left out of participants, and removed
 * comments do not make their author a participant.
 * planCommentNotices 处理新评论所需的信息：被回复的成员（如有），以及这条动态此前的点赞者和评论者，
 * 每人附带好友关系，以及作者是否对其设置了「不让TA看」。只计在用成员；参与者中不含评论者本人和被回复者；被移除的评论不会让其作者成为参与者。
 */
export async function loadCommentNoticeFacts(
  db: D1Database,
  input: { postId: string; postAuthorId: string; actorId: string; replyToMemberId: string | null },
): Promise<{ replyTarget: Participant | null; participants: Participant[] }> {
  const result = await db
    .prepare(
      `SELECT pe.member_id, pe.last_at,
              ${friendsSql('pe.member_id', '?3')} AS friend_of_actor,
              (?4 IS NOT NULL AND ${friendsSql('pe.member_id', '?4')}) AS friend_of_reply_to,
              ${friendsSql('pe.member_id', '?2')} AS friend_of_author,
              EXISTS (SELECT 1 FROM moment_blocks b WHERE b.member_id = ?2 AND b.target_id = pe.member_id AND b.kind = 'hide_from') AS hidden_from
       FROM (
         SELECT member_id, MAX(at) AS last_at FROM (
           SELECT member_id, created_at AS at FROM post_likes WHERE post_id = ?1
           UNION ALL
           SELECT author_id, created_at FROM post_comments WHERE post_id = ?1 AND removed_at IS NULL
           UNION ALL
           SELECT ?4, '' WHERE ?4 IS NOT NULL
         )
         GROUP BY member_id
       ) pe
       JOIN members m ON m.id = pe.member_id AND m.status = 'active'
       WHERE pe.member_id <> ?3
       ORDER BY pe.member_id = ?4 DESC, pe.last_at DESC, pe.member_id
       LIMIT ?5`,
    )
    .bind(input.postId, input.postAuthorId, input.actorId, input.replyToMemberId, PARTICIPANTS_MAX)
    .all<ParticipantRow>();
  let replyTarget: Participant | null = null;
  const participants: Participant[] = [];
  for (const row of result.results) {
    const person: Participant = {
      memberId: row.member_id,
      lastAt: row.last_at,
      friendOfActor: row.friend_of_actor === 1,
      friendOfReplyTo: row.friend_of_reply_to === 1,
      friendOfAuthor: row.friend_of_author === 1,
      hiddenFrom: row.hidden_from === 1,
    };
    if (row.member_id === input.replyToMemberId) replyTarget = person;
    else participants.push(person);
  }
  return { replyTarget, participants };
}

/**
 * Recipients whose newest comment or reply notice on the post is this comment. Read before the comment is
 * deleted or removed, so the push that showed its text can be replaced. Uses moment_notices_post.
 * 在这条动态上最新一条 comment 或 reply 消息正是这条评论的收件人。在删除或移除评论之前读取，以便替换显示过其内容的推送。
 * 使用 moment_notices_post 索引。
 */
export async function latestCommentNoticeRecipients(db: D1Database, postId: string, commentId: string): Promise<string[]> {
  const result = await db
    .prepare(
      `SELECT n.recipient_id FROM moment_notices n
       WHERE n.post_id = ?1 AND n.comment_id = ?2 AND n.kind IN ('comment', 'reply')
         AND NOT EXISTS (
           SELECT 1 FROM moment_notices o
           WHERE o.post_id = ?1 AND o.recipient_id = n.recipient_id AND o.kind IN ('comment', 'reply')
             -- Ids are random, so two notices in the same millisecond are ordered by insertion (rowid) instead.
             -- id 是随机的，因此同一毫秒内的两条消息改按插入顺序（rowid）排序。
             AND (o.created_at, o.rowid) > (n.created_at, n.rowid)
         )
       ORDER BY n.recipient_id`,
    )
    .bind(postId, commentId)
    .all<{ recipient_id: string }>();
  return result.results.map((row) => row.recipient_id);
}
