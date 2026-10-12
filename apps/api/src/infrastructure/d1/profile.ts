import type { ActivityPost, Experience, PostMedia } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import type { ExperienceInput } from '../../domain/profile/fields';
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
    .prepare(`SELECT post_id, object_key, content_type, kind FROM post_media WHERE post_id IN (${placeholders}) ORDER BY sort_order`)
    .bind(...postIds)
    .all<MediaRow>();
  for (const row of result.results) {
    const list = grouped.get(row.post_id) ?? [];
    list.push({ key: row.object_key, contentType: row.content_type, kind: row.kind });
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

export async function listMemberPosts(db: D1Database, memberId: string, limit: number): Promise<ActivityPost[]> {
  const result = await db
    .prepare(`${POST_SELECT} WHERE p.member_id = ? AND m.status = 'active' ORDER BY p.created_at DESC LIMIT ?`)
    .bind(memberId, limit)
    .all<PostRow>();
  return withMedia(db, result.results);
}

/** Newest posts from active members. Disabled accounts drop out of the feed with their author row. */
/** 在读成员的最新动态。账号停用后，作者不再出现，动态也不再出现。 */
export async function listFeed(db: D1Database, limit: number): Promise<ActivityPost[]> {
  const result = await db.prepare(`${POST_SELECT} WHERE m.status = 'active' ORDER BY p.created_at DESC LIMIT ?`).bind(limit).all<PostRow>();
  return withMedia(db, result.results);
}

export async function insertPost(db: D1Database, memberId: string, body: string, media: PostMedia[]): Promise<ActivityPost> {
  const id = randomId('post');
  const createdAt = nowIso();
  const statements = [
    db.prepare('INSERT INTO posts (id, member_id, body, created_at) VALUES (?, ?, ?, ?)').bind(id, memberId, body, createdAt),
    ...media.map((item, index) =>
      db
        .prepare('INSERT INTO post_media (id, post_id, object_key, content_type, kind, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(randomId('pmd'), id, item.key, item.contentType, item.kind, index, createdAt),
    ),
  ];
  await db.batch(statements);
  const row = await db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
  if (!row) throw new Error('post insert did not persist');
  return toPost(row, media);
}

/** Returns the object keys to remove from storage, or null when the post is not the member's. */
/** 返回需要从存储中删除的对象键。动态不属于该成员时返回 null。 */
export async function deletePost(db: D1Database, memberId: string, postId: string): Promise<string[] | null> {
  const owned = await db.prepare('SELECT id FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId).first<{ id: string }>();
  if (!owned) return null;
  const media = await db.prepare('SELECT object_key FROM post_media WHERE post_id = ?').bind(postId).all<{ object_key: string }>();
  await db.prepare('DELETE FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId).run();
  return media.results.map((row) => row.object_key);
}
