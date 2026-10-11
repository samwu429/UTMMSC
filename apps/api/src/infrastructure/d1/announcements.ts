import { randomId } from '../../domain/crypto/encoding';
import { nowIso } from './time';

export async function recordAnnouncement(db: D1Database, input: { title: string; body: string; sentBy: string; recipientCount: number; emailed: boolean }): Promise<void> {
  await db
    .prepare('INSERT INTO announcements (id, title, body, sent_by, sent_at, recipient_count, emailed) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(randomId('ann'), input.title, input.body, input.sentBy, nowIso(), input.recipientCount, input.emailed ? 1 : 0)
    .run();
}
