import type { ActivityPost, Experience } from '@utmmsc/shared';
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

function toPost(row: PostRow): ActivityPost {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.author_name,
    authorHeadline: row.author_headline,
  };
}

const POST_SELECT = `SELECT p.id, p.body, p.created_at, m.id AS author_id, m.display_name AS author_name, m.headline AS author_headline
  FROM posts p JOIN members m ON m.id = p.member_id`;

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
  return result.results.map(toPost);
}

/** Newest posts from active members. Disabled accounts drop out of the feed with their author row. */
/** 在读成员的最新动态。账号停用后，作者不再出现，动态也不再出现。 */
export async function listFeed(db: D1Database, limit: number): Promise<ActivityPost[]> {
  const result = await db.prepare(`${POST_SELECT} WHERE m.status = 'active' ORDER BY p.created_at DESC LIMIT ?`).bind(limit).all<PostRow>();
  return result.results.map(toPost);
}

export async function insertPost(db: D1Database, memberId: string, body: string): Promise<ActivityPost> {
  const id = randomId('post');
  await db.prepare('INSERT INTO posts (id, member_id, body, created_at) VALUES (?, ?, ?, ?)').bind(id, memberId, body, nowIso()).run();
  const row = await db.prepare(`${POST_SELECT} WHERE p.id = ?`).bind(id).first<PostRow>();
  if (!row) throw new Error('post insert did not persist');
  return toPost(row);
}

export async function deletePost(db: D1Database, memberId: string, postId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM posts WHERE id = ? AND member_id = ?').bind(postId, memberId).run();
  return (result.meta.changes ?? 0) > 0;
}
