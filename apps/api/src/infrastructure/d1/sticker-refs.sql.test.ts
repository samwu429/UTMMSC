import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findStickerRef } from './sticker-refs';
import { createSqliteD1, sqlite, type SqliteD1 } from './testing/sqlite-d1';

const NOW = '2026-10-26T16:00:00.000Z';
const LATER = '2026-10-26T17:00:00.000Z';
const CREATED = '2026-10-26T15:00:00.000Z';

const READY = 'stk_readyreadyreadyready00';
const STILL = 'stk_stillstillstillstill00';
const PENDING = 'stk_pendingpendingpending0';
const DELETING = 'stk_deletingdeletingdelet0';
const BLOCKED = 'stk_blockedblockedblocked0';
const UNKNOWN = 'stk_unknownunknownunknown0';

describe.skipIf(!sqlite)('findStickerRef', () => {
  let d1: SqliteD1;

  const object = (id: string, state: string, fields: { type?: string; animated?: number; blockedAt?: string | null } = {}) =>
    d1.rows(
      "INSERT INTO sticker_objects (id, type, width, height, bytes, animated, state, created_by, created_at, sweep_at, blocked_at) VALUES (?, ?, 240, 180, 182044, ?, ?, 'm1', ?, ?, ?)",
      id,
      fields.type ?? 'gif',
      fields.animated ?? 1,
      state,
      CREATED,
      CREATED,
      fields.blockedAt ?? null,
    );

  const sentAt = (id: string) => d1.rows<{ sent_at: string | null }>('SELECT sent_at FROM sticker_objects WHERE id = ?', id)[0]?.sent_at;

  beforeEach(() => {
    d1 = createSqliteD1();
    d1.rows(
      "INSERT INTO members (id, email, display_name, password_hash, status, role, enrollment_status, graduation_year, created_at, updated_at) VALUES ('m1', 'm1@mail.utoronto.ca', 'A', 'x', 'active', 'student', 'student', 2026, ?, ?)",
      CREATED,
      CREATED,
    );
    object(READY, 'ready');
    object(STILL, 'ready', { type: 'png', animated: 0 });
    object(PENDING, 'pending');
    object(DELETING, 'deleting');
    object(BLOCKED, 'ready', { blockedAt: CREATED });
  });

  afterEach(() => d1.close());

  it('gives a ready file its description, without a still', async () => {
    expect(await findStickerRef(d1.db, READY, NOW)).toEqual({ id: READY, type: 'gif', width: 240, height: 180, animated: true, bytes: 182044 });
    expect(await findStickerRef(d1.db, STILL, NOW)).toEqual({ id: STILL, type: 'png', width: 240, height: 180, animated: false, bytes: 182044 });
  });

  it('sets sent_at on the first send only, which takes the file out of the sweep', async () => {
    expect(sentAt(READY)).toBeNull();
    await findStickerRef(d1.db, READY, NOW);
    expect(sentAt(READY)).toBe(NOW);
    expect(await findStickerRef(d1.db, READY, LATER)).toMatchObject({ id: READY });
    expect(sentAt(READY)).toBe(NOW);
    const swept = d1.rows('SELECT id FROM sticker_objects INDEXED BY sticker_objects_sweep WHERE sent_at IS NULL AND blocked_at IS NULL AND sweep_at <= ?', LATER);
    expect(swept).not.toContainEqual({ id: READY });
  });

  it('gives null for pending, deleting, blocked and unknown ids, and marks none of them sent', async () => {
    for (const id of [PENDING, DELETING, BLOCKED, UNKNOWN]) expect(await findStickerRef(d1.db, id, NOW), id).toBeNull();
    for (const id of [PENDING, DELETING, BLOCKED]) expect(sentAt(id), id).toBeNull();
  });

  it('runs one batch of two primary-key statements, and none for a malformed id', async () => {
    d1.statements.length = 0;
    await findStickerRef(d1.db, READY, NOW);
    expect(d1.statements).toHaveLength(2);
    for (const statement of d1.statements) {
      const plan = d1.explain(statement).join('\n');
      expect(plan).toMatch(/sqlite_autoindex_sticker_objects_1 \(id=\?\)/);
      expect(plan).not.toMatch(/SCAN/);
    }
    d1.statements.length = 0;
    expect(await findStickerRef(d1.db, 'stk_short', NOW)).toBeNull();
    expect(await findStickerRef(d1.db, `sticker/${READY}.gif`, NOW)).toBeNull();
    expect(d1.statements).toHaveLength(0);
  });

  it('throws when the table is missing, for the caller to answer unavailable', async () => {
    const old = createSqliteD1({ migrate: false });
    try {
      old.migrate({ to: 18 });
      await expect(findStickerRef(old.db, READY, NOW)).rejects.toThrow(/no such table/);
    } finally {
      old.close();
    }
  });
});
