import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteD1, migrationFiles, sqlite, type SqliteD1 } from './testing/sqlite-d1';

/**
 * Migrations 0017 (timetable), 0018 (channel icons) and 0019 (stickers) on real SQLite: they apply on top of a
 * database that already has rows, keep those rows, and enforce what their tables promise. Store and route tests cover
 * the queries.
 * 迁移 0017（课表）、0018（频道图标）和 0019（表情）在真实 SQLite 上的检查：它们能在已有数据的数据库上执行、保留已有的行，
 * 并保证表所承诺的约束。查询本身由各存储和接口的测试覆盖。
 */

const NOW = '2026-10-24T16:00:00.000Z';

function member(d1: SqliteD1, id: string): void {
  d1.rows(
    "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES (?, ?, 'A', 'h', 'active', 'student', 'student', 2026, ?, ?)",
    id,
    `${id}@mail.utoronto.ca`,
    NOW,
    NOW,
  );
}

function count(d1: SqliteD1, sql: string, ...params: unknown[]): number {
  return Number(d1.rows<{ n: number }>(sql, ...params)[0]?.n ?? 0);
}

describe.skipIf(!sqlite)('migrations 0017 to 0019', () => {
  it('follow 0016 in order, with no number used twice', () => {
    const files = migrationFiles();
    const names = files.map((migration) => migration.name);
    expect(names.indexOf('0017_timetable.sql')).toBe(names.indexOf('0016_moments.sql') + 1);
    expect(names.indexOf('0018_channel_icons.sql')).toBe(names.indexOf('0017_timetable.sql') + 1);
    expect(names.indexOf('0019_stickers.sql')).toBe(names.indexOf('0018_channel_icons.sql') + 1);
    expect(files.map((migration) => migration.number)).toEqual(files.map((_, index) => index + 1));
  });

  it('apply on top of 0016 and keep the rows already there', () => {
    const d1 = createSqliteD1({ migrate: false });
    try {
      d1.migrate({ to: 16 });
      member(d1, 'm1');
      d1.rows("INSERT INTO notification_prefs (member_id, messages, events, preview, moments, updated_at) VALUES ('m1', 0, 1, 1, 0, ?)", NOW);
      d1.rows("INSERT INTO channels (id, slug, name, audience, post_policy, created_at) VALUES ('ch_1', 'general', 'General', 'all', 'members', ?)", NOW);
      d1.migrate({ from: 17 });
      expect(d1.rows('SELECT messages, moments, timetable FROM notification_prefs')).toEqual([{ messages: 0, moments: 0, timetable: 1 }]);
      expect(d1.rows("SELECT name, icon_key, icon_updated_at FROM channels WHERE id = 'ch_1'")).toEqual([{ name: 'General', icon_key: null, icon_updated_at: null }]);
      expect(count(d1, 'SELECT count(*) AS n FROM channels WHERE icon_key IS NOT NULL OR icon_updated_at IS NOT NULL')).toBe(0);
      const tables = d1.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'timetable_%' ORDER BY name").map((row) => row.name);
      expect(tables).toEqual(['timetable_assignments', 'timetable_courses', 'timetable_meetings', 'timetable_reminders', 'timetable_settings', 'timetable_skips', 'timetable_terms']);
    } finally {
      d1.close();
    }
  });

  describe('constraints', () => {
    let d1: SqliteD1;

    beforeEach(() => {
      d1 = createSqliteD1();
      member(d1, 'm1');
      member(d1, 'm2');
      d1.rows("INSERT INTO timetable_terms (id, member_id, name, starts_on, ends_on, created_at, updated_at) VALUES ('tt_1', 'm1', 'Fall', '2026-09-03', '2026-12-02', ?, ?)", NOW, NOW);
      d1.rows("INSERT INTO timetable_courses (id, member_id, term_id, code, color, created_at, updated_at) VALUES ('tc_1', 'm1', 'tt_1', 'MAT102H5F', 'purple', ?, ?)", NOW, NOW);
    });

    afterEach(() => {
      d1.close();
    });

    const meeting = (id: string, weekday: number, start: number, end: number, rule = 'all', list: string | null = null) =>
      d1.rows(
        'INSERT INTO timetable_meetings (id, course_id, member_id, weekday, start_min, end_min, week_rule, week_list, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        'tc_1',
        'm1',
        weekday,
        start,
        end,
        rule,
        list,
        NOW,
        NOW,
      );

    it('gives a settings row the documented defaults and refuses other values', () => {
      d1.rows("INSERT INTO timetable_settings (member_id, updated_at) VALUES ('m1', ?)", NOW);
      expect(d1.rows('SELECT rev, class_reminders, class_lead_min, assignment_offsets, show_weekend, locale FROM timetable_settings')).toEqual([
        { rev: 0, class_reminders: 0, class_lead_min: 10, assignment_offsets: '["1d","1h"]', show_weekend: 'always', locale: 'zh' },
      ]);
      expect(() => d1.rows("UPDATE timetable_settings SET class_lead_min = 25 WHERE member_id = 'm1'")).toThrow(/CHECK constraint/);
      expect(() => d1.rows("UPDATE timetable_settings SET assignment_offsets = '{}' WHERE member_id = 'm1'")).toThrow(/CHECK constraint/);
      expect(() => d1.rows("UPDATE timetable_settings SET locale = 'fr' WHERE member_id = 'm1'")).toThrow(/CHECK constraint/);
    });

    it('keeps meetings on 5-minute steps inside the day, ending after they start, with a list only for list weeks', () => {
      expect(() => meeting('tm_a', 1, 542, 600)).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 8, 540, 600)).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 1, 600, 600)).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 1, 600, 1445)).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 1, 600, 660, 'list', null)).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 1, 600, 660, 'all', '[1]')).toThrow(/CHECK constraint/);
      expect(() => meeting('tm_a', 1, 600, 660, 'list', '{"a":1}')).toThrow(/CHECK constraint/);
      meeting('tm_a', 1, 600, 660);
      meeting('tm_b', 3, 540, 590, 'list', '[1,3]');
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_meetings')).toBe(2);
    });

    it('keeps one holiday and one single skip per date, so a repeat is ignored', () => {
      meeting('tm_a', 1, 600, 660);
      const skip = 'INSERT INTO timetable_skips (member_id, on_date, meeting_id, label, created_at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT DO NOTHING';
      d1.rows(skip, 'm1', '2026-10-12', null, NOW);
      d1.rows(skip, 'm1', '2026-10-12', null, NOW);
      d1.rows(skip, 'm1', '2026-10-12', 'tm_a', NOW);
      d1.rows(skip, 'm1', '2026-10-12', 'tm_a', NOW);
      d1.rows(skip, 'm2', '2026-10-12', null, NOW);
      expect(count(d1, "SELECT count(*) AS n FROM timetable_skips WHERE member_id = 'm1'")).toBe(2);
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_skips')).toBe(3);
    });

    it('claims a class occurrence once, and ties each reminder row to exactly one source', () => {
      meeting('tm_a', 1, 600, 660);
      const claim =
        "INSERT INTO timetable_reminders (member_id, kind, meeting_id, occurs_at, offset_key, send_at, expires_at, status, attempts, claimed_at, created_at) VALUES ('m1', 'class', 'tm_a', ?, '10m', ?, ?, 'sending', 1, ?, ?) ON CONFLICT DO NOTHING RETURNING id";
      expect(d1.rows(claim, '2026-10-26T14:00:00.000Z', '2026-10-26T13:50:00.000Z', '2026-10-26T14:00:00.000Z', NOW, NOW)).toHaveLength(1);
      expect(d1.rows(claim, '2026-10-26T14:00:00.000Z', '2026-10-26T13:40:00.000Z', '2026-10-26T14:00:00.000Z', NOW, NOW)).toHaveLength(0);
      expect(d1.rows(claim, '2026-10-26T14:30:00.000Z', '2026-10-26T14:20:00.000Z', '2026-10-26T14:30:00.000Z', NOW, NOW)).toHaveLength(1);
      expect(() =>
        d1.rows(
          "INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, created_at) VALUES ('m1', 'class', NULL, 'x', 'x', 'x', 'x', ?) ON CONFLICT DO NOTHING",
          NOW,
        ),
      ).toThrow(/CHECK constraint/);
      expect(() => d1.rows("UPDATE timetable_reminders SET status = 'lost'")).toThrow(/CHECK constraint/);
    });

    it('cascades a course delete to meetings, single skips and class reminders, and keeps its assignments', () => {
      meeting('tm_a', 1, 600, 660);
      d1.rows("INSERT INTO timetable_skips (member_id, on_date, meeting_id, created_at) VALUES ('m1', '2026-10-12', NULL, ?), ('m1', '2026-10-19', 'tm_a', ?)", NOW, NOW);
      d1.rows(
        "INSERT INTO timetable_reminders (member_id, kind, meeting_id, occurs_at, offset_key, send_at, expires_at, created_at) VALUES ('m1', 'class', 'tm_a', '2026-10-26T14:00:00.000Z', '10m', '2026-10-26T13:50:00.000Z', '2026-10-26T14:00:00.000Z', ?)",
        NOW,
      );
      d1.rows("INSERT INTO timetable_assignments (id, member_id, course_id, title, due_at, remind_offsets, created_at, updated_at) VALUES ('ta_1', 'm1', 'tc_1', 'PS3', '2026-10-31T03:59:00.000Z', '[\"1d\"]', ?, ?)", NOW, NOW);
      d1.rows(
        "INSERT INTO timetable_reminders (member_id, kind, assignment_id, occurs_at, offset_key, send_at, expires_at, created_at) VALUES ('m1', 'assignment', 'ta_1', '2026-10-31T03:59:00.000Z', '1d', '2026-10-30T03:59:00.000Z', '2026-10-31T03:59:00.000Z', ?)",
        NOW,
      );
      d1.rows("DELETE FROM timetable_courses WHERE id = 'tc_1'");
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_meetings')).toBe(0);
      expect(d1.rows('SELECT on_date, meeting_id FROM timetable_skips')).toEqual([{ on_date: '2026-10-12', meeting_id: null }]);
      expect(d1.rows('SELECT kind FROM timetable_reminders')).toEqual([{ kind: 'assignment' }]);
      expect(d1.rows('SELECT course_id FROM timetable_assignments')).toEqual([{ course_id: null }]);
    });

    it('cascades a term delete to its courses and a member delete to everything', () => {
      meeting('tm_a', 1, 600, 660);
      d1.rows("DELETE FROM timetable_terms WHERE id = 'tt_1'");
      expect(count(d1, 'SELECT count(*) AS n FROM timetable_courses')).toBe(0);
      d1.rows("INSERT INTO timetable_settings (member_id, updated_at) VALUES ('m1', ?)", NOW);
      d1.rows("INSERT INTO timetable_assignments (id, member_id, title, due_at, created_at, updated_at) VALUES ('ta_1', 'm1', 'PS3', '2026-10-31T03:59:00.000Z', ?, ?)", NOW, NOW);
      d1.rows("DELETE FROM members WHERE id = 'm1'");
      for (const table of ['timetable_settings', 'timetable_terms', 'timetable_courses', 'timetable_meetings', 'timetable_skips', 'timetable_assignments', 'timetable_reminders']) {
        expect(count(d1, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
      }
    });

    it('stores a channel icon only as an upload key or a preset', () => {
      d1.rows("INSERT INTO channels (id, slug, name, audience, post_policy, created_at) VALUES ('ch_1', 'general', 'General', 'all', 'members', ?)", NOW);
      d1.rows("UPDATE channels SET icon_key = 'channel-icon/ch_1/cic_0123456789abcdEF.webp', icon_updated_at = ? WHERE id = 'ch_1'", NOW);
      d1.rows("UPDATE channels SET icon_key = 'preset:announce' WHERE id = 'ch_1'");
      d1.rows("UPDATE channels SET icon_key = NULL WHERE id = 'ch_1'");
      expect(() => d1.rows("UPDATE channels SET icon_key = 'avatar/m1/ava_x.jpg' WHERE id = 'ch_1'")).toThrow(/CHECK constraint/);
      expect(() => d1.rows("UPDATE channels SET icon_key = 'https://example.com/x.png' WHERE id = 'ch_1'")).toThrow(/CHECK constraint/);
    });
  });
});

describe.skipIf(!sqlite)('migration 0019 (stickers)', () => {
  const STICKER = 'stk_0123456789abcdefghijkl';
  const OTHER = 'stk_lkjihgfedcba9876543210';

  const object = (d1: SqliteD1, id: string, createdBy: string | null, fields: Record<string, unknown> = {}) => {
    const row = { type: 'gif', width: 240, height: 240, bytes: 1000, animated: 1, state: 'ready', ...fields };
    d1.rows(
      'INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      row.type,
      row.width,
      row.height,
      row.bytes,
      row.animated,
      row.state,
      createdBy,
      NOW,
    );
  };
  const collect = (d1: SqliteD1, memberId: string, stickerId: string, position: number) =>
    d1.rows("INSERT INTO member_stickers (member_id, sticker_id, thumb, position, added_at) VALUES (?, ?, 'AbCdEfGhIjKlMnOpQrStUv', ?, ?)", memberId, stickerId, position, NOW);

  it('applies on top of 0018, keeps the rows already there and starts empty', () => {
    const d1 = createSqliteD1({ migrate: false });
    try {
      d1.migrate({ to: 18 });
      member(d1, 'm1');
      d1.rows("INSERT INTO channels (id, slug, name, audience, post_policy, created_at, icon_key) VALUES ('ch_1', 'general', 'General', 'all', 'members', ?, 'preset:chat')", NOW);
      d1.migrate({ from: 19 });
      expect(d1.rows('SELECT id, display_name FROM members')).toEqual([{ id: 'm1', display_name: 'A' }]);
      expect(d1.rows("SELECT icon_key FROM channels WHERE id = 'ch_1'")).toEqual([{ icon_key: 'preset:chat' }]);
      for (const table of ['sticker_objects', 'sticker_thumbs', 'member_stickers', 'sticker_counts', 'sticker_daily']) {
        expect(count(d1, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
      }
    } finally {
      d1.close();
    }
  });

  describe('constraints', () => {
    let d1: SqliteD1;

    beforeEach(() => {
      d1 = createSqliteD1();
      member(d1, 'm1');
      member(d1, 'm2');
    });

    afterEach(() => {
      d1.close();
    });

    it('gives a file row the documented defaults and refuses values outside its CHECKs', () => {
      d1.rows("INSERT INTO sticker_objects (id, type, width, height, bytes, created_by, created_at) VALUES (?, 'png', 10, 20, 30, 'm1', ?)", STICKER, NOW);
      expect(d1.rows('SELECT animated, state, sent_at, sweep_at, blocked_at, reserves FROM sticker_objects')).toEqual([
        { animated: 0, state: 'pending', sent_at: null, sweep_at: null, blocked_at: null, reserves: 1 },
      ]);
      // reserves starts at 1 for the reserve that wrote the row and can never be unset or fall to 0.
      // reserves 从写入这条记录的那次预留的 1 开始，永远不能为空，也不能降到 0。
      expect(() => d1.rows('UPDATE sticker_objects SET reserves = 0')).toThrow(/CHECK constraint/);
      expect(() => d1.rows('UPDATE sticker_objects SET reserves = NULL')).toThrow(/NOT NULL constraint/);
      expect(() => object(d1, OTHER, 'm1', { type: 'jpg' })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { type: 'svg' })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { width: 0 })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { height: -1 })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { bytes: 0 })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { animated: 2 })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'm1', { state: 'gone' })).toThrow(/CHECK constraint/);
      expect(() => object(d1, OTHER, 'nobody')).toThrow(/FOREIGN KEY constraint/);
      for (const state of ['pending', 'ready', 'deleting']) d1.rows('UPDATE sticker_objects SET state = ? WHERE id = ?', state, STICKER);
      expect(() => d1.rows("UPDATE sticker_objects SET type = 'bmp'")).toThrow(/CHECK constraint/);
    });

    it('keeps one collection row per member and file, and gives counters their defaults', () => {
      object(d1, STICKER, 'm1');
      collect(d1, 'm1', STICKER, 1);
      expect(() => collect(d1, 'm1', STICKER, 2)).toThrow(/UNIQUE constraint/);
      expect(() => collect(d1, 'm1', OTHER, 2)).toThrow(/FOREIGN KEY constraint/);
      collect(d1, 'm2', STICKER, 1);
      d1.rows("INSERT INTO sticker_counts (scope) VALUES ('m1'), ('*')");
      expect(d1.rows("SELECT items, live_bytes, version, token FROM sticker_counts WHERE scope = '*'")).toEqual([{ items: 0, live_bytes: 0, version: 0, token: null }]);
      d1.rows("INSERT INTO sticker_daily (day, scope) VALUES ('2026-10-26', 'm1')");
      expect(d1.rows('SELECT uploads, upload_bytes, edits, lists, token FROM sticker_daily')).toEqual([{ uploads: 0, upload_bytes: 0, edits: 0, lists: 0, token: null }]);
      expect(() => d1.rows("INSERT INTO sticker_daily (day, scope) VALUES ('2026-10-26', 'm1')")).toThrow(/UNIQUE constraint/);
      d1.rows("INSERT INTO sticker_daily (day, scope) VALUES ('2026-10-26', '*'), ('2026-10-27', 'm1')");
      expect(count(d1, 'SELECT count(*) AS n FROM sticker_daily')).toBe(3);
    });

    it('cascades a member delete to their collection and keeps the files they created, without a creator', () => {
      object(d1, STICKER, 'm1');
      object(d1, OTHER, 'm2');
      collect(d1, 'm1', STICKER, 1);
      collect(d1, 'm1', OTHER, 2);
      collect(d1, 'm2', STICKER, 1);
      d1.rows("DELETE FROM members WHERE id = 'm1'");
      expect(d1.rows('SELECT member_id, sticker_id FROM member_stickers')).toEqual([{ member_id: 'm2', sticker_id: STICKER }]);
      expect(d1.rows('SELECT id, created_by FROM sticker_objects ORDER BY id')).toEqual([
        { id: STICKER, created_by: null },
        { id: OTHER, created_by: 'm2' },
      ]);
    });

    it('cascades a file delete to its stills, and refuses it while a collection uses the file', () => {
      object(d1, STICKER, 'm1');
      object(d1, OTHER, 'm1');
      d1.rows("INSERT INTO sticker_thumbs (sticker_id, thumb, created_at) VALUES (?, 'AAAAAAAAAAAAAAAAAAAAAA', ?), (?, 'BBBBBBBBBBBBBBBBBBBBBB', ?), (?, 'CCCCCCCCCCCCCCCCCCCCCC', ?)", STICKER, NOW, STICKER, NOW, OTHER, NOW);
      expect(() => d1.rows("INSERT INTO sticker_thumbs (sticker_id, thumb, created_at) VALUES (?, 'AAAAAAAAAAAAAAAAAAAAAA', ?)", STICKER, NOW)).toThrow(/UNIQUE constraint/);
      collect(d1, 'm2', OTHER, 1);
      d1.rows('DELETE FROM sticker_objects WHERE id = ?', STICKER);
      expect(d1.rows('SELECT sticker_id, thumb FROM sticker_thumbs')).toEqual([{ sticker_id: OTHER, thumb: 'CCCCCCCCCCCCCCCCCCCCCC' }]);
      expect(() => d1.rows('DELETE FROM sticker_objects WHERE id = ?', OTHER)).toThrow(/FOREIGN KEY constraint/);
      expect(count(d1, 'SELECT count(*) AS n FROM sticker_objects')).toBe(1);
    });

    it('creates the indexes the sweep, the list and the foreign keys rely on', () => {
      const indexes = d1.rows<{ name: string; tbl_name: string; sql: string }>(
        "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL AND (tbl_name LIKE 'sticker_%' OR tbl_name = 'member_stickers') ORDER BY name",
      );
      expect(indexes.map((index) => `${index.tbl_name}.${index.name}`)).toEqual([
        'member_stickers.member_stickers_order',
        'member_stickers.member_stickers_sticker',
        'sticker_objects.sticker_objects_creator',
        'sticker_objects.sticker_objects_sweep',
      ]);
      expect(indexes.find((index) => index.name === 'sticker_objects_sweep')?.sql).toMatch(/WHERE sent_at IS NULL AND blocked_at IS NULL/);
      const sweep = d1.explain({ sql: 'SELECT id FROM sticker_objects WHERE sent_at IS NULL AND blocked_at IS NULL AND sweep_at <= ? ORDER BY sweep_at LIMIT 50', params: [NOW] }).join('\n');
      expect(sweep).toMatch(/USING INDEX sticker_objects_sweep/);
      const list = d1.explain({ sql: 'SELECT sticker_id FROM member_stickers WHERE member_id = ? ORDER BY position DESC', params: ['m1'] }).join('\n');
      expect(list).toMatch(/USING (COVERING )?INDEX member_stickers_order/);
      expect(list).not.toMatch(/TEMP B-TREE/);
    });
  });
});
