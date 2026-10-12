import { nowIso } from './time';

export async function listPins(db: D1Database, memberId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT app_id FROM miniapp_pins WHERE member_id = ? ORDER BY created_at DESC')
    .bind(memberId)
    .all<{ app_id: string }>();
  return result.results.map((row) => row.app_id);
}

export async function pinMiniApp(db: D1Database, memberId: string, appId: string): Promise<void> {
  await db
    .prepare('INSERT INTO miniapp_pins (member_id, app_id, created_at) VALUES (?, ?, ?) ON CONFLICT (member_id, app_id) DO NOTHING')
    .bind(memberId, appId, nowIso())
    .run();
}

export async function unpinMiniApp(db: D1Database, memberId: string, appId: string): Promise<void> {
  await db.prepare('DELETE FROM miniapp_pins WHERE member_id = ? AND app_id = ?').bind(memberId, appId).run();
}
