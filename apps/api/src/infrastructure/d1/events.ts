import type { EventRecord } from '@utmmsc/shared';
import { randomId } from '../../domain/crypto/encoding';
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

export async function createEvent(db: D1Database, input: { title: string; startsAt: string; location: string | null; description: string | null; createdBy: string }): Promise<EventRow> {
  const id = randomId('evt');
  await db
    .prepare('INSERT INTO events (id, title, starts_at, location, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, input.title, input.startsAt, input.location, input.description, input.createdBy, nowIso())
    .run();
  const row = await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
  if (!row) throw new Error('event insert did not persist');
  return row;
}

export async function deleteEvent(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
}
