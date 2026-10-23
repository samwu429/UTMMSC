import type { EventNotificationKind, EventRecord } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
import { isMissingSchemaError } from './channels';
import { insertNoticeStatements, type EventNoticeRow } from './event-notifications';
import { nowIso } from './time';

export interface EventRow {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
  description: string | null;
  created_by: string;
  created_at: string;
}

export function toEvent(row: EventRow): EventRecord {
  return { id: row.id, title: row.title, startsAt: row.starts_at, location: row.location, description: row.description };
}

export async function listUpcomingEvents(db: D1Database, limit: number): Promise<EventRow[]> {
  const result = await db
    .prepare('SELECT * FROM events WHERE starts_at >= ? ORDER BY starts_at ASC LIMIT ?')
    .bind(nowIso(), limit)
    .all<EventRow>();
  return result.results;
}

export async function listAllEvents(db: D1Database): Promise<EventRow[]> {
  const result = await db.prepare('SELECT * FROM events ORDER BY starts_at DESC LIMIT 200').all<EventRow>();
  return result.results;
}

export async function findEvent(db: D1Database, id: string): Promise<EventRow | null> {
  return db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
}

export interface CreateEventInput {
  title: string;
  startsAt: string;
  location: string | null;
  description: string | null;
  createdBy: string;
}

/**
 * Writes the event and its planned notices in one batch. Before migration 0015 the notices are left
 * out and the event is still created.
 * 在同一批中写入活动及其通知计划。迁移 0015 之前不写通知计划，活动照常创建。
 */
export async function createEvent(
  db: D1Database,
  input: CreateEventInput,
  notices: readonly { kind: EventNotificationKind; sendAt: string }[] = [],
): Promise<{ row: EventRow; notices: EventNoticeRow[] }> {
  const id = randomId('evt');
  const ts = nowIso();
  const insertEvent = () =>
    db
      .prepare('INSERT INTO events (id, title, starts_at, location, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, input.title, input.startsAt, input.location, input.description, input.createdBy, ts);
  try {
    await db.batch([insertEvent(), ...insertNoticeStatements(db, id, notices, ts)]);
  } catch (err) {
    if (notices.length === 0 || !isMissingSchemaError(err)) throw err;
    // The failed batch rolled back, so the event row is written on its own.
    // 失败的一批已整体回滚，因此单独写入活动行。
    await insertEvent().run();
  }
  const row = await findEvent(db, id);
  if (!row) throw new Error('event insert did not persist');
  let saved: EventNoticeRow[] = [];
  if (notices.length > 0) {
    try {
      const result = await db.prepare('SELECT * FROM event_notifications WHERE event_id = ? ORDER BY send_at ASC, id ASC').bind(id).all<EventNoticeRow>();
      saved = result.results;
    } catch (err) {
      if (!isMissingSchemaError(err)) throw err;
    }
  }
  return { row, notices: saved };
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
}
