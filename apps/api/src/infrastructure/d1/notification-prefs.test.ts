import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS } from '@utmmsc/shared';
import { findNotificationPrefs, listMomentsOptOut, listTimetableOptOut, updateNotificationPrefs } from './notification-prefs';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

type Schema = 'current' | 'before-0017' | 'before-0016' | 'before-0015';

/**
 * A D1 stand-in for notification_prefs at a given migration. Statements that touch a missing table or column
 * fail the way D1 does; first() answers `row` and all() answers `rows`. Every statement that ran is recorded.
 * 模拟某个迁移阶段的 notification_prefs。涉及缺失的表或列的语句会像 D1 一样报错；first() 返回 `row`，all() 返回 `rows`。
 * 记录每一条执行过的语句。
 */
function fakeDb(schema: Schema, answers: { row?: object | null; rows?: object[] } = {}) {
  const ran: { sql: string; params: unknown[] }[] = [];
  function check(sql: string) {
    if (schema === 'before-0015') throw new Error('D1_ERROR: no such table: notification_prefs: SQLITE_ERROR');
    if ((schema === 'before-0016' || schema === 'before-0017') && /\btimetable\b/.test(sql)) throw new Error('D1_ERROR: no such column: timetable: SQLITE_ERROR');
    if (schema === 'before-0016' && /\bmoments\b/.test(sql)) throw new Error('D1_ERROR: no such column: moments: SQLITE_ERROR');
  }
  const db = {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          statement.params = params;
          return statement;
        },
        async first() {
          check(sql);
          ran.push({ sql, params: statement.params });
          return answers.row ?? null;
        },
        async all() {
          check(sql);
          ran.push({ sql, params: statement.params });
          return { results: answers.rows ?? [] };
        },
      };
      return statement;
    },
  };
  return { db: db as unknown as D1Database, ran };
}

describe('findNotificationPrefs', () => {
  it('reads every switch, moments and timetable included', async () => {
    const { db } = fakeDb('current', { row: { pref_messages: 1, pref_events: 0, pref_preview: 1, pref_moments: 0, pref_timetable: 0 } });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ messages: true, events: false, preview: true, moments: false, timetable: false });
  });

  it('turns everything on for a member without a row', async () => {
    const { db } = fakeDb('current', { row: null });
    expect(await findNotificationPrefs(db, 'm1')).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('reads moments and keeps timetable on before migration 0017', async () => {
    const { db, ran } = fakeDb('before-0017', { row: { pref_messages: 1, pref_events: 1, pref_preview: 0, pref_moments: 0 } });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ messages: true, events: true, preview: false, moments: false, timetable: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.sql).not.toMatch(/timetable/);
  });

  it('reads the older switches and keeps moments and timetable on before migration 0016', async () => {
    const { db, ran } = fakeDb('before-0016', { row: { pref_messages: 0, pref_events: 1, pref_preview: 0 } });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ messages: false, events: true, preview: false, moments: true, timetable: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.sql).not.toMatch(/moments|timetable/);
  });

  it('turns everything on before migration 0015', async () => {
    const { db } = fakeDb('before-0015');
    expect(await findNotificationPrefs(db, 'm1')).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe('updateNotificationPrefs', () => {
  it('writes timetable with the other switches and binds each value twice', async () => {
    const { db, ran } = fakeDb('current', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1, pref_moments: 1, pref_timetable: 0 } });
    expect(await updateNotificationPrefs(db, 'm1', { timetable: false })).toEqual({ messages: true, events: true, preview: true, moments: true, timetable: false });
    expect(ran[0]?.sql).toMatch(/timetable = COALESCE\(\?, timetable\)/);
    expect(ran[0]?.params).toEqual(['m1', null, null, null, null, 0, expect.any(String), null, null, null, null, 0]);
  });

  it('still saves moments and the older switches before migration 0017', async () => {
    const { db, ran } = fakeDb('before-0017', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1, pref_moments: 0 } });
    expect(await updateNotificationPrefs(db, 'm1', { moments: false })).toEqual({ messages: true, events: true, preview: true, moments: false, timetable: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.params).toEqual(['m1', null, null, null, 0, expect.any(String), null, null, null, 0]);
  });

  it('still saves the older switches before migration 0016', async () => {
    const { db, ran } = fakeDb('before-0016', { row: { pref_messages: 0, pref_events: 1, pref_preview: 1 } });
    expect(await updateNotificationPrefs(db, 'm1', { messages: false })).toEqual({ messages: false, events: true, preview: true, moments: true, timetable: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.params).toEqual(['m1', 0, null, null, expect.any(String), 0, null, null]);
  });

  it('refuses a change to a switch the database lacks, without writing anything', async () => {
    const before0017 = fakeDb('before-0017', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1, pref_moments: 1 } });
    await expect(updateNotificationPrefs(before0017.db, 'm1', { timetable: false, messages: false })).rejects.toThrow(/no such column/);
    expect(before0017.ran).toHaveLength(0);
    const before0016 = fakeDb('before-0016', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1 } });
    await expect(updateNotificationPrefs(before0016.db, 'm1', { moments: false, messages: false })).rejects.toThrow(/no such column/);
    await expect(updateNotificationPrefs(before0016.db, 'm1', { timetable: false })).rejects.toThrow(/no such column/);
    expect(before0016.ran).toHaveLength(0);
  });

  it('fails before migration 0015, so the route can answer that push is not ready', async () => {
    const { db } = fakeDb('before-0015');
    await expect(updateNotificationPrefs(db, 'm1', { messages: false })).rejects.toThrow(/no such table/);
  });
});

describe('opt-out lists', () => {
  it('returns the members who turned moments off, querying at most 90 ids at a time', async () => {
    const { db, ran } = fakeDb('current', { rows: [{ member_id: 'm3' }] });
    const ids = Array.from({ length: 95 }, (_, index) => `m${index}`);
    const off = await listMomentsOptOut(db, [...ids, 'm3']);
    expect([...off]).toEqual(['m3']);
    expect(ran.map((statement) => statement.params.length)).toEqual([90, 5]);
    expect(ran[0]?.sql).toMatch(/moments = 0/);
  });

  it('returns the members who turned 课表提醒 off the same way', async () => {
    const { db, ran } = fakeDb('current', { rows: [{ member_id: 'm7' }] });
    const off = await listTimetableOptOut(db, Array.from({ length: 91 }, (_, index) => `m${index}`));
    expect([...off]).toEqual(['m7']);
    expect(ran.map((statement) => statement.params.length)).toEqual([90, 1]);
    expect(ran[0]?.sql).toMatch(/WHERE timetable = 0 AND member_id IN/);
  });

  it('asks nothing for no members', async () => {
    const { db, ran } = fakeDb('current');
    expect((await listMomentsOptOut(db, [])).size).toBe(0);
    expect((await listTimetableOptOut(db, [])).size).toBe(0);
    expect(ran).toHaveLength(0);
  });

  it('treats everyone as on before the column exists', async () => {
    expect((await listMomentsOptOut(fakeDb('before-0016').db, ['m1'])).size).toBe(0);
    expect((await listMomentsOptOut(fakeDb('before-0015').db, ['m1'])).size).toBe(0);
    expect((await listTimetableOptOut(fakeDb('before-0017').db, ['m1'])).size).toBe(0);
    expect((await listTimetableOptOut(fakeDb('before-0016').db, ['m1'])).size).toBe(0);
    expect((await listTimetableOptOut(fakeDb('before-0015').db, ['m1'])).size).toBe(0);
  });
});

describe.skipIf(!sqlite)('notification prefs on real SQLite at each migration', () => {
  let d1: SqliteD1 | null = null;

  afterEach(() => {
    d1?.close();
    d1 = null;
  });

  function at(migration: number): SqliteD1 {
    d1 = createSqliteD1({ migrate: false });
    d1.migrate({ to: migration });
    d1.exec(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES ('m1', 'a@x', 'A', 'h', 'active', 'student', 'student', 2026, '2026-01-01', '2026-01-01')",
    );
    return d1;
  }

  it('reads and writes all five switches after 0017, and a new row defaults timetable on', async () => {
    const { db, rows } = at(Number.POSITIVE_INFINITY);
    expect(await updateNotificationPrefs(db, 'm1', { messages: false })).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, messages: false });
    expect(await updateNotificationPrefs(db, 'm1', { timetable: false })).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, messages: false, timetable: false });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, messages: false, timetable: false });
    expect([...(await listTimetableOptOut(db, ['m1', 'm2']))]).toEqual(['m1']);
    expect([...(await listMomentsOptOut(db, ['m1']))]).toEqual([]);
    expect(rows('SELECT timetable FROM notification_prefs')).toEqual([{ timetable: 0 }]);
  });

  it('falls back to the 0016 switches before 0017 and refuses a timetable change', async () => {
    const { db } = at(16);
    expect(await updateNotificationPrefs(db, 'm1', { moments: false })).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, moments: false });
    await expect(updateNotificationPrefs(db, 'm1', { timetable: false })).rejects.toThrow(/has no column named timetable/);
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, moments: false });
    expect((await listTimetableOptOut(db, ['m1'])).size).toBe(0);
  });

  it('falls back to the first three switches before 0016', async () => {
    const { db } = at(15);
    expect(await updateNotificationPrefs(db, 'm1', { events: false })).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, events: false });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, events: false });
  });

  it('keeps a row saved before 0017 and turns timetable on for it', async () => {
    const early = at(16);
    await updateNotificationPrefs(early.db, 'm1', { preview: false });
    early.migrate({ from: 17 });
    expect(await findNotificationPrefs(early.db, 'm1')).toEqual({ ...DEFAULT_NOTIFICATION_PREFS, preview: false });
  });
});
