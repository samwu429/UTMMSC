import type { EnrollmentStatus, ManualApplication } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface ApplicationRow {
  id: string;
  email: string;
  display_name: string;
  enrollment_status: EnrollmentStatus;
  graduation_year: number;
  major: string | null;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export function toApplication(row: ApplicationRow): ManualApplication {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    enrollmentStatus: row.enrollment_status,
    graduationYear: row.graduation_year,
    major: row.major,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function hasPendingApplication(db: D1Database, email: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM manual_applications WHERE email = ? AND status = 'pending'").bind(email).first<{ id: string }>();
  return row !== null;
}

export interface CreateApplicationInput {
  email: string;
  displayName: string;
  enrollmentStatus: EnrollmentStatus;
  graduationYear: number;
  major: string | null;
  note: string | null;
}

export async function createApplication(db: D1Database, input: CreateApplicationInput): Promise<string> {
  const id = randomId('app');
  await db
    .prepare(
      `INSERT INTO manual_applications (id, email, display_name, enrollment_status, graduation_year, major, note, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(id, input.email, input.displayName, input.enrollmentStatus, input.graduationYear, input.major, input.note, nowIso())
    .run();
  return id;
}

export async function listPendingApplications(db: D1Database): Promise<ApplicationRow[]> {
  const result = await db.prepare("SELECT * FROM manual_applications WHERE status = 'pending' ORDER BY created_at ASC").all<ApplicationRow>();
  return result.results;
}

export async function findApplication(db: D1Database, id: string): Promise<ApplicationRow | null> {
  return db.prepare('SELECT * FROM manual_applications WHERE id = ?').bind(id).first<ApplicationRow>();
}

export async function reviewApplication(db: D1Database, id: string, status: 'approved' | 'rejected', reviewerId: string): Promise<void> {
  await db
    .prepare("UPDATE manual_applications SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
    .bind(status, reviewerId, nowIso(), id)
    .run();
}

/** An approved application may register once with any password; the row proves identity instead of a code. */
/** 已批准的申请可凭任意密码注册一次；该记录代替验证码证明身份。 */
export async function findApprovedApplicationByEmail(db: D1Database, email: string): Promise<ApplicationRow | null> {
  return db
    .prepare("SELECT * FROM manual_applications WHERE email = ? AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1")
    .bind(email)
    .first<ApplicationRow>();
}
