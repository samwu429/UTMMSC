import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export interface EnrollmentYearRequestRow {
  id: string;
  member_id: string;
  requested_year: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  created_at: string;
  reviewed_at: string | null;
  reviewer_id: string | null;
  display_name: string;
  email: string;
  graduation_year: number;
}

export async function findPendingYearRequest(db: D1Database, memberId: string): Promise<EnrollmentYearRequestRow | null> {
  return db
    .prepare(
      `SELECT r.id, r.member_id, r.requested_year, r.status, r.created_at, r.reviewed_at, r.reviewer_id,
              m.display_name, m.email, m.graduation_year
       FROM enrollment_year_requests r
       JOIN members m ON m.id = r.member_id
       WHERE r.member_id = ? AND r.status = 'pending'`,
    )
    .bind(memberId)
    .first<EnrollmentYearRequestRow>();
}

export async function listPendingYearRequests(db: D1Database): Promise<EnrollmentYearRequestRow[]> {
  const result = await db
    .prepare(
      `SELECT r.id, r.member_id, r.requested_year, r.status, r.created_at, r.reviewed_at, r.reviewer_id,
              m.display_name, m.email, m.graduation_year
       FROM enrollment_year_requests r
       JOIN members m ON m.id = r.member_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at`,
    )
    .all<EnrollmentYearRequestRow>();
  return result.results;
}

export async function savePendingYearRequest(db: D1Database, memberId: string, year: number): Promise<EnrollmentYearRequestRow> {
  const existing = await findPendingYearRequest(db, memberId);
  const ts = nowIso();
  if (existing) {
    await db.prepare('UPDATE enrollment_year_requests SET requested_year = ?, created_at = ? WHERE id = ?').bind(year, ts, existing.id).run();
  } else {
    await db
      .prepare(
        `INSERT INTO enrollment_year_requests (id, member_id, requested_year, status, created_at)
         VALUES (?, ?, ?, 'pending', ?)`,
      )
      .bind(randomId('eyr'), memberId, year, ts)
      .run();
  }
  const saved = await findPendingYearRequest(db, memberId);
  if (!saved) throw new Error('enrollment year request did not persist');
  return saved;
}

export async function cancelPendingYearRequest(db: D1Database, memberId: string): Promise<void> {
  await db
    .prepare(`UPDATE enrollment_year_requests SET status = 'cancelled', reviewed_at = ? WHERE member_id = ? AND status = 'pending'`)
    .bind(nowIso(), memberId)
    .run();
}

export async function findYearRequest(db: D1Database, id: string): Promise<EnrollmentYearRequestRow | null> {
  return db
    .prepare(
      `SELECT r.id, r.member_id, r.requested_year, r.status, r.created_at, r.reviewed_at, r.reviewer_id,
              m.display_name, m.email, m.graduation_year
       FROM enrollment_year_requests r
       JOIN members m ON m.id = r.member_id
       WHERE r.id = ?`,
    )
    .bind(id)
    .first<EnrollmentYearRequestRow>();
}

export async function reviewYearRequest(db: D1Database, id: string, status: 'approved' | 'rejected', reviewerId: string): Promise<void> {
  await db
    .prepare(`UPDATE enrollment_year_requests SET status = ?, reviewed_at = ?, reviewer_id = ? WHERE id = ? AND status = 'pending'`)
    .bind(status, nowIso(), reviewerId, id)
    .run();
}
