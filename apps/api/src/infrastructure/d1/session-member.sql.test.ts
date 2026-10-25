import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findLiveSessionMember } from './session-member';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

const NOW = '2026-10-24T12:00:00.000Z';
const LATER = '2026-11-24T12:00:00.000Z';
const EARLIER = '2026-10-01T12:00:00.000Z';

describe.skipIf(!sqlite)('findLiveSessionMember', () => {
  let d1: SqliteD1;

  beforeEach(() => {
    d1 = createSqliteD1();
    for (const [id, status] of [
      ['mem_ann', 'active'],
      ['mem_bob', 'disabled'],
    ]) {
      d1.rows(
        "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, ?, 'x', ?, 'student', 'student', 2025, ?, ?)",
        id,
        `${id}@mail.utoronto.ca`,
        id === 'mem_ann' ? 'Ann' : 'Bob',
        status,
        EARLIER,
        EARLIER,
      );
    }
    const session = (id: string, memberId: string, expiresAt: string, revokedAt: string | null = null) =>
      d1.rows('INSERT INTO sessions (id, member_id, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?)', id, memberId, expiresAt, EARLIER, revokedAt);
    session('ses_live', 'mem_ann', LATER);
    session('ses_revoked', 'mem_ann', LATER, EARLIER);
    session('ses_expired', 'mem_ann', NOW);
    session('ses_bob', 'mem_bob', LATER);
  });
  afterEach(() => d1.close());

  it('returns the member of a live session in one query', async () => {
    d1.statements.length = 0;
    const live = await findLiveSessionMember(d1.db, 'ses_live', 'mem_ann', NOW);
    expect(live?.member).toMatchObject({ id: 'mem_ann', display_name: 'Ann', status: 'active', role: 'student' });
    expect(d1.statements).toHaveLength(1);
  });

  it('finds both rows by primary key', async () => {
    d1.statements.length = 0;
    await findLiveSessionMember(d1.db, 'ses_live', 'mem_ann', NOW);
    const plan = d1.explain(d1.statements[0]!).join('\n');
    expect(plan).toMatch(/SEARCH s USING INDEX sqlite_autoindex_sessions_1 \(id=\?\)/);
    expect(plan).toMatch(/SEARCH m USING INDEX sqlite_autoindex_members_1 \(id=\?\)/);
    expect(plan).not.toMatch(/SCAN/);
  });

  it('is null for a revoked, expired or unknown session, and for a session of another member', async () => {
    expect(await findLiveSessionMember(d1.db, 'ses_revoked', 'mem_ann', NOW)).toBeNull();
    expect(await findLiveSessionMember(d1.db, 'ses_expired', 'mem_ann', NOW)).toBeNull();
    expect(await findLiveSessionMember(d1.db, 'ses_nope', 'mem_ann', NOW)).toBeNull();
    expect(await findLiveSessionMember(d1.db, 'ses_live', 'mem_bob', NOW)).toBeNull();
  });

  it('returns a disabled member as stored, for the caller to refuse', async () => {
    expect((await findLiveSessionMember(d1.db, 'ses_bob', 'mem_bob', NOW))?.member?.status).toBe('disabled');
  });

  it('tells a live session whose member row is gone apart from no session', async () => {
    d1.exec('PRAGMA foreign_keys = OFF');
    d1.rows("DELETE FROM members WHERE id = 'mem_ann'");
    expect(await findLiveSessionMember(d1.db, 'ses_live', 'mem_ann', NOW)).toEqual({ member: null });
  });

  it('checks the current time by default', async () => {
    expect((await findLiveSessionMember(d1.db, 'ses_live', 'mem_ann'))?.member?.id).toBe('mem_ann');
  });
});
