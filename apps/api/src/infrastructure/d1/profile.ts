import type { ActivityPost, Experience, PostMedia } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import type { ExperienceInput } from '../../domain/profile/fields';
import { MOMENT_FRIEND_CTE, MOMENT_NOT_MUTED, MOMENT_POST_VISIBLE, momentObjectKeys, momentPublishWrites } from './moments';
import { nowIso } from './time';

interface ExperienceRow {
  id: string;
  title: string;
  organization: string;
  start_year: number | null;
  end_year: number | null;
  current: number;
  description: string | null;
}

interface PostRow {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author_name: string;
  author_headline: string | null;
  author_avatar: string | null;
}

interface MediaRow {
  post_id: string;
  object_key: string;
  content_type: string;
  kind: PostMedia['kind'];
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  preview_key: string | null;
}

function toExperience(row: ExperienceRow): Experience {
  return {
    id: row.id,
    title: row.title,
    organization: row.organization,
    startYear: row.start_year,
    endYear: row.end_year,
    current: row.current === 1,
    description: row.description,
  };
}

function toPost(row: PostRow, media: PostMedia[]): ActivityPost {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.author_name,
    authorHeadline: row.author_headline,
    authorAvatarKey: row.author_avatar,
    media,
  };
}

const POST_SELECT = `SELECT p.id, p.body, p.created_at, m.id AS author_id, m.display_name AS author_name, m.headline AS author_headline, m.avatar_key AS author_avatar
  FROM posts p JOIN members m ON m.id = p.member_id`;

async function mediaByPost(db: D1Database, postIds: string[]): Promise<Map<string, PostMedia[]>> {
  const grouped = new Map<string, PostMedia[]>();
  if (postIds.length === 0) return grouped;
  const placeholders = postIds.map(() => '?').join(', ');
  const result = await db
    .prepare(
      `SELECT post_id, object_key, content_type, kind, width, height, duration_ms, preview_key
       FROM post_media WHERE post_id IN (${placeholders}) ORDER BY sort_order`,
    )
    .bind(...postIds)
    .all<MediaRow>();
  for (const row of result.results) {
    const list = grouped.get(row.post_id) ?? [];
    list.push({
      key: row.object_key,
      contentType: row.content_type,
      kind: row.kind,
      width: row.width,
      height: row.height,
      previewKey: row.preview_key,
      durationMs: row.duration_ms,
    });
    grouped.set(row.post_id, list);
  }
  return grouped;
}

async function withMedia(db: D1Database, rows: PostRow[]): Promise<ActivityPost[]> {
  const grouped = await mediaByPost(db, rows.map((row) => row.id));
  return rows.map((row) => toPost(row, grouped.get(row.id) ?? []));
}

export async function listExperiences(db: D1Database, memberId: string): Promise<Experience[]> {
  const result = await db
    .prepare(
      `SELECT id, title, organization, start_year, end_year, current, description
       FROM experiences WHERE member_id = ?
       ORDER BY current DESC, start_year DESC, created_at DESC`,
    )
    .bind(memberId)
    .all<ExperienceRow>();
  return result.results.map(toExperience);
}

export async function countExperiences(db: D1Database, memberId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM experiences WHERE member_id = ?').bind(memberId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function insertExperience(db: D1Database, memberId: string, input: ExperienceInput): Promise<Experience> {
  const id = randomId('exp');
  await db
    .prepare(
      `INSERT INTO experiences (id, member_id, title, organization, start_year, end_year, current, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, memberId, input.title, input.organization, input.startYear, input.endYear, input.current ? 1 : 0, input.description, nowIso())
    .run();
  const row = await db
    .prepare('SELECT id, title, organization, start_year, end_year, current, description FROM experiences WHERE id = ?')
    .bind(id)
    .first<ExperienceRow>();
  if (!row) throw new Error('experience insert did not persist');
  return toExperience(row);
}

export async function deleteExperience(db: D1Database, memberId: string, experienceId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM experiences WHERE id = ? AND member_id = ?').bind(experienceId, memberId).run();
  return (result.meta.changes ?? 0) > 0;
}

/**
 * The legacy profile list: the member's posts the viewer may see by canSeeMomentPost, newest first, the same
 * rule as the album. Posts written for friends or for the author alone no longer reach everyone.
 * 旧版资料页的动态列表：按 canSeeMomentPost 查看者能看到的该成员动态，从新到旧，与相册的规则相同。
 * 仅好友可见或仅自己可见的动态不再对所有人显示。
 */
export async function listMemberPosts(db: D1Database, viewerId: string, memberId: string, limit: number): Promise<ActivityPost[]> {
  const result = await db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       ${POST_SELECT}
       WHERE p.member_id = ?2 AND m.status = 'active' AND ${MOMENT_POST_VISIBLE}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?3`,
    )
    .bind(viewerId, memberId, limit)
    .all<PostRow>();
  return withMedia(db, result.results);
}

/**
 * The legacy feed: what the viewer's home feed shows (showsOnHomeFeed), newest first. Disabled accounts drop
 * out with their author row, and so do posts the viewer may not see and authors the viewer muted.
 * 旧版信息流：与查看者动态首页显示的内容相同（showsOnHomeFeed），从新到旧。账号停用后其动态随作者一起消失，
 * 查看者无权看到的动态和设置了「不看TA」的作者也不出现。
 */
export async function listFeed(db: D1Database, viewerId: string, limit: number): Promise<ActivityPost[]> {
  const result = await db
    .prepare(
      `WITH ${MOMENT_FRIEND_CTE}
       ${POST_SELECT}
       WHERE m.status = 'active' AND ${MOMENT_POST_VISIBLE} AND ${MOMENT_NOT_MUTED}
       ORDER BY p.created_at DESC, p.id DESC LIMIT ?2`,
    )
    .bind(viewerId, limit)
    .all<PostRow>();
  return withMedia(db, result.results);
}

/**
 * A post from the legacy composer, which members used believing every post reached the whole club, so it is
 * stored as club like the posts migration 0016 found. It goes through momentPublishWrites as a moments publish
 * does: its uploads are consumed, and null means one of them was gone, so nothing was stored.
 * 来自旧版编辑器的动态。成员使用它时以为每条动态都对全社团可见，因此与迁移 0016 时已有的动态一样按全社团保存。
 * 与发表好友动态一样经由 momentPublishWrites 写入：消耗对应的上传记录；返回 null 表示其中有上传已不存在，什么也没有保存。
 */
export async function insertPost(db: D1Database, memberId: string, body: string, media: PostMedia[]): Promise<ActivityPost | null> {
  const id = randomId('post');
  const createdAt = nowIso();
  const publish = momentPublishWrites(
    db,
    db.prepare("INSERT INTO posts (id, member_id, body, created_at, audience) VALUES (?, ?, ?, ?, 'club')").bind(id, memberId, body, createdAt),
    memberId,
    id,
    media,
    createdAt,
  );
  if (publish.refused(await db.batch(publish.statements))) return null;
  const row = await db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
  if (!row) throw new Error('post insert did not persist');
  return toPost(row, media);
}

/**
 * Returns the object keys to remove from storage, previews included, or null when the post is not the
 * member's. Likes, comments and notices go with the post; reports and moderator actions stay.
 * 返回需要从存储中删除的对象键（包括预览图）；动态不属于该成员时返回 null。赞、评论和消息随动态一起删除；投诉和管理记录保留。
 */
export async function deletePost(db: D1Database, memberId: string, postId: string): Promise<string[] | null> {
  const owned = await db.prepare('SELECT id FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId).first<{ id: string }>();
  if (!owned) return null;
  const media = await db
    .prepare('SELECT object_key AS key, preview_key AS previewKey FROM post_media WHERE post_id = ? ORDER BY sort_order')
    .bind(postId)
    .all<{ key: string; previewKey: string | null }>();
  await db.prepare('DELETE FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId).run();
  return momentObjectKeys(media.results);
}
