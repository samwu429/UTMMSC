import { OPEN_TO, ROLES, enrollmentCalendarYear, shouldGraduate, type EnrollmentStatus, type MemberProfile, type MemberSelf, type MemberStatus, type OpenTo, type Role } from '@utmmsc/shared';
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
  headline: string | null;
  about: string | null;
  location: string | null;
  skills: string | null;
  open_to: string | null;
  avatar_key: string | null;
  cover_key: string | null;
  acting_role: string | null;
  created_at: string;
  updated_at: string;
}

function stringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function openToList(raw: string | null): OpenTo[] {
  return stringList(raw).filter((item): item is OpenTo => (OPEN_TO as readonly string[]).includes(item));
}

export function viewedRole(row: Pick<MemberRow, 'role' | 'acting_role'>): Role {
  const acting = row.acting_role;
  if (row.role === 'superadmin' && acting && acting !== 'superadmin' && (ROLES as readonly string[]).includes(acting)) {
    return acting as Role;
  }
  return row.role;
}

export function toProfile(row: MemberRow): MemberProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    role: row.role,
    enrollmentStatus: row.enrollment_status,
    graduationYear: row.graduation_year,
    major: row.major,
    headline: row.headline,
    about: row.about,
    location: row.location,
    skills: stringList(row.skills),
    openTo: openToList(row.open_to),
    avatarKey: row.avatar_key ?? null,
    coverKey: row.cover_key ?? null,
  };
}

export function toSelf(row: MemberRow): MemberSelf {
  const acting = row.acting_role && row.acting_role !== 'superadmin' && (ROLES as readonly string[]).includes(row.acting_role) ? (row.acting_role as Role) : null;
  return {
    ...toProfile(row),
    role: viewedRole(row),
    realRole: row.role,
    actingRole: row.role === 'superadmin' ? acting : null,
    email: row.email,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function findMemberByEmail(db: D1Database, email: string): Promise<MemberRow | null> {
  return db.prepare('SELECT * FROM members WHERE email = ?').bind(email).first<MemberRow>();
}

export async function findMemberById(db: D1Database, id: string): Promise<MemberRow | null> {
  return db.prepare('SELECT * FROM members WHERE id = ?').bind(id).first<MemberRow>();
}

export interface AuthorCard {
  displayName: string;
  avatarKey: string | null;
}

/** Current name and avatar for a set of members, in batches that stay under D1's bound-parameter limit. */
/** 一组成员当前的名字与头像，分批查询以不超过 D1 的参数个数上限。 */
export async function findAuthorCards(db: D1Database, ids: string[]): Promise<Map<string, AuthorCard>> {
  const cards = new Map<string, AuthorCard>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 90) {
    const slice = unique.slice(i, i + 90);
    const result = await db
      .prepare(`SELECT id, display_name, avatar_key FROM members WHERE id IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .all<{ id: string; display_name: string; avatar_key: string | null }>();
    for (const row of result.results) cards.set(row.id, { displayName: row.display_name, avatarKey: row.avatar_key });
  }
  return cards;
}

/** The fields that decide which channels a member can read. */
/** 决定成员能阅读哪些频道的字段。 */
export type MemberAccessRow = Pick<MemberRow, 'id' | 'role' | 'acting_role' | 'enrollment_status' | 'created_at'>;

export async function findMemberAccessRows(db: D1Database, ids: string[]): Promise<MemberAccessRow[]> {
  const rows: MemberAccessRow[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 90) {
    const slice = unique.slice(i, i + 90);
    const result = await db
      .prepare(`SELECT id, role, acting_role, enrollment_status, created_at FROM members WHERE id IN (${slice.map(() => '?').join(', ')})`)
      .bind(...slice)
      .all<MemberAccessRow>();
    rows.push(...result.results);
  }
  return rows;
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

export async function updateActingRole(db: D1Database, memberId: string, actingRole: Role | null): Promise<void> {
  await db.prepare('UPDATE members SET acting_role = ?, updated_at = ? WHERE id = ?').bind(actingRole, nowIso(), memberId).run();
}

/** Writes alumni for every student whose enrollment year is five or more years ago. */
/** 把入学已满五年的在校生写成毕业生。 */
export async function graduateDueMembers(db: D1Database, now: Date = new Date()): Promise<void> {
  await db
    .prepare(
      `UPDATE members
       SET enrollment_status = 'alumni',
           role = CASE WHEN role = 'student' THEN 'alumni' ELSE role END,
           updated_at = ?
       WHERE enrollment_status = 'student'
         AND graduation_year <= ?`,
    )
    .bind(nowIso(), enrollmentCalendarYear(now) - 5)
    .run();
}

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;
let lastSweepAt = 0;

/**
 * Runs the full-table graduation sweep at most once an hour per isolate, so ordinary requests do
 * not each pay for a write. The member making the request is settled individually.
 * 每个隔离实例每小时最多做一次全表毕业处理，普通请求不必每次都写库。发起请求的成员单独处理。
 */
export async function sweepGraduations(db: D1Database, now: Date = new Date()): Promise<void> {
  if (now.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now.getTime();
  await graduateDueMembers(db, now);
}

/** Graduates this member if due and returns the row with that change applied. */
/** 若该成员已满五年则写成毕业生，并返回更新后的行。 */
export async function settleEnrollment(db: D1Database, member: MemberRow, now: Date = new Date()): Promise<MemberRow> {
  if (!shouldGraduate(member.graduation_year, member.enrollment_status, now)) return member;
  await markGraduated(db, member.id);
  return {
    ...member,
    enrollment_status: 'alumni',
    role: member.role === 'student' ? 'alumni' : member.role,
  };
}

export async function markGraduated(db: D1Database, memberId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE members
       SET enrollment_status = 'alumni',
           role = CASE WHEN role = 'student' THEN 'alumni' ELSE role END,
           updated_at = ?
       WHERE id = ? AND enrollment_status = 'student'`,
    )
    .bind(nowIso(), memberId)
    .run();
}

/** System admin correction. A year that is already five years old forces alumni. */
/** 系统管理员更正。入学已满五年时，状态固定为毕业生。 */
export async function correctEnrollment(db: D1Database, member: MemberRow, year: number, status: EnrollmentStatus): Promise<void> {
  const nextStatus: EnrollmentStatus = shouldGraduate(year, 'student') ? 'alumni' : status;
  const nextRole: Role =
    member.role === 'student' && nextStatus === 'alumni'
      ? 'alumni'
      : member.role === 'alumni' && nextStatus === 'student'
        ? 'student'
        : member.role;
  await db
    .prepare('UPDATE members SET graduation_year = ?, enrollment_status = ?, role = ?, updated_at = ? WHERE id = ?')
    .bind(year, nextStatus, nextRole, nowIso(), member.id)
    .run();
}

export async function officeHolderExists(db: D1Database, role: string, exceptId: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM members WHERE role = ? AND id != ? AND status = 'active' LIMIT 1").bind(role, exceptId).first<{ id: string }>();
  return Boolean(row);
}

export interface ProfileUpdate {
  headline?: string | null;
  about?: string | null;
  location?: string | null;
  major?: string | null;
  skills?: string[];
  openTo?: OpenTo[];
}

export async function updateAvatarKey(db: D1Database, memberId: string, avatarKey: string | null): Promise<void> {
  await db.prepare('UPDATE members SET avatar_key = ?, updated_at = ? WHERE id = ?').bind(avatarKey, nowIso(), memberId).run();
}

export async function updateCoverKey(db: D1Database, memberId: string, coverKey: string | null): Promise<void> {
  await db.prepare('UPDATE members SET cover_key = ?, updated_at = ? WHERE id = ?').bind(coverKey, nowIso(), memberId).run();
}

export async function updateProfile(db: D1Database, memberId: string, patch: ProfileUpdate): Promise<void> {
  const sets = ['updated_at = ?'];
  const params: unknown[] = [nowIso()];
  if (patch.headline !== undefined) {
    sets.push('headline = ?');
    params.push(patch.headline);
  }
  if (patch.about !== undefined) {
    sets.push('about = ?');
    params.push(patch.about);
  }
  if (patch.location !== undefined) {
    sets.push('location = ?');
    params.push(patch.location);
  }
  if (patch.major !== undefined) {
    sets.push('major = ?');
    params.push(patch.major);
  }
  if (patch.skills !== undefined) {
    sets.push('skills = ?');
    params.push(JSON.stringify(patch.skills));
  }
  if (patch.openTo !== undefined) {
    sets.push('open_to = ?');
    params.push(JSON.stringify(patch.openTo));
  }
  params.push(memberId);
  await db.prepare(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();
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
    clauses.push("(display_name LIKE ? OR IFNULL(major, '') LIKE ? OR IFNULL(headline, '') LIKE ? OR IFNULL(location, '') LIKE ? OR IFNULL(skills, '') LIKE ?)");
    const like = `%${filter.query}%`;
    params.push(like, like, like, like, like);
  }
  if (filter.enrollmentStatus) {
    clauses.push('enrollment_status = ?');
    params.push(filter.enrollmentStatus);
    clauses.push("role != 'honorary_external'");
  }
  if (filter.graduationYear !== null) {
    clauses.push('graduation_year = ?');
    params.push(filter.graduationYear);
    if (!filter.enrollmentStatus) clauses.push("role != 'honorary_external'");
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
