import type { EnrollmentStatus, MemberProfile, MemberSelf, MemberStatus, Role } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface MemberRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  status: MemberStatus;
  role: Role;
  enrollment_status: EnrollmentStatus;
  graduation_year: number;
  major: string | null;
  created_at: string;
  updated_at: string;
}

export function toProfile(row: MemberRow): MemberProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    enrollmentStatus: row.enrollment_status,
    graduationYear: row.graduation_year,
    major: row.major,
  };
}

export function toSelf(row: MemberRow): MemberSelf {
  return { ...toProfile(row), email: row.email, status: row.status, createdAt: row.created_at };
}

export async function findMemberByEmail(db: D1Database, email: string): Promise<MemberRow | null> {
  return db.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
}

export async function findMemberById(db: D1Database, id: string): Promise<MemberRow | null> {
  return db.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<MemberRow>();
}

export async function countMembers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>();
  return row?.n ?? 0;
}

export interface CreateMemberInput {
  email: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major: string | null;
}

export async function createMember(db: D1Database, input: CreateMemberInput): Promise<MemberRow> {
  const id = randomId('mem');
  const ts = nowIso();
  await db
    .prepare(
      `INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, major, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.email, input.displayName, input.passwordHash, input.role, input.enrollmentStatus, input.graduationYear, input.major, ts, ts)
    .run();
  const row = await findMemberById(db, id);
  if (!row) throw new Error('member insert did not persist');
  return row;
}

export async function updatePasswordHash(db: D1Database, memberId: string, passwordHash: string): Promise<void> {
  await db.prepare('UPDATE members SET password_hash = ?, updated_at = ? WHERE id = ?').bind(passwordHash, nowIso(), memberId).run();
}

export async function updateMemberRole(db: D1Database, memberId: string, role: Role): Promise<void> {
  await db.prepare('UPDATE members SET role = ?, updated_at = ? WHERE id = ?').bind(role, nowIso(), memberId).run();
}

export async function updateMemberStatus(db: D1Database, memberId: string, status: MemberStatus): Promise<void> {
  await db.prepare('UPDATE members SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), memberId).run();
}

export interface DirectoryFilter {
  query: string | null;
  enrollmentStatus: EnrollmentStatus | null;
  graduationYear: number | null;
  afterName: string | null;
  afterId: string | null;
  limit: number;
}

/**
 * Keyset pagination on (display_name, id) keeps pages stable while members join. Only active
 * members appear in the directory.
 * 以 (display_name, id) 做键集分页，成员加入时页面保持稳定。目录仅显示 active 成员。
 */
export async function listDirectory(db: D1Database, filter: DirectoryFilter): Promise<MemberRow[]> {
  const clauses = ["status = 'active'"];
  const params: unknown[] = [];
  if (filter.query) {
    clauses.push('(display_name LIKE ? OR major LIKE ?)');
    const like = `%${filter.query}%`;
    params.push(like, like);
  }
  if (filter.enrollmentStatus) {
    clauses.push('enrollment_status = ?');
    params.push(filter.enrollmentStatus);
  }
  if (filter.graduationYear !== null) {
    clauses.push('graduation_year = ?');
    params.push(filter.graduationYear);
  }
  if (filter.afterName !== null && filter.afterId !== null) {
    clauses.push('(display_name > ? OR (display_name = ? AND id > ?))');
    params.push(filter.afterName, filter.afterName, filter.afterId);
  }
  params.push(filter.limit);
  const sql = `SELECT * FROM members WHERE ${clauses.join(' AND ')} ORDER BY display_name, id LIMIT ?`;
  const result = await db.prepare(sql).bind(...params).all<MemberRow>();
  return result.results;
}

export async function listAllMembersForAdmin(db: D1Database): Promise<MemberRow[]> {
  const result = await db.prepare('SELECT * FROM members ORDER BY created_at DESC LIMIT 500').all<MemberRow>();
  return result.results;
}

export async function listActiveMemberEmails(db: D1Database): Promise<{ email: string; display_name: string }[]> {
  const result = await db.prepare("SELECT email, display_name FROM members WHERE status = 'active'").all<{ email: string; display_name: string }>();
  return result.results;
}
