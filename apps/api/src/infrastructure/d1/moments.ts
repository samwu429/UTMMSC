import {
  canDeleteMomentComment,
  canModerateMoment,
  canReportMoment,
  MOMENT_INLINE_COMMENTS,
  MOMENT_INLINE_LIKES,
  MOMENT_PAGE_SIZE,
  type MomentAlbumOwner,
  type MomentAudience,
  type MomentAudienceCounts,
  type MomentComment,
  type MomentMedia,
  type MomentPerson,
  type MomentPost,
  type MomentPostFacts,
  type Role,
} from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { encodeMomentCursor, type MomentCursor } from '../../domain/moments/cursor';
import type { CreateMomentInput } from '../../domain/moments/input';
import { nowIso } from './time';

/**
 * The member a query answers for: their id, and the role they act as (viewedRole of their row), which decides
 * canModerate on every post and comment returned.
 * 查询所服务的成员：其 id，以及其当前身份（成员记录的 viewedRole），它决定返回的每条动态和评论的 canModerate。
 */
export interface MomentReader {
  id: string;
  role: Role;
}

/** One page of posts, each already hydrated with media, visible likes and visible comments for the reader. */
/** 一页动态，每条都已按读者附上媒体、可见的赞和可见的评论。 */
export interface MomentPage {
  posts: MomentPost[];
  /** The last post returned when there may be more, else null. */
  /** 可能还有更多时为返回的最后一条动态，否则为 null。 */
  nextCursor: MomentCursor | null;
}

/**
 * What the routes check permissions against, whether or not the reader may see the post. facts carries
 * hiddenFromViewer for this reader, so canSeeMomentPost({ id, friendIds }, facts) decides visibility.
 * 接口据以判断权限的信息，不论读者能否看到这条动态。facts 中的 hiddenFromViewer 针对这位读者，
 * 因此 canSeeMomentPost({ id, friendIds }, facts) 即可判断是否可见。
 */
export interface MomentAccess {
  postId: string;
  facts: MomentPostFacts;
  authorRole: Role;
  /** The reader and the author are friends. */
  /** 读者与作者是好友。 */
  friends: boolean;
  createdAt: string;
}

// SQL shared by the moment modules. Every statement binds the reader as ?1, so the fragments below can name
// the reader and the reader's friends without knowing what else the statement binds.
// 各动态模块共用的 SQL。每条语句都把读者绑定为 ?1，因此下面的片段无需知道语句还绑定了什么，就能引用读者及其好友。

/**
 * Numbered parameters for one statement. The reader is ?1; each later value gets the next number, so a value
 * named several times is bound once, and D1 and SQLite read the same numbering.
 * 一条语句的编号参数。读者为 ?1；之后每个值依次编号，因此多次引用的值只绑定一次，D1 与 SQLite 读到的编号相同。
 */
export class MomentSqlParams {
  readonly values: unknown[];

  constructor(readerId: string) {
    this.values = [readerId];
  }

  add(value: unknown): string {
    this.values.push(value);
    return `?${this.values.length}`;
  }

  list(values: readonly unknown[]): string {
    return values.map((value) => this.add(value)).join(', ');
  }
}

/** The reader's accepted friends in either direction, as the CTE friend(id). Uses friend_requests_from and _to. */
/** 读者在任一方向上已通过的好友，作为 CTE friend(id)。使用 friend_requests_from 和 friend_requests_to 索引。 */
export const MOMENT_FRIEND_CTE = `friend(id) AS (
  SELECT to_id FROM friend_requests WHERE from_id = ?1 AND status = 'accepted'
  UNION
  SELECT from_id FROM friend_requests WHERE to_id = ?1 AND status = 'accepted'
)`;

/**
 * canSeeMomentPost for posts p whose author m is already joined as active: the reader's own posts, removed
 * ones included, or live posts that are club-wide or for friends the reader is one of, and not hidden from them.
 * 针对已按在用条件联上作者 m 的动态 p 的 canSeeMomentPost：读者自己的动态（包括已被移除的），
 * 或未被移除、对全社团可见或对好友可见且读者是好友、并且没有对读者设置「不让TA看」的动态。
 */
export const MOMENT_POST_VISIBLE = `(p.member_id = ?1 OR (
  p.removed_at IS NULL
  AND (p.audience = 'club' OR (p.audience = 'friends' AND p.member_id IN (SELECT id FROM friend)))
  AND NOT EXISTS (SELECT 1 FROM moment_blocks b WHERE b.member_id = p.member_id AND b.target_id = ?1 AND b.kind = 'hide_from')
))`;

/** The home feed also skips authors the reader chose 不看TA for, never the reader's own posts. */
/** 动态首页还跳过读者设置了「不看TA」的作者，但从不跳过读者自己的动态。 */
export const MOMENT_NOT_MUTED = `(p.member_id = ?1 OR NOT EXISTS (
  SELECT 1 FROM moment_blocks b WHERE b.member_id = ?1 AND b.target_id = p.member_id AND b.kind = 'mute'
))`;

/**
 * canSeeMomentInteraction for one member column on a post p: everyone on a club post; on other posts the post
 * author sees all, and anyone else sees the reader, the author and the reader's friends.
 * 针对动态 p 上某一成员列的 canSeeMomentInteraction：全社团动态对所有人可见；其他动态的作者能看到全部，
 * 其他人能看到自己、作者和自己的好友。
 */
export function momentSeesSql(column: string): string {
  return `(p.audience = 'club' OR p.member_id = ?1 OR ${column} = ?1 OR ${column} = p.member_id OR ${column} IN (SELECT id FROM friend))`;
}

/** True for the error D1 and SQLite raise when a referenced row is gone, such as a post deleted mid-write. */
/** 被引用的记录已不存在时 D1 和 SQLite 抛出的错误，例如写入途中动态被删除。 */
export function isForeignKeyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /FOREIGN KEY constraint failed/i.test(message);
}

export function isUniqueError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed/i.test(message);
}

export function toMomentPerson(id: string, displayName: string, avatarKey: string | null): MomentPerson {
  return { id, displayName, avatarKey: avatarKey ?? null };
}

// Likes and comments as the reader may see them.
// 读者能看到的赞和评论。

export interface MomentLikeRow {
  post_id: string;
  member_id: string;
  display_name: string;
  avatar_key: string | null;
  total: number;
  mine: number;
}

export interface MomentLikeList {
  likes: MomentPerson[];
  likeCount: number;
  likedByMe: boolean;
}

const NO_LIKES: MomentLikeList = { likes: [], likeCount: 0, likedByMe: false };

/**
 * Visible likes of these posts by active members, oldest first and at most `cap` per post, each row carrying
 * the post's visible total and whether the reader liked it.
 * 这些动态上由在用成员点的、读者可见的赞，从早到晚，每条动态最多 `cap` 个；每行带有该动态的可见总数以及读者是否点过赞。
 */
export function momentLikesStatement(db: D1Database, readerId: string, postIds: readonly string[], cap: number = MOMENT_INLINE_LIKES): D1PreparedStatement {
  const params = new MomentSqlParams(readerId);
  const ids = params.list(postIds);
  return db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       SELECT post_id, member_id, display_name, avatar_key, total, mine FROM (
         SELECT l.post_id, l.member_id, lm.display_name, lm.avatar_key,
                ROW_NUMBER() OVER (PARTITION BY l.post_id ORDER BY l.created_at, l.member_id) AS rn,
                COUNT(*) OVER (PARTITION BY l.post_id) AS total,
                MAX(l.member_id = ?1) OVER (PARTITION BY l.post_id) AS mine
         FROM post_likes l
         JOIN posts p ON p.id = l.post_id
         JOIN members lm ON lm.id = l.member_id AND lm.status = 'active'
         WHERE l.post_id IN (${ids}) AND ${momentSeesSql('l.member_id')}
       )
       WHERE rn <= ${params.add(cap)}
       ORDER BY post_id, rn`,
    )
    .bind(...params.values);
}

export function groupMomentLikes(rows: readonly MomentLikeRow[]): Map<string, MomentLikeList> {
  const grouped = new Map<string, MomentLikeList>();
  for (const row of rows) {
    const list = grouped.get(row.post_id) ?? { likes: [], likeCount: row.total, likedByMe: row.mine === 1 };
    list.likes.push(toMomentPerson(row.member_id, row.display_name, row.avatar_key));
    grouped.set(row.post_id, list);
  }
  return grouped;
}

export function momentLikesOf(grouped: Map<string, MomentLikeList>, postId: string): MomentLikeList {
  return grouped.get(postId) ?? { ...NO_LIKES, likes: [] };
}

export interface MomentCommentRow {
  id: string;
  post_id: string;
  post_author_id: string;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  author_role: Role;
  reply_to_comment_id: string | null;
  reply_id: string | null;
  reply_name: string | null;
  reply_avatar: string | null;
  body: string;
  client_id: string;
  created_at: string;
  removed_at: string | null;
  removed_reason: string | null;
}

/**
 * Comment columns over post_comments c joined to its post p, its author ca and the member answered mr, who
 * counts only while active.
 * 评论的列：post_comments c 联上所属动态 p、作者 ca 和被回复者 mr（仅在用时计入）。
 */
export const MOMENT_COMMENT_COLUMNS = `c.id, c.post_id, p.member_id AS post_author_id,
  c.author_id, ca.display_name AS author_name, ca.avatar_key AS author_avatar, ca.role AS author_role,
  c.reply_to_comment_id, mr.id AS reply_id, mr.display_name AS reply_name, mr.avatar_key AS reply_avatar,
  c.body, c.client_id, c.created_at, c.removed_at, c.removed_reason`;

export const MOMENT_COMMENT_JOINS = `JOIN posts p ON p.id = c.post_id
  JOIN members ca ON ca.id = c.author_id AND ca.status = 'active'
  LEFT JOIN members mr ON mr.id = c.reply_to_member_id AND mr.status = 'active'`;

/**
 * The comments the reader may see: live ones, or their own removed ones, whose author and (when still active)
 * member answered both pass canSeeMomentInteraction.
 * 读者能看到的评论：未被移除的，或自己被移除的；其作者以及（仍在用的）被回复者都要满足 canSeeMomentInteraction。
 */
export const MOMENT_COMMENT_VISIBLE = `(c.removed_at IS NULL OR c.author_id = ?1)
  AND ${momentSeesSql('c.author_id')}
  AND (mr.id IS NULL OR ${momentSeesSql('mr.id')})`;

/** Visible comments of these posts, oldest first and at most `cap` per post, each with the post's visible total. */
/** 这些动态上读者可见的评论，从早到晚，每条动态最多 `cap` 条，每行带有该动态的可见总数。 */
function inlineCommentsStatement(db: D1Database, readerId: string, postIds: readonly string[], cap: number): D1PreparedStatement {
  const params = new MomentSqlParams(readerId);
  const ids = params.list(postIds);
  return db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       SELECT * FROM (
         SELECT ${MOMENT_COMMENT_COLUMNS},
                ROW_NUMBER() OVER (PARTITION BY c.post_id ORDER BY c.created_at, c.id) AS rn,
                COUNT(*) OVER (PARTITION BY c.post_id) AS total
         FROM post_comments c
         ${MOMENT_COMMENT_JOINS}
         WHERE c.post_id IN (${ids}) AND ${MOMENT_COMMENT_VISIBLE}
       )
       WHERE rn <= ${params.add(cap)}
       ORDER BY post_id, rn`,
    )
    .bind(...params.values);
}

/**
 * A comment as the reader receives it. clientId and the removal are for the comment's author only; canModerate
 * needs a moderator who outranks the comment's author by their real role.
 * 读者收到的评论。clientId 和移除信息只发给评论作者；canModerate 要求管理员的职位高于评论作者的真实身份。
 */
export function toMomentComment(row: MomentCommentRow, reader: MomentReader): MomentComment {
  const own = row.author_id === reader.id;
  const comment: MomentComment = {
    id: row.id,
    postId: row.post_id,
    author: toMomentPerson(row.author_id, row.author_name, row.author_avatar),
    replyTo: row.reply_id && row.reply_name !== null ? toMomentPerson(row.reply_id, row.reply_name, row.reply_avatar) : null,
    replyToCommentId: row.reply_to_comment_id,
    body: row.body,
    createdAt: row.created_at,
    canDelete: canDeleteMomentComment(reader.id, { authorId: row.author_id }, { authorId: row.post_author_id }),
    canModerate: canModerateMoment(reader, { id: row.author_id, role: row.author_role }),
  };
  if (own) {
    comment.clientId = row.client_id;
    if (row.removed_at) comment.removed = { at: row.removed_at, reason: row.removed_reason };
  }
  return comment;
}

interface PostRow {
  id: string;
  body: string;
  location: string | null;
  audience: MomentAudience;
  created_at: string;
  client_id: string | null;
  removed_at: string | null;
  removed_reason: string | null;
  author_id: string;
  author_name: string;
  author_avatar: string | null;
  author_role: Role;
}

export interface MomentMediaRow {
  post_id: string;
  object_key: string;
  content_type: string;
  kind: MomentMedia['kind'];
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  preview_key: string | null;
}

export function toMomentMedia(row: MomentMediaRow): MomentMedia {
  return {
    key: row.object_key,
    contentType: row.content_type,
    kind: row.kind,
    width: row.width,
    height: row.height,
    previewKey: row.preview_key,
    durationMs: row.duration_ms,
  };
}

/** Media of these posts in their order. Uses post_media_post. */
/** 这些动态的媒体，按排列顺序。使用 post_media_post 索引。 */
export function momentMediaStatement(db: D1Database, postIds: readonly string[]): D1PreparedStatement {
  return db
    .prepare(
      `SELECT post_id, object_key, content_type, kind, width, height, duration_ms, preview_key
       FROM post_media WHERE post_id IN (${postIds.map(() => '?').join(', ')})
       ORDER BY post_id, sort_order`,
    )
    .bind(...postIds);
}

export function groupMomentMedia(rows: readonly MomentMediaRow[]): Map<string, MomentMedia[]> {
  const grouped = new Map<string, MomentMedia[]>();
  for (const row of rows) {
    const list = grouped.get(row.post_id) ?? [];
    list.push(toMomentMedia(row));
    grouped.set(row.post_id, list);
  }
  return grouped;
}

const POST_COLUMNS = `p.id, p.body, p.location, p.audience, p.created_at, p.client_id, p.removed_at, p.removed_reason,
  m.id AS author_id, m.display_name AS author_name, m.avatar_key AS author_avatar, m.role AS author_role`;

/**
 * Posts the reader may see, newest first, with `where` added. The author join is a CROSS JOIN so SQLite
 * always walks posts first, in index order, instead of sorting every post of every active member.
 * 读者能看到的动态，从新到旧，并加上 `where` 条件。作者用 CROSS JOIN 联接，使 SQLite 总是先按索引顺序遍历动态，
 * 而不是把所有在用成员的全部动态取出再排序。
 */
async function selectPosts(db: D1Database, params: MomentSqlParams, where: string, limit: number): Promise<PostRow[]> {
  const result = await db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       SELECT ${POST_COLUMNS}
       FROM posts p
       CROSS JOIN members m ON m.id = p.member_id AND m.status = 'active'
       WHERE ${MOMENT_POST_VISIBLE} AND ${where}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ${params.add(limit)}`,
    )
    .bind(...params.values)
    .all<PostRow>();
  return result.results;
}

function afterCursor(params: MomentSqlParams, cursor: MomentCursor | null): string {
  return cursor ? `(p.created_at, p.id) < (${params.add(cursor.at)}, ${params.add(cursor.id)})` : '1 = 1';
}

/**
 * Media, visible likes and visible comments for these posts in one batch: four statements per page with the
 * posts themselves.
 * 在一个批次中为这些动态取媒体、可见的赞和可见的评论：加上动态本身，每页四条语句。
 */
async function hydratePosts(db: D1Database, reader: MomentReader, rows: readonly PostRow[], commentLimit: number): Promise<MomentPost[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [media, likes, comments] = await db.batch([
    momentMediaStatement(db, ids),
    momentLikesStatement(db, reader.id, ids),
    inlineCommentsStatement(db, reader.id, ids, commentLimit),
  ]);
  const mediaByPost = groupMomentMedia((media?.results ?? []) as MomentMediaRow[]);
  const likesByPost = groupMomentLikes((likes?.results ?? []) as MomentLikeRow[]);
  const commentsByPost = new Map<string, { comments: MomentComment[]; total: number }>();
  for (const row of (comments?.results ?? []) as (MomentCommentRow & { total: number })[]) {
    const entry = commentsByPost.get(row.post_id) ?? { comments: [], total: row.total };
    entry.comments.push(toMomentComment(row, reader));
    commentsByPost.set(row.post_id, entry);
  }
  return rows.map((row) => {
    const thread = commentsByPost.get(row.id) ?? { comments: [], total: 0 };
    return toPost(row, reader, mediaByPost.get(row.id) ?? [], momentLikesOf(likesByPost, row.id), thread.comments, thread.total);
  });
}

function toPost(row: PostRow, reader: MomentReader, media: MomentMedia[], likes: MomentLikeList, comments: MomentComment[], commentCount: number): MomentPost {
  const own = row.author_id === reader.id;
  const last = comments[comments.length - 1];
  const post: MomentPost = {
    id: row.id,
    author: toMomentPerson(row.author_id, row.author_name, row.author_avatar),
    body: row.body,
    media,
    location: row.location,
    createdAt: row.created_at,
    clubWide: row.audience === 'club',
    likes: likes.likes,
    likeCount: likes.likeCount,
    likedByMe: likes.likedByMe,
    comments,
    commentCount,
    commentsCursor: last && commentCount > comments.length ? encodeMomentCursor({ at: last.createdAt, id: last.id }) : null,
    canDelete: own,
    canModerate: canModerateMoment(reader, { id: row.author_id, role: row.author_role }),
    canReport: canReportMoment(reader.id, row.author_id, true),
    canInteract: row.removed_at === null,
  };
  if (own) {
    post.audience = row.audience;
    if (row.client_id) post.clientId = row.client_id;
    if (row.removed_at) post.removed = { at: row.removed_at, reason: row.removed_reason };
  }
  return post;
}

async function toPage(db: D1Database, reader: MomentReader, rows: PostRow[], limit: number): Promise<MomentPage> {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    posts: await hydratePosts(db, reader, page, MOMENT_INLINE_COMMENTS),
    nextCursor: rows.length > limit && last ? { at: last.created_at, id: last.id } : null,
  };
}

/**
 * The reader's home feed, newest first after `cursor`: their own posts, plus live posts they may see by
 * canSeeMomentPost from authors they did not mute. Four statements per page (posts, media, likes, comments).
 * The posts walk posts_page.
 * 读者的动态首页，从 `cursor` 之后按从新到旧排列：自己的动态，加上按 canSeeMomentPost 可见、且作者未被设为「不看TA」的动态。
 * 每页四条语句（动态、媒体、赞、评论）。动态按 posts_page 索引遍历。
 */
export async function listHomeFeed(db: D1Database, reader: MomentReader, cursor: MomentCursor | null, limit: number = MOMENT_PAGE_SIZE): Promise<MomentPage> {
  const params = new MomentSqlParams(reader.id);
  const rows = await selectPosts(db, params, `${MOMENT_NOT_MUTED} AND ${afterCursor(params, cursor)}`, limit + 1);
  return toPage(db, reader, rows, limit);
}

/** One member's posts the reader may see, newest first after `cursor`, mute ignored. The posts walk posts_member. */
/** 读者能看到的某位成员的动态，从 `cursor` 之后按从新到旧排列，不考虑「不看TA」。动态按 posts_member 索引遍历。 */
export async function listAlbum(db: D1Database, reader: MomentReader, authorId: string, cursor: MomentCursor | null, limit: number = MOMENT_PAGE_SIZE): Promise<MomentPage> {
  const params = new MomentSqlParams(reader.id);
  const rows = await selectPosts(db, params, `p.member_id = ${params.add(authorId)} AND ${afterCursor(params, cursor)}`, limit + 1);
  return toPage(db, reader, rows, limit);
}

/** An accepted friend request in either direction between ?1 and the member column. */
/** ?1 与该成员列之间任一方向上已通过的好友申请。 */
function friendsWithReaderSql(column: string): string {
  return `(EXISTS (SELECT 1 FROM friend_requests f WHERE f.from_id = ?1 AND f.to_id = ${column} AND f.status = 'accepted')
    OR EXISTS (SELECT 1 FROM friend_requests f WHERE f.from_id = ${column} AND f.to_id = ?1 AND f.status = 'accepted'))`;
}

/**
 * The album header for an active member, or null for an unknown or inactive id. clubOnly is true when the
 * reader is neither the member nor a friend.
 * 在用成员的相册头部信息；id 不存在或成员已停用时为 null。读者既不是本人也不是好友时 clubOnly 为 true。
 */
export async function findAlbumOwner(db: D1Database, reader: MomentReader, memberId: string): Promise<{ owner: MomentAlbumOwner; clubOnly: boolean } | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.display_name, m.avatar_key, m.cover_key, m.headline, ${friendsWithReaderSql('m.id')} AS friends
       FROM members m WHERE m.id = ?2 AND m.status = 'active'`,
    )
    .bind(reader.id, memberId)
    .first<{ id: string; display_name: string; avatar_key: string | null; cover_key: string | null; headline: string | null; friends: number }>();
  if (!row) return null;
  return {
    owner: { ...toMomentPerson(row.id, row.display_name, row.avatar_key), coverKey: row.cover_key, headline: row.headline },
    clubOnly: row.id !== reader.id && row.friends !== 1,
  };
}

/**
 * One post hydrated for the reader with up to `commentLimit` comments (MOMENT_INLINE_COMMENTS by default; the
 * detail route asks for MOMENT_DETAIL_COMMENTS), or null when it does not exist or the reader may not see it.
 * 为读者组装好的一条动态，最多附带 `commentLimit` 条评论（默认 MOMENT_INLINE_COMMENTS；详情接口用 MOMENT_DETAIL_COMMENTS）；
 * 不存在或读者无权查看时为 null。
 */
export async function findMomentPost(db: D1Database, reader: MomentReader, postId: string, commentLimit: number = MOMENT_INLINE_COMMENTS): Promise<MomentPost | null> {
  const params = new MomentSqlParams(reader.id);
  const rows = await selectPosts(db, params, `p.id = ${params.add(postId)}`, 1);
  const [post] = await hydratePosts(db, reader, rows, commentLimit);
  return post ?? null;
}

/** Permission facts for a post, or null when no such post exists. */
/** 一条动态的权限信息；动态不存在时为 null。 */
export async function findMomentAccess(db: D1Database, readerId: string, postId: string): Promise<MomentAccess | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.member_id, p.audience, p.removed_at, p.created_at, m.status AS author_status, m.role AS author_role,
              EXISTS (SELECT 1 FROM moment_blocks b WHERE b.member_id = p.member_id AND b.target_id = ?1 AND b.kind = 'hide_from') AS hidden,
              ${friendsWithReaderSql('p.member_id')} AS friends
       FROM posts p JOIN members m ON m.id = p.member_id
       WHERE p.id = ?2`,
    )
    .bind(readerId, postId)
    .first<{
      id: string;
      member_id: string;
      audience: MomentAudience;
      removed_at: string | null;
      created_at: string;
      author_status: string;
      author_role: Role;
      hidden: number;
      friends: number;
    }>();
  if (!row) return null;
  return {
    postId: row.id,
    facts: {
      authorId: row.member_id,
      authorActive: row.author_status === 'active',
      audience: row.audience,
      removed: row.removed_at !== null,
      hiddenFromViewer: row.hidden === 1,
    },
    authorRole: row.author_role,
    friends: row.friends === 1,
    createdAt: row.created_at,
  };
}

/** The reader's own post published with this clientId, hydrated, so a repeated publish returns it with 200. */
/** 读者以这个 clientId 发表过的动态（已组装），重复发表时以 200 返回它。 */
export async function findMomentByClientId(db: D1Database, reader: MomentReader, clientId: string): Promise<MomentPost | null> {
  const params = new MomentSqlParams(reader.id);
  const rows = await selectPosts(db, params, `p.member_id = ?1 AND p.client_id = ${params.add(clientId)}`, 1);
  const [post] = await hydratePosts(db, reader, rows, MOMENT_INLINE_COMMENTS);
  return post ?? null;
}

/** Every object a post's media uses, photos and videos with their previews, without repeats. */
/** 一条动态的媒体用到的全部对象：照片、视频及其预览图，不重复。 */
export function momentObjectKeys(media: readonly { key: string; previewKey?: string | null }[]): string[] {
  const keys = new Set<string>();
  for (const item of media) {
    keys.add(item.key);
    if (item.previewKey) keys.add(item.previewKey);
  }
  return [...keys];
}

/** One media item as a publish stores it. The legacy composer sends no sizes, duration or preview. */
/** 发表时保存的一项媒体。旧版编辑器不发送尺寸、时长和预览图。 */
export interface MomentMediaInsert {
  key: string;
  contentType: string;
  kind: MomentMedia['kind'];
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  previewKey?: string | null;
}

/**
 * The batch that publishes a post: its own INSERT, then its media. Each post_media row goes in only while the
 * member's moment_uploads rows for its file and its preview are still there. The cron claims a row by deleting
 * it before it deletes the object, so either the sweep comes first and the media insert changes nothing, or the
 * post comes first and the sweep sees the key in use. A post that did not get every media row is deleted again
 * in the same batch, and only a post that kept them consumes its uploads, so a refused publish leaves its
 * uploads to the cron. refused(results) reads the batch results: true when the post was deleted for that.
 * 发表一条动态的批次：先写入动态本身，再写入媒体。只有当该成员对应原文件及预览图的 moment_uploads 记录仍然存在时，
 * 才会写入 post_media。定时任务先删除记录认领它，再删除对象，因此要么清理在先、媒体写入什么也不改，要么动态在先、
 * 清理时看到这个键正在使用。没能写入全部媒体的动态在同一批次中被删除，只有保留了全部媒体的动态才会消耗它的上传记录，
 * 被拒绝的发表因此把上传留给定时任务处理。refused(results) 读取批次结果：动态因此被删除时为 true。
 */
export function momentPublishWrites(
  db: D1Database,
  post: D1PreparedStatement,
  memberId: string,
  postId: string,
  media: readonly MomentMediaInsert[],
  createdAt: string,
): { statements: D1PreparedStatement[]; refused(results: readonly D1Result[]): boolean } {
  if (media.length === 0) return { statements: [post], refused: () => false };
  const inserts = media.map((item, index) =>
    db
      .prepare(
        `INSERT INTO post_media (id, post_id, object_key, content_type, kind, sort_order, created_at, width, height, duration_ms, preview_key)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         WHERE EXISTS (SELECT 1 FROM moment_uploads WHERE member_id = ?12 AND object_key = ?3)
           AND (?11 IS NULL OR EXISTS (SELECT 1 FROM moment_uploads WHERE member_id = ?12 AND object_key = ?11))`,
      )
      .bind(
        randomId('pmd'),
        postId,
        item.key,
        item.contentType,
        item.kind,
        index,
        createdAt,
        item.width ?? null,
        item.height ?? null,
        item.durationMs ?? null,
        item.previewKey ?? null,
        memberId,
      ),
  );
  const keys = momentObjectKeys(media);
  const dropAt = 1 + inserts.length;
  return {
    statements: [
      post,
      ...inserts,
      db.prepare('DELETE FROM posts WHERE id = ?1 AND (SELECT COUNT(*) FROM post_media WHERE post_id = ?1) <> ?2').bind(postId, media.length),
      // Consumed last, and only by a post that kept every media row.
      // 最后消耗，而且只有保留了全部媒体的动态才会消耗。
      db
        .prepare(`DELETE FROM moment_uploads WHERE member_id = ? AND object_key IN (${keys.map(() => '?').join(', ')}) AND EXISTS (SELECT 1 FROM posts WHERE id = ?)`)
        .bind(memberId, ...keys, postId),
    ],
    refused: (results) => (results[dropAt]?.meta.changes ?? 0) > 0,
  };
}

/** What insertMoment did. media_gone: an upload expired or was never recorded, and nothing was stored. */
/** insertMoment 的结果。media_gone：有上传已过期或从未记录，什么也没有保存。 */
export type InsertMomentResult = { status: 'created' | 'existing'; post: MomentPost } | { status: 'media_gone' };

/**
 * Stores the post and its media rows (sizes, duration, preview) in one batch through momentPublishWrites, which
 * consumes their moment_uploads rows, or stores nothing when one of them is gone. A clientId already used
 * returns that post first, and a UNIQUE race on (member_id, client_id) re-selects the first post; both answer
 * existing.
 * 在一个批次中通过 momentPublishWrites 保存动态及其媒体（尺寸、时长、预览图）并消耗对应的 moment_uploads 记录；
 * 其中有记录已不存在时什么也不保存。已用过的 clientId 先返回那条动态；(member_id, client_id) 的唯一约束发生竞争时，
 * 重新读取第一条动态；两者都返回 existing。
 */
export async function insertMoment(db: D1Database, reader: MomentReader, input: CreateMomentInput): Promise<InsertMomentResult> {
  const existing = await findMomentByClientId(db, reader, input.clientId);
  if (existing) return { status: 'existing', post: existing };
  const id = randomId('post');
  const createdAt = nowIso();
  const publish = momentPublishWrites(
    db,
    db
      .prepare('INSERT INTO posts (id, member_id, body, created_at, audience, location, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, reader.id, input.text, createdAt, input.audience, input.location, input.clientId),
    reader.id,
    id,
    input.media,
    createdAt,
  );
  let results: D1Result[];
  try {
    results = await db.batch(publish.statements);
  } catch (err) {
    if (!isUniqueError(err)) throw err;
    const first = await findMomentByClientId(db, reader, input.clientId);
    if (first) return { status: 'existing', post: first };
    throw err;
  }
  if (publish.refused(results)) return { status: 'media_gone' };
  const post = await findMomentPost(db, reader, id);
  if (!post) throw new Error('moment insert did not persist');
  return { status: 'created', post };
}

/**
 * Hard-deletes the reader's own post (likes, comments and notices cascade; reports and actions stay) and
 * returns every object and preview key to remove from R2, or null when the post is not theirs.
 * 彻底删除读者自己的动态（赞、评论和消息级联删除；投诉和管理记录保留），并返回需要从 R2 删除的全部对象键和预览图键；
 * 动态不属于读者时返回 null。
 */
export async function deleteMoment(db: D1Database, memberId: string, postId: string): Promise<string[] | null> {
  const [media, deleted] = await db.batch([
    db
      .prepare(
        `SELECT pm.object_key AS key, pm.preview_key AS previewKey FROM post_media pm
         JOIN posts p ON p.id = pm.post_id
         WHERE pm.post_id = ? AND p.member_id = ?
         ORDER BY pm.sort_order`,
      )
      .bind(postId, memberId),
    db.prepare('DELETE FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId),
  ]);
  if ((deleted?.meta.changes ?? 0) === 0) return null;
  return momentObjectKeys((media?.results ?? []) as { key: string; previewKey: string | null }[]);
}

/** Posts the member published at or after `since`, for the daily cap. */
/** 成员在 `since` 及之后发表的动态数，用于每日上限。 */
export async function countMomentsSince(db: D1Database, memberId: string, since: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE member_id = ? AND created_at >= ?').bind(memberId, since).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * The member's active friends and every other active member, for 谁可以看: how many people besides the author
 * a friends post or a club post reaches.
 * 成员在用的好友数，以及除本人以外的全体在用成员数，用于「谁可以看」：好友动态和全社团动态分别能让本人以外的多少人看到。
 */
export async function countMomentAudience(db: D1Database, memberId: string): Promise<MomentAudienceCounts> {
  const row = await db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       SELECT
         (SELECT COUNT(*) FROM members m WHERE m.status = 'active' AND m.id IN (SELECT id FROM friend)) AS friends,
         (SELECT COUNT(*) FROM members m WHERE m.status = 'active' AND m.id <> ?1) AS club`,
    )
    .bind(memberId)
    .first<{ friends: number; club: number }>();
  return { friends: row?.friends ?? 0, club: row?.club ?? 0 };
}

/** Records an upload that no post uses yet, so the cron can delete it if it is never published. */
/** 记录一次尚未被动态使用的上传，从未发表时由定时任务删除。 */
export async function recordMomentUpload(db: D1Database, memberId: string, objectKey: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO moment_uploads (object_key, member_id, created_at) VALUES (?, ?, ?)').bind(objectKey, memberId, nowIso()).run();
}
