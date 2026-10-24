import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS } from '@utmmsc/shared';
import { findNotificationPrefs, listMomentsOptOut, updateNotificationPrefs } from './notification-prefs';

type Schema = 'current' | 'before-0016' | 'before-0015';

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
  it('reads every switch, moments included', async () => {
    const { db } = fakeDb('current', { row: { pref_messages: 1, pref_events: 0, pref_preview: 1, pref_moments: 0 } });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ messages: true, events: false, preview: true, moments: false });
  });

  it('turns everything on for a member without a row', async () => {
    const { db } = fakeDb('current', { row: null });
    expect(await findNotificationPrefs(db, 'm1')).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });

  it('reads the older switches and keeps moments on before migration 0016', async () => {
    const { db, ran } = fakeDb('before-0016', { row: { pref_messages: 0, pref_events: 1, pref_preview: 0 } });
    expect(await findNotificationPrefs(db, 'm1')).toEqual({ messages: false, events: true, preview: false, moments: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.sql).not.toMatch(/moments/);
  });

  it('turns everything on before migration 0015', async () => {
    const { db } = fakeDb('before-0015');
    expect(await findNotificationPrefs(db, 'm1')).toEqual(DEFAULT_NOTIFICATION_PREFS);
  });
});

describe('updateNotificationPrefs', () => {
  it('writes moments with the other switches and binds each value twice', async () => {
    const { db, ran } = fakeDb('current', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1, pref_moments: 0 } });
    expect(await updateNotificationPrefs(db, 'm1', { moments: false })).toEqual({ messages: true, events: true, preview: true, moments: false });
    expect(ran[0]?.sql).toMatch(/moments = COALESCE\(\?, moments\)/);
    expect(ran[0]?.params).toEqual(['m1', null, null, null, 0, expect.any(String), null, null, null, 0]);
  });

  it('still saves the older switches before migration 0016', async () => {
    const { db, ran } = fakeDb('before-0016', { row: { pref_messages: 0, pref_events: 1, pref_preview: 1 } });
    expect(await updateNotificationPrefs(db, 'm1', { messages: false })).toEqual({ messages: false, events: true, preview: true, moments: true });
    expect(ran).toHaveLength(1);
    expect(ran[0]?.params).toEqual(['m1', 0, null, null, expect.any(String), 0, null, null]);
  });

  it('refuses a change to moments before migration 0016 without writing anything', async () => {
    const { db, ran } = fakeDb('before-0016', { row: { pref_messages: 1, pref_events: 1, pref_preview: 1 } });
    await expect(updateNotificationPrefs(db, 'm1', { moments: false, messages: false })).rejects.toThrow(/no such column/);
    expect(ran).toHaveLength(0);
  });

  it('fails before migration 0015, so the route can answer that push is not ready', async () => {
    const { db } = fakeDb('before-0015');
    await expect(updateNotificationPrefs(db, 'm1', { messages: false })).rejects.toThrow(/no such table/);
  });
});

describe('listMomentsOptOut', () => {
  it('returns the members who turned moments off, querying at most 90 ids at a time', async () => {
    const { db, ran } = fakeDb('current', { rows: [{ member_id: 'm3' }] });
    const ids = Array.from({ length: 95 }, (_, index) => `m${index}`);
    const off = await listMomentsOptOut(db, [...ids, 'm3']);
    expect([...off]).toEqual(['m3']);
    expect(ran.map((statement) => statement.params.length)).toEqual([90, 5]);
    expect(ran[0]?.sql).toMatch(/moments = 0/);
  });

  it('asks nothing for no members', async () => {
    const { db, ran } = fakeDb('current');
    expect((await listMomentsOptOut(db, [])).size).toBe(0);
    expect(ran).toHaveLength(0);
  });

  it('treats everyone as on before migration 0016 and before 0015', async () => {
    expect((await listMomentsOptOut(fakeDb('before-0016').db, ['m1'])).size).toBe(0);
    expect((await listMomentsOptOut(fakeDb('before-0015').db, ['m1'])).size).toBe(0);
  });
});
